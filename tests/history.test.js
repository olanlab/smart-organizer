const fs = require('fs-extra');
const os = require('os');
const path = require('path');
const { scanDirectory, buildPlan, executePlan } = require('../src/organizer');
const { HISTORY_FILE, MAX_RUNS, readHistory, recordRun, undoLastRun } = require('../src/history');

const TEST_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'org-history-'));

async function organize(options = {}) {
  const plan = await buildPlan(TEST_DIR, await scanDirectory(TEST_DIR), options);
  const results = await executePlan(plan);
  await recordRun(TEST_DIR, results);
  return results;
}

beforeEach(async () => {
  await fs.remove(TEST_DIR);
  await fs.ensureDir(TEST_DIR);
});

afterAll(async () => {
  await fs.remove(TEST_DIR);
});

describe('undo history', () => {
  test('undo puts files back and removes the folders it emptied', async () => {
    await fs.outputFile(path.join(TEST_DIR, 'holiday.jpg'), 'photo');
    await fs.ensureFile(path.join(TEST_DIR, 'notes.txt'));
    await fs.ensureFile(path.join(TEST_DIR, 'sorted', 'documents', 'older.pdf'));
    await organize({ parent: 'sorted', name: 'x' });

    const { results } = await undoLastRun(TEST_DIR);

    expect(results.every((result) => result.ok)).toBe(true);
    expect(fs.readFileSync(path.join(TEST_DIR, 'holiday.jpg'), 'utf8')).toBe('photo');
    expect(fs.existsSync(path.join(TEST_DIR, 'notes.txt'))).toBe(true);
    expect(fs.existsSync(path.join(TEST_DIR, 'sorted', 'images'))).toBe(false);
    expect(fs.existsSync(path.join(TEST_DIR, 'sorted', 'documents', 'older.pdf'))).toBe(true);
    expect(fs.existsSync(path.join(TEST_DIR, HISTORY_FILE))).toBe(false);
  });

  test('a file that cannot go back is reported and the rest are still restored', async () => {
    await fs.ensureFile(path.join(TEST_DIR, 'a.jpg'));
    await fs.ensureFile(path.join(TEST_DIR, 'b.jpg'));
    await organize({ name: 'x' });
    await fs.outputFile(path.join(TEST_DIR, 'a.jpg'), 'new download with the same name');

    const { results } = await undoLastRun(TEST_DIR);

    expect(results.map((result) => [result.from, result.ok])).toEqual([['b.jpg', true], ['a.jpg', false]]);
    expect(fs.readFileSync(path.join(TEST_DIR, 'a.jpg'), 'utf8')).toBe('new download with the same name');
    expect(fs.existsSync(path.join(TEST_DIR, 'images', 'x-1.jpg'))).toBe(true);

    const history = await readHistory(TEST_DIR);
    expect(history).toHaveLength(1);
    expect(history[0].moves).toEqual([{ from: 'a.jpg', to: path.join('images', 'x-1.jpg') }]);
    await fs.move(path.join(TEST_DIR, 'a.jpg'), path.join(TEST_DIR, 'new-download.jpg'));
    const retry = await undoLastRun(TEST_DIR);
    expect(retry.results.map((result) => [result.from, result.ok])).toEqual([['a.jpg', true]]);
    expect(retry.remaining).toBe(0);
    expect(await readHistory(TEST_DIR)).toEqual([]);
  });

  test('stopping undo keeps unattempted files in history for the next run', async () => {
    await fs.ensureFile(path.join(TEST_DIR, 'a.jpg'));
    await fs.ensureFile(path.join(TEST_DIR, 'b.jpg'));
    await organize({ name: 'x' });
    const abort = new AbortController();
    const stopped = await undoLastRun(TEST_DIR, { signal: abort.signal, onProgress: () => abort.abort() });
    expect(stopped.results.map((result) => result.from)).toEqual(['b.jpg']);
    expect(stopped.remaining).toBe(1);
    expect(fs.existsSync(path.join(TEST_DIR, 'b.jpg'))).toBe(true);
    expect(fs.existsSync(path.join(TEST_DIR, 'a.jpg'))).toBe(false);
    const retry = await undoLastRun(TEST_DIR);
    expect(retry.results.map((result) => result.from)).toEqual(['a.jpg']);
    expect(await readHistory(TEST_DIR)).toEqual([]);
  });

  test('each undo takes back only the latest run', async () => {
    await fs.ensureFile(path.join(TEST_DIR, 'first.jpg'));
    await organize({ name: 'x' });
    await fs.ensureFile(path.join(TEST_DIR, 'second.jpg'));
    await organize({ name: 'x' });

    await undoLastRun(TEST_DIR);

    expect(fs.existsSync(path.join(TEST_DIR, 'second.jpg'))).toBe(true);
    expect(fs.existsSync(path.join(TEST_DIR, 'first.jpg'))).toBe(false);
    expect(await readHistory(TEST_DIR)).toHaveLength(1);
  });

  test('keeps only the most recent runs', async () => {
    for (let i = 0; i < MAX_RUNS + 2; i++) {
      await recordRun(TEST_DIR, [{ ok: true, name: `${i}.jpg`, folder: 'images', newName: `x-${i}.jpg` }]);
    }

    const runs = await readHistory(TEST_DIR);

    expect(runs).toHaveLength(MAX_RUNS);
    expect(runs.at(-1).moves[0].from).toBe(`${MAX_RUNS + 1}.jpg`);
  });

  test('records nothing when no file was moved, and has nothing to undo', async () => {
    const run = await recordRun(TEST_DIR, [{ ok: false, name: 'a.jpg', folder: 'images', newName: 'x-1.jpg' }]);

    expect(run).toBeNull();
    expect(await undoLastRun(TEST_DIR)).toBeNull();
  });

  test('the history file is never organized itself', async () => {
    await fs.ensureFile(path.join(TEST_DIR, 'a.jpg'));
    await organize();

    expect(await scanDirectory(TEST_DIR)).toEqual([]);
  });
});
