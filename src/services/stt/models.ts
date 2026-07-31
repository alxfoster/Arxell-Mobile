import {Platform} from 'react-native';
import * as RNFS from '@dr.pogodin/react-native-fs';

/**
 * Assets for the on-device STT pipeline.
 *
 *  - **Moonshine** (ASR): user-installed on first use. The native
 *    Moonshine loader requires its optimized `.ort` encoder and decoder
 *    files (not the sibling `.onnx` files) alongside the tokenizer.
 *
 *  - **Silero VAD**: bundled with the app (Android `assets/stt/`, iOS app
 *    bundle) — it is tiny infrastructure, never a user-facing download.
 *    `ensureBundledVAD()` copies it out of the bundle to the STT dir on
 *    first run; `isModelDownloaded('silero-vad')` then reports true.
 */
export type STTModelId = 'moonshine-base' | 'silero-vad';

interface ModelFile {
  filename: string;
  url: string;
}

interface ModelMeta {
  id: STTModelId;
  /** When `bundled` is true the asset ships in the app and is copied out of
   *  the bundle on init (the `url` is an iOS-only fallback if the bundled
   *  copy is absent). */
  bundled?: boolean;
  files: readonly ModelFile[];
}

const MOONSHINE_BASE =
  'https://huggingface.co/UsefulSensors/moonshine/resolve/main/onnx/merged/base/quantized';

const MODELS: Record<STTModelId, ModelMeta> = {
  'moonshine-base': {
    id: 'moonshine-base',
    files: [
      {
        filename: 'encoder_model.ort',
        url: `${MOONSHINE_BASE}/encoder_model.ort`,
      },
      {
        filename: 'decoder_model_merged.ort',
        url: `${MOONSHINE_BASE}/decoder_model_merged.ort`,
      },
      {filename: 'tokenizer.bin', url: `${MOONSHINE_BASE}/tokenizer.bin`},
    ],
  },
  'silero-vad': {
    id: 'silero-vad',
    bundled: true,
    files: [
      {
        filename: 'silero_vad.onnx',
        url: 'https://github.com/snakers4/silero-vad/raw/master/src/silero_vad/data/silero_vad.onnx',
      },
    ],
  },
};

export type STTDownloadProgress = (progress: number) => void;

/** Moonshine receives this directory as its modelPath. */
export function sttModelsDir(): string {
  return Platform.OS === 'ios'
    ? `${RNFS.LibraryDirectoryPath}/Application Support/STT`
    : `${RNFS.DocumentDirectoryPath}/STT`;
}

export async function ensureSttModelsDir(): Promise<void> {
  const dir = sttModelsDir();
  if (!(await RNFS.exists(dir))) {
    await RNFS.mkdir(dir, {NSURLIsExcludedFromBackupKey: true});
  }
}

export function getModelFilePath(id: STTModelId, filename: string): string {
  const file = MODELS[id].files.find(item => item.filename === filename);
  if (!file) {
    throw new Error(`Unknown file '${filename}' for STT model '${id}'`);
  }
  return `${sttModelsDir()}/${file.filename}`;
}

/** True iff the model's files are present on disk (bundled models count
 *  once `ensureBundledAssets()` has copied them out of the app bundle). */
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

/** Models the user must download (i.e. not bundled). */
const USER_DOWNLOAD_MODELS: STTModelId[] = ['moonshine-base'];

/** True once every user-downloadable STT model is present. Bundled models
 *  (VAD) are excluded — they are never a user's responsibility. */
export async function areSTTModelsDownloaded(): Promise<boolean> {
  const installed = await Promise.all(
    USER_DOWNLOAD_MODELS.map(isModelDownloaded),
  );
  return installed.every(Boolean);
}

/**
 * Copy bundled STT assets (currently Silero VAD) out of the app bundle into
 * the STT directory. Safe to call on every init — skips files already
 * present. Called from `STTStore.init()` so the VAD is available before any
 * session starts, with no download step.
 */
export async function ensureBundledAssets(): Promise<void> {
  await ensureSttModelsDir();
  for (const id of Object.keys(MODELS) as STTModelId[]) {
    const meta = MODELS[id];
    if (!meta.bundled) {
      continue;
    }
    for (const file of meta.files) {
      const dest = getModelFilePath(id, file.filename);
      if (await RNFS.exists(dest)) {
        continue;
      }
      try {
        if (Platform.OS === 'android') {
          // Android: assets are inside the APK; copy out to a real path.
          await RNFS.copyFileAssets(`stt/${file.filename}`, dest);
        } else {
          // iOS: the file ships in the main bundle (added to the target's
          // "Copy Bundle Resources" phase). Fall back to download only if a
          // future build forgets to include it.
          const bundled = `${RNFS.MainBundlePath}/stt/${file.filename}`;
          if (await RNFS.exists(bundled)) {
            await RNFS.copyFile(bundled, dest);
          } else {
            await downloadOne(file, dest);
          }
        }
      } catch (err) {
        console.warn(
          `[stt/models] bundled asset ${file.filename} failed:`,
          err,
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

/** Downloads the user-installable STT assets (Moonshine). Bundled models
 *  (VAD) are never fetched here. Atomic enough for the UI: a partial install
 *  is never considered installed and can be safely retried. */
export async function downloadSTTModels(
  onProgress?: STTDownloadProgress,
): Promise<void> {
  const files = USER_DOWNLOAD_MODELS.flatMap(id =>
    MODELS[id].files.map(f => ({id, ...f})),
  );
  const progress = new Array(files.length).fill(0);
  await ensureSttModelsDir();

  for (let index = 0; index < files.length; index++) {
    const file = files[index]!;
    const destination = getModelFilePath(file.id, file.filename);
    if (await RNFS.exists(destination)) {
      progress[index] = 1;
      onProgress?.(overall(progress, files.length));
      continue;
    }
    const result = await RNFS.downloadFile({
      fromUrl: file.url,
      toFile: destination,
      background: false,
      discretionary: false,
      cacheable: false,
      progressInterval: 500,
      progress: update => {
        progress[index] = Math.min(
          1,
          update.bytesWritten / Math.max(1, update.contentLength),
        );
        onProgress?.(overall(progress, files.length));
      },
    }).promise;
    if (result.statusCode !== 200) {
      if (await RNFS.exists(destination)) {
        await RNFS.unlink(destination);
      }
      throw new Error(
        `Failed to download ${file.filename}: HTTP ${result.statusCode}`,
      );
    }
    progress[index] = 1;
    onProgress?.(overall(progress, files.length));
  }
}

const overall = (parts: number[], total: number) =>
  parts.reduce((sum, value) => sum + value, 0) / total;

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

/** Rough download size (MB) the user incurs for STT — Moonshine base int8. */
export const STT_DOWNLOAD_SIZE_MB = 60;

export const STT_MODEL_META = MODELS;
