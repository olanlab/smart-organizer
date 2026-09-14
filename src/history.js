// Undo support. Every organized folder keeps a log of its recent runs in a dotfile
// (so scanDirectory never picks it up), with paths relative to that folder.

const fs = require('fs-extra');
const path = require('path');
const { resolveFolder } = require('./paths');

const HISTORY_FILE = '.org-history.json';
const MAX_RUNS = 20;

const historyPath = (targetDir) => path.join(targetDir, HISTORY_FILE);

async function readHistory(targetDir) {
  try {
    const data = await fs.readJson(historyPath(targetDir));
    return Array.isArray(data.runs) ? data.runs : [];
  } catch {
    return [];
  }
}

async function writeHistory(targetDir, runs) {
  const file = historyPath(targetDir);
  if (runs.length === 0) {
    await fs.remove(file);
    return;
  }
  // Write then rename, so an interrupted write never leaves half a history behind.
  await fs.writeJson(`${file}.tmp`, { version: 1, runs }, { spaces: 2 });
  await fs.move(`${file}.tmp`, file, { overwrite: true });
}

async function lastRun(targetDir) {
  return (await readHistory(targetDir)).at(-1) || null;
}

// Appends the successful moves from executePlan results as one run. Returns the run, or null.
async function recordRun(targetDir, results, date = new Date()) {
  const moves = results
    .filter((result) => result.ok)
    .map((result) => ({ from: result.name, to: path.relative(targetDir, resolveFolder(targetDir, path.join(result.folder, result.newName))) }));
  if (moves.length === 0) return null;

  const run = { at: date.toISOString(), moves };
  await writeHistory(targetDir, [...(await readHistory(targetDir)), run].slice(-MAX_RUNS));
  return run;
}

// Deletes a folder if nothing but a Finder .DS_Store is left in it.
async function removeIfEmpty(dir) {
  const entries = await fs.readdir(dir).catch(() => null);
  if (!entries || entries.some((name) => name !== '.DS_Store')) return false;
  if (entries.length > 0) await fs.unlink(path.join(dir, '.DS_Store'));
  return fs.rmdir(dir).then(() => true, () => false);
}

// Cleans up category folders an undo emptied, walking up to (never past) the organized folder.
async function removeEmptyFolders(targetDir, folders) {
  const deepestFirst = [...new Set(folders)].sort((a, b) => b.length - a.length);
  for (let folder of deepestFirst) {
    while (folder !== '.' && !folder.startsWith('..') && !path.isAbsolute(folder)) {
      if (!(await removeIfEmpty(path.join(targetDir, folder)))) break;
      folder = path.dirname(folder);
    }
  }
}

// Puts the files of the latest run back under their original names, newest first, and
// keeps any failed/unattempted moves available for a retry. Returns { run, results, remaining },
// or null if there is nothing to undo.
async function undoLastRun(targetDir, { onProgress, signal } = {}) {
  const runs = await readHistory(targetDir);
  const run = runs.at(-1);
  if (!run) return null;

  const moves = [...run.moves].reverse();
  const results = [];
  for (const move of moves) {
    if (signal && signal.aborted) break;
    let result;
    try {
      await fs.move(path.join(targetDir, move.to), path.join(targetDir, move.from));
      result = { ...move, ok: true };
    } catch (error) {
      result = { ...move, ok: false, error };
    }
    results.push(result);
    if (onProgress) onProgress(result, results.length, moves.length);
  }

  const restored = new Set(results.filter((result) => result.ok).map((result) => result.to));
  const pending = run.moves.filter((move) => !restored.has(move.to));
  await writeHistory(targetDir, [
    ...runs.slice(0, -1),
    ...(pending.length ? [{ ...run, moves: pending }] : []),
  ]);
  await removeEmptyFolders(targetDir, results.filter((result) => result.ok).map((result) => path.dirname(result.to)));
  return { run, results, remaining: pending.length };
}

module.exports = { HISTORY_FILE, MAX_RUNS, readHistory, writeHistory, lastRun, recordRun, undoLastRun };
