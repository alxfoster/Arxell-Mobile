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
const DEFAULT_ENDPOINT_SILENCE_MS = 700;
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
  lastError: string | null = null;
  /** Model assets are user-installed, never silently fetched on startup. */
  modelsInstalled: boolean = false;
  isInstallingModels: boolean = false;
  modelDownloadProgress: number = 0;

  private initialized: boolean = false;
  private installPromise: Promise<void> | null = null;
  private appStateSubscription: {remove: () => void} | null = null;

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
    } catch (err) {
      console.warn('[STTStore] model availability check failed:', err);
    }
  }

  private handleAppStateChange = (nextAppState: AppStateStatus) => {
    if (nextAppState === 'background' || nextAppState === 'inactive') {
      this.stop(false).catch(err => {
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

  /** Begin a dictation session (tap trigger). */
  async start(): Promise<void> {
    if (!this.isSTTEnabled || this.isListening || !this.modelsInstalled) {
      return;
    }
    runInAction(() => {
      this.partialText = '';
      this.finalText = '';
      this.lastError = null;
      this.sessionState = {mode: 'listening'};
    });

    try {
      await sttRuntime.startSession(
        {
          endpoint: this.endpoint,
          endpointSilenceMs: this.endpointSilenceMs,
          asrEngine: this.asrEngine,
        },
        {
          onPartialText: (text: string) => {
            runInAction(() => {
              this.partialText = text;
            });
          },
          onFinalText: (text: string) => {
            runInAction(() => {
              this.finalText = text;
              this.sessionState = {mode: 'idle'};
            });
            // Endpointed sessions are single-utterance. Stop capture and
            // release the native transcriber immediately; otherwise the mic
            // would remain open after the chat has submitted the message.
            sttRuntime.stopSession().catch(err => {
              console.warn('[STTStore] endpoint stop failed:', err);
            });
          },
          onEndpoint: () => {
            runInAction(() => {
              this.sessionState = {mode: 'processing'};
            });
          },
          onError: (err: unknown) => {
            const message = err instanceof Error ? err.message : String(err);
            console.warn('[STTStore] session error:', message);
            runInAction(() => {
              this.lastError = message;
              this.sessionState = {mode: 'idle'};
            });
          },
        },
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.warn('[STTStore] start failed:', message);
      runInAction(() => {
        this.lastError = message;
        this.sessionState = {mode: 'idle'};
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
      this.sessionState = {mode: 'idle'};
    });
    try {
      await sttRuntime.stopSession(finalize);
    } catch (err) {
      console.warn('[STTStore] stop failed:', err);
    }
  }
}

export const sttStore = new STTStore();
