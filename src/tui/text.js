// Width-aware string helpers. A terminal column is not a JS character: Thai vowel and
// tone marks take no space, CJK and emoji take two. The TUI must never wrap a row.

// eslint-disable-next-line no-control-regex
const ANSI_PATTERN = /\x1b\[[0-9;?]*[ -/]*[@-~]/g;
const PRINTABLE_ASCII = /^[ -~]*$/;
const ZERO_WIDTH = /[\p{Mn}\p{Me}\p{Cf}]/u;
const EMOJI = /\p{Emoji_Presentation}|\uFE0F/u;
const WIDE_RANGES = [
  [0x1100, 0x115f], [0x2e80, 0x303e], [0x3041, 0x33ff], [0x3400, 0x4dbf],
  [0x4e00, 0x9fff], [0xa000, 0xa4cf], [0xac00, 0xd7a3], [0xf900, 0xfaff],
  [0xfe30, 0xfe4f], [0xff00, 0xff60], [0xffe0, 0xffe6], [0x20000, 0x3fffd],
];

const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' });

function stripAnsi(text) {
  return text.replace(ANSI_PATTERN, '');
}

// Filenames may contain newlines or escape codes; shown raw they would break the layout
// or even send commands to the terminal. They are shown as "?" instead.
// eslint-disable-next-line no-control-regex
const CONTROL_CHARACTERS = /[\x00-\x1f\x7f-\x9f]/g;
function printable(text) {
  return String(text).replace(CONTROL_CHARACTERS, '?');
}

function codePointWidth(char) {
  const cp = char.codePointAt(0);
  if (cp < 0x20 || (cp >= 0x7f && cp < 0xa0) || ZERO_WIDTH.test(char)) return 0;
  return WIDE_RANGES.some(([start, end]) => cp >= start && cp <= end) ? 2 : 1;
}

function graphemeWidth(grapheme) {
  if (EMOJI.test(grapheme)) return 2;
  let width = 0;
  for (const char of grapheme) width += codePointWidth(char);
  return width;
}

function graphemes(text) {
  return Array.from(segmenter.segment(text), (part) => part.segment);
}

function displayWidth(text) {
  const plain = stripAnsi(text);
  if (PRINTABLE_ASCII.test(plain)) return plain.length;
  return graphemes(plain).reduce((sum, grapheme) => sum + graphemeWidth(grapheme), 0);
}

function takeWidth(parts, maxWidth) {
  const taken = [];
  let used = 0;
  for (const part of parts) {
    const width = graphemeWidth(part);
    if (used + width > maxWidth) break;
    taken.push(part);
    used += width;
  }
  return taken;
}

// Shortens plain (unstyled) text to `width` columns with an ellipsis, at the end, in the
// middle, or at the start. Middle keeps both ends of a filename, which is where names usually
// differ; start keeps the end of what is being typed in view.
function truncate(text, width, { middle = false, start = false } = {}) {
  if (displayWidth(text) <= width) return text;
  if (width < 1) return '';
  const parts = graphemes(text);
  const room = width - 1;
  if (start) return `…${takeWidth(parts.reverse(), room).reverse().join('')}`;
  if (!middle) return takeWidth(parts, room).join('') + '…';
  const head = takeWidth(parts, Math.ceil(room / 2)).join('');
  const tail = takeWidth(parts.reverse(), room - displayWidth(head)).reverse().join('');
  return `${head}…${tail}`;
}

function padEnd(text, width) {
  return text + ' '.repeat(Math.max(0, width - displayWidth(text)));
}

module.exports = { stripAnsi, printable, displayWidth, truncate, padEnd };
