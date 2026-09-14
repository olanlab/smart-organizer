// Pure state machine for the TUI: update(state, action) returns [nextState, effect?].
// Effects ({ type: 'scan' | 'execute' | 'undo' | 'history' | 'open' | 'complete' | 'quit' })
// are carried out by ./index.js, which dispatches the outcome back in as another action.

const path = require('path');
const {
  planMoves, validateName, friendlyError, countFiles, compareNames,
} = require('../organizer');
const { DUPLICATE_MODES, applyDuplicateMode } = require('../duplicates');
const { tildify } = require('../recent');
const { normalizeShortcut } = require('./keyboard');
const { listHeight, helpLayout } = require('./shortcuts');
const { resolveFolder, isWithin, relocatePath } = require('../paths');
const { validateFolderName } = require('./folders');

function createState({
  targetDir, parent = '', name = '', keepNames = false, fileDates = false, duplicates = 'keep', groupBy = null,
  folderFile = null, width = 80, height = 24, date = new Date(),
}) {
  return {
    mode: 'loading', // loading | browse | edit | filter | confirm | confirmUndo | history | running | done
    returnMode: null, // where confirmUndo goes back to when cancelled
    undoRequest: null, // { runs, files } waiting for confirmation
    runs: [], // past runs shown by h, newest first
    historyReturn: null, // where the history screen goes back to
    help: false, // key list shown over the file list
    helpScroll: 0,
    details: false, // status row shows the current file's full details
    filter: '', // only files matching this are listed (see parseFilter)
    sort: 'category', // one of SORTS
    targetDir,
    parent,
    name,
    keepNames, // sort only, don't rename
    fileDates, // date names use each file's modified day instead of today
    duplicates, // what happens to files with the same content as another: one of DUPLICATE_MODES
    groupBy, // null, 'month' or 'year': subfolders inside each category
    renames: new Map(), // file name -> name typed for it with e
    folderFile, // the folder's own .orgrc.json settings file, when it has one
    date,
    width,
    height,
    files: [], // { name, ext, category, modified, size, rank (scan order), selected }
    existing: new Map(),
    plan: [],
    cursor: 0,
    scroll: 0,
    edit: null, // { field: 'parent' | 'name' | 'dir' | 'rename', value, file (rename), matches (Tab completions) }
    folderBrowser: null, // { dir, entries, loading, busy, previous: { mode, cursor, scroll }, dirty }
    folderRequest: 0,
    progress: null, // { label, done, total }
    results: [],
    undo: null, // { count, at } for the last run in this folder, if any
    risk: null, // why organizing this folder is probably a mistake, if it is
    leftAlone: [], // { name, reason } of files the scan skipped on purpose (downloads in progress, ...)
    recent: [], // folders organized lately, newest first, for ↑↓ while switching folders
    message: null, // { tone: 'info' | 'error', text }
  };
}

const SORTS = ['category', 'name', 'newest', 'largest'];
const SORT_LABELS = { category: 'by category', name: 'by name', newest: 'newest first', largest: 'largest first' };

const DUPLICATE_MESSAGES = {
  keep: (count) => `${count} duplicate${count === 1 ? '' : 's'} will be organized like any other file.`,
  skip: (count) => `${count} duplicate${count === 1 ? '' : 's'} will be left where they are.`,
  separate: (count) => `${count} duplicate${count === 1 ? '' : 's'} will go into the "duplicates" folder.`,
};

const GROUP_CYCLE = [null, 'month', 'year'];
const GROUP_MESSAGES = {
  month: 'Files go into "2024-03" style subfolders, by the day each was last modified.',
  year: 'Files go into "2024" style subfolders, by the day each was last modified.',
};

// V opens the folder being organized itself (Finder, Explorer, ...).
const OPEN_FOLDER = { type: 'open', file: '.', label: 'the folder' };

const clamp = (value, min, max) => Math.min(Math.max(value, min), max);

// The list order is also the numbering order for date names, so what you see is what you get.
function sortFiles(files, sort) {
  const compare = {
    category: () => 0, // scan order already groups by category
    name: (a, b) => compareNames(a.name, b.name),
    newest: (a, b) => (b.modified || 0) - (a.modified || 0),
    largest: (a, b) => (b.size || 0) - (a.size || 0),
  }[sort];
  return [...files].sort((a, b) => compare(a, b) || a.rank - b.rank);
}
const isEnter = (key) => key.name === 'return' || key.name === 'enter';
const isQuit = (key) => key.name === 'q' || key.name === 'escape';
const isPrintable = (key) => Boolean(key.str) && !key.ctrl && !key.meta
  && Array.from(key.str).every((char) => char.codePointAt(0) >= 0x20 && char.codePointAt(0) !== 0x7f);

const SIZE_UNITS = { b: 1, kb: 1024, mb: 1024 ** 2, gb: 1024 ** 3 };

// Turns filter text into a test for files. Words are combined, and each one is:
// "@images" (category), ">10mb" / "<500kb" (size), or plain text found in the name.
function parseFilter(text) {
  const tests = text.toLowerCase().split(/\s+/).filter(Boolean).map((word) => {
    const size = /^([<>])(\d+(?:\.\d+)?)(b|kb|mb|gb)?$/.exec(word);
    if (size) {
      const limit = Number(size[2]) * SIZE_UNITS[size[3] || 'b'];
      return size[1] === '>' ? (file) => (file.size || 0) > limit : (file) => (file.size || 0) < limit;
    }
    if (word.startsWith('@') && word.length > 1) return (file) => file.category.startsWith(word.slice(1));
    return (file) => file.name.toLowerCase().includes(word);
  });
  return (file) => tests.every((test) => test(file));
}

function visibleFiles(state) {
  if (!state.filter.trim()) return state.files;
  return state.files.filter(parseFilter(state.filter));
}

function listItems(state) {
  if (state.folderBrowser) return state.folderBrowser.entries;
  if (state.mode === 'history' || (state.mode === 'confirmUndo' && state.returnMode === 'history')) return state.runs;
  return state.mode === 'done' ? state.results : visibleFiles(state);
}

// Moves the cursor and scrolls just enough to keep it on screen.
function moveCursor(state, cursor) {
  const count = listItems(state).length;
  const height = listHeight(state);
  const nextCursor = clamp(cursor, 0, Math.max(0, count - 1));
  const scroll = clamp(clamp(state.scroll, nextCursor - height + 1, nextCursor), 0, Math.max(0, count - height));
  return { ...state, cursor: nextCursor, scroll };
}

function replan(state) {
  const selected = applyDuplicateMode(state.files.filter((file) => file.selected), state.duplicates);
  const plan = planMoves(state.targetDir, selected, {
    parent: state.parent,
    name: state.name,
    keepNames: state.keepNames,
    fileDates: state.fileDates,
    groupBy: state.groupBy,
    date: state.date,
    existing: state.existing,
    renames: state.renames,
  });
  return { ...state, plan };
}

function scan(state, dir = state.targetDir) {
  return [{ ...state, mode: 'loading' }, { type: 'scan', dir }];
}

function onScanned(state, {
  targetDir, files, existing, date, undo = null, risk = null, leftAlone = [],
}) {
  // Rescanning the same folder keeps files the user skipped skipped; new files start selected.
  const sameDir = targetDir === state.targetDir;
  const skipped = new Set(sameDir ? state.files.filter((file) => !file.selected).map((file) => file.name) : []);
  const next = replan({
    ...state,
    mode: 'browse',
    targetDir,
    existing,
    date,
    undo,
    risk,
    leftAlone,
    files: sortFiles(files.map((file, rank) => ({ ...file, rank, selected: !skipped.has(file.name) })), state.sort),
    filter: sameDir ? state.filter : '',
    renames: sameDir ? state.renames : new Map(),
    // Folder settings were read for the folder the TUI started in; another folder keeps the current options.
    folderFile: sameDir ? state.folderFile : null,
    scroll: sameDir ? state.scroll : 0,
    results: [],
    progress: null,
  });
  return moveCursor(next, sameDir ? state.cursor : 0);
}

// Asks before undoing the newest `runs` runs (`files` files in all).
function askUndo(state, request = state.undo && { runs: 1, files: state.undo.count }) {
  if (!request) return [{ ...state, message: { tone: 'error', text: 'Nothing to undo in this folder.' } }];
  return [{ ...state, mode: 'confirmUndo', returnMode: state.mode, undoRequest: request }];
}

function onHistoryKey(state, key) {
  const moved = navigate(state, key);
  if (moved) return [moved];
  if (isEnter(key) && state.runs.length > 0) {
    // Undoing works newest first, so picking a run also takes back every newer one.
    const picked = state.runs.slice(0, state.cursor + 1);
    return askUndo(state, { runs: picked.length, files: picked.reduce((sum, run) => sum + run.moves.length, 0) });
  }
  if (key.name === 'escape' || key.name === 'h') return [moveCursor({ ...state, mode: state.historyReturn, runs: [] }, 0)];
  if (key.str === '?') return [{ ...state, help: true }];
  if (key.name === 'q') return [state, { type: 'quit' }];
  return [state];
}

function undoMessage(results) {
  const failures = results.filter((result) => !result.ok);
  const restored = results.length - failures.length;
  if (results.length === 0) return { tone: 'error', text: 'Nothing to undo in this folder.' };
  if (failures.length === 0) return { tone: 'info', text: `Restored ${countFiles(restored)} to their original names.` };
  const [first] = failures;
  const more = failures.length > 1 ? ` (and ${failures.length - 1} more)` : '';
  return { tone: 'error', text: `Restored ${restored}. Retry with u after fixing: ${first.to}: ${friendlyError(first.error)}${more}` };
}

function navigate(state, key) {
  const page = listHeight(state);
  const last = listItems(state).length - 1;
  if (key.name === 'up' || key.name === 'k') return moveCursor(state, state.cursor - 1);
  if (key.name === 'down' || key.name === 'j') return moveCursor(state, state.cursor + 1);
  if (key.name === 'pageup') return moveCursor(state, state.cursor - page);
  if (key.name === 'pagedown') return moveCursor(state, state.cursor + page);
  if (key.name === 'home' || (key.name === 'g' && !key.shift)) return moveCursor(state, 0);
  if (key.name === 'end' || (key.name === 'g' && key.shift)) return moveCursor(state, last);
  return null;
}

function setSelected(state, files, selected) {
  const names = new Set(files.map((file) => file.name));
  return replan({
    ...state,
    files: state.files.map((file) => (names.has(file.name) && file.selected !== selected ? { ...file, selected } : file)),
  });
}

// Includes the whole group, or skips it if every file in it is already included.
function toggleGroup(state, files) {
  return setSelected(state, files, !files.every((file) => file.selected));
}

function toggleCategory(state, current) {
  const group = visibleFiles(state).filter((file) => file.category === current.category);
  const next = toggleGroup(state, group);
  const verb = group.every((file) => file.selected) ? 'Skipped' : 'Included';
  return { ...next, message: { tone: 'info', text: `${verb} ${countFiles(group.length)} in ${current.category}.` } };
}

function nextDuplicateMode(state) {
  const duplicates = DUPLICATE_MODES[(DUPLICATE_MODES.indexOf(state.duplicates) + 1) % DUPLICATE_MODES.length];
  const count = state.files.filter((file) => file.duplicateOf).length;
  const text = count ? DUPLICATE_MESSAGES[duplicates](count) : `Duplicates: ${duplicates} (there are none here).`;
  return { ...replan({ ...state, duplicates }), message: { tone: 'info', text } };
}

function nextSort(state) {
  const sort = SORTS[(SORTS.indexOf(state.sort) + 1) % SORTS.length];
  const current = visibleFiles(state)[state.cursor];
  const sorted = replan({ ...state, sort, files: sortFiles(state.files, sort) });
  const cursor = Math.max(0, visibleFiles(sorted).indexOf(current));
  return { ...moveCursor(sorted, cursor), message: { tone: 'info', text: `Sorted ${SORT_LABELS[sort]}.` } };
}

// Leaves the filter and keeps the cursor on the file it was on.
function clearFilter(state) {
  const current = visibleFiles(state)[state.cursor];
  const cleared = { ...state, mode: 'browse', filter: '' };
  return moveCursor(cleared, Math.max(0, cleared.files.indexOf(current)));
}

function parentValue(state, dir) {
  return isWithin(state.targetDir, dir) ? path.relative(state.targetDir, dir) : dir;
}

function loadFolders(state, dir, { nearest = false, focus = null } = {}) {
  const request = state.folderRequest + 1;
  const previous = { mode: state.mode === 'edit' ? 'browse' : state.mode, cursor: state.cursor, scroll: state.scroll };
  const browser = state.folderBrowser || { dir, entries: [], previous, dirty: false };
  return [
    { ...state, mode: 'folders', folderRequest: request, folderBrowser: { ...browser, loading: true, busy: false } },
    { type: 'folders', dir, request, nearest, focus },
  ];
}

function closeFolders(state) {
  const { previous, dirty } = state.folderBrowser;
  const closed = { ...state, ...previous, folderBrowser: null, edit: null };
  return dirty && previous.mode === 'browse' ? scan(closed) : [closed];
}

function onFolderKey(state, key) {
  const browser = state.folderBrowser;
  if (browser.busy) return [state];
  if (isQuit(key)) return closeFolders(state);
  if (browser.loading) return [state];
  const moved = navigate(state, key);
  if (moved) return [moved];
  const current = browser.entries[state.cursor];
  if (isEnter(key) || key.name === 'right' || key.name === 'l') {
    return current ? loadFolders(state, path.join(browser.dir, current.name)) : [state];
  }
  if (['left', 'backspace', 'h'].includes(key.name)) return loadFolders(state, path.dirname(browser.dir), { focus: path.basename(browser.dir) });
  if (key.name === 's' || key.name === 'space') {
    return scan({ ...state, ...browser.previous, mode: 'browse', parent: parentValue(state, browser.dir), folderBrowser: null, edit: null });
  }
  if (key.name === 'n') return [{ ...state, mode: 'edit', edit: { field: 'newFolder', value: '' } }];
  if (key.name === 'e' && current) return [{ ...state, mode: 'edit', edit: { field: 'renameFolder', value: current.name, file: current.name } }];
  if (key.str === '/') return [{ ...state, mode: 'edit', edit: { field: 'folderPath', value: tildify(browser.dir) } }];
  if (key.name === 'r') return loadFolders(state, browser.dir, { focus: current && current.name });
  if (key.str === '?') return [{ ...state, help: true, helpScroll: 0 }];
  return [state];
}

function onFilterKey(state, key) {
  const withFilter = (filter) => [moveCursor({ ...state, filter, scroll: 0 }, 0)];

  if (['up', 'down', 'pageup', 'pagedown'].includes(key.name)) return [navigate(state, key)];
  if (key.name === 'escape') return [clearFilter(state)];
  if (isEnter(key)) return [{ ...state, mode: 'browse' }];
  if (key.name === 'backspace') return withFilter(Array.from(state.filter).slice(0, -1).join(''));
  if (key.ctrl && key.name === 'u') return withFilter('');
  if (isPrintable(key)) return withFilter(state.filter + key.str);
  return [state];
}

function onBrowseKey(state, key) {
  const moved = navigate(state, key);
  if (moved) return [moved];

  const current = visibleFiles(state)[state.cursor];
  if (key.str === '/') return [{ ...state, mode: 'filter' }];
  if (key.str === '?') return [{ ...state, help: true }];

  switch (key.name) {
  case 'space':
    return current ? [setSelected(state, [current], !current.selected)] : [state];
  case 'a':
    return [toggleGroup(state, visibleFiles(state))];
  case 'c':
    return current ? [toggleCategory(state, current)] : [state];
  case 's':
    return [nextSort(state)];
  case 'x':
    return [nextDuplicateMode(state)];
  case 'm': {
    // New subfolders may already hold files, so their names are read again.
    const groupBy = GROUP_CYCLE[(GROUP_CYCLE.indexOf(state.groupBy) + 1) % GROUP_CYCLE.length];
    return scan({ ...state, groupBy, message: { tone: 'info', text: GROUP_MESSAGES[groupBy] || 'No date subfolders.' } });
  }
  case 'i':
    return [{ ...state, details: !state.details }];
  case 'v':
    if (key.shift) return [state, OPEN_FOLDER];
    return current ? [state, { type: 'open', file: current.name }] : [state];
  case 'e': {
    if (!current) return [state];
    const move = state.plan.find((item) => item.name === current.name);
    const value = state.renames.get(current.name) || (move ? move.newName : current.name);
    return [{ ...state, mode: 'edit', edit: { field: 'rename', file: current.name, value } }];
  }
  case 'p':
    return [{ ...state, mode: 'edit', edit: { field: 'parent', value: state.parent } }];
  case 'b':
    return loadFolders(state, resolveFolder(state.targetDir, state.parent), { nearest: true });
  case 'n':
    return [{ ...state, mode: 'edit', edit: { field: 'name', value: state.name } }];
  case 'o':
    return [replan({ ...state, keepNames: !state.keepNames, fileDates: false })];
  case 'f':
    // File dates only make sense for date names, so this drops a custom name or kept names.
    return [replan({ ...state, fileDates: !state.fileDates, keepNames: false, name: '' })];
  case 'd':
    return [{ ...state, mode: 'edit', edit: { field: 'dir', value: tildify(state.targetDir), recentIndex: -1 } }];
  case 'r':
    return scan(state);
  case 'u':
    return askUndo(state);
  case 'h':
    return [state, { type: 'history' }];
  default:
    break;
  }

  if (isEnter(key)) {
    if (state.plan.length === 0) return [{ ...state, message: { tone: 'error', text: 'Nothing selected.' } }];
    return [{ ...state, mode: 'confirm' }];
  }
  if (key.name === 'escape' && state.filter) return [clearFilter(state)];
  if (isQuit(key)) return [state, { type: 'quit' }];
  return [state];
}

function commitEdit(state) {
  const { field } = state.edit;
  const value = state.edit.value.trim();
  const closed = { ...state, mode: 'browse', edit: null };

  if (state.folderBrowser) {
    if (field === 'folderPath') return loadFolders(state, resolveFolder(state.folderBrowser.dir, value));
    const error = validateFolderName(value);
    if (error) return [{ ...state, message: { tone: 'error', text: error } }];
    const request = state.folderRequest + 1;
    return [
      { ...state, mode: 'folders', folderRequest: request, folderBrowser: { ...state.folderBrowser, busy: true } },
      { type: field === 'newFolder' ? 'createFolder' : 'renameFolder', dir: state.folderBrowser.dir, name: value, oldName: state.edit.file, request },
    ];
  }

  if (field === 'name') {
    const error = value ? validateName(value) : null;
    if (error) return [{ ...state, message: { tone: 'error', text: error } }];
    // Choosing a name means renaming again; a custom name replaces the date.
    return [replan({ ...closed, name: value, keepNames: false, fileDates: value ? false : state.fileDates })];
  }
  if (field === 'parent') {
    // Destination folders change, so the names already taken there must be re-read.
    return value === state.parent ? [closed] : scan({ ...closed, parent: value });
  }
  if (field === 'rename') {
    const error = value ? validateName(value) : null;
    if (error) return [{ ...state, message: { tone: 'error', text: error } }];
    // An empty name drops the custom one, and the file is named like the others again.
    const renames = new Map(state.renames);
    if (value) renames.set(state.edit.file, value);
    else renames.delete(state.edit.file);
    return [replan({ ...closed, renames })];
  }
  const unchanged = !value || value === state.targetDir || value === tildify(state.targetDir);
  return unchanged ? [closed] : scan(closed, value);
}

function onEditKey(state, key) {
  const { value } = state.edit;
  const withValue = (next) => [{ ...state, edit: { ...state.edit, value: next, matches: null } }];

  if (key.name === 'escape') return [{ ...state, mode: state.folderBrowser ? 'folders' : 'browse', edit: null }];
  if (isEnter(key)) return commitEdit(state);
  if (key.name === 'tab' && state.edit.field === 'parent') return loadFolders(state, resolveFolder(state.targetDir, value), { nearest: true });
  if (key.name === 'tab' && state.edit.field === 'folderPath') {
    return [state, { type: 'complete', value, baseDir: state.folderBrowser.dir, field: 'folderPath' }];
  }
  if (key.name === 'tab' && state.edit.field === 'dir') return [state, { type: 'complete', value }];
  if ((key.name === 'up' || key.name === 'down') && state.edit.field === 'dir' && state.recent.length) {
    // Like shell history: up goes to older folders, down back towards newer ones.
    const step = key.name === 'up' ? 1 : -1;
    const recentIndex = clamp(state.edit.recentIndex + step, 0, state.recent.length - 1);
    return [{ ...state, edit: { ...state.edit, value: state.recent[recentIndex], recentIndex, matches: null } }];
  }
  if (key.name === 'backspace') return withValue(Array.from(value).slice(0, -1).join(''));
  if (key.ctrl && key.name === 'u') return withValue('');
  if (isPrintable(key)) return withValue(value + key.str);
  return [state];
}

function onConfirmKey(state, key) {
  if (key.name === 'y') {
    return [
      { ...state, mode: 'running', progress: { label: 'Moving', done: 0, total: state.plan.length } },
      { type: 'execute', plan: state.plan },
    ];
  }
  return [{ ...state, mode: 'browse' }];
}

function onConfirmUndoKey(state, key) {
  if (key.name !== 'y') return [{ ...state, mode: state.returnMode }];
  const { runs, files } = state.undoRequest;
  return [
    { ...state, mode: 'running', runs: [], progress: { label: 'Restoring', done: 0, total: files } },
    { type: 'undo', count: runs },
  ];
}

function onDoneKey(state, key) {
  const moved = navigate(state, key);
  if (moved) return [moved];
  if (key.name === 'r' || isEnter(key)) return scan({ ...state, cursor: 0, scroll: 0 });
  if (key.name === 'u') return askUndo(state);
  if (key.name === 'h') return [state, { type: 'history' }];
  if (key.name === 'b') return loadFolders(state, resolveFolder(state.targetDir, state.parent), { nearest: true });
  if (key.str === '?') return [{ ...state, help: true }];
  if (key.name === 'v' && key.shift) return [state, OPEN_FOLDER];
  if (key.name === 'v') {
    // Opens a moved file where it is now, or a failed one where it still is.
    const result = state.results[state.cursor];
    return result ? [state, { type: 'open', file: result.ok ? path.join(result.folder, result.newName) : result.name }] : [state];
  }
  if (isQuit(key)) return [state, { type: 'quit' }];
  return [state];
}

function onKey(state, key) {
  if (key.ctrl && key.name === 'c') return [state, { type: 'quit' }];
  // Text fields receive the original Thai characters; only commands use keyboard aliases.
  if (state.mode !== 'edit' && state.mode !== 'filter') key = normalizeShortcut(key);
  if (state.help) {
    const { room, rows } = helpLayout(state);
    const last = Math.max(0, rows - room);
    const steps = { up: -1, k: -1, down: 1, j: 1, pageup: -room, pagedown: room };
    if (Object.hasOwn(steps, key.name)) return [{ ...state, helpScroll: clamp(state.helpScroll + steps[key.name], 0, last) }];
    if (key.name === 'home' || (key.name === 'g' && !key.shift)) return [{ ...state, helpScroll: 0 }];
    if (key.name === 'end' || (key.name === 'g' && key.shift)) return [{ ...state, helpScroll: last }];
    return [moveCursor({ ...state, help: false, helpScroll: 0 }, state.cursor)];
  }
  // Any key press dismisses the last message.
  const current = state.message ? { ...state, message: null } : state;
  switch (state.mode) {
  case 'browse': return onBrowseKey(current, key);
  case 'folders': return onFolderKey(current, key);
  case 'edit': return onEditKey(current, key);
  case 'filter': return onFilterKey(current, key);
  case 'confirm': return onConfirmKey(current, key);
  case 'confirmUndo': return onConfirmUndoKey(current, key);
  case 'history': return onHistoryKey(current, key);
  case 'done': return onDoneKey(current, key);
  case 'loading': return isQuit(key) ? [state, { type: 'quit' }] : [state];
  default: return [state]; // moving files ignores everything but ctrl+c
  }
}

function update(state, action) {
  switch (action.type) {
  case 'key':
  {
    const [next, effect] = onKey(state, action.key);
    // Prompt/shortcut rows can change the list's height when entering or leaving a mode.
    return [moveCursor(next, next.cursor), effect];
  }
  case 'resize':
  {
    const resized = { ...state, width: action.width, height: action.height };
    const { room, rows } = helpLayout(resized);
    resized.helpScroll = clamp(resized.helpScroll, 0, Math.max(0, rows - room));
    return [moveCursor(resized, state.cursor)];
  }
  case 'scanned':
    return [onScanned(state, action)];
  case 'foldersLoaded': {
    if (!state.folderBrowser || action.request !== state.folderRequest) return [state];
    let next = state;
    if (action.renamed) {
      const { from, to } = action.renamed;
      const parent = parentValue(state, relocatePath(resolveFolder(state.targetDir, state.parent), from, to));
      const results = state.results.map((result) => {
        const folder = relocatePath(resolveFolder(state.targetDir, result.folder), from, to);
        return { ...result, folder: parentValue(state, folder), destination: path.join(folder, result.newName) };
      });
      next = { ...next, parent, results };
    }
    return [moveCursor({
      ...next, mode: 'folders', edit: null, scroll: 0,
      cursor: Math.max(0, action.entries.findIndex((entry) => entry.name === action.focus)),
      folderBrowser: { ...state.folderBrowser, dir: action.dir, entries: action.entries, loading: false, busy: false, dirty: state.folderBrowser.dirty || Boolean(action.changed) },
      message: action.message ? { tone: 'info', text: action.message } : null,
    }, Math.max(0, action.entries.findIndex((entry) => entry.name === action.focus)))];
  }
  case 'foldersFailed':
    if (!state.folderBrowser || action.request !== state.folderRequest) return [state];
    return [{
      ...state, mode: state.edit ? 'edit' : 'folders',
      folderBrowser: { ...state.folderBrowser, loading: false, busy: false },
      message: { tone: 'error', text: friendlyError(action.error) },
    }];
  case 'progress':
    return [{ ...state, progress: { ...state.progress, done: action.done, total: action.total } }];
  case 'executed':
    return [{
      ...state,
      mode: 'done',
      results: action.results,
      undo: action.undo,
      cursor: 0,
      scroll: 0,
      message: action.warning ? { tone: 'error', text: action.warning } : state.message,
    }];
  case 'undone':
    // Rescan so the restored files show up again under their original names.
    return scan({ ...state, cursor: 0, scroll: 0, message: undoMessage(action.results) });
  case 'failed':
    return [{ ...state, mode: 'browse', message: { tone: 'error', text: action.error.message } }];
  case 'historyLoaded': {
    const runs = [...action.runs].reverse();
    const message = runs.length ? state.message : { tone: 'error', text: 'Nothing to undo in this folder.' };
    if (!runs.length) return [{ ...state, message }];
    return [{ ...state, mode: 'history', historyReturn: state.mode, runs, cursor: 0, scroll: 0, message }];
  }
  case 'recentLoaded':
    return [{ ...state, recent: action.folders }];
  case 'notice':
    return [{ ...state, message: { tone: action.tone, text: action.text } }];
  case 'completed': {
    // Ignored if the user left the folder field while the folder was being read.
    if (state.mode !== 'edit' || state.edit.field !== (action.field || 'dir')) return [state];
    if (action.requestValue !== undefined && state.edit.value !== action.requestValue) return [state];
    const message = action.matches.length === 0 ? { tone: 'error', text: 'No folder starts with that.' } : state.message;
    return [{ ...state, edit: { ...state.edit, value: action.value, matches: action.matches }, message }];
  }
  default:
    return [state];
  }
}

module.exports = { SORT_LABELS, createState, update, listHeight, listItems, visibleFiles };
