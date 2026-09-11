// Folders organized lately, newest first, kept next to the settings file so the TUI can offer
// them again when switching folders.

const fs = require('fs-extra');
const os = require('os');
const path = require('path');
const { defaultConfigPath } = require('./config');

const MAX_RECENT = 10;

const recentFile = () => path.join(path.dirname(defaultConfigPath()), 'recent.json');

async function readRecent() {
  const data = await fs.readJson(recentFile()).catch(() => null);
  return Array.isArray(data && data.folders) ? data.folders.filter((folder) => typeof folder === 'string') : [];
}

// Puts `dir` at the top of the list. Failing to save is not worth bothering anyone about.
async function rememberFolder(dir) {
  const folders = [dir, ...(await readRecent()).filter((folder) => folder !== dir)].slice(0, MAX_RECENT);
  await fs.outputJson(recentFile(), { folders }, { spaces: 2 }).catch(() => {});
}

// "/Users/me/Downloads" -> "~/Downloads", which reads (and types) more easily.
function tildify(dir) {
  const home = os.homedir();
  return dir === home || dir.startsWith(`${home}${path.sep}`) ? `~${dir.slice(home.length)}` : dir;
}

module.exports = { MAX_RECENT, readRecent, rememberFolder, tildify };
