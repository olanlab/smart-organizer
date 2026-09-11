// Terminal side of the TUI: raw keyboard input, the alternate screen, and running
// the effects that ./state.js asks for (scanning folders, moving files).

const path = require('path');
const readline = require('readline');
const { spawn } = require('child_process');
const {
  DEFAULT_CATEGORIES, isDirectory, riskReason, scanDirectory, readExistingNames, executePlan,
} = require('../organizer');
const {
  lastRun, readHistory, recordRun, undoLastRun,
} = require('../history');
const { organizedFolders, possibleDestinations, markDuplicates } = require('../duplicates');
const { createState, update } = require('./state');
const { render } = require('./view');
const { resolveDir, completePath, openCommand } = require('./paths');
const { printable } = require('./text');
const { readRecent, rememberFolder, tildify } = require('../recent');

const CSI = '\x1b[';
// Alternate screen, hidden cursor, no auto-wrap (a mis-measured glyph gets clipped instead of
// scrolling), the mouse wheel sent as arrow keys, and the window title saved to restore later.
const ENTER_SCREEN = `${CSI}?1049h${CSI}?25l${CSI}?7l${CSI}?1007h${CSI}22;0t${CSI}2J`;
const LEAVE_SCREEN = `${CSI}23;0t${CSI}?1007l${CSI}?7h${CSI}?25h${CSI}?1049l`;
const windowTitle = (dir) => `\x1b]0;org — ${printable(path.basename(dir) || dir)}\x07`;
// Synchronized output: supporting terminals paint the whole frame at once, others ignore it.
const BEGIN_FRAME = `${CSI}?2026h`;
const END_FRAME = `${CSI}?2026l`;

// Starts the system's default app for a file and resolves once it launched (or failed to).
function openWithDefaultApp(file) {
  return new Promise((resolve, reject) => {
    const [command, args] = openCommand(file);
    const child = spawn(command, args, { detached: true, stdio: 'ignore' });
    child.once('error', reject);
    child.once('spawn', () => {
      child.unref();
      resolve();
    });
  });
}

async function readUndoInfo(dir) {
  const run = await lastRun(dir);
  return run ? { count: run.moves.length, at: run.at } : null;
}

// Resolves with { targetDir, results, restored } once the user quits: results cover every
// file moved this session, restored counts the files put back by undo.
function runTui({
  targetDir, parent, name, keepNames, fileDates, duplicates, groupBy, version,
  categories = DEFAULT_CATEGORIES, ignore = [], only = null, names = null, folderFile = null,
  input = process.stdin, output = process.stdout, openFile = openWithDefaultApp,
}) {
  if (!input.isTTY || !output.isTTY) {
    return Promise.reject(new Error('The TUI needs an interactive terminal.'));
  }

  return new Promise((resolve, reject) => {
    let state = createState({
      targetDir, parent, name, keepNames, fileDates, duplicates, groupBy, folderFile, width: output.columns, height: output.rows,
    });
    const allResults = [];
    let restored = 0;
    const abort = new AbortController();
    let finished = false;
    let quitting = false;
    let mutation = Promise.resolve();

    const restoreScreen = () => output.write(LEAVE_SCREEN);

    const close = () => {
      finished = true;
      abort.abort();
      input.off('keypress', onKeypress);
      output.off('resize', onResize);
      process.off('exit', restoreScreen);
      input.setRawMode(false);
      input.pause();
      restoreScreen();
    };

    let shownTitle = null;
    const draw = () => {
      const rows = render(state, { version });
      // The tab title follows the folder, so a busy row of terminal tabs shows which one this is.
      const title = windowTitle(state.targetDir);
      if (title !== shownTitle) output.write(title);
      shownTitle = title;
      output.write(BEGIN_FRAME + rows.map((line, i) => `${CSI}${i + 1};1H${line}`).join('') + END_FRAME);
    };

    const perform = async (effect) => {
      if (effect.type === 'quit') {
        if (quitting) return;
        quitting = true;
        abort.abort();
        if (state.mode === 'running') {
          dispatch({ type: 'notice', tone: 'info', text: 'Stopping after the current file and saving undo history…' });
        }
        // Finish the in-flight file and its history before restoring the terminal or reporting totals.
        await mutation;
        close();
        resolve({ targetDir: state.targetDir, results: allResults, restored });
        return;
      }
      const dir = state.targetDir;
      try {
        if (effect.type === 'scan') {
          const scanDir = resolveDir(effect.dir, dir);
          const folders = organizedFolders(categories, state.parent);
          if (!(await isDirectory(scanDir))) throw new Error(`Not a folder: ${scanDir}`);
          // Files named on the command line only narrow the folder they came from.
          const leftAlone = [];
          const scanned = await scanDirectory(scanDir, {
            categories, ignore, only, names: scanDir === targetDir ? names : null, skipped: leftAlone,
          });
          const files = await markDuplicates(scanDir, scanned, { folders });
          const destinations = possibleDestinations(files, { parent: state.parent, groupBy: state.groupBy });
          const existing = await readExistingNames(scanDir, [...folders, ...destinations]);
          const undo = await readUndoInfo(scanDir);
          const risk = await riskReason(scanDir);
          dispatch({
            type: 'scanned', targetDir: scanDir, files, existing, undo, risk, leftAlone, date: new Date(),
          });
        } else if (effect.type === 'execute') {
          const results = await executePlan(effect.plan, {
            signal: abort.signal,
            // Recorded as they land, so quitting mid-run still reports what was moved.
            onProgress: (result, done, total) => {
              allResults.push(result);
              dispatch({ type: 'progress', done, total });
            },
          });
          // Saved even if the user quit mid-run, so those moves can still be undone later.
          const warning = await recordRun(dir, results).then(() => null, (error) => `Could not save undo history: ${error.message}`);
          if (results.some((result) => result.ok)) {
            await rememberFolder(dir);
            loadRecent();
          }
          dispatch({ type: 'executed', results, undo: await readUndoInfo(dir), warning });
        } else if (effect.type === 'undo') {
          // Several runs are undone newest first; progress counts files across all of them.
          const results = [];
          for (let run = 0; run < (effect.count || 1); run++) {
            const before = results.length;
            const undone = await undoLastRun(dir, {
              signal: abort.signal,
              onProgress: (_, done) => dispatch({ type: 'progress', done: before + done, total: state.progress.total }),
            });
            if (!undone) break;
            results.push(...undone.results);
            if (undone.remaining > 0 || abort.signal.aborted) break;
          }
          restored += results.filter((result) => result.ok).length;
          dispatch({ type: 'undone', results });
        } else if (effect.type === 'history') {
          dispatch({ type: 'historyLoaded', runs: await readHistory(dir) });
        } else if (effect.type === 'open') {
          const opened = await openFile(path.join(dir, effect.file)).then(() => null, (error) => error);
          dispatch(opened
            ? { type: 'notice', tone: 'error', text: `Could not open ${effect.label || effect.file}: ${opened.message}` }
            : { type: 'notice', tone: 'info', text: `Opened ${effect.label || effect.file}` });
        } else if (effect.type === 'complete') {
          const { value, matches } = await completePath(effect.value, dir);
          dispatch({ type: 'completed', value, matches });
        }
      } catch (error) {
        dispatch({ type: 'failed', error });
      }
    };

    // Recent folders, shown as "~/Downloads", for ↑↓ while switching folders.
    function loadRecent() {
      readRecent().then((folders) => dispatch({ type: 'recentLoaded', folders: folders.map(tildify) }));
    }

    function dispatch(action) {
      if (finished) return;
      try {
        const [next, effect] = update(state, action);
        state = next;
        draw();
        if (effect) {
          const task = perform(effect);
          if (effect.type === 'execute' || effect.type === 'undo') mutation = task;
        }
      } catch (error) {
        close();
        reject(error);
      }
    }

    function onKeypress(str, key = {}) {
      if (quitting) return;
      dispatch({ type: 'key', key: { ...key, str } });
    }

    function onResize() {
      output.write(`${CSI}2J`);
      dispatch({ type: 'resize', width: output.columns, height: output.rows });
    }

    // A lone Esc is only told apart from arrow-key sequences after this delay; the 500ms default feels laggy.
    readline.emitKeypressEvents(input, { escapeCodeTimeout: 50 });
    input.setRawMode(true);
    input.resume();
    input.on('keypress', onKeypress);
    output.on('resize', onResize);
    process.on('exit', restoreScreen);
    output.write(ENTER_SCREEN);

    draw();
    loadRecent();
    perform({ type: 'scan', dir: targetDir });
  });
}

module.exports = { runTui };
