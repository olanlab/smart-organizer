// Spotting files with identical content, like "report.pdf" and "report (1).pdf" in Downloads.
// Nothing is ever deleted: duplicates are organized as usual, left where they are, or moved
// into their own folder so they can be reviewed and thrown away in one go.

const crypto = require('crypto');
const fs = require('fs-extra');
const path = require('path');
const { DEFAULT_CATEGORIES, categoryFolder, destinationFolder } = require('./organizer');

const DUPLICATE_MODES = ['keep', 'skip', 'separate'];
const DUPLICATES_FOLDER = 'duplicates';

// Where already-organized copies can be: every category folder, plus the duplicates folder.
function organizedFolders(categories = DEFAULT_CATEGORIES, parent = '') {
  return [...categories.order, DUPLICATES_FOLDER].map((category) => categoryFolder(parent, category));
}

// Every folder the files could be moved into, as a normal file or as a duplicate.
function possibleDestinations(files, settings) {
  return files.flatMap((file) => [file, { ...file, category: DUPLICATES_FOLDER }])
    .map((file) => destinationFolder(file, settings));
}

// Files of equal size are first compared by their start only; most differ right away,
// so big files (videos, disk images) are read in full only when their starts match.
const PREFIX_BYTES = 64 * 1024;

function hashFile(file, limit = Infinity) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    fs.createReadStream(file, Number.isFinite(limit) ? { start: 0, end: limit - 1 } : {})
      .on('error', reject)
      .on('data', (chunk) => hash.update(chunk))
      .on('end', () => resolve(hash.digest('hex')));
  });
}

// A key per file of one size group: equal keys mean equal content, null means unreadable.
async function contentKeys(targetDir, group) {
  const prefixes = new Map();
  for (const file of group) {
    prefixes.set(file, await hashFile(path.join(targetDir, file.name), PREFIX_BYTES).catch(() => null));
  }
  if (group[0].size <= PREFIX_BYTES) return prefixes; // the start is the whole file

  const seen = new Map();
  for (const prefix of prefixes.values()) if (prefix) seen.set(prefix, (seen.get(prefix) || 0) + 1);
  const keys = new Map();
  for (const file of group) {
    const prefix = prefixes.get(file);
    if (!prefix || seen.get(prefix) < 2) {
      keys.set(file, prefix && `${prefix}:alone`); // nothing else starts the same way
    } else {
      keys.set(file, await hashFile(path.join(targetDir, file.name)).catch(() => null));
    }
  }
  return keys;
}

// Files already sorted into `folder` (relative to targetDir), named by their relative path.
// Looks one level deeper too, for folders grouped by month or year ("images/2024-03").
async function listOrganized(targetDir, folder, depth = 1) {
  const entries = await fs.readdir(path.join(targetDir, folder), { withFileTypes: true }).catch(() => []);
  const visible = entries.filter((entry) => !entry.name.startsWith('.'));
  const files = await Promise.all(visible.filter((entry) => entry.isFile()).map(async (entry) => {
    const name = path.join(folder, entry.name);
    const stats = await fs.stat(path.join(targetDir, name)).catch(() => null);
    return stats && { name, size: stats.size, modified: stats.mtime, organized: true };
  }));
  const nested = depth > 0
    ? await Promise.all(visible.filter((entry) => entry.isDirectory())
      .map((entry) => listOrganized(targetDir, path.join(folder, entry.name), depth - 1)))
    : [];
  return [...files.filter(Boolean), ...nested.flat()];
}

// Adds `duplicateOf` (the original's name) to every file whose content matches another one:
// another file in the list, or one already organized into `folders` (e.g. the same PDF
// downloaded twice). Organized files, then the oldest ones, count as originals. Only files
// of equal size are read, and empty files are left out since they all "match".
async function markDuplicates(targetDir, files, { folders = [] } = {}) {
  const sizes = new Set(files.map((file) => file.size));
  const organized = (await Promise.all([...new Set(folders)].map((folder) => listOrganized(targetDir, folder))))
    .flat()
    .filter((file) => sizes.has(file.size));

  const bySize = new Map();
  for (const file of [...organized, ...files]) {
    if (!file.size) continue;
    if (!bySize.has(file.size)) bySize.set(file.size, []);
    bySize.get(file.size).push(file);
  }

  const duplicateOf = new Map();
  for (const group of bySize.values()) {
    if (group.length < 2 || group.every((file) => file.organized)) continue;
    const originals = new Map(); // content key -> name of the first file seen
    const originalsFirst = [...group].sort((a, b) => Number(Boolean(b.organized)) - Number(Boolean(a.organized))
      || (a.modified - b.modified) || a.name.length - b.name.length || a.name.localeCompare(b.name));
    const keys = await contentKeys(targetDir, originalsFirst);
    for (const file of originalsFirst) {
      const key = keys.get(file);
      if (!key) continue;
      if (!originals.has(key)) originals.set(key, file.name);
      else if (!file.organized) duplicateOf.set(file.name, originals.get(key));
    }
  }
  return files.map((file) => (duplicateOf.has(file.name) ? { ...file, duplicateOf: duplicateOf.get(file.name) } : file));
}

// The files to plan, given what should happen to duplicates.
function applyDuplicateMode(files, mode = 'keep') {
  if (mode === 'skip') return files.filter((file) => !file.duplicateOf);
  if (mode === 'separate') return files.map((file) => (file.duplicateOf ? { ...file, category: DUPLICATES_FOLDER } : file));
  return files;
}

module.exports = {
  DUPLICATE_MODES, DUPLICATES_FOLDER, organizedFolders, possibleDestinations, markDuplicates, applyDuplicateMode,
};
