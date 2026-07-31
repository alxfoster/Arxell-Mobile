import {AppState} from 'react-native';

// Mock persistence BEFORE importing the store.
jest.mock('mobx-persist-store', () => ({
  makePersistable: jest.fn().mockReturnValue(Promise.resolve()),
}));

const appStateHandlers: Array<(s: string) => void> = [];
jest.spyOn(AppState, 'addEventListener').mockImplementation(((
  event: string,
  handler: any,
) => {
  if (event === 'change') {
    appStateHandlers.push(handler);
  }
  return {remove: jest.fn()};
}) as any);

// Mock the STT model layer + runtime so the store is unit-testable.
const mockAreSTTModelsDownloaded = jest.fn().mockResolvedValue(false);
const mockDownloadSTTModels = jest.fn().mockResolvedValue(undefined);
const mockEnsureBundledAssets = jest.fn().mockResolvedValue(undefined);
jest.mock('../../services/stt/models', () => ({
  areSTTModelsDownloaded: (...args: any[]) =>
    mockAreSTTModelsDownloaded(...args),
  downloadSTTModels: (...args: any[]) => mockDownloadSTTModels(...args),
  ensureBundledAssets: (...args: any[]) => mockEnsureBundledAssets(...args),
  STTModelNotInstalledError: class extends Error {},
}));

const mockStartSession = jest.fn().mockResolvedValue(undefined);
const mockStopSession = jest.fn().mockResolvedValue(undefined);
const mockRelease = jest.fn().mockResolvedValue(undefined);
jest.mock('../../services/stt', () => ({
  sttRuntime: {
    startSession: (...args: any[]) => mockStartSession(...args),
    stopSession: (...args: any[]) => mockStopSession(...args),
    release: (...args: any[]) => mockRelease(...args),
  },
}));

import {STTStore} from '../STTStore';

describe('STTStore', () => {
  let store: STTStore;

  beforeEach(() => {
    jest.clearAllMocks();
    appStateHandlers.length = 0;
    mockAreSTTModelsDownloaded.mockResolvedValue(false);
    store = new STTStore();
  });

  describe('init()', () => {
    it('registers an AppState listener and reads model availability', async () => {
      mockAreSTTModelsDownloaded.mockResolvedValueOnce(true);
      await store.init();
      expect(appStateHandlers.length).toBe(1);
      expect(store.modelsInstalled).toBe(true);
    });

    it('is idempotent', async () => {
      await store.init();
      await store.init();
      expect(appStateHandlers.length).toBe(1);
    });

    it('migrates the old aggressive endpoint delay', async () => {
      store.endpointSilenceMs = 700;

      await store.init();

      expect(store.endpointSilenceMs).toBe(1200);
    });

    it('tears down on background', async () => {
      await store.init();
      mockStopSession.mockClear();
      // `start` would have set listening; force state then background.
      (store as any).sessionState = {mode: 'listening'};
      appStateHandlers[0]!('background');
      // stop() is fire-and-forget on background.
      await Promise.resolve();
      expect(mockStopSession).toHaveBeenCalled();
    });
  });

  describe('installModels()', () => {
    it('downloads models, reports progress, flips modelsInstalled', async () => {
      const progress: number[] = [];
      mockDownloadSTTModels.mockImplementation(cb => {
        cb?.(0.5);
        cb?.(1);
        return Promise.resolve();
      });
      await store.installModels(p => progress.push(p));

      expect(mockDownloadSTTModels).toHaveBeenCalled();
      expect(store.modelsInstalled).toBe(true);
      expect(store.isInstallingModels).toBe(false);
      expect(progress).toEqual([0.5, 1]);
    });

    it('coalesces concurrent install calls', async () => {
      mockDownloadSTTModels.mockResolvedValue(undefined);
      const p1 = store.installModels();
      const p2 = store.installModels();
      await Promise.all([p1, p2]);
      expect(mockDownloadSTTModels).toHaveBeenCalledTimes(1);
    });

    it('no-ops when already installed', async () => {
      (store as any).modelsInstalled = true;
      await store.installModels();
      expect(mockDownloadSTTModels).not.toHaveBeenCalled();
    });

    it('surfaces download failure via lastError and rethrows', async () => {
      mockDownloadSTTModels.mockRejectedValue(new Error('network down'));
      await expect(store.installModels()).rejects.toThrow('network down');
      expect(store.modelsInstalled).toBe(false);
      expect(store.lastError).toBe('network down');
      expect(store.isInstallingModels).toBe(false);
    });
  });

  describe('start()', () => {
    it('refuses to start until models are installed', async () => {
      store.endpoint = 'silero';
      await store.start();
      expect(mockStartSession).not.toHaveBeenCalled();
    });

    it('starts the runtime session once models are installed', async () => {
      store.endpoint = 'silero';
      (store as any).modelsInstalled = true;
      await store.start();
      expect(mockStartSession).toHaveBeenCalledTimes(1);
      expect(mockStartSession.mock.calls[0]![0].endpointSilenceMs).toBe(1200);
      expect(store.sessionState.mode).toBe('listening');
    });

    it('exposes a starting state until the recorder and models are ready', async () => {
      let ready!: () => void;
      mockStartSession.mockImplementationOnce(
        () => new Promise<void>(resolve => (ready = resolve)),
      );
      (store as any).modelsInstalled = true;

      const starting = store.start();
      expect(store.sessionState.mode).toBe('starting');

      ready();
      await starting;
      expect(store.sessionState.mode).toBe('listening');
    });

    it('no-ops when STT is disabled', async () => {
      store.endpoint = 'disabled';
      (store as any).modelsInstalled = true;
      await store.start();
      expect(mockStartSession).not.toHaveBeenCalled();
    });

    it('ignores transcript events from a stopped session generation', async () => {
      (store as any).modelsInstalled = true;
      await store.start();
      const oldCallbacks = mockStartSession.mock.calls[0]![1];
      await store.stop(false);
      await store.start();

      oldCallbacks.onPartialText('stale words');
      oldCallbacks.onFinalText('stale final');

      expect(store.partialText).toBe('');
      expect(store.finalText).toBe('');
      expect(store.sessionState.mode).toBe('listening');
    });
  });

  describe('stop()', () => {
    it('stays in processing mode until explicit-stop finalization completes', async () => {
      let finishStop!: () => void;
      mockStopSession.mockImplementationOnce(
        () => new Promise<void>(resolve => (finishStop = resolve)),
      );
      (store as any).modelsInstalled = true;
      await store.start();

      const stopping = store.stop(true);
      expect(store.sessionState.mode).toBe('processing');

      finishStop();
      await stopping;
      expect(store.sessionState.mode).toBe('idle');
      expect(mockStopSession).toHaveBeenCalledWith(true);
    });
  });

  describe('auto-stop on finalText', () => {
    it('stops capture and releases the transcriber after a finalized utterance', async () => {
      store.endpoint = 'silero';
      (store as any).modelsInstalled = true;
      mockStopSession.mockClear();
      await store.start();

      // Capture the callbacks passed to startSession.
      const callbacks = mockStartSession.mock.calls[0]![1];
      callbacks.onFinalText('hello world');

      expect(store.finalText).toBe('hello world');
      expect(store.sessionState.mode).toBe('idle');
      await Promise.resolve();
      expect(mockStopSession).toHaveBeenCalled();
    });
  });
});
