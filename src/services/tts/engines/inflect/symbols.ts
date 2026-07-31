/**
 * Inflect-Nano-v2 symbol vocabulary.
 *
 * Byte-exact port of the model's `runtime/text/symbols.py` (keithito/tacotron
 * symbol set). The duration predictor's `tokens` input expects IDs from this
 * table. DO NOT edit — it must match the trained model exactly.
 *
 * Order: pad · punctuation · ASCII letters · IPA letters (178 total).
 */

const _pad = '_';
const _punctuation = ';:,.!?¡¿—…"«»“” ';
const _letters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
const _letters_ipa =
  'ɑɐɒæɓʙβɔɕçɗɖðʤəɘɚɛɜɝɞɟʄɡɠɢʛɦɧħɥʜɨɪʝɭɬɫɮʟɱɯɰŋɳɲɴøɵɸθœɶʘ' +
  'ɹɺɾɻʀʁɽʂʃʈʧʉʊʋⱱʌɣɤʍχʎʏʑʐʒʔʡʕʢǀǁǂǃˈˌːˑʼʴʰʱʲʷˠˤ˞↓↑→↗↘' +
  "'̩'ᵻ";

/** Ordered symbol table — index === token id. */
export const SYMBOLS: readonly string[] = [
  _pad,
  ...Array.from(_punctuation),
  ...Array.from(_letters),
  ...Array.from(_letters_ipa),
];

/** Reverse lookup: symbol character → token id. */
export const SYMBOL_TO_ID: ReadonlyMap<string, number> = new Map(
  SYMBOLS.map((s, i) => [s, i]),
);

/** Total vocabulary size (178). */
export const VOCAB_SIZE = SYMBOLS.length;
