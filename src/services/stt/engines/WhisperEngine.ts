import type {ASREngine, ASRStreamEvent, STTASREngineId} from '../types';

/**
 * Whisper ASR via whisper.rn — the fallback ASR engine. NOT YET WIRED.
 *
 * Kept as a selectable option (STTStore.asrEngine = 'whisper') so users can
 * fall back if Moonshine's accuracy or op-compat disappoints. Until wired,
 * every method throws a clear NotImplemented; the UI surfaces lastError.
 *
 * When implementing: wrap @mybigday/whisper.rn behind this same interface —
 * offline transcribe() maps to transcribeFile(), streaming maps to
 * startRealtime()/onRealtime. The orchestrator and store need no changes.
 */
const NOT_IMPLEMENTED = (fn: string): Error =>
  new Error(
    `[WhisperEngine] ${fn}() not implemented — wire @mybigday/whisper.rn to enable the 'whisper' ASR fallback.`,
  );

export class WhisperEngine implements ASREngine {
  readonly id: STTASREngineId = 'whisper';

  async isAvailable(): Promise<boolean> {
    return false;
  }

  async init(): Promise<void> {
    throw NOT_IMPLEMENTED('init');
  }

  async transcribe(): Promise<string> {
    throw NOT_IMPLEMENTED('transcribe');
  }

  async startStream(_onEvent: (e: ASRStreamEvent) => void): Promise<string> {
    throw NOT_IMPLEMENTED('startStream');
  }

  async feedStream(): Promise<void> {
    throw NOT_IMPLEMENTED('feedStream');
  }

  async endStream(): Promise<void> {
    throw NOT_IMPLEMENTED('endStream');
  }

  async cancelStream(): Promise<void> {
    throw NOT_IMPLEMENTED('cancelStream');
  }

  async release(): Promise<void> {
    /* no-op until wired */
  }
}
