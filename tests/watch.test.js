const fs = require('fs-extra');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const { formatDate } = require('../src/organizer');
const { readHistory } = require('../src/history');
const { watchFolder } = require('../src/watch');

const ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'org-watch-'));
let dir;
let counter = 0;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitFor(check, timeout = 5000) {
  for (const start = Date.now(); Date.now() - start < timeout; await sleep(25)) {
    if (await check()) return;
  }
  throw new Error('timed out');
}

// Starts a watcher on a fresh folder; returns helpers to inspect and stop it.
function startWatching(options = {}) {
  const abort = new AbortController();
  const batches = [];
  const done = watchFolder(dir, {}, { settleMs: 150, pollMs: 400, signal: abort.signal, onBatch: (results) => batches.push(results), ...options });
  return { batches, stop: async () => { abort.abort(); await done; } };
}

beforeEach(async () => {
  dir = path.join(ROOT, `folder-${counter++}`);
  await fs.ensureDir(dir);
});

afterAll(async () => {
  await fs.remove(ROOT);
});

describe('watch mode', () => {
  test('organizes files already there and files that arrive later, one undoable run per batch', async () => {
    await fs.ensureFile(path.join(dir, 'old.pdf'));
    const watching = startWatching();

    await waitFor(() => fs.pathExists(path.join(dir, 'documents', `${formatDate()}-1.pdf`)));
    await fs.ensureFile(path.join(dir, 'new.jpg'));
    await waitFor(() => fs.pathExists(path.join(dir, 'images', `${formatDate()}-1.jpg`)));
    await watching.stop();

    expect(watching.batches.flat().map((result) => result.name)).toEqual(['old.pdf', 'new.jpg']);
    expect(await readHistory(dir)).toHaveLength(2);
  });

  test('waits until a file stops changing before moving it', async () => {
    const file = path.join(dir, 'growing.mp4');
    const watching = startWatching();

    for (let i = 0; i < 8; i++) {
      await fs.appendFile(file, 'x'.repeat(1000));
      await sleep(60);
    }
    const movedWhileWriting = await fs.pathExists(path.join(dir, 'videos'));
    await waitFor(() => fs.pathExists(path.join(dir, 'videos', `${formatDate()}-1.mp4`)));
    await watching.stop();

    expect(movedWhileWriting).toBe(false);
    expect((await fs.stat(path.join(dir, 'videos', `${formatDate()}-1.mp4`))).size).toBe(8000);
  });

  test('still notices new files when the file system sends no event', async () => {
    // A watcher that never reports anything, like fs.watch on some network drives.
    const deaf = () => ({ on() {}, close() {} });
    const watching = startWatching({ watch: deaf });
    await sleep(100);
    await fs.ensureFile(path.join(dir, 'quiet.txt'));

    await waitFor(() => fs.pathExists(path.join(dir, 'documents', `${formatDate()}-1.txt`)));
    await watching.stop();
  });

  test('a dry run reports each file once and moves nothing', async () => {
    await fs.ensureFile(path.join(dir, 'a.txt'));
    const watching = startWatching({ dryRun: true });

    await waitFor(() => watching.batches.length > 0);
    await fs.ensureFile(path.join(dir, 'b.txt'));
    await waitFor(() => watching.batches.length > 1);
    await sleep(400);
    await watching.stop();

    expect(watching.batches.flat().map((result) => result.name)).toEqual(['a.txt', 'b.txt']);
    expect(await fs.pathExists(path.join(dir, 'a.txt'))).toBe(true);
  });

  test('org --watch stops cleanly on Ctrl+C and says how to undo', async () => {
    await fs.ensureFile(path.join(dir, 'song.mp3'));
    const child = spawn('node', [path.resolve(__dirname, '../bin/index.js'), '-d', dir, '--watch'], {
      env: { ...process.env, XDG_CONFIG_HOME: path.join(ROOT, 'config') },
    });
    let output = '';
    child.stdout.on('data', (chunk) => { output += chunk; });

    await waitFor(() => output.includes('Moved: song.mp3'));
    child.kill('SIGINT');
    const code = await new Promise((resolve) => child.on('exit', resolve));

    expect(code).toBe(0);
    expect(output).toContain('Stopped watching. Organized 1 file.');
    expect(output).toContain('Undo the last batch with: org --undo -d');
  });
});
