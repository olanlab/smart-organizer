const fs = require('fs-extra');
const os = require('os');
const path = require('path');
const { expandHome, resolveFolder } = require('./paths');

const CATEGORIES = {
  images: [
    '.jpg', '.jpeg', '.png', '.gif', '.svg', '.webp', '.bmp', '.tiff', '.tif', '.heic', '.heif', '.avif', '.ico',
    '.raw', '.dng', '.cr2', '.cr3', '.nef', '.arw', '.raf', '.orf', '.rw2',
  ],
  videos: ['.mp4', '.mkv', '.mov', '.avi', '.wmv', '.flv', '.webm', '.m4v', '.3gp', '.mpg', '.mpeg'],
  audio: ['.mp3', '.wav', '.flac', '.ogg', '.m4a', '.aac', '.opus', '.aiff', '.aif', '.wma'],
  documents: [
    '.pdf', '.doc', '.docx', '.txt', '.xls', '.xlsx', '.ppt', '.pptx', '.csv', '.md',
    '.rtf', '.odt', '.ods', '.odp', '.pages', '.numbers', '.epub', '.tsv',
  ],
  archives: ['.zip', '.rar', '.tar', '.gz', '.7z', '.bz2', '.xz', '.tgz', '.zst'],
  code: [
    '.js', '.ts', '.py', '.go', '.java', '.c', '.cpp', '.html', '.css', '.json', '.sh',
    '.jsx', '.tsx', '.mjs', '.cjs', '.rb', '.rs', '.php', '.swift', '.kt', '.cs', '.h', '.hpp',
    '.scss', '.vue', '.sql', '.xml', '.yml', '.yaml', '.toml', '.ipynb',
  ],
  apps: ['.dmg', '.exe', '.app', '.pkg', '.msi', '.deb', '.rpm', '.apk', '.appimage', '.iso'],
};
const DEFAULT_CATEGORY = 'others';
const EXTENSION_TO_CATEGORY = new Map(
  Object.entries(CATEGORIES).flatMap(([category, extensions]) => extensions.map((ext) => [ext, category])),
);

// Kept whole when renaming, so "backup.tar.gz" doesn't turn into a bare ".gz".
const COMPOUND_EXTENSIONS = ['.tar.gz', '.tar.bz2', '.tar.xz'];

// Never touched: a Node project's own files and OS clutter...
const IGNORED_FILES = new Set(['index.js', 'package.json', 'package-lock.json', 'Thumbs.db', 'desktop.ini', 'Icon\r']);
// ...downloads that are still in progress (moving them breaks the download)...
const IN_PROGRESS_EXTENSIONS = new Set(['.crdownload', '.part', '.partial', '.download', '.opdownload', '.tmp']);
// ...hidden files, and "~$report.docx" lock files Office keeps next to open documents.
function leftAloneReason(name) {
  if (name.startsWith('.')) return 'hidden';
  if (name.startsWith('~$')) return 'Office lock file';
  if (IGNORED_FILES.has(name)) return 'system or project file';
  if (IN_PROGRESS_EXTENSIONS.has(path.extname(name).toLowerCase())) return 'still downloading';
  return null;
}

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });

// Name order that puts "report.pdf" before its copy "report (1).pdf": the part before the
// extension is compared first, then the extension.
function compareNames(a, b) {
  const stem = (name) => name.slice(0, name.length - path.extname(name).length);
  return collator.compare(stem(a), stem(b)) || collator.compare(a, b);
}

function getExtension(fileName) {
  const lower = fileName.toLowerCase();
  return COMPOUND_EXTENSIONS.find((ext) => lower.endsWith(ext) && lower.length > ext.length) || path.extname(lower);
}

// "*.log" style patterns: * and ? wildcards, matched against the whole name, ignoring case.
function globToRegExp(pattern) {
  const source = pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.');
  return new RegExp(`^${source}$`, 'i');
}

// The built-in categories plus custom ones from the settings file. `custom` maps a folder to
// extensions ({ design: ['.psd'] }), taking them over from their built-in category; `rules`
// maps a folder to name patterns ({ screenshots: ['Screenshot*'] }) and wins over extensions.
function buildCategories(custom = {}, rules = {}) {
  const lookup = new Map(EXTENSION_TO_CATEGORY);
  for (const [category, extensions] of Object.entries(custom)) {
    for (const ext of extensions) lookup.set(ext.toLowerCase(), category);
  }
  const matchers = Object.entries(rules).map(([folder, patterns]) => [folder, patterns.map(globToRegExp)]);
  const byName = (fileName) => {
    const rule = matchers.find(([, patterns]) => patterns.some((pattern) => pattern.test(fileName)));
    return rule && rule[0];
  };
  const names = [...Object.keys(CATEGORIES), ...Object.keys(custom), ...Object.keys(rules)]
    .filter((name) => name !== DEFAULT_CATEGORY);
  return {
    order: [...new Set(names), DEFAULT_CATEGORY],
    // Tries the full extension first, so a custom ".tar.zst" can win over ".zst".
    of: (fileName) => byName(fileName) || lookup.get(getExtension(fileName))
      || lookup.get(path.extname(fileName).toLowerCase()) || DEFAULT_CATEGORY,
  };
}

const DEFAULT_CATEGORIES = buildCategories();

// Local calendar date as YYYY-MM-DD. toISOString() is UTC, which gives yesterday's
// date to anyone east of Greenwich organizing files shortly after midnight.
function formatDate(date = new Date()) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

const countFiles = (n) => `${n} ${n === 1 ? 'file' : 'files'}`;

// "images 12 · documents 3", biggest first.
function categorySummary(moves) {
  const counts = new Map();
  for (const move of moves) counts.set(move.category, (counts.get(move.category) || 0) + 1);
  return [...counts].sort((a, b) => b[1] - a[1]).map(([category, count]) => `${category} ${count}`).join(' · ');
}

// "1.5 MB", "320 KB": one decimal only for small numbers.
function formatSize(bytes) {
  if (bytes === undefined) return '';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit++;
  }
  const digits = unit > 0 && value < 10 ? 1 : 0;
  return `${value.toFixed(digits)} ${units[unit]}`;
}

// Local "YYYY-MM-DD HH:MM".
function formatDateTime(date) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${formatDate(date)} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

// Returns an error message, or null when `name` is usable as a base filename.
function validateName(name) {
  if (name === undefined || name === null) return null;
  if (!name.trim()) return 'Name cannot be empty.';
  if (/[/\\]/.test(name)) return 'Name must be a plain filename, not a path.';
  return null;
}

function categoryFolder(parent, category) {
  return parent ? path.join(expandHome(parent), category) : category;
}

const GROUPINGS = ['month', 'year'];

// Where a file goes: its category folder, plus a "2024-03" or "2024" subfolder from the day
// it was last modified when grouping by month or year.
function destinationFolder(file, { parent, groupBy, date = new Date() } = {}) {
  const folder = categoryFolder(parent, file.category);
  if (!groupBy) return folder;
  const day = formatDate(file.modified || date);
  return path.join(folder, groupBy === 'year' ? day.slice(0, 4) : day.slice(0, 7));
}

async function isDirectory(dir) {
  const stats = await fs.stat(dir).catch(() => null);
  return Boolean(stats && stats.isDirectory());
}

// Returns the root of the git project `dir` belongs to, or null. Organizing a project
// scatters its source files, so callers ask for confirmation first. A repository at or
// above the home folder (a dotfiles repo) doesn't count, or ~/Downloads would be flagged.
async function findProjectRoot(dir) {
  const home = os.homedir();
  for (let current = path.resolve(dir); current !== home; current = path.dirname(current)) {
    if (await fs.pathExists(path.join(current, '.git'))) return current;
    if (current === path.dirname(current)) break;
  }
  return null;
}

// Why organizing `dir` is probably a mistake ("it is your home folder"), or null if it looks fine.
async function riskReason(dir) {
  const resolved = path.resolve(dir);
  if (resolved === os.homedir()) return 'it is your home folder';
  if (resolved === path.parse(resolved).root) return 'it is the top of the disk';
  const project = await findProjectRoot(resolved);
  return project ? `it is inside a code project (${project})` : null;
}

// The name a file gets when the user types `custom` for it. Its extension always stays, so
// "passport" and "passport.PDF" both work, and "my.report" becomes "my.report.pdf".
function customName(file, custom) {
  const ext = file.name.slice(file.name.length - file.ext.length); // original case
  return custom.toLowerCase().endsWith(file.ext) && file.ext ? custom : `${custom}${ext}`;
}

// A short reason a move failed, in words instead of error codes and full paths.
function friendlyError(error) {
  const reasons = {
    EACCES: 'permission denied',
    EPERM: 'permission denied',
    EBUSY: 'the file is open in another app',
    ENOENT: 'the file is gone (moved or deleted in the meantime)',
    ENOSPC: 'the disk is full',
    EROFS: 'the disk is read-only',
    ENAMETOOLONG: 'the name is too long',
  };
  if (reasons[error.code]) return reasons[error.code];
  if (/dest already exists/.test(error.message)) return 'a file with that name appeared in the meantime';
  return error.message;
}

// Lists the files to organize in `targetDir`, sorted by category, then name.
// `ignore` adds "*.log" style patterns on top of the files that are always left alone,
// `only` limits the list to some categories and `names` to some files.
// `skipped`, when given, collects { name, reason } for files left alone that a person may
// look for (downloads in progress, lock files, ignore patterns); hidden files stay quiet.
async function scanDirectory(targetDir, {
  categories = DEFAULT_CATEGORIES, ignore = [], only = null, names = null, skipped = null,
} = {}) {
  const patterns = ignore.map(globToRegExp);
  const leaveAlone = (name) => {
    const reason = leftAloneReason(name) || (patterns.some((re) => re.test(name)) && 'matches an ignore pattern');
    if (reason && reason !== 'hidden' && skipped && (!names || names.has(name))) skipped.push({ name, reason });
    return Boolean(reason);
  };
  const entries = await fs.readdir(targetDir, { withFileTypes: true });
  const files = await Promise.all(entries
    // isFile() is false for directories and symlinks, so links are never moved.
    .filter((entry) => entry.isFile() && !leaveAlone(entry.name))
    .filter((entry) => (!only || only.includes(categories.of(entry.name))) && (!names || names.has(entry.name)))
    .map(async (entry) => {
      const stats = await fs.stat(path.join(targetDir, entry.name)).catch(() => null);
      if (!stats) return null; // deleted since the folder was read
      return {
        name: entry.name,
        ext: getExtension(entry.name),
        category: categories.of(entry.name),
        modified: stats.mtime,
        size: stats.size,
      };
    }));
  const rank = (category) => categories.order.indexOf(category);
  return files
    .filter(Boolean)
    .sort((a, b) => rank(a.category) - rank(b.category) || compareNames(a.name, b.name));
}

// How names are compared when looking for a free one: like macOS and Windows disks do, ignoring
// case and how accented letters are encoded ("é" as one character or as "e" plus an accent).
const nameKey = (name) => name.normalize('NFC').toLowerCase();

// Maps each folder (relative to targetDir) to the names already inside it, as nameKey()s.
// A missing or unreadable folder counts as empty; fs.move still refuses to overwrite.
async function readExistingNames(targetDir, folders) {
  const existing = new Map();
  await Promise.all([...new Set(folders)].map(async (folder) => {
    const names = await fs.readdir(resolveFolder(targetDir, folder)).catch(() => []);
    existing.set(folder, new Set(names.map(nameKey)));
  }));
  return existing;
}

// Gives each file a free name in its category folder, without touching disk. Files are named
// "<base>-<n><ext>", where base is `name`, or the date: today's, or with fileDates the day the
// file was last modified. With keepNames a file keeps its own name ("photo.jpg", then "photo-2.jpg").
// Names are compared with nameKey() to stay safe on case-insensitive disks (macOS, Windows).
function planMoves(targetDir, files, {
  parent, name, keepNames = false, fileDates = false, groupBy, date = new Date(), existing = new Map(),
  renames = new Map(), // file name -> name the user typed for it
} = {}) {
  const useFileDates = fileDates && !name && !keepNames;
  const dateOf = (file) => (useFileDates && file.modified) || date;
  const taken = new Map();
  const nextNumber = new Map();

  // With file dates, each day's files are numbered oldest first, so "-1" is the earliest one.
  const order = files.map((_, index) => index);
  if (useFileDates) order.sort((a, b) => dateOf(files[a]) - dateOf(files[b]));

  const plan = new Array(files.length);
  for (const index of order) {
    const file = files[index];
    const folder = destinationFolder(file, { parent, groupBy, date });
    if (!taken.has(folder)) taken.set(folder, new Set(existing.get(folder)));
    const names = taken.get(folder);
    const isFree = (candidate) => !names.has(nameKey(candidate));

    const custom = renames.get(file.name);
    let newName;
    if (custom || keepNames) {
      // A name of its own (typed, or the original), numbered only when it is taken.
      const wanted = custom ? customName(file, custom) : file.name;
      const stem = wanted.slice(0, wanted.length - file.ext.length);
      const ext = wanted.slice(stem.length); // as written, unlike the lowercased file.ext
      newName = wanted;
      for (let number = 2; !isFree(newName); number++) newName = `${stem}-${number}${ext}`;
    } else {
      const baseName = name || formatDate(dateOf(file));
      const counterKey = `${folder}\0${baseName}\0${file.ext}`;
      let number = nextNumber.get(counterKey) || 1;
      while (!isFree(`${baseName}-${number}${file.ext}`)) number++;
      newName = `${baseName}-${number}${file.ext}`;
      nextNumber.set(counterKey, number + 1);
    }
    names.add(nameKey(newName));

    plan[index] = {
      ...file,
      source: path.join(targetDir, file.name),
      folder,
      newName,
      renamed: Boolean(custom),
      destination: path.join(resolveFolder(targetDir, folder), newName),
    };
  }
  return plan;
}

async function buildPlan(targetDir, files, options = {}) {
  const folders = files.map((file) => destinationFolder(file, options));
  const existing = await readExistingNames(targetDir, folders);
  return planMoves(targetDir, files, { ...options, existing });
}

// Moves files one at a time. A failed move is recorded and the rest carry on;
// fs.move never overwrites, so a file that appeared after planning is left alone.
async function executePlan(plan, { onProgress, signal } = {}) {
  const results = [];
  for (const move of plan) {
    if (signal && signal.aborted) break;
    let result;
    try {
      await fs.move(move.source, move.destination);
      result = { ...move, ok: true };
    } catch (error) {
      result = { ...move, ok: false, error };
    }
    results.push(result);
    if (onProgress) onProgress(result, results.length, plan.length);
  }
  return results;
}

module.exports = {
  CATEGORIES,
  DEFAULT_CATEGORIES,
  buildCategories,
  getExtension,
  countFiles,
  categorySummary,
  formatDate,
  formatDateTime,
  formatSize,
  validateName,
  categoryFolder,
  GROUPINGS,
  destinationFolder,
  isDirectory,
  findProjectRoot,
  riskReason,
  customName,
  friendlyError,
  compareNames,
  scanDirectory,
  readExistingNames,
  planMoves,
  buildPlan,
  executePlan,
};
