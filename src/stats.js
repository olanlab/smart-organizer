// What is in a folder, without moving anything: sizes per category, the biggest files,
// duplicates and the files that would be left alone.

const { scanDirectory } = require('./organizer');
const { organizedFolders, markDuplicates } = require('./duplicates');

async function folderStats(targetDir, settings = {}) {
  const leftAlone = [];
  const scanned = await scanDirectory(targetDir, { ...settings, skipped: leftAlone });
  const files = await markDuplicates(targetDir, scanned, { folders: organizedFolders(settings.categories, settings.parent) });

  const byCategory = new Map();
  for (const file of files) {
    const entry = byCategory.get(file.category) || { category: file.category, count: 0, size: 0 };
    entry.count++;
    entry.size += file.size;
    byCategory.set(file.category, entry);
  }
  const copies = files.filter((file) => file.duplicateOf);

  return {
    count: files.length,
    size: files.reduce((sum, file) => sum + file.size, 0),
    categories: [...byCategory.values()].sort((a, b) => b.size - a.size),
    biggest: [...files].sort((a, b) => b.size - a.size).slice(0, 5),
    duplicates: { count: copies.length, size: copies.reduce((sum, file) => sum + file.size, 0) },
    leftAlone,
  };
}

module.exports = { folderStats };
