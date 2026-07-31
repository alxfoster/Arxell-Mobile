# Voice Transcription Reliability and Latency Plan

Status: implementation in progress.

## Implementation progress

Implemented in the first reliability pass:

- replaced repeated full-utterance partial decoding with a real Moonshine stream;
- switched the production download/model architecture to `tiny-streaming` (~52 MB);
- added ordered 200 ms native feed batching and stream start/flush/remove lifecycle;
- added line-ID transcript assembly so completed lines remain stable without prematurely ending long prompts;
- retained Silero as the single utterance endpointer with onset hysteresis, adaptive energy fallback, and pre-roll;
- made explicit stop drain accepted VAD audio and flush all queued ASR batches;
- added stale-session guards and preserved pre-existing typed composer text;
- added architecture-specific model directories, weighted progress, and atomic partial-file downloads;
- added a short warm-model cache with immediate background release;
- added deterministic tests for queued-tail draining, stream lifecycle, multi-line assembly, stale updates, and model installation.

Still required before calling the work production-validated:

- physical Android/iOS testing with the actual native model and 50–60 word prompts;
- latency/WER measurements on the supported device floor;
- tuning of feed interval, VAD thresholds, and the 30-second warm cache from those measurements;
- native sample-accounting/diagnostic UI if device traces reveal unexplained loss.

## Problem statement

A long spoken prompt currently produces an early partial transcript, then appears to freeze while the remaining text arrives tens of seconds later. Some spoken words also never appear in the composer. The desired behavior is:

- text begins appearing quickly and continues updating while the user speaks;
- a 50–60 word prompt does not stall or lose its tail;
- stopping the microphone never drops queued audio;
- the final transcript is authoritative and arrives shortly after speech ends;
- the implementation remains fully on-device and behaves predictably on supported Android and iOS devices.

## Findings from the current mobile implementation

### 1. The default path repeatedly re-transcribes the entire growing utterance

`src/services/stt/index.ts` runs `engine.transcribe(utterance.slice(), ...)` approximately every 750 ms. Each request is an **offline transcription of all audio captured so far**, not an incremental decode.

This creates work that grows roughly like:

- partial 1: decode the first slice;
- partial 2: decode the first slice again plus new audio;
- partial 3: decode all prior audio again plus more audio;
- final: decode the complete prompt once more.

Only one partial may be in flight, so once a longer partial takes several seconds, every scheduled update is skipped. Finalization then waits for that stale partial and performs another full transcription. This is the most likely explanation for “the first 7 or 8 words appear, then the input freezes for 20–30 seconds.” A smaller **offline** model would reduce the cost but would not fix this architecture.

### 2. Recognition blocks endpoint processing and finalization

The same native transcriber is used for partial and final offline calls. `finalize()` waits for `partialInFlight`, and the VAD pump awaits `finalize()`. During that time microphone buffers continue to accumulate but cannot influence endpoint decisions. After the final callback, the remaining queued buffers can be discarded as teardown audio.

Capture/VAD, recognition, and UI publication therefore do not have independent progress. Slow inference can make the whole voice session look frozen and can hide resumed speech.

### 3. The existing “basic” streaming path is not a complete Moonshine stream lifecycle

The package API expects the lifecycle:

1. create a stream;
2. start the stream;
3. add ordered audio;
4. stop/flush the stream;
5. remove the stream.

The current adapter creates a stream but does not call `startStream()`. Its `endStream()` is a no-op, teardown calls offline cancellation rather than stopping/removing the stream, and the loaded architecture is `base`, not `base-streaming` or `tiny-streaming`.

There is also an event-semantics issue: Moonshine `lineCompleted` means a transcript **line** became stable; it does not necessarily mean the user’s whole utterance ended. Treating the first completed line as the session final can truncate a long prompt around the first sentence/line.

### 4. Streaming audio is sent as many unsequenced fire-and-forget bridge calls

The capture callback emits roughly 32 ms buffers. Each is converted from `Float32Array` to a JavaScript `number[]` and sent without awaiting the previous call. In Moonshine’s Android bridge, every `addAudioToStream` also invokes stream transcription and emits updates. This can produce excessive bridge traffic, native decode calls, allocations, and an unbounded promise backlog.

The Moonshine package itself recommends reasonably sized PCM chunks (roughly 100–250 ms) for legacy native bridges.

### 5. The transcript has no utterance identity or ordering contract

Callbacks contain only text. There is no session ID, utterance ID, event sequence, or stable/provisional distinction. A late partial from an old decode can therefore overwrite newer text unless every lifecycle race happens exactly as expected.

`ChatView` also replaces the entire composer with each partial and clears it when speech starts. That can erase a pre-existing typed draft and makes corrections/finals harder to merge safely.

### 6. VAD and capture need stronger backpressure and diagnostics

Positive elements already present include 16 kHz mono capture, Silero recurrent state, audio-duration endpointing, pre-roll, and draining queued audio on explicit stop. The current uncommitted work improves cold-start and tail capture, but it does not remove repeated full-prefix inference.

Remaining risks include:

- an unbounded `pending` array if JavaScript/ONNX processing falls behind;
- a fixed RMS `OR` threshold that can hold speech open in steady background noise;
- no onset hysteresis, so one high-energy frame can start an utterance;
- no sample sequence or accounting to prove that capture, VAD, and ASR consumed the same audio;
- model load/release on every utterance, which adds cold-start latency and creates lifecycle races;
- expensive base64 decoding and per-sample JavaScript array copies on the hot path.

## Useful ideas from the desktop Arxell implementation

The desktop implementation has several patterns worth retaining:

- serialized ingest/transcription queues rather than uncontrolled fire-and-forget work;
- an utterance ID attached to partial and final events;
- pre-speech audio, start/end hysteresis, minimum/maximum utterance lengths, and an explicit flush path;
- separation between the continuous audio ingest path and transcript events;
- queue, VAD, and latency diagnostics;
- deterministic stream reset at the start of a session.

It should not be copied literally. Its fallback paths can also repeatedly transcribe growing buffers, and it has both frontend and backend segmentation paths. Mobile should have one production segment owner and one incremental ASR stream, avoiding duplicate endpoint decisions and full-prefix partial decoding.

## Recommended target architecture

```text
Microphone (16 kHz mono PCM)
  -> lossless sequenced capture ring
       -> Silero VAD/control lane (small frames, always progresses)
       -> Moonshine streaming lane (serialized 100–250 ms batches)
            -> stable-line + provisional-line assembler
                 -> ordered partial events
Silero endpoint / explicit stop
  -> seal utterance audio
  -> stop and flush Moonshine stream
  -> authoritative final event
  -> optional auto-submit
```

The key rule is: **never run periodic offline transcription over the complete growing utterance.** Offline decoding remains a bounded recovery path, not the live partial path.

### Capture and control lane

- Assign every captured buffer a session ID, monotonically increasing sequence, sample start/end offsets, and capture timestamp.
- Keep VAD frames small (512 samples for the current Silero model), but aggregate adjacent PCM into 160–240 ms batches before crossing into Moonshine.
- Use one ordered ASR feed queue with one native call in flight. Adjacent queued batches may be coalesced, but samples must never be discarded or reordered.
- Track captured, VAD-consumed, ASR-fed, and finalized sample counts. A mismatch becomes an explicit error/metric, not silent truncation.
- Put a bounded-duration ring around captured PCM. If processing falls behind, show a recoverable “processing slowly” state and use a sealed-buffer recovery decode; never silently drop the oldest or newest speech.
- Keep VAD/control work independent of ASR inference so an ASR stall cannot prevent endpoint detection or explicit stop.
- Add onset/offset hysteresis and adaptive energy fallback. Silero should be authoritative when healthy; RMS should be a calibrated fallback, not an unconditional noisy-room override.

### Incremental Moonshine lane

- Use a real streaming model and lifecycle (`createStream`, `startStream`, ordered `addAudioToStream`, `stopStream`, `removeStream`).
- Configure a measured update interval rather than forcing inference for every 32 ms recorder callback.
- Assemble transcript by Moonshine line ID:
  - completed lines are stable text;
  - the active line is provisional and may be revised;
  - `lineCompleted` commits a line but does not end the utterance;
  - Silero or explicit user stop owns utterance completion.
- On endpoint, stop/flush the stream and wait for its final line events with a short timeout. Publish one authoritative final assembled transcript. Do not launch another complete offline decode during the normal path.
- Tag all native events with session/utterance generation and sequence. Drop events from closed generations.
- Add cancellation and timeout handling for stream creation, feed, flush, and release.

### Model strategy

Benchmark these as distinct products rather than only changing the current `MODEL_ARCH` constant:

1. `tiny-streaming` — proposed default candidate for responsive dictation;
2. `base-streaming` — quality option for devices that sustain real-time decoding;
3. current `base` offline — fallback/reference only.

The likely product choice is **tiny-streaming by default**, with `base-streaming` optional or selected by an “Auto” device profile. The decision must be based on word error rate and real-time factor on low-, mid-, and high-tier devices. Tiny offline would improve the current symptom but retain the freeze-prone repeated-work design.

Model storage should use per-architecture directories and an install manifest with size/checksum/version. The current shared filenames are not sufficient for safely installing tiny/base and streaming/non-streaming variants together. Downloads should be atomic, and existing base installs need an explicit migration path.

### Engine lifetime

- Separate “voice session ended” from “model must be unloaded.”
- Keep the selected transcriber warm for a short idle period so consecutive mic taps do not reload ~52 MB of model assets.
- Release on app background, memory pressure, model change, or idle timeout.
- Measure the memory tradeoff with an LLM loaded; use a conservative device-memory policy instead of always keeping both resident.

### Composer integration

Represent voice input as structured state rather than one mutable string:

- `draftPrefix`: text that existed before the mic started;
- `stableVoiceText`: completed Moonshine lines;
- `provisionalVoiceText`: current revisable line;
- `finalVoiceText`: authoritative utterance final.

Only replace the voice-owned span. Preserve typed text, do not clear the composer for an empty “speech started” event, and never allow an older partial to replace a newer partial/final. Auto-submit only after the authoritative final is published and only for the active utterance.

## Delivery plan

### Phase 0 — Instrument and reproduce before changing behavior

Add development-only timing and sample-accounting events for:

- mic callback sequence and sample count;
- capture/VAD/ASR queue depth and oldest-buffer age;
- VAD probability, RMS, speech start/end offsets;
- model load time;
- each ASR feed start/end and batch duration;
- Moonshine line ID/type, native `lastTranscriptionLatencyMs`, and UI apply time;
- endpoint-to-final and stop-to-final latency;
- captured versus fed versus finalized sample totals.

Create a deterministic PCM replay harness so the same 5 s, 20 s, and 60 s recordings can be fed without a live microphone. Confirm the current freeze and identify whether time is spent in JS queueing, the native bridge, or inference.

**Exit criterion:** a trace explains every captured sample and reproduces the stall on at least one physical device.

### Phase 1 — Validate Moonshine’s native streaming contract

Build a small internal spike using the installed `@siteed/moonshine.rn` version:

- verify the exact files/directories required by `tiny-streaming` and `base-streaming`;
- verify create/start/feed/stop/remove on both Android and iOS;
- confirm event ordering and whether stop resolves before or after flush events;
- confirm long prompts produce multiple `lineCompleted` events on one stream;
- measure update interval, feed batch size, real-time factor, warm/cold startup, memory, and WER;
- test 100, 160, 200, and 250 ms feed batches.

If the package cannot provide reliable stream ordering/flush semantics, fix or pin the native wrapper before redesigning application code around assumptions.

**Exit criterion:** one streaming architecture processes a 60 s clip in real time with ordered partials and a complete flush.

### Phase 2 — Introduce explicit session and transcript contracts

Update the STT abstractions to carry:

- session and utterance IDs;
- event sequence and audio sample offsets;
- stable/provisional/final event types;
- stream lifecycle and flush results;
- cancellation/timeouts;
- diagnostic counters.

Implement and unit-test a line-ID transcript assembler independently of React Native and Moonshine.

**Exit criterion:** delayed, duplicated, revised, and out-of-order synthetic events cannot regress or truncate displayed/final text.

### Phase 3 — Replace full-prefix partial decoding with streaming ASR

- Make the Silero path feed a correctly started streaming transcriber.
- Batch and serialize native audio calls with explicit backpressure.
- Keep Silero as the single utterance endpointer.
- Commit Moonshine lines without ending the session.
- Flush the stream on Silero endpoint or explicit stop.
- Remove periodic `engine.transcribe(utterance.slice())` from the production partial path.
- Retain the sealed utterance PCM only for diagnostics and bounded failure recovery.

**Exit criterion:** no normal live session invokes complete offline transcription for each partial or after a successful stream flush.

### Phase 4 — Make capture and teardown lossless

- Formalize captured/VAD-fed/ASR-fed sample accounting.
- Drain/coalesce every accepted audio buffer before explicit-stop flush.
- Make start/stop idempotent and generation-safe under rapid taps.
- Prevent release while feed/flush is active.
- Add watchdog behavior for a stalled native feed and a clear user-visible recoverable error.
- Keep the transcriber warm according to the memory policy.

**Exit criterion:** injected slow-native tests and rapid start/stop tests show zero unexplained sample loss and no cross-session callbacks.

### Phase 5 — Correct composer merging and auto-submit

- Add the stable/provisional voice transcript representation.
- Preserve pre-existing typed drafts.
- Ignore stale session generations and sequences.
- Apply the final atomically before auto-submit.
- Keep final text in the composer when auto-submit is disabled.

**Exit criterion:** typed text plus revised partials plus a delayed final always produces the expected composer content exactly once.

### Phase 6 — Model selection and rollout

- Ship `tiny-streaming` to an internal/beta cohort first.
- Compare it with `base-streaming` using the same recorded corpus and device matrix.
- Choose default thresholds by measured real-time factor and WER.
- Migrate model storage/download UI and update the stated download size.
- Keep a remote-free local feature flag to revert to the prior endpoint mode during beta, but do not silently revert to repeated full-prefix decoding in production.

**Exit criterion:** the selected default meets the latency/reliability targets below across the supported device floor.

## Test plan

### Deterministic unit tests

- transcript line added, revised, completed, duplicated, and delivered out of order;
- late partial after final;
- old-session event after a new session starts;
- queue coalescing preserves every sample in order;
- explicit stop during VAD, native feed, and flush;
- endpoint while a feed is queued;
- native stream timeout/error and bounded fallback;
- pre-roll and trailing-silence sample boundaries;
- existing draft plus stable/provisional/final voice text.

### Integration tests with recorded PCM

Use a small checked-in or CI-downloaded privacy-safe corpus covering:

- 2–5 word command;
- 50–60 word continuous prompt;
- 60 s maximum-length prompt;
- natural 300–1000 ms pauses;
- quiet onset and final consonants;
- noisy room, fan, keyboard, and car noise;
- accented English and supported non-English languages;
- speech resumed near the endpoint boundary.

Compare streaming final text with a one-shot reference decode and assert sample-accounting invariants.

### Physical-device matrix

At minimum:

- lowest supported Android performance tier;
- representative mid-tier Android;
- recent flagship Android;
- oldest supported iPhone;
- recent iPhone;
- warm and cold model, with and without an LLM resident.

Also test Bluetooth/headset microphones, TTS-to-STT handoff, app backgrounding, permission denial, interruptions, and repeated mic taps.

## Acceptance targets

Targets should be captured as p50/p95 by device class. Initial release gates:

- first meaningful partial: p95 under 1.5 s after speech begins;
- continued partial cadence while speaking: no unexplained gap over 1.5 s when the ASR real-time factor is below 1;
- endpoint/explicit-stop to authoritative final: p95 under 1.5 s on supported mid-tier devices, under 2.5 s on the device floor;
- 60 s input: no freeze longer than 2 s and no unexplained captured-sample loss;
- 50–60 word prompt: final completeness statistically equivalent to the one-shot reference within the agreed WER tolerance;
- zero stale partials applied after final and zero cross-session transcript updates;
- no unbounded capture, feed, or promise queue;
- memory remains within the agreed budget with the normal chat LLM loaded.

## Rollback and fallback behavior

- Keep model/stream rollout behind a persisted local capability flag during beta.
- If streaming initialization fails, show a clear error or use **one bounded decode of the sealed utterance** after recording; do not restart periodic whole-prefix partial decoding.
- If base-streaming cannot sustain real time, select tiny-streaming for that device/session.
- If Silero fails to initialize, use a calibrated hysteretic energy endpoint and report the fallback in diagnostics.
- Preserve the captured utterance until final success/failure so a transient ASR error can be retried without asking the user to speak again.

## Recommended implementation order by area

1. `src/services/stt/engines/MoonshineEngine.ts` — validated streaming lifecycle, line assembler inputs, timeout/cancellation.
2. `src/services/stt/types.ts` — session IDs, ordered stable/provisional/final contracts.
3. `src/services/stt/index.ts` — independent VAD/control lane, serialized batched ASR lane, lossless stop/flush.
4. `src/services/stt/models.ts` — streaming variants, per-model directories, manifests, migration.
5. `src/services/stt/audio/AudioCapture.ts` — sample accounting and lower-copy batching; evaluate a native/JSI PCM path only if profiling proves the base64 bridge remains a bottleneck.
6. `src/store/STTStore.ts` and `src/components/ChatView/ChatView.tsx` — generation-safe structured transcript and composer merge.
7. Tests and physical-device benchmark tooling before changing the default model.

The central recommendation is to fix the incremental pipeline first, then select tiny versus base with measurements. Switching to tiny alone may make the current failure less visible, but a properly batched `tiny-streaming` pipeline is the strongest candidate for the elegant, low-latency, reliable default requested here.
