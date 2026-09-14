const fs = require('fs-extra');
const path = require('path');
const { isWithin, relocatePath } = require('../paths');
const { readHistory, writeHistory } = require('../history');

function validateFolderName(name) {
  if (!name.trim() || name === '.' || name === '..') return 'Enter a folder name, not . or ..';
  // Names here describe one child folder, never a path or a terminal control sequence.
  if (/[/\\\x00-\x1f\x7f]/.test(name)) return 'Use a folder name without slashes or control characters.'; // eslint-disable-line no-control-regex
  return null;
}

async function listFolders(dir, { nearest = false } = {}) {
  for (;;) {
    try {
      const entries = await fs.readdir(dir, { withFileTypes: true });
      return {
        dir,
        entries: entries.filter((entry) => entry.isDirectory() && !entry.name.startsWith('.'))
          .map((entry) => ({ name: entry.name }))
          .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true })),
      };
    } catch (error) {
      if (!nearest || !['ENOENT', 'ENOTDIR'].includes(error.code) || dir === path.dirname(dir)) throw error;
      dir = path.dirname(dir);
    }
  }
}

async function createFolder(dir, name) {
  const error = validateFolderName(name);
  if (error) throw new Error(error);
  const folder = path.join(dir, name);
  await fs.mkdir(folder); // Fails if anything with this name already exists.
  return folder;
}

async function renameFolder(sourceDir, dir, oldName, newName) {
  for (const name of [oldName, newName]) {
    const error = validateFolderName(name);
    if (error) throw new Error(error);
  }
  const from = path.join(dir, oldName);
  const to = path.join(dir, newName);
  if (!(await fs.lstat(from)).isDirectory()) throw new Error('Choose a folder to rename.');
  const [realFrom, realSource] = await Promise.all([fs.realpath(from), fs.realpath(sourceDir)]);
  if (isWithin(realFrom, realSource)) throw new Error('The source folder and its parents cannot be renamed while organizing it.');
  if (from === to) return { from, to };
  const exists = await fs.lstat(to).then(() => true, (error) => {
    if (error.code !== 'ENOENT') throw error;
    return false;
  });
  if (exists) throw new Error(`A file or folder named "${newName}" already exists.`);

  const runs = await readHistory(sourceDir);
  let changed = false;
  const updated = runs.map((run) => ({
    ...run,
    moves: run.moves.map((move) => {
      const current = path.join(sourceDir, move.to);
      const destination = relocatePath(current, from, to);
      if (current === destination) return move;
      changed = true;
      return { ...move, to: path.relative(sourceDir, destination) };
    }),
  }));
  await fs.move(from, to, { overwrite: false });
  if (changed) {
    try {
      await writeHistory(sourceDir, updated);
    } catch (error) {
      // Preserve the old paths if saving their replacements fails.
      await fs.move(to, from, { overwrite: false });
      throw new Error(`Could not update undo history; the folder name was restored: ${error.message}`, { cause: error });
    }
  }
  return { from, to };
}

module.exports = { validateFolderName, listFolders, createFolder, renameFolder };
