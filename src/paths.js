const os = require('os');
const path = require('path');

function expandHome(value) {
  return value === '~' || /^~[/\\]/.test(value) ? path.join(os.homedir(), value.slice(2)) : value;
}

function resolveFolder(base, value = '') {
  return path.resolve(base, expandHome(value));
}

function isWithin(parent, file) {
  const relative = path.relative(parent, file);
  return relative === '' || (!path.isAbsolute(relative) && relative !== '..' && !relative.startsWith(`..${path.sep}`));
}

function relocatePath(file, from, to) {
  return isWithin(from, file) ? path.join(to, path.relative(from, file)) : file;
}

module.exports = { expandHome, resolveFolder, isWithin, relocatePath };
