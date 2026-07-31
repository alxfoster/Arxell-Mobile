import {Platform} from 'react-native';
import * as RNFS from '@dr.pogodin/react-native-fs';

/** Models used by the on-device STT pipeline. */
export type STTModelId =
  | 'moonshine-tiny-streaming'
  | 'moonshine-base'
  | 'silero-vad';

interface ModelFile {
  filename: string;
  url: string;
  sizeBytes?: number;
}

interface ModelMeta {
  id: STTModelId;
  bundled?: boolean;
  /** Isolate architectures whose canonical filenames overlap. */
  directory: string;
  files: readonly ModelFile[];
}

const MOONSHINE_BASE =
  'https://huggingface.co/UsefulSensors/moonshine/resolve/main/onnx/merged/base/quantized';
const MOONSHINE_TINY_STREAMING =
  'https://download.moonshine.ai/model/tiny-streaming-en/quantized';

const MODELS: Record<STTModelId, ModelMeta> = {
  'moonshine-tiny-streaming': {
    id: 'moonshine-tiny-streaming',
    directory: 'moonshine-tiny-streaming',
    // Required files from Moonshine's native model dependency catalog. The
    // attention decoder is intentionally omitted because word timestamps are
    // disabled; this keeps the user download near 52 MB.
    files: [
      {
        filename: 'adapter.ort',
        url: `${MOONSHINE_TINY_STREAMING}/adapter.ort`,
        sizeBytes: 1_319_440,
      },
      {
        filename: 'cross_kv.ort',
        url: `${MOONSHINE_TINY_STREAMING}/cross_kv.ort`,
        sizeBytes: 1_264_384,
      },
      {
        filename: 'decoder_kv.ort',
        url: `${MOONSHINE_TINY_STREAMING}/decoder_kv.ort`,
        sizeBytes: 32_403_688,
      },
      {
        filename: 'encoder.ort',
        url: `${MOONSHINE_TINY_STREAMING}/encoder.ort`,
        sizeBytes: 7_569_200,
      },
      {
        filename: 'frontend.ort',
        url: `${MOONSHINE_TINY_STREAMING}/frontend.ort`,
        sizeBytes: 8_324_600,
      },
      {
        filename: 'streaming_config.json',
        url: `${MOONSHINE_TINY_STREAMING}/streaming_config.json`,
        sizeBytes: 509,
      },
      {
        filename: 'tokenizer.bin',
        url: `${MOONSHINE_TINY_STREAMING}/tokenizer.bin`,
        sizeBytes: 249_974,
      },
    ],
  },
  // Kept so an existing installation is identifiable during migration and as
  // a bounded offline diagnostic fallback. It is not downloaded for new users.
  'moonshine-base': {
    id: 'moonshine-base',
    directory: 'moonshine-base',
    files: [
      {
        filename: 'encoder_model.ort',
        url: `${MOONSHINE_BASE}/encoder_model.ort`,
        sizeBytes: 20_661_976,
      },
      {
        filename: 'decoder_model_merged.ort',
        url: `${MOONSHINE_BASE}/decoder_model_merged.ort`,
        sizeBytes: 42_703_232,
      },
      {
        filename: 'tokenizer.bin',
        url: `${MOONSHINE_BASE}/tokenizer.bin`,
      },
    ],
  },
  'silero-vad': {
    id: 'silero-vad',
    bundled: true,
    directory: 'silero-vad',
    files: [
      {
        filename: 'silero_vad.onnx',
        url: 'https://github.com/snakers4/silero-vad/raw/master/src/silero_vad/data/silero_vad.onnx',
      },
    ],
  },
};

export type STTDownloadProgress = (progress: number) => void;

export function sttModelsDir(): string {
  return Platform.OS === 'ios'
    ? `${RNFS.LibraryDirectoryPath}/Application Support/STT`
    : `${RNFS.DocumentDirectoryPath}/STT`;
}

export function getModelDir(id: STTModelId): string {
  return `${sttModelsDir()}/${MODELS[id].directory}`;
}

export async function ensureSttModelsDir(): Promise<void> {
  const dir = sttModelsDir();
  if (!(await RNFS.exists(dir))) {
    await RNFS.mkdir(dir, {NSURLIsExcludedFromBackupKey: true});
  }
}

async function ensureModelDir(id: STTModelId): Promise<void> {
  await ensureSttModelsDir();
  const dir = getModelDir(id);
  if (!(await RNFS.exists(dir))) {
    await RNFS.mkdir(dir, {NSURLIsExcludedFromBackupKey: true});
  }
}

export function getModelFilePath(id: STTModelId, filename: string): string {
  const file = MODELS[id].files.find(item => item.filename === filename);
  if (!file) {
    throw new Error(`Unknown file '${filename}' for STT model '${id}'`);
  }
  return `${getModelDir(id)}/${file.filename}`;
}

export async function isModelDownloaded(id: STTModelId): Promise<boolean> {
  try {
    const checks = await Promise.all(
      MODELS[id].files.map(file =>
        RNFS.exists(getModelFilePath(id, file.filename)),
      ),
    );
    return checks.every(Boolean);
  } catch {
    return false;
  }
}

const USER_DOWNLOAD_MODELS: STTModelId[] = ['moonshine-tiny-streaming'];

export async function areSTTModelsDownloaded(): Promise<boolean> {
  const installed = await Promise.all(
    USER_DOWNLOAD_MODELS.map(isModelDownloaded),
  );
  return installed.every(Boolean);
}

/** Copy the bundled VAD out of the application package on first run. */
export async function ensureBundledAssets(): Promise<void> {
  for (const id of Object.keys(MODELS) as STTModelId[]) {
    const meta = MODELS[id];
    if (!meta.bundled) {
      continue;
    }
    await ensureModelDir(id);
    for (const file of meta.files) {
      const dest = getModelFilePath(id, file.filename);
      if (await RNFS.exists(dest)) {
        continue;
      }
      try {
        if (Platform.OS === 'android') {
          await RNFS.copyFileAssets(`stt/${file.filename}`, dest);
        } else {
          const bundled = `${RNFS.MainBundlePath}/stt/${file.filename}`;
          if (await RNFS.exists(bundled)) {
            await RNFS.copyFile(bundled, dest);
          } else {
            await downloadOne(file, dest);
          }
        }
      } catch (error) {
        console.warn(
          `[stt/models] bundled asset ${file.filename} failed:`,
          error,
        );
      }
    }
  }
}

async function downloadOne(file: ModelFile, dest: string): Promise<void> {
  const result = await RNFS.downloadFile({
    fromUrl: file.url,
    toFile: dest,
    background: false,
    discretionary: false,
    cacheable: false,
  }).promise;
  if (result.statusCode !== 200) {
    if (await RNFS.exists(dest)) {
      await RNFS.unlink(dest);
    }
    throw new Error(
      `Failed to download ${file.filename}: HTTP ${result.statusCode}`,
    );
  }
}

/** Download the production streaming model after explicit user consent. */
export async function downloadSTTModels(
  onProgress?: STTDownloadProgress,
): Promise<void> {
  const files = USER_DOWNLOAD_MODELS.flatMap(id =>
    MODELS[id].files.map(file => ({id, ...file})),
  );
  const progress = new Array(files.length).fill(0);
  const weights = files.map(file => file.sizeBytes ?? 1);

  for (const id of USER_DOWNLOAD_MODELS) {
    await ensureModelDir(id);
  }
  for (let index = 0; index < files.length; index++) {
    const file = files[index]!;
    const destination = getModelFilePath(file.id, file.filename);
    if (await RNFS.exists(destination)) {
      progress[index] = 1;
      onProgress?.(weightedOverall(progress, weights));
      continue;
    }
    // A killed/interrupted download must never look installed on the next
    // launch merely because its destination exists. Download beside the final
    // path and rename only after a successful HTTP completion.
    const partialDestination = `${destination}.partial`;
    if (await RNFS.exists(partialDestination)) {
      await RNFS.unlink(partialDestination);
    }
    const result = await RNFS.downloadFile({
      fromUrl: file.url,
      toFile: partialDestination,
      background: false,
      discretionary: false,
      cacheable: false,
      progressInterval: 250,
      progress: update => {
        progress[index] = Math.min(
          1,
          update.bytesWritten /
            Math.max(1, update.contentLength || file.sizeBytes || 1),
        );
        onProgress?.(weightedOverall(progress, weights));
      },
    }).promise;
    if (result.statusCode !== 200) {
      if (await RNFS.exists(partialDestination)) {
        await RNFS.unlink(partialDestination);
      }
      throw new Error(
        `Failed to download ${file.filename}: HTTP ${result.statusCode}`,
      );
    }
    await RNFS.moveFile(partialDestination, destination);
    progress[index] = 1;
    onProgress?.(weightedOverall(progress, weights));
  }
}

const weightedOverall = (parts: number[], weights: number[]) => {
  const total = weights.reduce((sum, value) => sum + value, 0);
  return (
    parts.reduce((sum, value, index) => sum + value * weights[index]!, 0) /
    Math.max(1, total)
  );
};

export class STTModelNotInstalledError extends Error {
  constructor(id: STTModelId) {
    super(
      `STT model '${id}' is not installed. Install voice input before recording.`,
    );
    this.name = 'STTModelNotInstalledError';
  }
}

export async function ensureModel(id: STTModelId): Promise<void> {
  if (!(await isModelDownloaded(id))) {
    throw new STTModelNotInstalledError(id);
  }
}

export const STT_DOWNLOAD_SIZE_MB = 52;
export const STT_MODEL_META = MODELS;
