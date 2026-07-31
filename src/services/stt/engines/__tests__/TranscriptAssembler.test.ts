import {TranscriptAssembler} from '../TranscriptAssembler';

describe('TranscriptAssembler', () => {
  it('keeps completed lines while the active line is revised', () => {
    const transcript = new TranscriptAssembler();

    expect(
      transcript.update({lineId: '1', text: 'the first words', startedAtMs: 0}),
    ).toBe('the first words');
    expect(
      transcript.update({
        lineId: '1',
        text: 'The first words.',
        isFinal: true,
        startedAtMs: 0,
      }),
    ).toBe('The first words.');
    expect(
      transcript.update({lineId: '2', text: 'and the', startedAtMs: 1000}),
    ).toBe('The first words. and the');
    expect(
      transcript.update({
        lineId: '2',
        text: 'and the rest.',
        startedAtMs: 1000,
      }),
    ).toBe('The first words. and the rest.');
  });

  it('does not regress a completed line with a delayed provisional event', () => {
    const transcript = new TranscriptAssembler();
    transcript.update({lineId: 'line', text: 'final text', isFinal: true});

    expect(
      transcript.update({
        lineId: 'line',
        text: 'stale partial',
        isFinal: false,
      }),
    ).toBe('final text');
  });

  it('orders lines by audio start time when events arrive out of order', () => {
    const transcript = new TranscriptAssembler();
    transcript.update({lineId: '2', text: 'second', startedAtMs: 500});

    expect(
      transcript.update({lineId: '1', text: 'first', startedAtMs: 0}),
    ).toBe('first second');
  });
});
