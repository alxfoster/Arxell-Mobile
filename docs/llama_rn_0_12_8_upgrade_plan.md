# llama.rn 0.12.8 Upgrade Plan

Status: dependency upgrade implemented; physical-device and iOS validation remain.

## Implementation progress

Completed:

- pinned `llama.rn` 0.12.8 in `package.json` and regenerated `yarn.lock`;
- installed and verified the 0.12.8 Android/iOS prebuilt artifact checksum markers;
- updated `ios/Podfile.lock` to record `llama-rn (0.12.8)` (CocoaPods is not available in the current Linux environment, so macOS must still regenerate/verify it);
- confirmed the installed source reports llama.cpp b10156 / `91f8c9c`;
- passed TypeScript and localization validation;
- built Android `prodDebug` and `prodRelease` successfully;
- inspected the packaged arm64 release library and confirmed it contains llama.cpp commit `91f8c9c`.

Outstanding validation:

- macOS CocoaPods install and clean iOS simulator/device builds;
- physical-device CPU, Metal, OpenCL, Hexagon, multimodal, tool-calling, memory, and performance testing;
- full-project lint/test cleanup. The upgrade introduced no TypeScript API changes, and 266 of 270 test suites passed, but the existing tree has unrelated lint failures and 4 failing suites involving Settings expectations, design-token invariants, and stale color snapshots.

## Executive summary

Arxell currently pins `llama.rn` **0.12.7**, which embeds llama.cpp **b10054** (`ac2557c`). Version **0.12.8** embeds llama.cpp **b10156** (`91f8c9c`).

This is a low-risk JavaScript/API update but a medium-risk native-runtime update. The only public TypeScript change is documentation for a new multimodal state sidecar file. However, the llama.cpp sync changes model loading, reasoning/chat parsing, KV-cache handling, OpenCL, Hexagon, Metal, multimodal processing, and several model architectures. The upgrade should therefore be treated as a native inference-engine update rather than a routine patch-package bump.

Recommended outcome: upgrade to 0.12.8 after clean native builds and focused physical-device regression tests, especially Android OpenCL/Hexagon and multimodal multi-turn inference.

## Current integration

- Dependency: exact pin `"llama.rn": "0.12.7"` in `package.json`.
- Lockfile: `yarn.lock` resolves the 0.12.7 npm tarball.
- iOS: CocoaPods consumes `../node_modules/llama.rn`; `ios/Podfile.lock` records `llama-rn (0.12.7)`.
- Android and iOS use llama.rn's downloaded, SHA-256-verified prebuilt native artifacts by default.
- React Native New Architecture is enabled, as required by llama.rn 0.10+.
- Android source compilation is available but disabled: `rnllamaBuildFromSource=true` is commented out.
- There is no local `patch-package` patch for llama.rn.
- The app explicitly exercises CPU, Metal, OpenCL, and Hexagon/device-selection paths.
- The app fixes `n_parallel` to 1 for normal blocking completion.
- The app does not currently pass `save_state_path` or `load_state_path`, so the headline 0.12.8 state-resume fix is not directly consumed today.
- The app explicitly supplies `use_mmap` and `use_mlock`, making the upstream load-mode behavior change relevant to regression testing.

## Upstream changes relevant to Arxell

### Public API compatibility

The JavaScript exports and callable TypeScript API are unchanged. The only `src/types.ts` difference documents that multimodal state saves now create a `<state path>.meta` sidecar. No application source migration should be required.

### llama.cpp update

- llama.cpp moves from **b10054** to **b10156**.
- New model architecture work includes Laguna, MiniMax M3, Nanbeige, GLM-DSA changes, and multimodal additions.
- Chat parsing, reasoning-budget handling, grammar handling, sampling, vocabulary, model loading, and KV-cache internals changed.
- Reasoning end-tag handling now supports multiple end tags internally. This can affect reasoning separation even though Arxell does not use reasoning budgets.

### Multimodal and state handling

- Parallel multimodal state files are made valid and resumable.
- Media placeholders and media identity are preserved through a `.meta` sidecar.
- Slot memory rollback/reuse and prompt checkpointing were substantially revised.
- Arxell does not currently persist llama.rn state files, but it does use multimodal inference. Multi-turn image prompts and transitions back to text therefore need focused testing.

### Native backend changes

- OpenCL adds a program cache, OpenCL 3.0 targeting, an `abs` kernel, and many kernel changes.
- Hexagon/HTP receives broad changes to attention, matrix multiplication, tensor, DMA, and unary operations.
- Metal and generic backend code also changed.
- Android's llama.rn CMake source list changed. This matters if source builds are enabled later, even though production currently uses prebuilt libraries.

### Model loading

The JSI layer now reconciles `use_mmap` and `use_mlock` with llama.cpp's `load_mode`. Arxell supplies both values explicitly, so behavior should remain equivalent, but all supported combinations should be verified for load success and memory use.

## Upgrade procedure

### Phase 0: Capture a 0.12.7 baseline

Before changing the dependency:

1. Record About-screen build info: llama.cpp `10054 (ac2557c)`.
2. Run the existing benchmark matrix on representative physical devices.
3. Save startup time, prompt-processing speed, generation speed, peak memory, backend selection logs, and output correctness.
4. Include at least:
   - Android CPU-only;
   - Android OpenCL on a supported Adreno device;
   - Android Hexagon on a supported Qualcomm device;
   - iOS CPU/Metal;
   - text-only and multimodal models.
5. Preserve native logs so changes in backend selection or silent CPU fallback can be detected.

### Phase 1: Update dependency metadata

1. Change the exact dependency pin in `package.json` from `0.12.7` to `0.12.8`.
2. Run `yarn install` rather than manually editing `yarn.lock`.
3. Confirm `yarn.lock` resolves only `llama.rn@0.12.8` and records the expected npm tarball.
4. Confirm the postinstall downloaded the 0.12.8 artifacts and replaced the old checksum markers:
   - Android artifact SHA-256: `ff2c9f695192343b03a581921a8114c2779743e4f68c1e5a64834e844f862621`;
   - iOS artifact SHA-256: `15be44da28f9a9dcf05bac53c9a4293e344be0dfd3a01d10fb6ba80456860dc9`.
5. Run `pod install` in `ios` and commit the resulting `ios/Podfile.lock` update to `llama-rn (0.12.8)`.
6. Do not enable `rnllamaBuildFromSource` as part of this upgrade; that would introduce a second variable.

Use a clean dependency installation in CI or once locally to prove the artifact installer does not accidentally retain 0.12.7 binaries.

### Phase 2: Static and unit validation

Run:

```bash
yarn typecheck
yarn lint
yarn test --runInBand
yarn l10n:validate
git diff --check
```

Pay particular attention to:

- `llama.rn` mocks and imported types;
- `ModelStore` initialization and release behavior;
- completion cancellation and immediate restart;
- tool-call and reasoning parsing;
- backend device enumeration and benchmark log parsing;
- multimodal message formatting;
- context-setting migrations for `use_mmap`, `use_mlock`, `devices`, `n_parallel`, and flash attention.

No TypeScript adaptation is expected. Any required cast or behavior workaround should be investigated as a possible regression rather than applied blindly.

### Phase 3: Clean native builds

Build from clean native outputs so stale 0.12.7 libraries cannot mask an installation problem.

Android:

```bash
yarn clean:android
yarn build:android
cd android && ./gradlew assembleProdRelease
```

Verify packaged ABIs and inspect native logs/About screen for llama.cpp **b10156 (`91f8c9c`)**.

On a macOS builder, run `pod install`, clear DerivedData as needed, and build both iOS simulator and physical-device configurations. Confirm the About screen reports the same new llama.cpp build.

### Phase 4: Functional regression matrix

#### Core text inference

- Load, generate, stop, unload, and reload multiple GGUF models.
- Test dense, MoE, recurrent/hybrid, and sliding-window models used by the supported catalog.
- Test short and near-context-limit prompts.
- Test cancellation during prompt processing and token generation, followed immediately by another completion.
- Verify deterministic test prompts for gross output corruption, repetition, premature EOS, and malformed UTF-8.

#### Chat, tools, and reasoning

Because upstream chat/reasoning code changed:

- test plain chat templates;
- test native tool calling, generic tool fallback, and parallel tool-call output parsing;
- test models with `<think>`-style reasoning and models with alternate/multiple end markers;
- confirm reasoning does not leak into final answer text or disappear;
- test JSON-schema/grammar-constrained generation.

#### Multimodal

- Submit one image with text and complete successfully.
- Continue the same conversation with text only.
- Reuse the same image, then use a different image.
- Test multiple images where supported.
- Stop during image evaluation and retry.
- Unload/reload the model between multimodal turns.
- Confirm no stale image embedding or cross-turn media reuse.

State-file save/load testing is optional for the current app because those parameters are unused. If state persistence is added later, the `.bin` and `.bin.meta` files must be treated as one lifecycle unit for move, delete, and backup operations.

#### Loading and memory modes

Test the settings Arxell can emit:

- mmap on / mlock off;
- mmap off / mlock off;
- mmap on / mlock on where supported;
- Android `smart` resolution;
- explicit CPU-only and explicit backend device selection.

Confirm load success, expected memory profile, and no regression in model unload/reload.

#### Backend/device matrix

OpenCL and Hexagon require the strongest scrutiny because their upstream diffs are large:

- verify expected backend registration and selected device in native logs;
- detect silent fallback to CPU;
- compare output sanity against CPU;
- run repeated loads and generations to exercise the new OpenCL program cache;
- test app background/foreground and model reload;
- watch for native crashes, hangs, driver errors, and increasing memory.

### Phase 5: Performance acceptance

Compare 0.12.8 to the Phase 0 baseline using identical model files and parameters.

Suggested acceptance thresholds:

- no statistically meaningful correctness regression;
- no backend that previously worked silently falls back to CPU;
- model-load time and time-to-first-token regress by no more than 10% unless explained;
- prompt and generation throughput regress by no more than 5% on stable repeated runs;
- no material sustained-memory increase or leak over repeated load/generate/unload cycles;
- no crash or hang in a 20-cycle smoke test per hardware backend.

Treat improvements as informational; do not change default backend or context settings in the same upgrade.

### Phase 6: Rollout

1. Ship through the normal prerelease/internal track first.
2. Monitor native crash symbols, model-load failures, backend fallback logs, OOM reports, and malformed generation reports.
3. Keep the dependency update isolated from unrelated inference-setting changes so rollback remains straightforward.
4. Expand rollout only after at least one successful physical-device run for each supported backend family.

## Rollback

If acceptance fails:

1. restore `llama.rn` to exact version `0.12.7` in `package.json` and `yarn.lock`;
2. rerun `yarn install` so 0.12.7 prebuilt artifacts replace 0.12.8 artifacts;
3. rerun `pod install` and restore the 0.12.7 Pod lock entry;
4. clean Android/iOS build outputs before rebuilding;
5. verify About reports llama.cpp `10054 (ac2557c)`.

Model files and persisted Arxell settings should not require migration or rollback.

## Acceptance checklist

- [ ] Baseline captured on 0.12.7.
- [x] `package.json` and `yarn.lock` resolve exactly 0.12.8.
- [x] Native artifact checksums match the 0.12.8 manifest.
- [x] `ios/Podfile.lock` records llama-rn 0.12.8 (macOS `pod install` verification remains).
- [ ] Typecheck, lint, localization validation, and unit tests pass (typecheck/localization pass; pre-existing lint and four-suite failures remain).
- [x] Clean Android release build passes.
- [ ] Clean iOS simulator and device builds pass.
- [x] Packaged Android runtime reports llama.cpp b10156 / `91f8c9c`.
- [ ] CPU, Metal, OpenCL, and Hexagon tests pass where hardware is available.
- [ ] Tool calling, reasoning, grammar, and multimodal regressions pass.
- [ ] mmap/mlock combinations behave as expected.
- [ ] Performance and memory remain within thresholds.
- [ ] Internal rollout shows no new native crash or inference-failure signal.
