import {AppState, AppStateStatus} from 'react-native';

import {makeAutoObservable, runInAction} from 'mobx';
import {makePersistable} from 'mobx-persist-store';
import AsyncStorage from '@react-native-async-storage/async-storage';

import {sttRuntime} from '../services/stt';
import {
  areSTTModelsDownloaded,
  downloadSTTModels,
  ensureBundledAssets,
} from '../services/stt/models';
import type {
  STTASREngineId,
  STTEndpointStrategyId,
  STTSessionState,
} from '../services/stt/types';

const DEFAULT_ENDPOINT: STTEndpointStrategyId = 'silero';
const LEGACY_ENDPOINT_SILENCE_MS = 700;
const DEFAULT_ENDPOINT_SILENCE_MS = 1200;
// Hands-free is conversational rather than compositional: once speech ends,
// hand the turn to the model promptly. Single-tap dictation keeps the more
// forgiving 1.2 s threshold so natural mid-sentence pauses are not truncated.
const HANDS_FREE_ENDPOINT_SILENCE_MS = 750;
const DEFAULT_AUTO_SUBMIT = true;
const DEFAULT_ASR_ENGINE: STTASREngineId = 'moonshine';

/**
 * Speech-to-Text store. Coordinates on-device dictation: opens a session on
 * tap, streams partial transcript into the chat input, and (when autoSubmit
 * is on) submits on end-of-speech. Mirrors TTSStore's shape and lifecycle —
 * persisted settings (makePersistable + AsyncStorage), AppState teardown,
 * idempotent init().
 *
 * Feature gate: `endpoint === 'disabled'` hides STT entirely (no mic button).
 * This doubles as the feature flag while the subsystem matures — no separate
 * flag mechanism needed.
 *
 * The store owns lifecycle + observable transcript; the native audio pipeline
 * (mic capture, Silero VAD, Moonshine/Whisper inference) lives behind
 * `sttRuntime` in services/stt and is wired in a follow-up PR. Until then,
 * start()/stop() surface the runtime's deliberate "not implemented" errors
 * via `lastError` so the UI can react.
 *
 * Coordination with TTS: a dictation session and TTS playback should not run
 * simultaneously (they contend for the audio session / AudioFocus). The UI
 * layer is responsible for stopping TTS before starting STT (mirroring how
 * TTS already stops itself on state changes); this may later be enforced
 * here via a cross-store reaction once both subsystems are live.
 */
export class STTStore {
  // Persisted user preferences
  endpoint: STTEndpointStrategyId = DEFAULT_ENDPOINT;
  endpointSilenceMs: number = DEFAULT_ENDPOINT_SILENCE_MS;
  autoSubmit: boolean = DEFAULT_AUTO_SUBMIT;
  asrEngine: STTASREngineId = DEFAULT_ASR_ENGINE;

  // Runtime session state
  sessionState: STTSessionState = {mode: 'idle'};
  /** Live, possibly-revised transcript for the in-flight utterance. */
  partialText: string = '';
  /** Last finalized utterance. ChatView reacts to this to auto-submit. */
  finalText: string = '';
  /** Latched, foreground-only conversation mode. It deliberately is not
   * persisted: reopening Arxell must never surprise the user with a live mic. */
  handsFreeEnabled: boolean = false;
  /** Monotonic VAD event consumed by ChatView to implement barge-in without
   * coupling the audio runtime to generation/TTS stores. */
  speechStartSequence: number = 0;
  lastError: string | null = null;
  /** Model assets are user-installed, never silently fetched on startup. */
  modelsInstalled: boolean = false;
  isInstallingModels: boolean = false;
  modelDownloadProgress: number = 0;

  private initialized: boolean = false;
  private installPromise: Promise<void> | null = null;
  private appStateSubscription: {remove: () => void} | null = null;
  /** Invalidates callbacks that arrive after a newer recording has started. */
  private sessionGeneration: number = 0;

  constructor() {
    makeAutoObservable(this, {}, {autoBind: true});
    makePersistable(this, {
      name: 'STTStore',
      properties: ['endpoint', 'endpointSilenceMs', 'autoSubmit', 'asrEngine'],
      storage: AsyncStorage,
    });
  }

  /** Master availability gate. `disabled` hides STT entirely. */
  get isSTTEnabled(): boolean {
    return this.endpoint !== 'disabled';
  }

  get isListening(): boolean {
    return (
      this.sessionState.mode === 'starting' ||
      this.sessionState.mode === 'listening' ||
      this.sessionState.mode === 'processing'
    );
  }

  /** Initialize. Idempotent — safe to call multiple times. Wire alongside
   *  ttsStore.init() in app startup. */
  async init(): Promise<void> {
    if (this.initialized) {
      return;
    }
    this.initialized = true;

    // v1/v2a are foreground-only. Stop any in-flight session when we leave
    // the foreground; the low-power always-on path (Path A: default-assistant
    // system hotword) is a later milestone and would NOT be torn down here.
    this.appStateSubscription = AppState.addEventListener(
      'change',
      this.handleAppStateChange,
    );
    try {
      // Copy the bundled VAD out of the app bundle before any availability
      // check so `modelsInstalled` reflects reality.
      await ensureBundledAssets();
      this.modelsInstalled = await areSTTModelsDownloaded();
      // 700 ms was too aggressive for natural phrase pauses and frequently
      // finalized while the speaker was beginning their last word. There is
      // currently no UI for customizing this value, so migrate the old default
      // in place while preserving any other programmatic/custom value.
      if (this.endpointSilenceMs === LEGACY_ENDPOINT_SILENCE_MS) {
        runInAction(() => {
          this.endpointSilenceMs = DEFAULT_ENDPOINT_SILENCE_MS;
        });
      }
    } catch (err) {
      console.warn('[STTStore] model availability check failed:', err);
    }
  }

  private handleAppStateChange = (nextAppState: AppStateStatus) => {
    if (nextAppState === 'background' || nextAppState === 'inactive') {
      // Hands-free is intentionally foreground-only. Returning to the app
      // requires another deliberate long press before the mic can reopen.
      this.disableHandsFree()
        .then(() => sttRuntime.release())
        .catch(err => {
          console.warn('[STTStore] background stop failed:', err);
        });
    }
  };

  // --- persisted settings setters -------------------------------------

  setEndpoint(endpoint: STTEndpointStrategyId) {
    this.endpoint = endpoint;
    if (endpoint === 'disabled') {
      this.stop(false).catch(() => {});
    }
  }

  setEndpointSilenceMs(ms: number) {
    // Clamp to a sane range so the slider/stepper can't produce unusable
    // values (too short -> premature submit on mid-utterance pauses;
    // too long -> feels unresponsive).
    this.endpointSilenceMs = Math.max(100, Math.min(5000, Math.round(ms)));
  }

  setAutoSubmit(on: boolean) {
    this.autoSubmit = on;
  }

  setAsrEngine(engine: STTASREngineId) {
    this.asrEngine = engine;
  }

  // --- model installation ---------------------------------------------

  /** Install the Moonshine and Silero assets after an explicit user action.
   *  `onProgress` (0..1) is forwarded from the downloader for UI binding. */
  async installModels(onProgress?: (progress: number) => void): Promise<void> {
    if (this.modelsInstalled) {
      return;
    }
    if (this.installPromise) {
      return this.installPromise;
    }
    this.installPromise = (async () => {
      runInAction(() => {
        this.isInstallingModels = true;
        this.modelDownloadProgress = 0;
        this.lastError = null;
      });
      try {
        await downloadSTTModels(progress => {
          runInAction(() => {
            this.modelDownloadProgress = progress;
          });
          onProgress?.(progress);
        });
        runInAction(() => {
          this.modelsInstalled = true;
          this.modelDownloadProgress = 1;
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        runInAction(() => {
          this.lastError = message;
          this.modelsInstalled = false;
        });
        throw err;
      } finally {
        runInAction(() => {
          this.isInstallingModels = false;
        });
        this.installPromise = null;
      }
    })();
    return this.installPromise;
  }

  // --- session lifecycle ----------------------------------------------

  /** Latch foreground hands-free mode and begin listening. */
  async enableHandsFree(): Promise<void> {
    if (!this.isSTTEnabled || !this.modelsInstalled) {
      return;
    }
    this.handsFreeEnabled = true;
    await this.start();
  }

  /** Turn off hands-free immediately and discard any unfinished utterance. */
  async disableHandsFree(): Promise<void> {
    if (!this.handsFreeEnabled && !this.isListening) {
      return;
    }
    this.handsFreeEnabled = false;
    // Invalidate callbacks before native teardown so a final event racing this
    // tap cannot submit text after the user has switched the microphone off.
    this.sessionGeneration += 1;
    this.partialText = '';
    this.finalText = '';
    await this.stop(false);
  }

  /** Begin a dictation session (tap trigger or a hands-free turn). */
  async start(): Promise<void> {
    if (!this.isSTTEnabled || this.isListening || !this.modelsInstalled) {
      return;
    }
    const generation = ++this.sessionGeneration;
    runInAction(() => {
      this.partialText = '';
      // A hands-free restart may happen before React consumes the preceding
      // final transcript. Keep it until ChatView explicitly clears it.
      if (!this.handsFreeEnabled) {
        this.finalText = '';
      }
      this.lastError = null;
      // The microphone begins buffering immediately, but the native ASR/VAD
      // sessions may still be loading. The button shows a ready indicator and
      // cannot be tapped again during this short transition.
      this.sessionState = {mode: 'starting'};
    });

    try {
      await sttRuntime.startSession(
        {
          endpoint: this.endpoint,
          endpointSilenceMs: this.handsFreeEnabled
            ? Math.min(this.endpointSilenceMs, HANDS_FREE_ENDPOINT_SILENCE_MS)
            : this.endpointSilenceMs,
          asrEngine: this.asrEngine,
        },
        {
          onPartialText: (text: string) => {
            if (generation !== this.sessionGeneration) {
              return;
            }
            runInAction(() => {
              this.partialText = text;
            });
          },
          onFinalText: (text: string) => {
            if (generation !== this.sessionGeneration) {
              return;
            }
            runInAction(() => {
              this.partialText = text;
              this.finalText = text;
              this.sessionState = {mode: 'idle'};
            });
            // A normal tap is one utterance. Hands-free uses the same clean
            // session boundary, then opens a fresh session for the next turn.
            sttRuntime
              .stopSession()
              .then(() => {
                if (
                  generation === this.sessionGeneration &&
                  this.handsFreeEnabled
                ) {
                  return this.start();
                }
              })
              .catch(err => {
                console.warn('[STTStore] endpoint stop/restart failed:', err);
                runInAction(() => {
                  this.handsFreeEnabled = false;
                });
              });
          },
          onSpeechStart: () => {
            if (generation !== this.sessionGeneration) {
              return;
            }
            runInAction(() => {
              this.speechStartSequence += 1;
            });
          },
          onEndpoint: () => {
            if (generation !== this.sessionGeneration) {
              return;
            }
            runInAction(() => {
              this.sessionState = {mode: 'processing'};
            });
          },
          onError: (err: unknown) => {
            if (generation !== this.sessionGeneration) {
              return;
            }
            const message = err instanceof Error ? err.message : String(err);
            console.warn('[STTStore] session error:', message);
            runInAction(() => {
              this.lastError = message;
              this.sessionState = {mode: 'idle'};
              this.handsFreeEnabled = false;
            });
          },
        },
      );
      runInAction(() => {
        if (this.sessionState.mode === 'starting') {
          this.sessionState = {mode: 'listening'};
        }
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.warn('[STTStore] start failed:', message);
      runInAction(() => {
        this.lastError = message;
        this.sessionState = {mode: 'idle'};
        this.handsFreeEnabled = false;
      });
    }
  }

  /** Clear the last finalized utterance. Consumers (ChatView) call this
   *  after handling finalText so two identical consecutive utterances both
   *  re-fire the reaction. */
  clearFinalText() {
    this.finalText = '';
  }

  /** Stop the session. Explicit user stops finalize captured speech; lifecycle
   *  teardown passes false to discard it. */
  async stop(finalize: boolean = true): Promise<void> {
    if (!this.isListening) {
      return;
    }
    runInAction(() => {
      // Keep the button in a busy state until queued audio and final inference
      // complete. Returning to idle early allows a second tap to race the old
      // recorder/transcriber and can truncate either session.
      this.sessionState = finalize ? {mode: 'processing'} : {mode: 'idle'};
    });
    try {
      await sttRuntime.stopSession(finalize);
    } catch (err) {
      console.warn('[STTStore] stop failed:', err);
    } finally {
      // Invalidate any native line event delivered after stop/flush returns.
      this.sessionGeneration += 1;
      // onFinalText also sets idle; this covers silence-only recordings and
      // teardown/error paths where no final callback is emitted.
      runInAction(() => {
        this.sessionState = {mode: 'idle'};
      });
    }
  }
}

export const sttStore = new STTStore();
