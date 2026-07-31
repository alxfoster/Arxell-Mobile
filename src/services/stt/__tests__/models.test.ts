import * as RNFS from '@dr.pogodin/react-native-fs';

import {
  STT_MODEL_META,
  STTModelNotInstalledError,
  areSTTModelsDownloaded,
  downloadSTTModels,
  ensureModel,
  getModelFilePath,
  isModelDownloaded,
} from '../models';

const okDownload = () => ({
  promise: Promise.resolve({statusCode: 200}),
});

const MODEL_ID = 'moonshine-tiny-streaming' as const;
const MODEL_FILES = STT_MODEL_META[MODEL_ID].files;

const modelPaths = () =>
  MODEL_FILES.map(file => getModelFilePath(MODEL_ID, file.filename));

describe('stt/models', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (RNFS.exists as jest.Mock).mockResolvedValue(false);
    (RNFS.mkdir as jest.Mock).mockResolvedValue(undefined);
    (RNFS.unlink as jest.Mock).mockResolvedValue(undefined);
    (RNFS.moveFile as jest.Mock).mockResolvedValue(undefined);
    (RNFS.downloadFile as jest.Mock).mockImplementation(() => okDownload());
  });

  const markPresent = (paths: string[]) => {
    (RNFS.exists as jest.Mock).mockImplementation((path: string) =>
      Promise.resolve(paths.includes(path)),
    );
  };

  it('isModelDownloaded is true only when every file exists', async () => {
    expect(await isModelDownloaded('silero-vad')).toBe(false);

    markPresent([getModelFilePath('silero-vad', 'silero_vad.onnx')]);
    expect(await isModelDownloaded('silero-vad')).toBe(true);

    expect(await isModelDownloaded(MODEL_ID)).toBe(false);
    markPresent(modelPaths());
    expect(await isModelDownloaded(MODEL_ID)).toBe(true);
  });

  it('areSTTModelsDownloaded requires the production streaming model', async () => {
    expect(await areSTTModelsDownloaded()).toBe(false);
    markPresent(modelPaths());
    expect(await areSTTModelsDownloaded()).toBe(true);
  });

  it('ensureModel throws when not installed', async () => {
    await expect(ensureModel('silero-vad')).rejects.toBeInstanceOf(
      STTModelNotInstalledError,
    );
  });

  it('ensureModel resolves when installed', async () => {
    markPresent([getModelFilePath('silero-vad', 'silero_vad.onnx')]);
    await expect(ensureModel('silero-vad')).resolves.toBeUndefined();
  });

  it('downloadSTTModels downloads every file and reports monotonic progress', async () => {
    const seen: number[] = [];
    await downloadSTTModels(progress => seen.push(progress));

    expect(RNFS.downloadFile).toHaveBeenCalledTimes(MODEL_FILES.length);
    expect(RNFS.moveFile).toHaveBeenCalledTimes(MODEL_FILES.length);
    for (let i = 1; i < seen.length; i++) {
      expect(seen[i]).toBeGreaterThanOrEqual(seen[i - 1]!);
    }
    expect(seen.at(-1)).toBe(1);
  });

  it('downloadSTTModels deletes the partial file and rethrows on HTTP error', async () => {
    const written = new Set<string>();
    (RNFS.downloadFile as jest.Mock).mockImplementation((options: any) => {
      written.add(options.toFile);
      return {promise: Promise.resolve({statusCode: 404})};
    });
    (RNFS.exists as jest.Mock).mockImplementation((path: string) =>
      Promise.resolve(written.has(path)),
    );

    await expect(downloadSTTModels()).rejects.toThrow(/HTTP 404/);
    expect(RNFS.unlink).toHaveBeenCalled();
  });

  it('downloadSTTModels skips files that already exist', async () => {
    const presentPath = modelPaths()[0]!;
    markPresent([presentPath]);

    await downloadSTTModels();

    const fetched = (RNFS.downloadFile as jest.Mock).mock.calls.map(
      (call: any) => call[0].toFile as string,
    );
    expect(fetched).not.toContain(presentPath);
    expect(fetched.length).toBe(MODEL_FILES.length - 1);
  });
});
