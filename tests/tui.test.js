const fs = require('fs-extra');
const os = require('os');
const path = require('path');
const { PassThrough } = require('stream');
const { createState, update, visibleFiles } = require('../src/tui/state');
const { render } = require('../src/tui/view');
const { runTui } = require('../src/tui');
const { resolveDir, completePath, openCommand } = require('../src/tui/paths');
const { stripAnsi, displayWidth, truncate } = require('../src/tui/text');
const { readHistory, recordRun } = require('../src/history');
const { scanDirectory, buildPlan, executePlan } = require('../src/organizer');

// The TUI remembers recent folders in the settings folder; keep that away from the real one.
process.env.XDG_CONFIG_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'org-tui-config-'));

const DATE = new Date(2026, 8, 11);
const FILES = [
  { name: 'a.jpg', ext: '.jpg', category: 'images' },
  { name: 'b.jpg', ext: '.jpg', category: 'images' },
  { name: 'song.mp3', ext: '.mp3', category: 'audio' },
];

const key = (name, extra = {}) => ({ type: 'key', key: { name, ...extra } });
const typed = (text) => Array.from(text, (str) => ({ type: 'key', key: { str, name: /^[a-z]$/.test(str) ? str : undefined } }));

// Applies actions in order; returns the final state and the last effect produced.
function run(state, ...actions) {
  let effect = null;
  for (const action of actions.flat()) [state, effect = null] = update(state, action);
  return [state, effect];
}

function scannedState(options = {}) {
  const state = createState({ targetDir: '/data', date: DATE, ...options });
  return run(state, { type: 'scanned', targetDir: '/data', files: FILES, existing: new Map(), date: DATE })[0];
}

const newNames = (state) => state.plan.map((move) => move.newName);
const plainRows = (state) => render(state, { version: '9.9.9' }).map(stripAnsi);

describe('text helpers', () => {
  test('measure terminal columns, not string length', () => {
    expect(displayWidth('abc')).toBe(3);
    expect(displayWidth('ที่นี่')).toBe(2); // tone and vowel marks take no space
    expect(displayWidth('กำ')).toBe(2);
    expect(displayWidth('日本')).toBe(4);
    expect(displayWidth('📁x')).toBe(3);
    expect(displayWidth('\x1b[31mred\x1b[39m')).toBe(3);
  });

  test('truncate keeps both ends in middle mode and never splits a Thai cluster', () => {
    expect(truncate('Screenshot-2026-09-11.png', 12, { middle: true })).toBe('Screen…1.png');
    expect(truncate('/Users/me/Pictures/import', 10, { start: true })).toBe('…es/import');
    expect(truncate('ไฟล์ภาพที่นี่', 4)).toBe('ไฟล์…'); // ์ stays attached to ล
    expect(displayWidth(truncate('日本語のファイル', 7))).toBeLessThanOrEqual(7);
  });

  test('resolveDir expands ~ and resolves relative to the current folder', () => {
    expect(resolveDir('~/Downloads', '/x')).toBe(path.join(os.homedir(), 'Downloads'));
    expect(resolveDir('..', '/a/b')).toBe(path.resolve('/a'));
  });

  test('completePath finishes a folder name like a shell does', async () => {
    const base = fs.mkdtempSync(path.join(os.tmpdir(), 'org-complete-'));
    for (const name of ['Downloads', 'Documents', 'Desktop', '.hidden']) await fs.ensureDir(path.join(base, name));
    await fs.ensureFile(path.join(base, 'Dockerfile'));

    expect(await completePath('Dow', base)).toEqual({ value: 'Downloads/', matches: ['Downloads'] });
    expect(await completePath('do', base)).toEqual({ value: 'Do', matches: ['Documents', 'Downloads'] });
    expect(await completePath('D', base)).toMatchObject({ value: 'D', matches: ['Desktop', 'Documents', 'Downloads'] });
    expect(await completePath('./Desk', base)).toEqual({ value: './Desktop/', matches: ['Desktop'] });
    expect((await completePath('zzz', base)).matches).toEqual([]);
    await fs.remove(base);
  });

  test('openCommand uses the right opener for each system', () => {
    expect(openCommand('/x/a.pdf', 'darwin')).toEqual(['open', ['/x/a.pdf']]);
    expect(openCommand('/x/a.pdf', 'linux')).toEqual(['xdg-open', ['/x/a.pdf']]);
    expect(openCommand('C:\\a.pdf', 'win32')[0]).toBe('cmd');
  });
});

describe('TUI state', () => {
  test.each([
    ['a', 'ฟ', 'ฤ'], ['c', 'แ', 'ฉ'], ['d', 'ก', 'ฏ'], ['e', 'ำ', 'ฎ'],
    ['f', 'ด', 'โ'], ['g', 'เ', 'ฌ'], ['h', '้', '็'], ['i', 'ร', 'ณ'],
    ['j', '่', '๋'], ['k', 'า', 'ษ'], ['m', 'ท', null], ['n', 'ื', '์'],
    ['o', 'น', 'ฯ'], ['p', 'ย', 'ญ'], ['q', 'ๆ', '๐'], ['r', 'พ', 'ฑ'],
    ['s', 'ห', 'ฆ'], ['u', 'ี', '๊'], ['v', 'อ', 'ฮ'], ['x', 'ป', ')'],
  ])('Thai Kedmanee keys at %s have the same action, including Shift', (english, plain, shifted) => {
    const state = { ...scannedState(), cursor: 1, undo: { count: 3, at: '' } };
    expect(run(state, typed(plain))).toEqual(run(state, key(english, { shift: false })));
    if (shifted) expect(run(state, typed(shifted))).toEqual(run(state, key(english, { shift: true })));
  });

  test('Thai filter and help keys work, and literal punctuation keeps its meaning', () => {
    expect(run(scannedState(), typed('ฝ'))[0].mode).toBe('filter');
    expect(run(scannedState(), typed('/'))[0].mode).toBe('filter');
    expect(run(scannedState(), typed('ฦ'))[0].help).toBe(true);
    expect(run(scannedState(), typed('?'))[0].help).toBe(true); // Thai Shift+M
  });

  test('Thai confirmation keys organize or cancel, and also confirm undo', () => {
    const [confirming] = run(scannedState(), key('return'));
    expect(run(confirming, typed('ั'))[1]).toEqual({ type: 'execute', plan: confirming.plan });
    expect(run(confirming, typed('ํ'))[1]).toEqual({ type: 'execute', plan: confirming.plan });
    expect(run(confirming, typed('ื'))[0].mode).toBe('browse');
    const [asking] = run({ ...scannedState(), undo: { count: 3 } }, typed('ี'));
    expect(run(asking, typed('ั'))[1]).toEqual({ type: 'undo', count: 1 });
    expect(run(asking, typed('ื'))[0].mode).toBe('browse');
  });

  test('Thai shortcuts work in history, results and while scanning', () => {
    const base = scannedState();
    const results = base.plan.map((move) => ({ ...move, ok: true }));
    const [done] = run(base, { type: 'executed', results });
    expect(run(done, typed('พ'))[1]).toEqual({ type: 'scan', dir: '/data' });
    expect(run(done, typed('อ'))[1]).toEqual({ type: 'open', file: path.join(results[0].folder, results[0].newName) });
    const [history] = run(base, { type: 'historyLoaded', runs: [{ at: '', moves: [{ from: 'x', to: 'y' }] }] });
    expect(run(history, typed('้'))[0].mode).toBe('browse');
    for (const state of [done, history, createState({ targetDir: '/data' })]) {
      expect(run(state, typed('ๆ'))[1]).toEqual({ type: 'quit' });
    }
  });

  test('Thai text stays literal in every edit field, including marks, slashes and question marks', () => {
    const text = 'ภาพถ่ายที่เชียงใหม่ๆัืฝฦ?';
    for (const shortcut of ['n', 'p', 'd', 'e']) {
      const [editing] = run(scannedState(), key(shortcut), key('u', { ctrl: true }), typed(text));
      expect(editing.mode).toBe('edit');
      expect(editing.edit.value).toBe(text);
      expect(run(editing, key('backspace'))[0].edit.value).toBe(text.slice(0, -1));
      expect(run(editing, key('u', { ctrl: true }))[0].edit.value).toBe('');
    }
    const [named] = run(scannedState(), typed('ื'), typed('ทริปเชียงใหม่'), key('return'));
    expect(newNames(named)[0]).toBe('ทริปเชียงใหม่-1.jpg');
  });

  test('Thai search text filters files without triggering shortcut actions', () => {
    const files = [
      { name: 'รูปถ่ายที่เชียงใหม่.jpg', ext: '.jpg', category: 'images' },
      ...FILES,
    ];
    const [loaded] = run(scannedState(), { type: 'scanned', targetDir: '/data', files, existing: new Map(), date: DATE });
    const [filtering, effect] = run(loaded, typed('ฝ'), typed('เชียงใหม่'));
    expect(filtering.mode).toBe('filter');
    expect(filtering.filter).toBe('เชียงใหม่');
    expect(visibleFiles(filtering).map((file) => file.name)).toEqual(['รูปถ่ายที่เชียงใหม่.jpg']);
    expect(effect).toBeNull();
  });

  test('Thai aliases do not turn Ctrl or Alt combinations into commands', () => {
    for (const modifier of ['ctrl', 'meta']) {
      const [state, effect] = run(scannedState(), key(undefined, { str: 'ๆ', [modifier]: true }));
      expect(state.mode).toBe('browse');
      expect(effect).toBeNull();
    }
  });

  test('selects every scanned file and plans date-based names', () => {
    const state = scannedState();

    expect(state.mode).toBe('browse');
    expect(newNames(state)).toEqual(['2026-09-11-1.jpg', '2026-09-11-2.jpg', '2026-09-11-1.mp3']);
  });

  test('space skips the current file and renumbers the rest', () => {
    const [state] = run(scannedState(), key('space'));

    expect(state.files[0].selected).toBe(false);
    expect(newNames(state)).toEqual(['2026-09-11-1.jpg', '2026-09-11-1.mp3']);
    expect(state.plan[0].name).toBe('b.jpg');
  });

  test('a toggles everything off and back on', () => {
    const [none] = run(scannedState(), key('a'));
    const [all] = run(none, key('a'));

    expect(none.plan).toHaveLength(0);
    expect(all.plan).toHaveLength(3);
  });

  test('editing the name replans with the new base name', () => {
    const [state] = run(scannedState(), key('n'), typed('trip'), key('return'));

    expect(state.mode).toBe('browse');
    expect(state.name).toBe('trip');
    expect(newNames(state)[0]).toBe('trip-1.jpg');
  });

  test('o switches between renaming and keeping original names', () => {
    const [keeping] = run(scannedState(), key('o'));
    const [renamed] = run(keeping, key('n'), typed('trip'), key('return'));

    expect(newNames(keeping)).toEqual(['a.jpg', 'b.jpg', 'song.mp3']);
    expect(renamed.keepNames).toBe(false);
    expect(newNames(renamed)[0]).toBe('trip-1.jpg');
  });

  test('f switches date names to each file\'s modified day', () => {
    const files = FILES.map((file, i) => ({ ...file, modified: new Date(2024, 0, 10 + i) }));
    const [named] = run(createState({ targetDir: '/data', name: 'trip', date: DATE }),
      { type: 'scanned', targetDir: '/data', files, existing: new Map(), date: DATE });

    const [dated] = run(named, key('f'));

    expect(dated.name).toBe('');
    expect(newNames(dated)).toEqual(['2024-01-10-1.jpg', '2024-01-11-1.jpg', '2024-01-12-1.mp3']);
    expect(plainRows(dated)[2]).toContain('YYYY-MM-DD-N (each file\'s modified date)');
  });

  test('an invalid name keeps the editor open with an error', () => {
    const [state] = run(scannedState(), key('n'), typed('a/b'), key('return'));

    expect(state.mode).toBe('edit');
    expect(state.message.text).toMatch(/path/);
  });

  test('escape cancels an edit and backspace removes one character', () => {
    const [editing] = run(scannedState(), key('n'), typed('ab'), key('backspace'));
    const [cancelled] = run(editing, key('escape'));

    expect(editing.edit.value).toBe('a');
    expect(cancelled.name).toBe('');
    expect(cancelled.mode).toBe('browse');
  });

  test('changing the parent folder rescans with the new parent', () => {
    const [state, effect] = run(scannedState(), key('p'), typed('sorted'), key('return'));

    expect(state.parent).toBe('sorted');
    expect(state.mode).toBe('loading');
    expect(effect).toEqual({ type: 'scan', dir: '/data' });
  });

  test('a failed folder change keeps the current folder', () => {
    const [loading, effect] = run(scannedState(), key('d'), key('u', { ctrl: true }), typed('nope'), key('return'));
    const [state] = run(loading, { type: 'failed', error: new Error('Not a folder: /nope') });

    expect(effect).toEqual({ type: 'scan', dir: 'nope' });
    expect(state.mode).toBe('browse');
    expect(state.targetDir).toBe('/data');
    expect(state.message.text).toContain('Not a folder');
  });

  test('enter asks for confirmation and y starts moving the planned files', () => {
    const [confirming] = run(scannedState(), key('return'));
    const [running, effect] = run(confirming, key('y'));

    expect(confirming.mode).toBe('confirm');
    expect(running.mode).toBe('running');
    expect(effect).toEqual({ type: 'execute', plan: confirming.plan });
  });

  test('any other key cancels the confirmation', () => {
    const [state, effect] = run(scannedState(), key('return'), key('n'));

    expect(state.mode).toBe('browse');
    expect(effect).toBeNull();
  });

  test('enter with nothing selected shows an error instead of confirming', () => {
    const [state] = run(scannedState(), key('a'), key('return'));

    expect(state.mode).toBe('browse');
    expect(state.message.text).toBe('Nothing selected.');
  });

  test('v opens the current file, from the list or from the results', () => {
    const [, fromList] = run(scannedState(), key('down'), key('v'));
    const results = scannedState().plan.map((move) => ({ ...move, ok: true }));
    const [, fromResults] = run(scannedState(), { type: 'executed', results, undo: null }, key('v'));

    expect(fromList).toEqual({ type: 'open', file: 'b.jpg' });
    expect(fromResults).toEqual({ type: 'open', file: path.join('images', '2026-09-11-1.jpg') });
  });

  test('V opens the folder being organized', () => {
    const [, effect] = run(scannedState(), key('v', { shift: true }));

    expect(effect).toEqual({ type: 'open', file: '.', label: 'the folder' });
  });

  test('a long value in an edit field shows its end, where the typing happens', () => {
    const long = `/Volumes/Backup Drive/${'deep/'.repeat(20)}photos`;
    const [editing] = run(scannedState(), key('d'), key('u', { ctrl: true }), typed(long));
    const footer = plainRows(editing).at(-2);

    expect(footer).toMatch(/Folder › ….*deep\/photos /);
    expect(displayWidth(footer)).toBe(80);
  });

  test('up and down in the folder field walk through recent folders', () => {
    const [loaded] = run(scannedState(), { type: 'recentLoaded', folders: ['~/Downloads', '~/Pictures/import', '/Volumes/USB'] });
    const [editing] = run(loaded, key('d'));
    const [older] = run(editing, key('up'), key('up'));
    const [newer] = run(older, key('down'));
    const [oldest] = run(older, key('up'), key('up'), key('up'));

    expect(plainRows(editing).at(-3)).toContain('↑↓ recent: ~/Downloads  ·  ~/Pictures/import  ·  /Volumes/USB');
    expect(older.edit.value).toBe('~/Pictures/import');
    expect(newer.edit.value).toBe('~/Downloads');
    expect(oldest.edit.value).toBe('/Volumes/USB');
  });

  test('tab in the folder field asks for completions and shows several matches', () => {
    const [editing, effect] = run(scannedState(), key('d'), key('u', { ctrl: true }), typed('~/D'), key('tab'));
    const [completed] = run(editing, { type: 'completed', value: '~/Do', matches: ['Documents', 'Downloads'] });

    expect(effect).toEqual({ type: 'complete', value: '~/D' });
    expect(completed.edit.value).toBe('~/Do');
    expect(plainRows(completed).at(-3)).toContain('Folders: Documents  Downloads');
  });

  test('switching to another folder clears the filter', () => {
    const [filtered] = run(scannedState(), typed('/'), typed('song'), key('return'));
    const [other] = run(filtered, { type: 'scanned', targetDir: '/elsewhere', files: FILES, existing: new Map(), date: DATE });

    expect(other.filter).toBe('');
    expect(visibleFiles(other)).toHaveLength(3);
  });

  test('rescanning the same folder keeps skipped files skipped', () => {
    const [skipped] = run(scannedState(), key('space'));
    const [state] = run(skipped, { type: 'scanned', targetDir: '/data', files: FILES, existing: new Map(), date: DATE });

    expect(state.files.map((file) => file.selected)).toEqual([false, true, true]);
  });

  test('the cursor stays inside the list and scrolls into view', () => {
    const files = Array.from({ length: 30 }, (_, i) => ({ name: `f${i}.txt`, ext: '.txt', category: 'documents' }));
    const [loaded] = run(createState({ targetDir: '/d', height: 12, date: DATE }),
      { type: 'scanned', targetDir: '/d', files, existing: new Map(), date: DATE });

    const [top] = run(loaded, key('up'));
    const [bottom] = run(loaded, key('g', { shift: true }));
    const [paged] = run(loaded, key('pagedown'));

    expect(top.cursor).toBe(0);
    expect(bottom.cursor).toBe(29);
    expect(bottom.scroll).toBe(26); // 12 rows minus 6 chrome and 2 shortcut rows = 4 visible
    expect(paged.cursor).toBe(4);
    expect(paged.scroll).toBe(1);
  });

  test('/ filters the list as you type, and actions apply to what is shown', () => {
    const [filtering] = run(scannedState(), typed('/'), typed('JPG'));
    const [kept] = run(filtering, key('return'), key('down'), key('a'));

    expect(filtering.mode).toBe('filter');
    expect(visibleFiles(filtering).map((file) => file.name)).toEqual(['a.jpg', 'b.jpg']);
    expect(kept.mode).toBe('browse');
    expect(kept.files.map((file) => file.selected)).toEqual([false, false, true]);
  });

  test('the filter understands @category and size limits, combined with name words', () => {
    const files = [
      { name: 'big-installer.dmg', ext: '.dmg', category: 'apps', size: 300 * 1024 ** 2 },
      { name: 'IMG_1.jpg', ext: '.jpg', category: 'images', size: 6 * 1024 ** 2 },
      { name: 'IMG_2.jpg', ext: '.jpg', category: 'images', size: 200 * 1024 },
      { name: 'notes.txt', ext: '.txt', category: 'documents', size: 12 },
    ];
    const [loaded] = run(createState({ targetDir: '/d', date: DATE }),
      { type: 'scanned', targetDir: '/d', files, existing: new Map(), date: DATE });
    const shown = (filter) => visibleFiles({ ...loaded, filter }).map((file) => file.name);

    expect(shown('>100mb')).toEqual(['big-installer.dmg']);
    expect(shown('@images >5MB')).toEqual(['IMG_1.jpg']);
    expect(shown('<1kb')).toEqual(['notes.txt']);
    expect(shown('@im img_2')).toEqual(['IMG_2.jpg']);
    expect(shown('>')).toEqual([]);
  });

  test('esc clears the filter and keeps the cursor on the same file', () => {
    const [filtered] = run(scannedState(), typed('/'), typed('song'), key('return'));
    const [cleared] = run(filtered, key('escape'));
    const [, quit] = run(cleared, key('escape'));

    expect(cleared.filter).toBe('');
    expect(cleared.files[cleared.cursor].name).toBe('song.mp3');
    expect(quit).toEqual({ type: 'quit' });
  });

  test('c includes or skips the whole category of the current file', () => {
    const [skipped] = run(scannedState(), key('c'));
    const [included] = run(skipped, key('c'));

    expect(skipped.files.map((file) => file.selected)).toEqual([false, false, true]);
    expect(skipped.message.text).toBe('Skipped 2 files in images.');
    expect(included.files.every((file) => file.selected)).toBe(true);
  });

  test('s cycles the sort order, keeps the cursor on its file, and numbers in list order', () => {
    const files = [
      { name: 'small.jpg', ext: '.jpg', category: 'images', size: 10, modified: new Date(2024, 0, 3) },
      { name: 'big.jpg', ext: '.jpg', category: 'images', size: 5000, modified: new Date(2024, 0, 1) },
      { name: 'mid.jpg', ext: '.jpg', category: 'images', size: 300, modified: new Date(2024, 0, 2) },
    ];
    const [loaded] = run(createState({ targetDir: '/d', date: DATE }),
      { type: 'scanned', targetDir: '/d', files, existing: new Map(), date: DATE });
    const order = (state) => state.files.map((file) => file.name);

    const [byName] = run(loaded, key('s'));
    const [newest] = run(byName, key('s'));
    const [largest] = run(newest, key('s'));
    const [back] = run(largest, key('s'));

    expect(order(byName)).toEqual(['big.jpg', 'mid.jpg', 'small.jpg']);
    expect(order(newest)).toEqual(['small.jpg', 'mid.jpg', 'big.jpg']);
    expect(order(largest)).toEqual(['big.jpg', 'mid.jpg', 'small.jpg']);
    expect(order(back)).toEqual(['small.jpg', 'big.jpg', 'mid.jpg']);
    expect(largest.files[largest.cursor].name).toBe('small.jpg');
    expect(largest.message.text).toBe('Sorted largest first.');
    expect(largest.plan.find((move) => move.name === 'big.jpg').newName).toBe('2026-09-11-1.jpg');
  });

  test('x cycles what happens to duplicates, and the list shows it', () => {
    const files = [
      { name: 'report.pdf', ext: '.pdf', category: 'documents' },
      { name: 'report (1).pdf', ext: '.pdf', category: 'documents', duplicateOf: 'report.pdf' },
    ];
    const [loaded] = run(createState({ targetDir: '/d', date: DATE }),
      { type: 'scanned', targetDir: '/d', files, existing: new Map(), date: DATE });

    const [skipping] = run(loaded, key('x'));
    const [separating] = run(skipping, key('x'));

    expect(loaded.plan).toHaveLength(2);
    expect(plainRows(loaded).at(-3)).toContain('1 duplicate (x: keep)');
    expect(skipping.plan.map((move) => move.name)).toEqual(['report.pdf']);
    expect(skipping.message.text).toBe('1 duplicate will be left where they are.');
    expect(plainRows(skipping).join('\n')).toContain('skip, same as report.pdf');
    expect(separating.plan[1].folder).toBe('duplicates');
  });

  test('m cycles month and year subfolders and rescans for the new folders', () => {
    const files = [{ name: 'a.jpg', ext: '.jpg', category: 'images', modified: new Date(2024, 2, 5) }];
    const scanned = { type: 'scanned', targetDir: '/d', files, existing: new Map(), date: DATE };
    const [loaded] = run(createState({ targetDir: '/d', date: DATE }), scanned);

    const [loading, effect] = run(loaded, key('m'));
    const [monthly] = run(loading, scanned);
    const [, yearlyScan] = run(monthly, key('m'));

    expect(effect).toEqual({ type: 'scan', dir: '/d' });
    expect(monthly.plan[0].folder).toBe(path.join('images', '2024-03'));
    expect(plainRows(monthly)[2]).toContain('Group  by month');
    expect(yearlyScan).toEqual({ type: 'scan', dir: '/d' });
  });

  test('i shows the full details of the current file', () => {
    const files = [{ name: 'report.pdf', ext: '.pdf', category: 'documents', size: 1572864, modified: new Date(2024, 2, 14, 9, 5) }];
    const [state] = run(createState({ targetDir: '/d', date: DATE }),
      { type: 'scanned', targetDir: '/d', files, existing: new Map(), date: DATE }, key('i'));

    expect(plainRows(state).at(-3)).toContain(
      `report.pdf  → ${path.join('documents', '2026-09-11-1.pdf')}  1.5 MB  2024-03-14 09:05`,
    );
  });

  test('? opens the key list and the next key only closes it', () => {
    const [help] = run(scannedState(), typed('?'));
    const [closed, effect] = run(help, key('q'));

    expect(help.help).toBe(true);
    expect(closed.help).toBe(false);
    expect(effect).toBeNull();
  });

  test('q quits while the folder is still being scanned', () => {
    const [, effect] = run(createState({ targetDir: '/data' }), key('q'));

    expect(effect).toEqual({ type: 'quit' });
  });

  test('u without an earlier run says there is nothing to undo', () => {
    const [state, effect] = run(scannedState(), key('u'));

    expect(state.mode).toBe('browse');
    expect(state.message.text).toMatch(/Nothing to undo/);
    expect(effect).toBeNull();
  });

  test('u asks first, then restores the last run', () => {
    const [loaded] = run(createState({ targetDir: '/data', date: DATE }),
      { type: 'scanned', targetDir: '/data', files: FILES, existing: new Map(), date: DATE, undo: { count: 4, at: '' } });

    const [asking] = run(loaded, key('u'));
    const [cancelled] = run(asking, key('n'));
    const [running, effect] = run(asking, key('y'));

    expect(asking.mode).toBe('confirmUndo');
    expect(plainRows(asking).at(-2)).toContain('Undo the last run and restore 4 files?');
    expect(cancelled.mode).toBe('browse');
    expect(running.progress).toEqual({ label: 'Restoring', done: 0, total: 4 });
    expect(effect).toEqual({ type: 'undo', count: 1 });
  });

  test('h lists past runs, and enter undoes back to the one picked', () => {
    const runs = [
      { at: '2026-09-09T10:00:00.000Z', moves: [{ from: 'old.jpg', to: 'images/x-1.jpg' }] },
      { at: '2026-09-10T10:00:00.000Z', moves: [{ from: 'a.pdf', to: 'documents/x-1.pdf' }, { from: 'b.pdf', to: 'documents/x-2.pdf' }] },
      { at: '2026-09-11T10:00:00.000Z', moves: [{ from: 'new.mp3', to: 'audio/x-1.mp3' }] },
    ];
    const [, askForHistory] = run(scannedState(), key('h'));
    const [history] = run(scannedState(), { type: 'historyLoaded', runs });
    const [asking] = run(history, key('down'), key('return'));
    const [, effect] = run(asking, key('y'));
    const [back] = run(history, key('escape'));

    expect(askForHistory).toEqual({ type: 'history' });
    expect(history.runs.map((item) => item.moves[0].from)).toEqual(['new.mp3', 'a.pdf', 'old.jpg']);
    expect(plainRows(history).join('\n')).toContain('a.pdf → documents/x-1.pdf');
    expect(plainRows(asking).at(-2)).toContain('Undo the last 2 runs and restore 3 files?');
    expect(effect).toEqual({ type: 'undo', count: 2 });
    expect(back.mode).toBe('browse');
  });

  test('h with no runs recorded says so and stays put', () => {
    const [state] = run(scannedState(), { type: 'historyLoaded', runs: [] });

    expect(state.mode).toBe('browse');
    expect(state.message.text).toMatch(/Nothing to undo/);
  });

  test('cancelling an undo from the results screen goes back to the results', () => {
    const results = scannedState().plan.map((move) => ({ ...move, ok: true }));
    const [done] = run(scannedState(), { type: 'executed', results, undo: { count: 3, at: '' } });

    const [state] = run(done, key('u'), key('escape'));

    expect(state.mode).toBe('done');
  });

  test('after an undo the folder is rescanned and the outcome stays visible', () => {
    const undone = [{ from: 'a.jpg', to: 'images/x-1.jpg', ok: true }];
    const [loading, effect] = run(scannedState(), { type: 'undone', results: undone });
    const [state] = run(loading, { type: 'scanned', targetDir: '/data', files: FILES, existing: new Map(), date: DATE });

    expect(effect).toEqual({ type: 'scan', dir: '/data' });
    expect(state.message.text).toBe('Restored 1 file to their original names.');
  });

  test('ctrl+c quits from any mode, q quits from browse', () => {
    const [, fromEdit] = run(scannedState(), key('n'), key('c', { ctrl: true }));
    const [, fromBrowse] = run(scannedState(), key('q'));

    expect(fromEdit).toEqual({ type: 'quit' });
    expect(fromBrowse).toEqual({ type: 'quit' });
  });
});

describe('TUI view', () => {
  test('important commands are visible in the bottom bar at 80 columns', () => {
    const rows = plainRows(scannedState()).slice(-2);
    const footer = rows.join('\n');
    for (const hint of ['space select', 'enter organize', '/ filter', '↑↓ move', 'e rename', 'a all', 'n name', 'u undo', 'd folder', '? help', 'q quit']) {
      expect(footer).toContain(hint);
    }
    expect(footer).not.toContain('…');
  });

  test('the smallest supported terminal shows complete essential shortcut hints', () => {
    const footer = plainRows(scannedState({ width: 40, height: 10 })).slice(-2).join('\n');
    for (const hint of ['space select', 'enter organize', '/ filter', '↑↓ move', '? help', 'q quit']) expect(footer).toContain(hint);
    expect(footer).not.toContain('…');
  });

  test('long text cannot hide save, cancel or confirmation keys', () => {
    const base = scannedState({ width: 40, height: 12 });
    const long = 'ชื่อไฟล์ที่ยาวมาก'.repeat(10);
    const [editing] = run(base, typed('ื'), typed(long));
    const [filtering] = run(base, typed('ฝ'), typed(long));
    const [confirming] = run({ ...base, risk: 'inside a project with a very long folder name'.repeat(4) }, key('return'));
    expect(plainRows(editing).at(-1)).toMatch(/enter save\s+esc cancel/);
    expect(plainRows(filtering).at(-1)).toMatch(/enter keep\s+esc clear/);
    expect(plainRows(filtering).join('\n')).toContain('Filter › …');
    expect(plainRows(confirming).at(-1)).toMatch(/y\/ั yes\s+n\/ื no\s+esc cancel/);
  });

  test('help can reach its last command on a short terminal and resize without losing the file cursor', () => {
    const [help] = run(scannedState({ width: 40, height: 10 }), key('down'), typed('ฦ'));
    const [bottom] = run(help, typed('ฌ')); // Shift+G on a Thai keyboard
    expect(plainRows(bottom).join('\n')).toContain('Thai Kedmanee');
    expect(plainRows(bottom).at(-1)).toContain('esc close');
    const [resized] = run(bottom, { type: 'resize', width: 120, height: 30 });
    expect(resized.helpScroll).toBe(0);
    const [closed, effect] = run(resized, typed('ๆ'));
    expect(closed.help).toBe(false);
    expect(closed.cursor).toBe(1);
    expect(effect).toBeNull();
  });

  test('all modes fit the terminal when shortcut rows wrap or prompts change', () => {
    for (const width of [40, 59, 60, 69, 70, 79, 80, 120]) {
      for (const height of [10, 12, 24]) {
        const base = scannedState({ width, height });
        const variants = [
          base, run(base, key('d'))[0], run(base, key('n'))[0], run(base, typed('/'))[0],
          run(base, key('return'))[0], run(base, typed('?'))[0],
          run(base, { type: 'historyLoaded', runs: [{ at: '2026-09-11', moves: [{ from: 'x', to: 'y' }] }] })[0],
          run(base, { type: 'executed', results: base.plan.map((move) => ({ ...move, ok: true })) })[0],
          run(base, key('return'), key('y'))[0],
        ];
        for (const state of variants) {
          const rows = render(state);
          expect(rows).toHaveLength(height);
          for (const line of rows) expect(displayWidth(line)).toBe(width);
        }
      }
    }
  });


  test('shows each file with its destination', () => {
    const text = plainRows(scannedState()).join('\n');

    expect(text).toContain('Smart Organizer v9.9.9');
    expect(text).toContain(`a.jpg    → ${path.join('images', '2026-09-11-1.jpg')}`);
    expect(text).toContain('3/3 selected');
  });

  test('every row is exactly the terminal width, whatever the file names', () => {
    const files = [
      { name: 'รูปถ่ายงานแต่งงานของเพื่อนที่เชียงใหม่.jpg', ext: '.jpg', category: 'images' },
      { name: '会議の議事録_最終版.pdf', ext: '.pdf', category: 'documents' },
      { name: '📸 party.png', ext: '.png', category: 'images' },
    ];
    for (const [width, height] of [[40, 10], [80, 24], [80, 12], [123, 40], [20, 5]]) {
      const [state] = run(createState({ targetDir: '/data', width, height, date: DATE }),
        { type: 'scanned', targetDir: '/data', files, existing: new Map(), date: DATE });
      const [help] = run(state, typed('?'));
      const [filtering] = run(state, typed('/'), typed('ร'));

      for (const rows of [render(state), render(help), render(filtering)]) {
        expect(rows).toHaveLength(height);
        for (const line of rows) expect(displayWidth(line)).toBe(width);
      }
    }
  });

  test('wide terminals show size and modified date next to each file', () => {
    const files = [{ name: 'movie.mov', ext: '.mov', category: 'videos', size: 3 * 1024 ** 3, modified: new Date(2024, 6, 4) }];
    const scanned = { type: 'scanned', targetDir: '/d', files, existing: new Map(), date: DATE };
    const [wide] = run(createState({ targetDir: '/d', width: 120, date: DATE }), scanned);
    const [narrow] = run(createState({ targetDir: '/d', width: 80, date: DATE }), scanned);

    expect(plainRows(wide)[4]).toMatch(/movie\.mov\s+3\.0 GB {2}2024-07-04 → /);
    expect(plainRows(narrow)[4]).not.toContain('GB');
  });

  test('control characters in file names cannot break the frame or reach the terminal', () => {
    const files = [
      { name: 'evil\x1b[2Jname.txt', ext: '.txt', category: 'documents' },
      { name: 'two\nlines.txt', ext: '.txt', category: 'documents' },
    ];
    const [state] = run(createState({ targetDir: '/d', date: DATE }),
      { type: 'scanned', targetDir: '/d', files, existing: new Map(), date: DATE }, key('i'));
    const rows = render(state).map(stripAnsi);

    for (const line of rows) {
      expect(line).not.toMatch(/[\x00-\x1f]/); // eslint-disable-line no-control-regex
      expect(displayWidth(line)).toBe(80);
    }
    expect(rows.join('\n')).toContain('evil?[2Jname.txt');
    expect(rows.join('\n')).toContain('two?lines.txt');
  });

  test('help and quit stay visible in the hints on a narrow terminal', () => {
    const rows = plainRows(scannedState({ width: 40, height: 10 }));

    expect(rows.at(-1)).toMatch(/\? help {3}q quit $/);
  });

  test('the key list folds into two columns when the terminal is short', () => {
    const [short] = run(scannedState({ width: 90, height: 14 }), typed('?'));
    const text = plainRows(short).join('\n');

    expect(text).toContain('↑↓ scroll · other keys close');
    expect(text).toMatch(/move\s+o {2}f\s+keep names \/ file dates/);
    for (const label of ['filter / sort', 'toggle all / category', 'what to do with copies', 'undo / history / quit']) {
      expect(text).toContain(label);
    }
  });

  test('the confirmation mentions selected files the filter is hiding', () => {
    const [state] = run(scannedState(), typed('/'), typed('song'), key('return'), key('return'));

    expect(plainRows(state).at(-2)).toContain('Move and rename 3 files (2 hidden by the filter)?');
  });

  test('warns loudly about a folder that is risky to organize', () => {
    const risk = 'it is inside a code project (/repo)';
    const [state] = run(createState({ targetDir: '/repo/src', date: DATE }),
      { type: 'scanned', targetDir: '/repo/src', files: FILES, existing: new Map(), date: DATE, risk },
      key('return'));
    const rows = plainRows(state);

    expect(rows.at(-3)).toContain('Careful: it is inside a code project (/repo)');
    expect(rows.at(-2)).toContain('Careful, it is inside a code project (/repo)! Move and rename 3 files anyway?');
  });

  test('e gives one file a name of its own, keeping its extension', () => {
    const [renamed] = run(scannedState(), key('down'), key('e'), key('u', { ctrl: true }), typed('beach day'), key('return'));
    const [clash] = run(renamed, key('up'), key('e'), key('u', { ctrl: true }), typed('beach day.JPG'), key('return'));
    const [reset] = run(clash, key('e'), key('u', { ctrl: true }), key('return'));

    expect(renamed.plan.map((move) => move.newName)).toEqual(['2026-09-11-1.jpg', 'beach day.jpg', '2026-09-11-1.mp3']);
    expect(clash.plan.map((move) => move.newName).slice(0, 2)).toEqual(['beach day.JPG', 'beach day-2.jpg']);
    expect(reset.plan[0].newName).toBe('2026-09-11-1.jpg');
  });

  test('shows the edit prompt, confirmation and results', () => {
    const [editing] = run(scannedState(), key('p'));
    const [confirming] = run(scannedState(), key('return'));
    const results = scannedState().plan.map((move, i) => (i === 1 ? { ...move, ok: false, error: new Error('EACCES') } : { ...move, ok: true }));
    const [done] = run(scannedState(), { type: 'executed', results });

    expect(plainRows(editing).at(-2)).toContain('Parent folder ›');
    expect(plainRows(confirming).at(-2)).toContain('Move and rename 3 files?');
    expect(plainRows(done).join('\n')).toMatch(/2 files moved \(images 1 · audio 1\)\s+✘ 1 failed/);
  });
});

describe('runTui', () => {
  const TEST_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'org-tui-'));

  function fakeTerminal() {
    const input = new PassThrough();
    Object.assign(input, { isTTY: true, setRawMode: () => input });
    const output = new PassThrough();
    Object.assign(output, { isTTY: true, columns: 80, rows: 24 });
    let screen = '';
    output.on('data', (chunk) => { screen += chunk; });
    return {
      input, output, screen: () => stripAnsi(screen), raw: () => screen,
      frame: () => stripAnsi(screen.slice(screen.lastIndexOf('\x1b[?2026h'))),
    };
  }

  async function waitFor(check) {
    for (let i = 0; i < 100; i++) {
      if (check()) return;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    throw new Error('timed out');
  }

  beforeEach(async () => {
    await fs.remove(TEST_DIR);
    await fs.ensureFile(path.join(TEST_DIR, 'holiday.jpg'));
    await fs.ensureFile(path.join(TEST_DIR, 'notes.txt'));
  });

  afterAll(async () => {
    await fs.remove(TEST_DIR);
  });

  test('refuses to start without a terminal', async () => {
    const input = new PassThrough();
    await expect(runTui({ targetDir: TEST_DIR, input, output: new PassThrough() })).rejects.toThrow(/interactive terminal/);
  });

  test('organizes the selected files end to end', async () => {
    const terminal = fakeTerminal();
    const session = runTui({ targetDir: TEST_DIR, name: 'pic', input: terminal.input, output: terminal.output });

    await waitFor(() => terminal.screen().includes('2/2 selected'));
    terminal.input.write(' '); // skip holiday.jpg (images sort before documents)
    terminal.input.write('\r');
    terminal.input.write('y');
    await waitFor(() => terminal.screen().includes('1 file moved'));
    terminal.input.write('q');

    const { results } = await session;
    expect(results.map((result) => result.name)).toEqual(['notes.txt']);
    expect(fs.existsSync(path.join(TEST_DIR, 'documents', 'pic-1.txt'))).toBe(true);
    expect(fs.existsSync(path.join(TEST_DIR, 'holiday.jpg'))).toBe(true);
    expect(terminal.output.listenerCount('resize')).toBe(0);
    // Mouse wheel on and the tab title set while running, both put back on the way out.
    expect(terminal.raw()).toContain(`\x1b]0;org — ${path.basename(TEST_DIR)}\x07`);
    expect(terminal.raw()).toContain('\x1b[?1007h');
    expect(terminal.raw().endsWith('\x1b[23;0t\x1b[?1007l\x1b[?7h\x1b[?25h\x1b[?1049l')).toBe(true);
  });

  test('undoes what it just organized', async () => {
    const terminal = fakeTerminal();
    const session = runTui({ targetDir: TEST_DIR, input: terminal.input, output: terminal.output });

    await waitFor(() => terminal.screen().includes('2/2 selected'));
    terminal.input.write('\r');
    terminal.input.write('y');
    await waitFor(() => terminal.screen().includes('2 files moved'));
    terminal.input.write('u');
    terminal.input.write('y');
    await waitFor(() => terminal.screen().includes('Restored 2 files'));
    terminal.input.write('q');

    const { restored } = await session;
    expect(restored).toBe(2);
    expect(fs.existsSync(path.join(TEST_DIR, 'holiday.jpg'))).toBe(true);
    expect(fs.existsSync(path.join(TEST_DIR, 'notes.txt'))).toBe(true);
    expect(fs.existsSync(path.join(TEST_DIR, 'images'))).toBe(false);
  });

  test('Thai keyboard input searches, renames, organizes and undoes through the terminal decoder', async () => {
    await fs.move(path.join(TEST_DIR, 'holiday.jpg'), path.join(TEST_DIR, 'รูปถ่ายเชียงใหม่.jpg'));
    const terminal = fakeTerminal();
    const session = runTui({ targetDir: TEST_DIR, input: terminal.input, output: terminal.output });
    try {
      await waitFor(() => terminal.screen().includes('2/2 selected'));
      terminal.input.write('ฝ'); // /
      // UTF-8 input can arrive split inside Thai characters, especially over SSH.
      for (const byte of Buffer.from('เชียงใหม่')) terminal.input.write(Buffer.from([byte]));
      terminal.input.write('\r');
      await waitFor(() => terminal.screen().includes('1 of 2'));
      terminal.input.write(' '); // leave the photo where it is
      terminal.input.write('\x1b'); // clear the filter
      // Wait for readline's lone-Esc timeout before entering the name editor.
      await waitFor(() => terminal.frame().includes('notes.txt'));
      terminal.input.write('ื'); // n
      await waitFor(() => terminal.screen().includes('File name ›'));
      terminal.input.write('บันทึกทริป');
      terminal.input.write('\r');
      terminal.input.write('\r');
      terminal.input.write('ื'); // n: cancel the first confirmation
      expect(fs.existsSync(path.join(TEST_DIR, 'notes.txt'))).toBe(true);
      terminal.input.write('\r');
      terminal.input.write('ั'); // y
      await waitFor(() => terminal.screen().includes('1 file moved'));
      expect(fs.existsSync(path.join(TEST_DIR, 'documents', 'บันทึกทริป-1.txt'))).toBe(true);
      terminal.input.write('ี'); // u
      terminal.input.write('ั'); // y
      await waitFor(() => terminal.screen().includes('Restored 1 file'));
      terminal.input.write('ๆ'); // q
      const result = await session;
      expect(result.results.map((file) => file.name)).toEqual(['notes.txt']);
      expect(result.restored).toBe(1);
      expect(fs.existsSync(path.join(TEST_DIR, 'notes.txt'))).toBe(true);
      expect(fs.existsSync(path.join(TEST_DIR, 'รูปถ่ายเชียงใหม่.jpg'))).toBe(true);
    } finally {
      terminal.input.write('\x03');
      await session;
    }
  });

  test.each(['organize', 'undo'])('Ctrl+C during %s waits for the current file and saves recoverable history', async (action) => {
    if (action === 'undo') {
      const plan = await buildPlan(TEST_DIR, await scanDirectory(TEST_DIR), { name: 'trip' });
      await recordRun(TEST_DIR, await executePlan(plan));
    }
    const terminal = fakeTerminal();
    const session = runTui({ targetDir: TEST_DIR, input: terminal.input, output: terminal.output });
    let settled = false;
    session.then(() => { settled = true; });
    let release;
    const gate = new Promise((resolve) => { release = resolve; });
    const move = fs.move.bind(fs);
    const delayedMove = jest.spyOn(fs, 'move').mockImplementationOnce(async (...args) => {
      await gate;
      return move(...args);
    });
    try {
      await waitFor(() => terminal.frame().includes(action === 'undo' ? '0/0 selected' : '2/2 selected'));
      terminal.input.write(action === 'undo' ? 'ี' : '\r');
      terminal.input.write('ั');
      await waitFor(() => delayedMove.mock.calls.length > 0);
      terminal.input.write('\x03');
      await waitFor(() => terminal.frame().includes('Stopping after the current file'));
      expect(settled).toBe(false);
      release();
      const result = await session;
      const history = await readHistory(TEST_DIR);
      expect(history).toHaveLength(1);
      expect(history[0].moves).toHaveLength(1);
      expect(action === 'undo' ? result.restored : result.results.length).toBe(1);
      expect(terminal.input.listenerCount('keypress')).toBe(0);
    } finally {
      release();
      terminal.input.write('\x03');
      await session;
      delayedMove.mockRestore();
    }
  });

  test('undoing multiple runs stops at a conflict and keeps older history for a retry', async () => {
    for (let i = 0; i < 2; i++) {
      const plan = await buildPlan(TEST_DIR, await scanDirectory(TEST_DIR), { name: 'trip' });
      await recordRun(TEST_DIR, await executePlan(plan));
      await fs.outputFile(path.join(TEST_DIR, 'holiday.jpg'), `download ${i}`);
    }
    const terminal = fakeTerminal();
    const session = runTui({ targetDir: TEST_DIR, input: terminal.input, output: terminal.output });
    try {
      await waitFor(() => terminal.frame().includes('1/1 selected'));
      terminal.input.write('้');
      await waitFor(() => terminal.frame().includes('history · 2 runs'));
      terminal.input.write('่'); // choose both runs
      terminal.input.write('\r');
      terminal.input.write('ั');
      await waitFor(() => terminal.frame().includes('Retry with u'));
      expect(await readHistory(TEST_DIR)).toHaveLength(2);
      expect(fs.readFileSync(path.join(TEST_DIR, 'holiday.jpg'), 'utf8')).toBe('download 1');
      expect(fs.existsSync(path.join(TEST_DIR, 'notes.txt'))).toBe(false);
    } finally {
      terminal.input.write('\x03');
      await session;
    }
  });
});
