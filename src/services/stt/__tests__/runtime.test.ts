jest.mock('../audio/AudioCapture', () => ({
  audioCapture: {
    init: jest.fn(),
    start: jest.fn().mockResolvedValue(undefined),
    stop: jest.fn().mockResolvedValue(undefined),
    setSubscriber: jest.fn(),
  },
  requestMicPermission: jest.fn().mockResolvedValue(true),
}));

const mockAudioCapture = jest.requireMock('../audio/AudioCapture').audioCapture;
let mockSubscriber: ((samples: Float32Array) => void) | null = null;

const mockVadProcess = jest.fn();
const mockVadRelease = jest.fn().mockResolvedValue(undefined);
jest.mock('../vad/SileroVAD', () => ({
  SileroVAD: class {
    load = jest.fn().mockResolvedValue(undefined);
    process = (...args: any[]) => mockVadProcess(...args);
    reset = jest.fn();
    release = mockVadRelease;
  },
}));

const mockEngineInit = jest.fn().mockResolvedValue(undefined);
const mockStartStream = jest.fn();
const mockFeedStream = jest.fn();
const mockEndStream = jest.fn();
const mockCancelStream = jest.fn();
const mockEngineRelease = jest.fn().mockResolvedValue(undefined);
jest.mock('../engines/MoonshineEngine', () => ({
  MoonshineEngine: class {
    id = 'moonshine';
    init = mockEngineInit;
    startStream = (...args: any[]) => mockStartStream(...args);
    feedStream = (...args: any[]) => mockFeedStream(...args);
    endStream = (...args: any[]) => mockEndStream(...args);
    cancelStream = (...args: any[]) => mockCancelStream(...args);
    release = mockEngineRelease;
  },
}));

jest.mock('../engines/WhisperEngine', () => ({
  WhisperEngine: class {},
}));

import {sttRuntime} from '..';

describe('sttRuntime silero session', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockSubscriber = null;
    mockAudioCapture.setSubscriber.mockImplementation(fn => {
      mockSubscriber = fn;
    });
    mockAudioCapture.start.mockResolvedValue(undefined);
    mockAudioCapture.stop.mockResolvedValue(undefined);
    mockVadRelease.mockResolvedValue(undefined);
    mockEngineInit.mockResolvedValue(undefined);
    mockEngineRelease.mockResolvedValue(undefined);
    mockStartStream.mockResolvedValue('stream-1');
    mockFeedStream.mockResolvedValue(undefined);
    mockEndStream.mockResolvedValue('complete phrase');
    mockCancelStream.mockResolvedValue(undefined);
  });

  afterEach(async () => {
    await sttRuntime.stopSession(false);
    await sttRuntime.release();
  });

  it('drains audio already queued when the user taps stop', async () => {
    let resolveFirstFrame!: (probabilities: number[]) => void;
    mockVadProcess
      .mockImplementationOnce(
        () =>
          new Promise<number[]>(resolve => {
            resolveFirstFrame = resolve;
          }),
      )
      .mockResolvedValue([0.9]);

    const onFinalText = jest.fn();
    await sttRuntime.startSession(
      {
        endpoint: 'silero',
        endpointSilenceMs: 1200,
        asrEngine: 'moonshine',
      },
      {
        onPartialText: jest.fn(),
        onFinalText,
        onEndpoint: jest.fn(),
        onError: jest.fn(),
      },
    );

    // The second frame queues while VAD is still processing the first. It is
    // exactly the kind of tail the previous stop path discarded.
    mockSubscriber!(new Float32Array([0.25, 0.5]));
    mockSubscriber!(new Float32Array([0.75, 1]));
    const stopping = sttRuntime.stopSession(true);

    resolveFirstFrame([0.9]);
    await stopping;

    expect(mockAudioCapture.start.mock.invocationCallOrder[0]).toBeLessThan(
      mockEngineInit.mock.invocationCallOrder[0],
    );
    expect(mockFeedStream).toHaveBeenCalledTimes(1);
    expect(mockFeedStream.mock.calls[0]![1]).toEqual([0.25, 0.5, 0.75, 1]);
    expect(mockEndStream).toHaveBeenCalledWith('stream-1');
    expect(onFinalText).toHaveBeenCalledWith('complete phrase');
  });
});
