import {getAllEngines, getEngine} from '../engineRegistry';
import {InflectEngine} from '../engines/inflect';
import {KittenEngine} from '../engines/kitten';
import {KokoroEngine} from '../engines/kokoro';
import {SupertonicEngine} from '../engines/supertonic';
import {SystemEngine} from '../engines/system';

describe('engineRegistry', () => {
  it('returns the System engine for id "system"', () => {
    const engine = getEngine('system');
    expect(engine).toBeInstanceOf(SystemEngine);
    expect(engine.id).toBe('system');
  });

  it('returns the Supertonic engine for id "supertonic"', () => {
    const engine = getEngine('supertonic');
    expect(engine).toBeInstanceOf(SupertonicEngine);
    expect(engine.id).toBe('supertonic');
  });

  it('returns the Kokoro engine for id "kokoro"', () => {
    const engine = getEngine('kokoro');
    expect(engine).toBeInstanceOf(KokoroEngine);
    expect(engine.id).toBe('kokoro');
  });

  it('returns the Kitten engine for id "kitten"', () => {
    const engine = getEngine('kitten');
    expect(engine).toBeInstanceOf(KittenEngine);
    expect(engine.id).toBe('kitten');
  });

  it('returns the Inflect engine for id "inflect"', () => {
    const engine = getEngine('inflect');
    expect(engine).toBeInstanceOf(InflectEngine);
    expect(engine.id).toBe('inflect');
  });

  it('getAllEngines returns the five engines in setup-sheet order: inflect, kitten, kokoro, supertonic, system', () => {
    const all = getAllEngines();
    expect(all).toHaveLength(5);
    expect(all.map(e => e.id)).toEqual([
      'inflect',
      'kitten',
      'kokoro',
      'supertonic',
      'system',
    ]);
  });

  it('returns stable singleton instances across calls', () => {
    expect(getEngine('kokoro')).toBe(getEngine('kokoro'));
    expect(getEngine('kitten')).toBe(getEngine('kitten'));
  });
});
