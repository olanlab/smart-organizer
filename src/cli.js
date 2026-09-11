// Small decisions behind the `org` command, kept apart from bin/index.js so they can be tested.

const { buildCategories, countFiles, categorySummary } = require('./organizer');

// In a terminal, plain `org` opens the TUI so everything can be checked before it moves.
// --yes organizes right away, and so do scripts and pipes (no terminal), as `org` always did.
function wantsTui(options, isTerminal) {
  if (options.tui) return true;
  if (options.yes || options.dryRun || options.watch) return false;
  return isTerminal;
}

// A copy-pasteable command that undoes the run just made in `targetDir`.
function undoCommand(targetDir, cwd = process.cwd()) {
  if (targetDir === cwd) return 'org --undo';
  const quoted = /^[\w./~-]+$/.test(targetDir) ? targetDir : `'${targetDir.replace(/'/g, '\'\\\'\'')}'`;
  return `org --undo -d ${quoted}`;
}

// "--only images,videos" as a list of known categories; throws on a name that isn't one.
function parseOnly(value, categories) {
  if (!value) return null;
  const only = value.split(',').map((item) => item.trim().toLowerCase()).filter(Boolean);
  const unknown = only.find((category) => !categories.order.includes(category));
  if (unknown) throw new Error(`Unknown category "${unknown}" in --only. Pick from: ${categories.order.join(', ')}`);
  return only;
}

// Command-line options win; the settings file fills in whatever they leave out.
function resolveSettings(options, config) {
  const namingFromCli = Boolean(options.name || options.keepNames || options.fileDate);
  const categories = buildCategories(config.categories, config.rules);
  return {
    parent: options.parent ?? config.parent,
    name: options.name,
    keepNames: namingFromCli ? Boolean(options.keepNames) : config.naming === 'keep-names',
    fileDates: namingFromCli ? Boolean(options.fileDate) : config.naming === 'file-date',
    duplicates: options.duplicates ?? config.duplicates ?? 'keep',
    groupBy: options.groupBy ?? config.groupBy ?? null,
    categories,
    ignore: [...(config.ignore || []), ...(options.exclude || [])],
    only: parseOnly(options.only, categories),
  };
}

// Files named on the command line ("org *.pdf"): they must be files in one folder, which
// becomes the folder to organize. Returns { dir, names } or throws with what is wrong.
async function resolveFileArguments(files, fs, path) {
  const paths = files.map((file) => path.resolve(file));
  const notFiles = [];
  for (const file of paths) {
    const stats = await fs.stat(file).catch(() => null);
    if (!stats || !stats.isFile()) notFiles.push(file);
  }
  if (notFiles.length) throw new Error(`Not a file: ${notFiles.join(', ')}`);
  const dirs = [...new Set(paths.map((file) => path.dirname(file)))];
  if (dirs.length > 1) throw new Error(`The files must all be in one folder (they are in: ${dirs.join(', ')})`);
  return { dir: dirs[0], names: new Set(paths.map((file) => path.basename(file))) };
}

module.exports = {
  countFiles, wantsTui, undoCommand, parseOnly, resolveSettings, resolveFileArguments, categorySummary,
};
