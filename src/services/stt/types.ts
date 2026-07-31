/**
 * Speech-to-Text (STT) — on-device, offline, private.
 *
 * Architecture mirrors the TTS subsystem (services/tts + store/TTSStore):
 * a runtime facade (`sttRuntime`) over swappable engines/strategies, owned
 * by an observable store (`STTStore`).
 *
 * Target pipeline (wired in the follow-up "audio pipeline" PR):
 *   mic (PCM 16 kHz mono)
 *     -> Silero VAD (on the existing onnxruntime-react-native)
 *     -> gated speech segments
 *     -> ASR engine (Moonshine primary, Whisper fallback)
 *     -> streaming transcript
 *
 * Phasing:
 *  - v1: tap-to-dictate. Tap mic -> listen -> Silero endpoint -> fill input
 *    -> auto-submit. Single utterance. Foreground only.
 *  - v2a: wake-word trigger via OpenWakeWord (on onnxruntime), foreground.
 *  - v2a+: optional mic foreground service for background (screen-on) listening.
 *  - v2b: SystemHotwordTrigger (default-assistant DSP path) for locked/asleep.
 *
 * Only ONE mic-owning trigger source may be active at a time — see the design
 * notes on Path A vs Path C non-concurrency (they are alternative trigger
 * sources, never concurrent). The TriggerSource interface below is the seam.
 *
 * Engine notes:
 *  - ASR defaults to Moonshine via @siteed/moonshine.rn (native TurboModule,
 *    MIT). It takes decoded PCM + emits incremental transcript events —
 *    ideal for a VAD-gated, mic-owned pipeline.
 *  - @siteed/moonshine.rn declares minSdkVersion 35 (Android 15). The app's
 *    minSdk is also 35, so the gate in sttRuntime.isASREngineSupported()
 *    is satisfied on every supported device; it is kept as a defensive
 *    check in case the app minSdk is ever lowered.
 *  - Whisper via whisper.rn remains a selectable fallback ASR engine.
 */

/** Which voice-activity/endpoint detector owns the "user stopped speaking" signal. */
export type STTEndpointStrategyId = 'disabled' | 'basic' | 'silero';

/**
 * - `disabled`: STT is off entirely (no mic button). Doubles as the feature
 *   gate while the subsystem matures.
 * - `basic`: energy/segment-based endpointing (whisper.rn realtime path, or
 *   a simple energy detector). Coarse; kept as a selectable fallback.
 * - `silero`: frame-level Silero VAD on onnxruntime-react-native. Default.
 *   Gates audio before ASR (prevents Whisper/Moonshine silence hallucination)
 *   and provides precise endpointing for auto-submit.
 */
export type STTEndpointSetting = STTEndpointStrategyId;

/** Which ASR model transcribes gated speech. */
export type STTASREngineId = 'moonshine' | 'whisper';

/** Persisted user settings. Mirrors the TTSStore persistence pattern. */
export interface STTSettings {
  endpoint: STTEndpointStrategyId;
  /** Trailing-silence duration (ms) before an utterance is considered
   *  complete. Applies to both 'basic' and 'silero' endpointers. */
  endpointSilenceMs: number;
  /** When true, the finalized transcript is submitted automatically on
   *  endpoint. When false, the transcript is left in the input for review. */
  autoSubmit: boolean;
  /** ASR engine selection. */
  asrEngine: STTASREngineId;
}

/** Lifecycle of a single dictation session. */
export type STTSessionState =
  | {mode: 'idle'}
  | {mode: 'listening'}
  | {mode: 'processing'}; // endpoint detected, finalizing the utterance

/**
 * A source that can open a dictation session. v1 ships TapButtonTrigger.
 * Later trigger sources (InAppOpenWakeWordTrigger, SystemHotwordTrigger)
 * drop in without changing the VoiceSession — they all just call onTrigger.
 *
 * Only ONE trigger source may own the mic at a time.
 */
export interface TriggerSource {
  readonly id: string;
  start(onTrigger: () => void): Promise<void> | void;
  stop(): Promise<void> | void;
}

/** Callbacks the ASR session emits into the store/UI. */
export interface STTSessionCallbacks {
  /** Partial, potentially-revised transcript for the current utterance
   *  (streams into the chat input as the user speaks). */
  onPartialText: (text: string) => void;
  /** A finalized utterance. */
  onFinalText: (text: string) => void;
  /** The endpointer declared end-of-speech (silence >= endpointSilenceMs). */
  onEndpoint: () => void;
  onError: (err: unknown) => void;
}

/** A streaming-ASR event relayed up to the orchestrator. */
export interface ASRStreamEvent {
  type: 'partial' | 'final';
  text: string;
}

/**
 * ASR engine abstraction. MoonshineEngine (primary) and WhisperEngine
 * (fallback) both implement this so the store/UI never depend on which
 * model is active. Swapping engines is a one-line strategy change.
 *
 * Two modes:
 *  - Offline (transcribe): used by the 'silero' endpoint strategy — VAD hands
 *    the engine a complete gated utterance, it returns the text. This is the
 *    canonical Moonshine path and the most likely to work first-run.
 *  - Streaming (startStream/feedStream/endStream): used by the 'basic'
 *    endpoint strategy — the engine owns mic-driven segmentation + VAD and
 *    emits partial/final events. Engines MAY throw NotImplemented on the
 *    streaming methods (e.g. WhisperEngine until wired).
 */
export interface ASREngine {
  readonly id: STTASREngineId;
  /** True when the native runtime + model files are present AND the platform
   *  meets the engine's requirements (e.g. Android API >= 35 for Moonshine). */
  isAvailable(): Promise<boolean>;
  /** Load the model / create the native transcriber. Idempotent. */
  init(): Promise<void>;
  /** Offline transcription of a complete utterance (float PCM [-1, 1]). */
  transcribe(
    samples: number[],
    sampleRate: number,
    signal?: {aborted: boolean},
  ): Promise<string>;
  /** Open a streaming session. Returns a stream id; push audio via
   *  feedStream; receive partials/finals via onEvent. */
  startStream(onEvent: (e: ASRStreamEvent) => void): Promise<string>;
  feedStream(
    streamId: string,
    samples: number[],
    sampleRate: number,
  ): Promise<void>;
  endStream(streamId: string): Promise<void>;
  cancelStream(streamId: string): Promise<void>;
  /** Release native resources (model sessions). Lazy re-init on next use. */
  release(): Promise<void>;
}
