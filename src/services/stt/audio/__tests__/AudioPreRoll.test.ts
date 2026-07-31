import {AudioPreRoll} from '../AudioPreRoll';

describe('AudioPreRoll', () => {
  it('keeps the newest samples in chronological order', () => {
    const preRoll = new AudioPreRoll(5);

    preRoll.append(Float32Array.from([1, 2, 3]));
    preRoll.append(Float32Array.from([4, 5, 6]));

    const utterance = [0];
    preRoll.drainInto(utterance);
    expect(utterance).toEqual([0, 2, 3, 4, 5, 6]);
    expect(preRoll.length).toBe(0);
  });

  it('keeps only the tail of a chunk larger than its capacity', () => {
    const preRoll = new AudioPreRoll(3);

    preRoll.append(Float32Array.from([1, 2, 3, 4, 5]));

    const utterance: number[] = [];
    preRoll.drainInto(utterance);
    expect(utterance).toEqual([3, 4, 5]);
  });

  it('can be cleared without draining into an utterance', () => {
    const preRoll = new AudioPreRoll(4);
    preRoll.append(Float32Array.from([1, 2]));

    preRoll.clear();

    expect(preRoll.length).toBe(0);
  });
});
