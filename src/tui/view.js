// Renders a state into exactly `height` rows, each exactly `width` columns wide,
// so every frame fully overwrites the previous one without clearing the screen.

const path = require('path');
const chalk = require('chalk');
const {
  formatDate, formatDateTime, formatSize, friendlyError, countFiles, categorySummary,
} = require('../organizer');
const { printable, displayWidth, truncate, padEnd } = require('./text');
const { SORT_LABELS, listHeight, listItems, visibleFiles } = require('./state');
const { HELP, shortcutRows, hasPrompt, helpLayout } = require('./shortcuts');

const MIN_WIDTH = 40;
const MIN_HEIGHT = 10;
// From this width on, file rows also show size and modified date.
const META_WIDTH = 100;

const CATEGORY_COLORS = {
  images: chalk.magenta,
  videos: chalk.red,
  audio: chalk.yellow,
  documents: chalk.blueBright,
  archives: chalk.cyan,
  code: chalk.green,
  apps: chalk.white,
  others: chalk.gray,
};

const EDIT_LABELS = {
  parent: ['Parent folder', 'empty = none'],
  name: ['File name', 'empty = today\'s date'],
  dir: ['Folder', 'Tab completes folder names'],
  rename: ['New name', 'the extension stays; empty = back to normal'],
};

// Custom categories from the settings file get a steady color picked from their name.
const EXTRA_COLORS = [chalk.magentaBright, chalk.greenBright, chalk.yellowBright, chalk.cyanBright, chalk.redBright];
const colorFor = (category) => CATEGORY_COLORS[category]
  || EXTRA_COLORS[Array.from(category).reduce((sum, char) => sum + char.codePointAt(0), 0) % EXTRA_COLORS.length];
const segmentsWidth = (segments) => segments.reduce((sum, [text]) => sum + displayWidth(printable(text)), 0);

// Joins [text, style] segments into one row, cut at `width` columns and padded with spaces.
// Every piece of text goes through printable(), so no filename can break the frame.
function row(segments, width) {
  let out = '';
  let used = 0;
  for (const [text, style = String] of segments) {
    if (used >= width) break;
    const piece = truncate(printable(text), width - used);
    out += style(piece);
    used += displayWidth(piece);
  }
  return out + ' '.repeat(Math.max(0, width - used));
}

// Left segments, then right segments flush against the right edge. When both don't fit,
// the right side is dropped, or with keepRight the left side is cut short instead.
function spread(left, right, width, { keepRight = false } = {}) {
  const rightWidth = segmentsWidth(right);
  const gap = width - segmentsWidth(left) - rightWidth;
  if (gap >= 1) return row([...left, [' '.repeat(gap)], ...right], width);
  if (!keepRight || rightWidth >= width) return row(left, width);
  return row(left, width - rightWidth) + row(right, rightWidth);
}

function rule(width, label = '') {
  if (!label || width < displayWidth(label) + 4) return chalk.dim('─'.repeat(width));
  return chalk.dim(`${'─'.repeat(width - displayWidth(label) - 3)} ${label} ─`);
}

function hints(pairs) {
  return pairs.flatMap(([key, label], index) => [[index ? '   ' : ' '], [key, chalk.cyan.bold], [` ${label}`]]);
}

function footerRows(state) {
  return [
    ...(hasPrompt(state) ? [promptRow(state)] : []),
    ...shortcutRows(state).map(({ pairs, tail }) => spread(hints(pairs), [...hints(tail), [' ']], state.width)),
  ];
}

function titleRow(state, version) {
  const left = [[' Smart Organizer', chalk.bold.cyan], [version ? ` v${version}` : '', chalk.dim]];
  const status = {
    loading: 'scanning…',
    running: `${(state.progress && state.progress.label.toLowerCase()) || 'working'}…`,
    done: `${state.results.filter((result) => result.ok).length} moved`,
    history: `history · ${state.runs.length} ${state.runs.length === 1 ? 'run' : 'runs'}`,
  }[state.mode] || `${state.plan.length}/${state.files.length} selected`
    // Files skipped on purpose (still downloading, lock files) are counted so nobody wonders where they went.
    + (state.leftAlone.length && state.mode !== 'done' ? ` · ${state.leftAlone.length} left alone` : '');
  return spread(left, [[`${status} `, chalk.dim]], state.width);
}

function nameSegments(state) {
  if (state.keepNames) return [['original names', chalk.bold], [' (o to rename)', chalk.dim]];
  if (state.name) return [[`${state.name}-N`, chalk.bold]];
  if (state.fileDates) return [['YYYY-MM-DD-N', chalk.bold], [' (each file\'s modified date)', chalk.dim]];
  return [[`${formatDate(state.date)}-N`, chalk.bold], [' (today · f for file dates)', chalk.dim]];
}

function optionRows(state) {
  return [
    row([
      [' Folder  ', chalk.dim],
      [truncate(printable(state.targetDir), state.width - (state.folderFile ? 27 : 9), { middle: true }), chalk.bold],
      [state.folderFile ? '  (folder settings)' : '', chalk.dim],
    ], state.width),
    row([
      [' Parent  ', chalk.dim],
      [state.parent || '(none)', state.parent ? chalk.bold : chalk.dim],
      ...(state.groupBy ? [['    Group  ', chalk.dim], [`by ${state.groupBy}`, chalk.bold]] : []),
      ['    Name  ', chalk.dim],
      ...nameSegments(state),
    ], state.width),
  ];
}

// Size and modified date, shown between the name and the destination on wide terminals.
function metaSegments(file) {
  return [[`${formatSize(file.size).padStart(9)}  ${file.modified ? formatDate(file.modified) : ''.padEnd(10)}`, chalk.dim]];
}
const META_COLUMNS = 21;

function fileRow(file, active, nameWidth, move, width, showMeta) {
  // Copies of other files are yellow, so they stand out before anything moves.
  const base = file.duplicateOf ? chalk.yellow : String;
  const nameStyle = active ? chalk.bold : file.selected ? base : chalk.dim;
  let destination = [['skip', chalk.dim]];
  // A name typed with e is underlined, so it is clear which files got one.
  if (move) destination = [[`${move.folder}${path.sep}`, colorFor(move.category)], [move.newName, move.renamed ? chalk.underline : String]];
  else if (file.selected && file.duplicateOf) destination = [[`skip, same as ${file.duplicateOf}`, chalk.yellow]];
  return row([
    [active ? '❯ ' : '  ', chalk.cyan],
    [file.selected ? '● ' : '○ ', file.selected ? chalk.green : chalk.dim],
    [padEnd(truncate(printable(file.name), nameWidth, { middle: true }), nameWidth), nameStyle],
    ...(showMeta ? metaSegments(file) : []),
    [' → ', chalk.dim],
    ...destination,
  ], width);
}

function resultRow(result, active, nameWidth, width) {
  const outcome = result.ok
    ? [path.join(result.folder, result.newName), colorFor(result.category)]
    : [friendlyError(result.error), chalk.red];
  return row([
    [active ? '❯ ' : '  ', chalk.cyan],
    result.ok ? ['✔ ', chalk.green] : ['✘ ', chalk.red],
    [padEnd(truncate(printable(result.name), nameWidth, { middle: true }), nameWidth), active ? chalk.bold : String],
    [' → ', chalk.dim],
    outcome,
  ], width);
}

function emptyText(state) {
  if (state.mode === 'loading') return 'Scanning…';
  if (state.mode === 'done') return 'Nothing was moved.';
  if (state.filter) return `No files match "${state.filter}". Esc clears the filter.`;
  if (state.leftAlone.length) {
    const reasons = [...new Set(state.leftAlone.map((file) => file.reason))].join(', ');
    return `Nothing to organize: ${countFiles(state.leftAlone.length)} left alone (${reasons}).`;
  }
  return 'Nothing to organize here. Press d to pick another folder (Tab completes names).';
}

// The key list, in two columns when it doesn't fit in one and the terminal is wide enough.
function helpRows(state) {
  const { width } = state;
  const { room, columns, rows: total } = helpLayout(state);
  const entry = ([key, label]) => [[`  ${padEnd(key, 14)}`, chalk.cyan.bold], [label]];
  const title = row([[' Keys', chalk.bold], ['   ↑↓ scroll · other keys close', chalk.dim]], width);
  const offset = Math.min(state.helpScroll, Math.max(0, total - room));
  if (columns === 1) return [title, ...HELP.slice(offset, offset + room).map((item) => row(entry(item), width))];

  const column = Math.floor(width / 2);
  const rows = [];
  for (let i = offset; i < Math.min(total, offset + room); i++) {
    const right = HELP[i + total] ? entry(HELP[i + total]) : [];
    rows.push(row(entry(HELP[i]), column) + row(right, width - column));
  }
  return [title, ...rows];
}

// One row per past run, newest first: when, how many files, and a few examples.
function historyRows(state) {
  const visible = state.runs.slice(state.scroll, state.scroll + listHeight(state));
  return visible.map((run, i) => {
    const index = state.scroll + i;
    const sample = run.moves.slice(0, 2).map((move) => `${move.from} → ${move.to}`).join(', ');
    const more = run.moves.length > 2 ? `, +${run.moves.length - 2} more` : '';
    // Rows that the selected one would undo along with it are marked.
    const included = index <= state.cursor;
    return row([
      [index === state.cursor ? '❯ ' : '  ', chalk.cyan],
      [included ? '↶ ' : '  ', chalk.yellow],
      [`${formatDateTime(new Date(run.at))}  `, index === state.cursor ? chalk.bold : String],
      [padEnd(countFiles(run.moves.length), 10), chalk.bold],
      [`${sample}${more}`, chalk.dim],
    ], state.width);
  });
}

function listRows(state) {
  const { width } = state;
  if (state.help) return helpRows(state);
  if (state.mode === 'history' || (state.mode === 'confirmUndo' && state.returnMode === 'history')) {
    return historyRows(state);
  }
  const items = listItems(state);
  if (items.length === 0) return [row([[`  ${emptyText(state)}`, chalk.dim]], width)];

  // Name column: as wide as the longest name, but never more than half of what is left.
  const showMeta = state.mode !== 'done' && width >= META_WIDTH;
  const room = width - 7 - (showMeta ? META_COLUMNS : 0);
  const longest = items.reduce((max, item) => Math.max(max, displayWidth(printable(item.name))), 0);
  const nameWidth = Math.max(8, Math.min(longest, Math.floor(room / 2)));
  const visible = items.slice(state.scroll, state.scroll + listHeight(state));

  if (state.mode === 'done') {
    return visible.map((result, i) => resultRow(result, state.scroll + i === state.cursor, nameWidth, width));
  }
  const moves = new Map(state.plan.map((move) => [move.name, move]));
  return visible.map((file, i) => fileRow(
    file, state.scroll + i === state.cursor, nameWidth, moves.get(file.name), width, showMeta,
  ));
}

function scrollLabel(state) {
  if (state.help) {
    const { room, rows } = helpLayout(state);
    return rows > room ? `${state.helpScroll + 1}–${Math.min(state.helpScroll + room, rows)} of ${rows}` : '';
  }
  const total = listItems(state).length;
  const height = listHeight(state);
  if (state.help || total <= height) return '';
  return `${state.scroll + 1}–${Math.min(state.scroll + height, total)} of ${total}`;
}

// Shown on the rule above the list: any active filter and a non-default sort order.
function listLabel(state) {
  if (state.mode === 'done' || state.help) return '';
  const parts = [];
  if (state.filter) parts.push(`filter "${state.filter}" · ${visibleFiles(state).length} of ${state.files.length}`);
  if (state.sort !== 'category') parts.push(SORT_LABELS[state.sort]);
  return parts.join(' · ');
}

function detailsRow(state) {
  const file = visibleFiles(state)[state.cursor];
  if (!file) return row([], state.width);
  const move = state.plan.find((item) => item.name === file.name);
  // The destination comes before the extras, so a narrow terminal cuts those off first.
  return row([
    [` ${file.name}`, chalk.bold],
    ['  → ', chalk.dim],
    move ? [path.join(move.folder, move.newName), colorFor(move.category)] : ['skipped', chalk.dim],
    [`  ${formatSize(file.size)}`, chalk.dim],
    [file.modified ? `  ${formatDateTime(file.modified)}` : '', chalk.dim],
    [file.duplicateOf ? `  same as ${file.duplicateOf}` : '', chalk.yellow],
  ], state.width);
}

function statusRow(state) {
  const matches = state.mode === 'edit' && state.edit.matches;
  if (matches && matches.length > 1) {
    return row([[' Folders: ', chalk.dim], [matches.join('  ')]], state.width);
  }
  if (state.message) {
    const style = state.message.tone === 'error' ? chalk.red : chalk.green;
    return row([[` ${state.message.text}`, style]], state.width);
  }
  if (state.mode === 'edit' && state.edit.field === 'dir' && state.recent.length) {
    return row([[' ↑↓ recent: ', chalk.dim], [state.recent.join('  ·  ')]], state.width);
  }
  if (state.mode === 'done') {
    const moved = state.results.filter((result) => result.ok);
    const failed = state.results.length - moved.length;
    return row([
      [` ✔ ${countFiles(moved.length)} moved`, chalk.green],
      [moved.length ? ` (${categorySummary(moved)})` : '', chalk.dim],
      [failed ? `   ✘ ${failed} failed` : '', chalk.red],
    ], state.width);
  }

  if (state.mode === 'history' || (state.mode === 'confirmUndo' && state.returnMode === 'history')) {
    return row([[' Undoing a run also undoes every newer one (marked ↶), newest first.', chalk.dim]], state.width);
  }

  if (state.details) return detailsRow(state);

  if (state.risk) {
    return row([[` ⚠ Careful: ${state.risk}. Its files would be scattered.`, chalk.yellow]], state.width);
  }

  const counts = new Map();
  for (const move of state.plan) counts.set(move.category, (counts.get(move.category) || 0) + 1);
  const copies = state.files.filter((file) => file.duplicateOf).length;
  const segments = [...counts].flatMap(([category, count], index) => [
    [index ? ' · ' : ' ', chalk.dim],
    [category, colorFor(category)],
    [` ${count}`, chalk.bold],
  ]);
  // The duplicates note goes first so a narrow terminal doesn't cut it off.
  if (copies) segments.unshift([` ${copies} duplicate${copies === 1 ? '' : 's'} (x: ${state.duplicates})  `, chalk.yellow]);
  return row(segments, state.width);
}

function progressBar(done, total, width) {
  const filled = total ? Math.round((done / total) * width) : 0;
  return [['█'.repeat(filled), chalk.cyan], ['░'.repeat(width - filled), chalk.dim]];
}

function promptRow(state) {
  const { width } = state;
  switch (state.mode) {
  case 'edit': {
    const [label, placeholder] = EDIT_LABELS[state.edit.field];
    const prompt = ` ${label} › `;
    // The typing position stays visible; save/cancel have a separate, permanent row.
    const room = width - displayWidth(prompt) - 1;
    return row([
      [prompt, chalk.cyan],
      [truncate(printable(state.edit.value), Math.max(1, room), { start: true }), chalk.bold],
      [' ', chalk.inverse],
      [state.edit.value ? '' : ` ${placeholder}`, chalk.dim],
    ], width);
  }
  case 'confirm': {
    // Organizing covers every selected file, including ones the filter is hiding: say so.
    const shown = new Set(visibleFiles(state).map((file) => file.name));
    const hidden = state.plan.filter((move) => !shown.has(move.name)).length;
    const action = `${state.keepNames ? 'Move' : 'Move and rename'} ${countFiles(state.plan.length)}`
      + (hidden ? ` (${hidden} hidden by the filter)` : '');
    return row([
      state.risk
        ? [` Careful, ${state.risk}! ${action} anyway? `, chalk.red.bold]
        : [` ${action}? `, chalk.yellow.bold],
    ], width);
  }
  case 'confirmUndo': {
    const { runs, files } = state.undoRequest;
    const what = runs === 1 ? 'the last run' : `the last ${runs} runs`;
    return row([
      [` Undo ${what} and restore ${countFiles(files)}? `, chalk.yellow.bold],
    ], width);
  }
  case 'running': {
    const { label, done, total } = state.progress;
    const barWidth = Math.max(10, Math.min(30, width - 30));
    return row([[` ${label} `], ...progressBar(done, total, barWidth), [` ${done}/${total}`, chalk.dim]], width);
  }
  case 'filter':
    return row([
      [' Filter › ', chalk.cyan],
      [truncate(printable(state.filter), width - displayWidth(' Filter › ') - 1, { start: true }), chalk.bold],
      [' ', chalk.inverse],
      [state.filter ? '' : ' name, @images, >10mb, <1kb', chalk.dim],
    ], width);
  default:
    return row([], width);
  }
}

function render(state, { version = '' } = {}) {
  const { width, height } = state;
  if (width < MIN_WIDTH || height < MIN_HEIGHT) {
    const lines = [row([[` Terminal too small (need ${MIN_WIDTH}×${MIN_HEIGHT})`, chalk.yellow]], width)];
    while (lines.length < height) lines.push(' '.repeat(width));
    return lines;
  }

  const list = listRows(state);
  while (list.length < listHeight(state)) list.push(' '.repeat(width));

  return [
    titleRow(state, version),
    ...optionRows(state),
    rule(width, listLabel(state)),
    ...list,
    rule(width, scrollLabel(state)),
    statusRow(state),
    ...footerRows(state),
  ];
}

module.exports = { render, MIN_WIDTH, MIN_HEIGHT };
