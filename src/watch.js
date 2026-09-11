// Keeps a folder organized as files arrive. A file is only moved once its size and modified
// time have stayed the same for `settleMs`, so nothing is moved while it is still being
// downloaded or copied. Every batch is recorded in the undo history.

const fs = require('fs-extra');
const { scanDirectory, buildPlan, executePlan } = require('./organizer');
const { recordRun } = require('./history');
const { organizedFolders, markDuplicates, applyDuplicateMode } = require('./duplicates');

// Waits this long after a change in the folder before looking, so a burst of events is one scan.
const DEBOUNCE_MS = 300;

// Resolves once `signal` aborts. `onBatch(results, { skipped })` gets the outcome of each batch
// of moves (with dryRun, the plan of what would move, each file reported once) and the
// duplicates left where they are.
async function watchFolder(targetDir, settings, {
  settleMs = 2000, pollMs = 10000, dryRun = false, signal, onBatch = () => {}, onError = () => {},
  watch = fs.watch,
}) {
  const pending = new Map(); // name -> { size, mtimeMs, since }
  const reported = new Set(); // files dealt with without moving: shown in a dry run, skipped, or failed
  let timer = null;
  let dueAt = Infinity;
  let checking = false;
  let checkAgain = false;

  // Makes sure a check happens within `delay`; never pushes an earlier one back.
  const schedule = (delay) => {
    if (signal.aborted) return;
    const at = Date.now() + delay;
    if (timer && dueAt <= at) return;
    clearTimeout(timer);
    dueAt = at;
    timer = setTimeout(() => {
      timer = null;
      dueAt = Infinity;
      check();
    }, delay);
  };

  // Splits the folder's files into those that have settled and those still changing.
  function sortOut(files, now) {
    const ready = [];
    let waiting = false;
    for (const file of files) {
      const seen = pending.get(file.name);
      const mtimeMs = file.modified.getTime();
      const unchanged = seen && seen.size === file.size && seen.mtimeMs === mtimeMs;
      if (unchanged && now - seen.since >= settleMs) {
        ready.push(file);
      } else {
        if (!unchanged) pending.set(file.name, { size: file.size, mtimeMs, since: now });
        waiting = true;
      }
    }
    const present = new Set(files.map((file) => file.name));
    for (const name of pending.keys()) if (!present.has(name)) pending.delete(name);
    return { ready, waiting };
  }

  async function check() {
    if (signal.aborted) return;
    if (checking) {
      checkAgain = true;
      return;
    }
    checking = true;
    try {
      const files = (await scanDirectory(targetDir, settings)).filter((file) => !reported.has(file.name));
      const { ready, waiting } = sortOut(files, Date.now());
      if (ready.length > 0) {
        const marked = await markDuplicates(targetDir, ready, {
          folders: organizedFolders(settings.categories, settings.parent),
        });
        const skipped = settings.duplicates === 'skip' ? marked.filter((file) => file.duplicateOf) : [];
        const plan = await buildPlan(targetDir, applyDuplicateMode(marked, settings.duplicates), settings);
        for (const file of skipped) reported.add(file.name);
        if (dryRun) {
          for (const file of ready) reported.add(file.name);
          onBatch(plan.map((move) => ({ ...move, ok: true })), { skipped });
        } else {
          const results = await executePlan(plan, { signal });
          await recordRun(targetDir, results);
          // A file that could not be moved is reported once, not again on every change in the folder.
          for (const result of results) if (!result.ok) reported.add(result.name);
          onBatch(results, { skipped });
        }
        for (const file of ready) pending.delete(file.name);
      }
      if (waiting) schedule(settleMs);
    } catch (error) {
      onError(error);
    } finally {
      checking = false;
      if (checkAgain) {
        checkAgain = false;
        schedule(0);
      }
    }
  }

  const watcher = watch(targetDir, () => schedule(DEBOUNCE_MS));
  watcher.on('error', onError);
  // fs.watch can miss changes (network drives, some Linux setups), so the folder is also
  // looked at every now and then, events or not.
  const poll = setInterval(() => schedule(0), pollMs);
  schedule(0);

  await new Promise((resolve) => signal.addEventListener('abort', resolve, { once: true }));
  clearTimeout(timer);
  clearInterval(poll);
  watcher.close();
}

module.exports = { watchFolder };
