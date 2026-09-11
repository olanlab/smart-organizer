const fs = require('fs-extra');
const os = require('os');
const path = require('path');
const { scanDirectory } = require('../src/organizer');
const { organizedFolders, markDuplicates, applyDuplicateMode } = require('../src/duplicates');

const ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'org-dupes-'));
let dir;
let counter = 0;

async function write(name, content, modified) {
  const file = path.join(dir, name);
  await fs.outputFile(file, content);
  if (modified) await fs.utimes(file, modified, modified);
}

const duplicatesIn = async (options) => {
  const files = await markDuplicates(dir, await scanDirectory(dir), options);
  return Object.fromEntries(files.filter((file) => file.duplicateOf).map((file) => [file.name, file.duplicateOf]));
};

beforeEach(async () => {
  dir = path.join(ROOT, `folder-${counter++}`);
  await fs.ensureDir(dir);
});

afterAll(async () => {
  await fs.remove(ROOT);
});

describe('duplicates', () => {
  test('marks files with identical content, keeping the oldest as the original', async () => {
    await write('report.pdf', 'same bytes', new Date(2024, 0, 1));
    await write('report (1).pdf', 'same bytes', new Date(2024, 0, 2));
    await write('report (2).pdf', 'same bytes', new Date(2024, 0, 3));
    await write('other.pdf', 'diff bytes'); // same size, different content

    expect(await duplicatesIn()).toEqual({ 'report (1).pdf': 'report.pdf', 'report (2).pdf': 'report.pdf' });
  });

  test('big files that only share their start are not duplicates, big copies are', async () => {
    const start = 'x'.repeat(100 * 1024);
    await write('movie.mov', `${start}ending one`, new Date(2024, 0, 1));
    await write('other.mov', `${start}ending two`, new Date(2024, 0, 2));
    await write('movie copy.mov', `${start}ending one`, new Date(2024, 0, 3));

    expect(await duplicatesIn()).toEqual({ 'movie copy.mov': 'movie.mov' });
  });

  test('empty files are never called duplicates', async () => {
    await write('a.txt', '');
    await write('b.txt', '');

    expect(await duplicatesIn()).toEqual({});
  });

  test('finds a new download that matches a file organized earlier', async () => {
    await write(path.join('documents', '2026-09-01-1.pdf'), 'invoice');
    await write('invoice.pdf', 'invoice');

    expect(await duplicatesIn({ folders: organizedFolders() })).toEqual({
      'invoice.pdf': path.join('documents', '2026-09-01-1.pdf'),
    });
  });

  test('applyDuplicateMode keeps, drops or redirects the copies', () => {
    const files = [
      { name: 'a.pdf', category: 'documents' },
      { name: 'a (1).pdf', category: 'documents', duplicateOf: 'a.pdf' },
    ];

    expect(applyDuplicateMode(files, 'keep')).toEqual(files);
    expect(applyDuplicateMode(files, 'skip').map((file) => file.name)).toEqual(['a.pdf']);
    expect(applyDuplicateMode(files, 'separate')[1].category).toBe('duplicates');
  });
});
