// User settings from ~/.config/smart-organizer/config.json ($XDG_CONFIG_HOME or %APPDATA% if set).
// Every setting is optional, and command-line options always win over them.

const fs = require('fs-extra');
const os = require('os');
const path = require('path');

const { DUPLICATE_MODES } = require('./duplicates');
const { GROUPINGS } = require('./organizer');

const NAMING_MODES = ['date', 'file-date', 'keep-names'];

const STARTER_CONFIG = {
  parent: '',
  naming: 'date',
  duplicates: 'keep',
  categories: {
    design: ['.psd', '.fig', '.sketch', '.ai'],
  },
  rules: {
    screenshots: ['Screenshot*', 'Screen Shot*', 'ภาพหน้าจอ*'],
  },
  ignore: ['*.log'],
};

function defaultConfigPath() {
  const base = process.env.XDG_CONFIG_HOME
    || (process.platform === 'win32' && process.env.APPDATA)
    || path.join(os.homedir(), '.config');
  return path.join(base, 'smart-organizer', 'config.json');
}

const isPlainObject = (value) => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const isStringList = (value) => Array.isArray(value) && value.every((item) => typeof item === 'string' && item.trim());

function normalizeExtension(ext) {
  const lower = ext.trim().toLowerCase();
  return lower.startsWith('.') ? lower : `.${lower}`;
}

// A { folder: [strings] } setting like "categories" or "rules", checked.
function parseFolderMap(value, setting, example) {
  if (!isPlainObject(value)) throw new Error(`"${setting}" must map a folder name to a list like ${example}`);
  const result = {};
  for (const [folder, items] of Object.entries(value)) {
    if (!folder.trim() || /[/\\]/.test(folder) || folder === '.' || folder === '..') {
      throw new Error(`folder "${folder}" in "${setting}" must be a plain folder name`);
    }
    if (!isStringList(items)) throw new Error(`"${setting}.${folder}" must be a list like ${example}`);
    result[folder] = items;
  }
  return result;
}

// Checks one parsed settings object and returns it normalized. Throws with the problem spelled out.
function parseConfig(data) {
  if (!isPlainObject(data)) throw new Error('it must be a JSON object, like {"naming": "file-date"}');

  const known = ['parent', 'naming', 'duplicates', 'groupBy', 'categories', 'rules', 'ignore'];
  const unknown = Object.keys(data).find((key) => !known.includes(key));
  if (unknown) throw new Error(`unknown setting "${unknown}" (expected one of: ${known.join(', ')})`);

  const config = {};
  if (data.parent !== undefined) {
    if (typeof data.parent !== 'string') throw new Error('"parent" must be a folder name');
    config.parent = data.parent;
  }
  if (data.naming !== undefined) {
    if (!NAMING_MODES.includes(data.naming)) throw new Error(`"naming" must be one of: ${NAMING_MODES.join(', ')}`);
    config.naming = data.naming;
  }
  if (data.duplicates !== undefined) {
    if (!DUPLICATE_MODES.includes(data.duplicates)) throw new Error(`"duplicates" must be one of: ${DUPLICATE_MODES.join(', ')}`);
    config.duplicates = data.duplicates;
  }
  if (data.groupBy !== undefined && data.groupBy !== null) {
    if (!GROUPINGS.includes(data.groupBy)) throw new Error(`"groupBy" must be one of: ${GROUPINGS.join(', ')}`);
    config.groupBy = data.groupBy;
  }
  if (data.categories !== undefined) {
    config.categories = parseFolderMap(data.categories, 'categories', '[".psd", ".fig"]');
    for (const category of Object.keys(config.categories)) {
      config.categories[category] = config.categories[category].map(normalizeExtension);
    }
  }
  if (data.rules !== undefined) {
    config.rules = parseFolderMap(data.rules, 'rules', '["Screenshot*"]');
  }
  if (data.ignore !== undefined) {
    if (!isStringList(data.ignore)) throw new Error('"ignore" must be a list of filename patterns like ["*.log"]');
    config.ignore = data.ignore;
  }
  return config;
}

// Reads the settings file; a missing file means no settings.
async function loadConfig(file = defaultConfigPath()) {
  let text;
  try {
    text = await fs.readFile(file, 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT') return {};
    throw error;
  }
  try {
    return parseConfig(JSON.parse(text));
  } catch (error) {
    throw new Error(`Problem in settings file ${file}: ${error.message}`, { cause: error });
  }
}

// Settings for one folder live in a hidden file inside it, so they are never organized themselves.
const FOLDER_CONFIG = '.orgrc.json';

// The global settings with the folder's .orgrc.json on top: plain settings are replaced,
// categories and rules are merged by folder name, ignore patterns are added together.
async function loadSettingsFor(dir, globalFile) {
  const global = await loadConfig(globalFile);
  const folderFile = path.join(dir, FOLDER_CONFIG);
  const folder = await loadConfig(folderFile);
  const hasFolder = Object.keys(folder).length > 0;
  return {
    config: {
      ...global,
      ...folder,
      categories: { ...global.categories, ...folder.categories },
      rules: { ...global.rules, ...folder.rules },
      ignore: [...(global.ignore || []), ...(folder.ignore || [])],
    },
    folderFile: hasFolder ? folderFile : null,
  };
}

// Writes a starter settings file unless one exists. Returns { file, created }.
async function initConfig(file = defaultConfigPath()) {
  if (await fs.pathExists(file)) return { file, created: false };
  await fs.outputJson(file, STARTER_CONFIG, { spaces: 2 });
  return { file, created: true };
}

module.exports = {
  NAMING_MODES, FOLDER_CONFIG, defaultConfigPath, parseConfig, loadConfig, loadSettingsFor, initConfig,
};
