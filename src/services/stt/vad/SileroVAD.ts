import * as ort from 'onnxruntime-react-native';

import {ensureModel, getModelFilePath} from '../models';

/**
 * Silero VAD on the app's existing onnxruntime-react-native. Runs entirely
 * on-device; used by the 'silero' endpoint strategy both to GATE audio before
 * ASR (prevents silence/noise hallucination) and to provide precise
 * end-of-speech endpointing (tunable via STTStore.endpointSilenceMs).
 *
 * ⚠️ RUNTIME VALIDATION NEEDED — tensor contract. The assumed contract is the
 * common snakers/silero-vad `silero_vad.onnx` **v4** export:
 *
 *   inputs:  input   float32[1, 512]     (16 kHz mono waveform, 32 ms)
 *            state   float32[2, 1, 128]   (combined LSTM h/c)
 *            sr      int64[1]             (16000)
 *   outputs: output  float32[1, 1]        (speech probability)
 *            stateN  float32[2, 1, 128]    (new state)
 *
 * If your hosted export differs (e.g. split h/c state tensors named h/c with
 * [2,1,64], or v5's stateless 5120-sample context window), adjust the NAME_*
 * constants + WINDOW below. A mismatch throws a clear "invalid input/output
 * name" error from onnxruntime — that's the signal to adapt here.
 *
 * Audio is buffered internally so capture frame size (from AudioCapture) is
 * decoupled from the model's fixed 512-sample window.
 */

const WINDOW = 512; // samples per inference (32 ms @ 16 kHz)
const STATE_SIZE = 2 * 1 * 128;

export class SileroVAD {
  private session: ort.InferenceSession | null = null;
  private state: ort.Tensor = new ort.Tensor(
    'float32',
    new Float32Array(STATE_SIZE),
    [2, 1, 128],
  );
  private buffer: number[] = [];

  // Adapt these if the model export uses different tensor names.
  private static readonly NAME_INPUT = 'input';
  private static readonly NAME_STATE_IN = 'state';
  private static readonly NAME_SR = 'sr';
  private static readonly NAME_PROB = 'output';
  private static readonly NAME_STATE_OUT = 'stateN';

  async load(): Promise<void> {
    if (this.session) {
      return;
    }
    await ensureModel('silero-vad');
    this.session = await ort.InferenceSession.create(
      getModelFilePath('silero-vad', 'silero_vad.onnx'),
    );
    this.reset();
  }

  reset(): void {
    (this.state.data as Float32Array).fill(0);
    this.buffer.length = 0;
  }

  /**
   * Feed a chunk of float PCM [-1, 1]. Runs one inference per completed
   * 512-sample window (may be zero or several). Returns the speech
   * probabilities for the windows that completed.
   *
   * Async because onnxruntime session.run is async — callers must await.
   * On a Snapdragon 8 Gen 3 each window inference is ~1-5 ms, comfortably
   * realtime.
   */
  async process(float: Float32Array): Promise<number[]> {
    if (!this.session) {
      return [];
    }
    for (let i = 0; i < float.length; i++) {
      this.buffer.push(float[i]);
    }
    const probs: number[] = [];
    while (this.buffer.length >= WINDOW) {
      const win = this.buffer.splice(0, WINDOW);
      probs.push(await this.runWindow(win));
    }
    return probs;
  }

  private async runWindow(win: number[]): Promise<number> {
    const sess = this.session!;
    const input = new ort.Tensor('float32', new Float32Array(win), [1, WINDOW]);
    // This Silero export declares `sr` as a scalar (rank 0), not [1].
    const sr = new ort.Tensor('int64', BigInt64Array.from([BigInt(16000)]), []);
    const out = await sess.run({
      [SileroVAD.NAME_INPUT]: input,
      [SileroVAD.NAME_STATE_IN]: this.state,
      [SileroVAD.NAME_SR]: sr,
    });
    const probTensor = out[SileroVAD.NAME_PROB];
    const stateTensor = out[SileroVAD.NAME_STATE_OUT];
    const prob = probTensor ? (probTensor.data as Float32Array)[0] : 0;
    if (stateTensor) {
      this.state = stateTensor; // carry state forward (streaming LSTM)
    }
    return prob;
  }

  async release(): Promise<void> {
    this.session = null;
    this.reset();
  }
}
