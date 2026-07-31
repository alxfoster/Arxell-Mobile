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

const TOTAL_FILES = STT_MODEL_META['moonshine-base'].files.length;

describe('stt/models', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // RNFS.exists defaults to "nothing present"; tests flip specific paths on.
    (RNFS.exists as jest.Mock).mockResolvedValue(false);
    (RNFS.mkdir as jest.Mock).mockResolvedValue(undefined);
    (RNFS.unlink as jest.Mock).mockResolvedValue(undefined);
    (RNFS.downloadFile as jest.Mock).mockImplementation(() => okDownload());
  });

  const markPresent = (paths: string[]) => {
    (RNFS.exists as jest.Mock).mockImplementation((p: string) =>
      Promise.resolve(paths.includes(p)),
    );
  };

  it('isModelDownloaded is true only when every file exists', async () => {
    expect(await isModelDownloaded('silero-vad')).toBe(false);

    markPresent([getModelFilePath('silero-vad', 'silero_vad.onnx')]);
    expect(await isModelDownloaded('silero-vad')).toBe(true);

    expect(await isModelDownloaded('moonshine-base')).toBe(false);
    markPresent([
      getModelFilePath('moonshine-base', 'encoder_model.onnx'),
      getModelFilePath('moonshine-base', 'decoder_model_merged.onnx'),
      getModelFilePath('moonshine-base', 'tokenizer.bin'),
      // keep silero present too so areSTTModelsDownloaded is well-defined
      getModelFilePath('silero-vad', 'silero_vad.onnx'),
    ]);
    expect(await isModelDownloaded('moonshine-base')).toBe(true);
  });

  it('areSTTModelsDownloaded requires every model fully installed', async () => {
    expect(await areSTTModelsDownloaded()).toBe(false);
    markPresent([
      getModelFilePath('silero-vad', 'silero_vad.onnx'),
      getModelFilePath('moonshine-base', 'encoder_model.onnx'),
      getModelFilePath('moonshine-base', 'decoder_model_merged.onnx'),
      getModelFilePath('moonshine-base', 'tokenizer.bin'),
    ]);
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
    await downloadSTTModels(p => seen.push(p));

    expect(RNFS.downloadFile).toHaveBeenCalledTimes(TOTAL_FILES);
    for (let i = 1; i < seen.length; i++) {
      expect(seen[i]).toBeGreaterThanOrEqual(seen[i - 1]!);
    }
    expect(seen[seen.length - 1]).toBe(1);
  });

  it('downloadSTTModels deletes the partial file and rethrows on HTTP error', async () => {
    // RNFS writes a partial file even on a failed HTTP response; mirror that
    // so the cleanup branch actually hits `exists() -> true`.
    const written = new Set<string>();
    (RNFS.downloadFile as jest.Mock).mockImplementation((opts: any) => {
      written.add(opts.toFile);
      return {promise: Promise.resolve({statusCode: 404})};
    });
    (RNFS.exists as jest.Mock).mockImplementation((p: string) =>
      Promise.resolve(written.has(p)),
    );

    await expect(downloadSTTModels()).rejects.toThrow(/HTTP 404/);
    expect(RNFS.unlink).toHaveBeenCalled();
  });

  it('downloadSTTModels skips files that already exist', async () => {
    const presentPath = getModelFilePath(
      'moonshine-base',
      'encoder_model.onnx',
    );
    markPresent([presentPath]);

    await downloadSTTModels();

    const fetched = (RNFS.downloadFile as jest.Mock).mock.calls.map(
      (c: any) => c[0].toFile as string,
    );
    expect(fetched).not.toContain(presentPath);
    expect(fetched.length).toBe(TOTAL_FILES - 1);
  });
});
