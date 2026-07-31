const mockEnsureModel = jest.fn().mockResolvedValue(undefined);
const mockEnsureSttModelsDir = jest.fn().mockResolvedValue(undefined);
jest.mock('../../models', () => ({
  ensureModel: (...args: any[]) => mockEnsureModel(...args),
  ensureSttModelsDir: (...args: any[]) => mockEnsureSttModelsDir(...args),
  isModelDownloaded: jest.fn().mockResolvedValue(true),
  getModelDir: () => '/models/moonshine-tiny-streaming',
}));

import Moonshine from '@siteed/moonshine.rn';
import {MoonshineEngine} from '../MoonshineEngine';

describe('MoonshineEngine streaming', () => {
  it('starts, assembles multiple lines, flushes, and removes the stream', async () => {
    let listener: any = null;
    const transcriber = {
      transcriberId: 'transcriber-1',
      createStream: jest.fn().mockResolvedValue('stream-1'),
      startStream: jest.fn().mockResolvedValue({success: true}),
      stopStream: jest.fn().mockImplementation(async () => {
        listener?.({
          type: 'lineCompleted',
          transcriberId: 'transcriber-1',
          streamId: 'stream-1',
          line: {
            lineId: '2',
            text: 'and the rest.',
            isFinal: true,
            startedAtMs: 1000,
          },
        });
      }),
      removeStream: jest.fn().mockResolvedValue({success: true}),
      addAudioToStream: jest.fn().mockResolvedValue({success: true}),
      addListener: jest.fn((callback: (event: any) => void) => {
        listener = callback;
        return jest.fn();
      }),
      release: jest.fn().mockResolvedValue({released: true}),
    };
    (Moonshine.createTranscriberFromFiles as jest.Mock).mockResolvedValueOnce(
      transcriber,
    );
    const partials: string[] = [];
    const engine = new MoonshineEngine();

    await engine.init();
    expect(Moonshine.createTranscriberFromFiles).toHaveBeenCalledWith(
      expect.objectContaining({
        modelArch: 'tiny-streaming',
        modelPath: '/models/moonshine-tiny-streaming',
        updateIntervalMs: 300,
      }),
    );
    const streamId = await engine.startStream(event => {
      partials.push(event.text);
    });
    listener?.({
      type: 'lineCompleted',
      transcriberId: 'transcriber-1',
      streamId: 'stream-1',
      line: {
        lineId: '1',
        text: 'The first words.',
        isFinal: true,
        startedAtMs: 0,
      },
    });
    listener?.({
      type: 'lineUpdated',
      transcriberId: 'transcriber-1',
      streamId: 'stream-1',
      line: {lineId: '2', text: 'and the', startedAtMs: 1000},
    });

    expect(streamId).toBe('stream-1');
    expect(transcriber.startStream).toHaveBeenCalledWith('stream-1');
    expect(partials.at(-1)).toBe('The first words. and the');
    await expect(engine.endStream(streamId)).resolves.toBe(
      'The first words. and the rest.',
    );
    expect(transcriber.stopStream).toHaveBeenCalledWith('stream-1');
    expect(transcriber.removeStream).toHaveBeenCalledWith('stream-1');
  });

  it('ignores events from another stream', async () => {
    let listener: any = null;
    const transcriber = {
      transcriberId: 'transcriber-1',
      createStream: jest.fn().mockResolvedValue('stream-1'),
      startStream: jest.fn().mockResolvedValue({success: true}),
      stopStream: jest.fn().mockResolvedValue({success: true}),
      removeStream: jest.fn().mockResolvedValue({success: true}),
      addListener: jest.fn((callback: (event: any) => void) => {
        listener = callback;
        return jest.fn();
      }),
      release: jest.fn().mockResolvedValue({released: true}),
    };
    (Moonshine.createTranscriberFromFiles as jest.Mock).mockResolvedValueOnce(
      transcriber,
    );
    const onEvent = jest.fn();
    const engine = new MoonshineEngine();

    await engine.startStream(onEvent);
    listener?.({
      type: 'lineUpdated',
      transcriberId: 'transcriber-1',
      streamId: 'old-stream',
      line: {lineId: '1', text: 'stale'},
    });

    expect(onEvent).not.toHaveBeenCalled();
  });
});
