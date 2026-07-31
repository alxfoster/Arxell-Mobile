/**
 * Jest mock for `onnxruntime-react-native`.
 *
 * App code (the Inflect engine) imports ONNX `InferenceSession`/`Tensor`
 * directly, unlike the other engines which run ONNX inside the mocked
 * speech library. This stub lets importing the Inflect engine succeed in
 * Node/Jest without the native binding (which throws on import there).
 */

export class Tensor {
  readonly type: string;
  readonly data: unknown;
  readonly dims: readonly number[];
  constructor(type: string, data: unknown, dims?: readonly number[]) {
    this.type = type;
    this.data = data;
    this.dims = dims ?? [];
  }
}

export const InferenceSession = {
  create: jest.fn().mockResolvedValue({
    run: jest.fn().mockResolvedValue({}),
    release: jest.fn().mockResolvedValue(undefined),
  }),
};
