const { displayWidth } = require('./text');

// Shared by the help view and its navigation, so every entry can be reached on a small screen.
const HELP = [
  ['↑↓  j k', 'move'],
  ['PgUp PgDn g G', 'page / first / last'],
  ['/  s', 'filter / sort'],
  ['space', 'include or skip file'],
  ['a  c', 'toggle all / category'],
  ['x', 'what to do with copies'],
  ['n  m', 'name / by month'],
  ['o  f', 'keep names / file dates'],
  ['d  r', 'source folder / rescan'],
  ['i  v V  e', 'details / open / rename'],
  ['enter', 'organize selected'],
  ['u  h  q', 'undo / history / quit'],
  ['b', 'choose destination'],
  ['p', 'type destination path'],
  ['Thai Kedmanee', 'same physical shortcut keys'],
];

const FOLDER_HELP = [
  ['↑↓  j k', 'move through folders'],
  ['enter  →', 'open highlighted folder'],
  ['←  backspace', 'go to parent folder'],
  ['s  space', 'use this destination'],
  ['n', 'create a folder here'],
  ['e', 'rename highlighted folder'],
  ['/', 'type a folder path'],
  ['r', 'refresh folders'],
  ['esc  q', 'back to file preview'],
  ['Thai Kedmanee', 'same physical keys'],
];
const helpEntries = (state) => state.folderBrowser ? FOLDER_HELP : HELP;

const PROMPT_MODES = new Set(['edit', 'filter', 'confirm', 'confirmUndo', 'running']);
const HELP_QUIT = [['?', 'help'], ['q', 'quit']];
const widthOf = (pairs) => displayWidth(pairs.map(([key, label]) => `${key} ${label}`).join('   '));

// Fit whole hints, with the essential exit/help keys reserved on the last row.
// Less common commands stay in ?. Never leave a clipped key or label at the edge.
function pack(pairs, tail, width, maxRows) {
  const rows = Array.from({ length: maxRows }, (_, i) => ({ pairs: [], tail: i === maxRows - 1 ? tail : [] }));
  let index = 0;
  for (const pair of pairs) {
    while (index < rows.length) {
      const line = rows[index];
      const next = [...line.pairs, pair];
      const needed = 2 + widthOf(next) + widthOf(line.tail) + (line.tail.length ? 3 : 0);
      if (needed <= width) {
        line.pairs = next;
        break;
      }
      index++;
    }
    if (index === rows.length) break;
  }
  return rows.filter((line) => line.pairs.length || line.tail.length);
}

function shortcutRows(state) {
  const { width } = state;
  if (state.help) return pack([['↑↓', 'scroll']], [['esc', 'close']], width, 1);
  switch (state.mode) {
  case 'folders':
    if (state.folderBrowser.busy) return pack([], [['ctrl+c', 'quit when done']], width, 1);
    return pack([
      ['enter', 'open'], ['s', 'use destination'], ['n', 'new'], ['e', 'rename'],
      ['←', 'up'], ['/', 'path'], ['↑↓', 'move'], ['r', 'refresh'],
    ], [['?', 'help'], ['esc', 'back']], width, width < 70 && state.height >= 12 ? 3 : 2);
  case 'edit':
    return pack([
      ...(state.edit.field === 'dir' ? [['Tab', 'complete'], ['↑↓', 'recent']] : []),
      ...(state.edit.field === 'parent' ? [['Tab', 'browse']] : []),
      ...(state.edit.field === 'folderPath' ? [['Tab', 'complete']] : []),
      ['ctrl+u', 'clear'],
    ], [['enter', { newFolder: 'create', renameFolder: 'rename', folderPath: 'open' }[state.edit.field] || 'save'], ['esc', 'cancel']], width, width < 70 ? 2 : 1);
  case 'filter':
    return pack([['↑↓', 'move'], ['ctrl+u', 'clear']], [['enter', 'keep'], ['esc', 'clear']], width, width < 60 ? 2 : 1);
  case 'confirm':
  case 'confirmUndo':
    return pack([], [['y/ั', 'yes'], ['n/ื', 'no'], ['esc', 'cancel']], width, 1);
  case 'loading':
    return pack([], [['q', 'quit'], ['ctrl+c', 'quit']], width, 1);
  case 'running':
    return pack([], [['ctrl+c', 'stop']], width, 1);
  case 'history':
    return pack([['enter', 'undo to here'], ['↑↓', 'move']], [['esc', 'back'], ...HELP_QUIT], width, 2);
  case 'done':
    return pack([['u', 'undo'], ['r', 'rescan'], ['↑↓', 'scroll'], ['b', 'destination'], ['v', 'open'], ['h', 'history']], HELP_QUIT, width, 2);
  default:
    return pack([
      ['space', 'select'], ['enter', 'organize'], ['/', 'filter'], ['↑↓', 'move'],
      ['d', 'source'], ['b', 'destination'], ['e', 'rename'], ['a', 'all'],
      ['u', 'undo'], ['n', 'name'], ['h', 'history'], ['s', 'sort'], ['x', 'copies'],
    ], HELP_QUIT, width, width < 70 && state.height >= 12 ? 3 : 2);
  }
}

function hasPrompt(state) {
  return !state.help && PROMPT_MODES.has(state.mode);
}

function listHeight(state) {
  // Title, folder, options, two rules, status, then prompts and shortcut rows.
  return Math.max(1, state.height - 6 - Number(hasPrompt(state)) - shortcutRows(state).length);
}

function helpLayout(state) {
  const room = Math.max(1, listHeight(state) - 1);
  const entries = helpEntries(state);
  const columns = entries.length > room && state.width >= 80 ? 2 : 1;
  return { room, columns, rows: Math.ceil(entries.length / columns) };
}

module.exports = { HELP, helpEntries, shortcutRows, hasPrompt, listHeight, helpLayout };
