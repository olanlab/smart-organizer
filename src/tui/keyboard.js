// Physical QWERTY positions on the Thai Kedmanee keyboard, including Shift.
// https://learn.microsoft.com/en-us/globalization/keyboards/kbdth0.html
const ROWS = [
  ['qwertyuiop', 'ๆไำพะัีรนย', '๐"ฎฑธํ๊ณฯญ'],
  ['asdfghjkl', 'ฟหกดเ้่าส', 'ฤฆฏโฌ็๋ษศ'],
  ['zxcvbnm', 'ผปแอิืท', '()ฉฮฺ์?'],
  ['/', 'ฝ', 'ฦ'],
];

const SHORTCUTS = new Map();
for (const [keys, plain, shifted] of ROWS) {
  for (const [shift, chars] of [[false, plain], [true, shifted]]) {
    Array.from(chars).forEach((char, i) => {
      // A literal ? already opens help, including Shift+M on a Thai keyboard.
      if (char === '?') return;
      const str = keys[i] === '/' && shift ? '?' : shift ? keys[i].toUpperCase() : keys[i];
      SHORTCUTS.set(char, { name: keys[i] === '/' ? undefined : keys[i], str, shift });
    });
  }
}

function normalizeShortcut(key) {
  if (key.ctrl || key.meta) return key;
  const shortcut = SHORTCUTS.get(key.str);
  return shortcut ? { ...key, ...shortcut } : key;
}

module.exports = { normalizeShortcut };
