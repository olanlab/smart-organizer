// Folder paths typed into the TUI: "~" expansion and shell-style Tab completion.

const fs = require('fs-extra');
const os = require('os');
const path = require('path');

function resolveDir(input, baseDir) {
  const expanded = input === '~' || input.startsWith('~/') ? path.join(os.homedir(), input.slice(1)) : input;
  return path.resolve(baseDir, expanded);
}

function commonPrefix(names) {
  let prefix = names[0] || '';
  for (const name of names) {
    while (!name.toLowerCase().startsWith(prefix.toLowerCase())) prefix = prefix.slice(0, -1);
  }
  return prefix;
}

// Completes the last part of a typed folder path, keeping what was typed before it (like "~/").
// Returns { value, matches }: one match is completed with a trailing "/", several are
// completed as far as they agree, and matches lists them.
async function completePath(value, baseDir) {
  const cut = value.lastIndexOf('/') + 1;
  const head = value.slice(0, cut);
  const partial = value.slice(cut);
  const entries = await fs.readdir(resolveDir(head || '.', baseDir), { withFileTypes: true }).catch(() => []);
  const matches = entries
    .filter((entry) => entry.isDirectory() || entry.isSymbolicLink())
    .map((entry) => entry.name)
    .filter((name) => name.toLowerCase().startsWith(partial.toLowerCase()) && (partial.startsWith('.') || !name.startsWith('.')))
    .sort((a, b) => a.localeCompare(b));

  if (matches.length === 1) return { value: `${head}${matches[0]}/`, matches };
  // The shared start comes from the real names, so "do" also gets fixed up to "Do".
  if (matches.length > 1) return { value: `${head}${commonPrefix(matches)}`, matches };
  return { value, matches };
}

// Opens a file with the app the system uses for it (Preview, a PDF reader, ...), without waiting.
function openCommand(file, platform = process.platform) {
  if (platform === 'darwin') return ['open', [file]];
  if (platform === 'win32') return ['cmd', ['/c', 'start', '""', file]];
  return ['xdg-open', [file]];
}

module.exports = { resolveDir, completePath, openCommand };
