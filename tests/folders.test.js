const fs = require('fs-extra');
const os = require('os');
const path = require('path');
const { listFolders, createFolder, renameFolder } = require('../src/tui/folders');
const { scanDirectory, buildPlan, executePlan } = require('../src/organizer');
const { readHistory, recordRun, undoLastRun } = require('../src/history');

const ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'org-folders-'));
const source = path.join(ROOT, 'source');

beforeEach(async () => {
  await fs.emptyDir(ROOT);
  await fs.ensureDir(source);
});
afterEach(() => jest.restoreAllMocks());
afterAll(() => fs.remove(ROOT));

test('folder browsing shows real visible folders in natural order and can find an existing parent', async () => {
  for (const name of ['Folder10', 'Folder2', '.hidden', 'รูปภาพ']) await fs.ensureDir(path.join(source, name));
  await fs.ensureFile(path.join(source, 'file.txt'));
  await fs.symlink(path.join(source, 'Folder2'), path.join(source, 'link'));
  const listed = await listFolders(source);
  expect(listed.entries.map((entry) => entry.name)).toEqual(['Folder2', 'Folder10', 'รูปภาพ']);
  expect((await listFolders(path.join(source, 'missing', 'nested'), { nearest: true })).dir).toBe(source);
  await expect(listFolders(path.join(source, 'missing'))).rejects.toMatchObject({ code: 'ENOENT' });
});

test('creates a Thai folder immediately and refuses existing names, files and invalid paths', async () => {
  expect(await createFolder(source, 'แฟ้มใหม่')).toBe(path.join(source, 'แฟ้มใหม่'));
  expect((await fs.stat(path.join(source, 'แฟ้มใหม่'))).isDirectory()).toBe(true);
  await expect(createFolder(source, 'แฟ้มใหม่')).rejects.toMatchObject({ code: 'EEXIST' });
  await fs.outputFile(path.join(source, 'taken'), 'keep me');
  await expect(createFolder(source, 'taken')).rejects.toMatchObject({ code: 'EEXIST' });
  for (const name of ['', ' ', '.', '..', '../outside', 'a/b', 'a\\b', 'line\nbreak']) {
    await expect(createFolder(source, name)).rejects.toThrow();
  }
  expect(await fs.readFile(path.join(source, 'taken'), 'utf8')).toBe('keep me');
});

test('renames a nonempty folder and leaves conflicting destinations untouched', async () => {
  await fs.outputFile(path.join(source, 'เก่า', 'notes.txt'), 'content');
  await fs.ensureDir(path.join(source, 'taken'));
  await expect(renameFolder(source, source, 'เก่า', 'taken')).rejects.toThrow(/already exists/);
  await fs.symlink(path.join(source, 'missing'), path.join(source, 'dangling'));
  await expect(renameFolder(source, source, 'เก่า', 'dangling')).rejects.toThrow(/already exists/);
  await renameFolder(source, source, 'เก่า', 'ใหม่');
  expect(await fs.pathExists(path.join(source, 'เก่า'))).toBe(false);
  expect(await fs.readFile(path.join(source, 'ใหม่', 'notes.txt'), 'utf8')).toBe('content');
});

test('prevents renaming the active source or its parents', async () => {
  await expect(renameFolder(source, ROOT, 'source', 'moved')).rejects.toThrow(/source folder and its parents/);
  await expect(renameFolder(source, path.dirname(ROOT), path.basename(ROOT), 'moved-root')).rejects.toThrow(/source folder and its parents/);
  expect(await fs.pathExists(source)).toBe(true);
});

async function organizeExternally() {
  const parent = path.join(ROOT, 'archive');
  await fs.outputFile(path.join(source, 'photo.jpg'), 'photo');
  await fs.outputFile(path.join(source, 'report.txt'), 'report');
  const plan = await buildPlan(source, await scanDirectory(source), { parent, keepNames: true });
  const results = await executePlan(plan);
  expect(results.every((result) => result.ok)).toBe(true);
  await recordRun(source, results);
  return parent;
}

test('renaming an external destination updates undo paths and restores the original files', async () => {
  await organizeExternally();
  await renameFolder(source, ROOT, 'archive', 'จัดแล้ว');
  const runs = await readHistory(source);
  expect(runs[0].moves.map((move) => move.to)).toEqual([
    path.join('..', 'จัดแล้ว', 'images', 'photo.jpg'),
    path.join('..', 'จัดแล้ว', 'documents', 'report.txt'),
  ]);
  const undone = await undoLastRun(source);
  expect(undone.remaining).toBe(0);
  expect(await fs.readFile(path.join(source, 'photo.jpg'), 'utf8')).toBe('photo');
  expect(await fs.readFile(path.join(source, 'report.txt'), 'utf8')).toBe('report');
});

test('rolls back a folder rename when updating history fails', async () => {
  const parent = await organizeExternally();
  const before = await readHistory(source);
  jest.spyOn(fs, 'writeJson').mockRejectedValueOnce(new Error('disk full'));
  await expect(renameFolder(source, ROOT, 'archive', 'renamed')).rejects.toThrow(/folder name was restored/);
  expect(await fs.pathExists(path.join(parent, 'images', 'photo.jpg'))).toBe(true);
  expect(await fs.pathExists(path.join(ROOT, 'renamed'))).toBe(false);
  expect(await readHistory(source)).toEqual(before);
});
