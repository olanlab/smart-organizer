#!/usr/bin/env node

const fs = require('fs-extra');
const path = require('path');
const chalk = require('chalk');

// https://no-color.org, and --no-color on the command line.
if ('NO_COLOR' in process.env || process.argv.includes('--no-color')) chalk.level = 0;
const { program, Option } = require('commander');
const { version } = require('../package.json');
const {
  scanDirectory, buildPlan, executePlan, validateName, isDirectory, riskReason, GROUPINGS,
  formatDateTime, formatSize, friendlyError,
} = require('../src/organizer');
const { readHistory, recordRun, undoLastRun } = require('../src/history');
const {
  FOLDER_CONFIG, defaultConfigPath, loadSettingsFor, initConfig,
} = require('../src/config');
const {
  DUPLICATE_MODES, organizedFolders, markDuplicates, applyDuplicateMode,
} = require('../src/duplicates');
const { watchFolder } = require('../src/watch');
const { notify } = require('../src/notify');
const { rememberFolder } = require('../src/recent');
const { folderStats } = require('../src/stats');
const { SHELLS, completionScript } = require('../src/completion');
const { printable } = require('../src/tui/text');
const {
  countFiles, wantsTui, undoCommand, resolveSettings, resolveFileArguments, categorySummary,
} = require('../src/cli');

const copyNote = (file) => (file.duplicateOf ? chalk.yellow(` (copy of ${printable(file.duplicateOf)})`) : '');

function fail(message) {
  console.error(chalk.red(message));
  process.exitCode = 1;
}

const countRuns = (n) => `${n} ${n === 1 ? 'run' : 'runs'}`;
const runTime = (run) => formatDateTime(new Date(run.at));

// Undoes the latest `count` runs, newest first.
async function undo(targetDir, { count = 1, dryRun, quiet } = {}) {
  const history = await readHistory(targetDir);
  if (history.length === 0) {
    console.log(chalk.yellow(`Nothing to undo in ${targetDir}`));
    return;
  }
  if (count > history.length) console.log(chalk.yellow(`Only ${countRuns(history.length)} recorded here; undoing all of them.`));
  const runs = history.slice(-count).reverse();

  if (dryRun) {
    for (const run of runs) {
      console.log(chalk.blue(`The run from ${runTime(run)} in: ${targetDir}`));
      if (!quiet) for (const move of [...run.moves].reverse()) console.log(chalk.cyan(`Would restore: ${printable(move.to)} -> ${printable(move.from)}`));
    }
    const total = runs.reduce((sum, run) => sum + run.moves.length, 0);
    console.log(chalk.bold(`\nDry run: ${countFiles(total)} would be restored. Nothing was moved.`));
    return;
  }

  let restored = 0;
  let failed = 0;
  for (const run of runs) {
    if (!quiet) console.log(chalk.blue(`Undoing the run from ${runTime(run)} in: ${targetDir}`));
    const { results, remaining } = await undoLastRun(targetDir, {
      onProgress: (result) => {
        if (!result.ok) console.error(chalk.red(`Could not restore ${printable(result.to)} (${friendlyError(result.error)})`));
        else if (!quiet) console.log(chalk.green(`Restored: ${printable(result.to)} -> ${printable(result.from)}`));
      },
    });
    restored += results.filter((result) => result.ok).length;
    failed += results.filter((result) => !result.ok).length;
    // Do not retry the blocked run repeatedly or reach older runs out of order.
    if (remaining > 0) {
      console.log(chalk.yellow(`Kept ${countFiles(remaining)} in undo history. Fix the conflict and retry with: ${undoCommand(targetDir)}`));
      break;
    }
  }

  if (restored > 0) console.log(chalk.bold.green(`${quiet ? '' : '\n'}Restored ${countFiles(restored)} to their original names.`));
  if (failed > 0) fail(`${countFiles(failed)} could not be restored.`);
}

async function showHistory(targetDir) {
  const history = await readHistory(targetDir);
  if (history.length === 0) {
    console.log(chalk.yellow(`No runs recorded in ${targetDir}`));
    return;
  }
  console.log(chalk.blue(`Recent runs in ${targetDir} (newest first):`));
  [...history].reverse().forEach((run, index) => {
    const sample = run.moves.slice(0, 2).map((move) => `${printable(move.from)} -> ${printable(move.to)}`).join(', ');
    const more = run.moves.length > 2 ? `, +${run.moves.length - 2} more` : '';
    console.log(`${String(index + 1).padStart(3)}. ${runTime(run)}  ${countFiles(run.moves.length).padEnd(10)} ${chalk.dim(sample + more)}`);
  });
  console.log(chalk.dim(`\nUndo the newest with: ${undoCommand(targetDir)} (add a number, like --undo 3, for more)`));
}

async function showStats(targetDir, settings) {
  const stats = await folderStats(targetDir, settings);
  console.log(chalk.bold(`${targetDir}: ${countFiles(stats.count)}, ${formatSize(stats.size)}`));
  if (stats.count === 0) console.log(chalk.dim('  Nothing to organize here.'));

  const largest = Math.max(1, ...stats.categories.map((entry) => entry.size));
  const nameWidth = Math.max(0, ...stats.categories.map((entry) => entry.category.length));
  for (const { category, count, size } of stats.categories) {
    const bar = '█'.repeat(Math.max(1, Math.round((size / largest) * 20)));
    console.log(`  ${category.padEnd(nameWidth)}  ${countFiles(count).padStart(10)}  ${formatSize(size).padStart(8)}  ${chalk.cyan(bar)}`);
  }

  if (stats.biggest.length) {
    console.log(chalk.bold('\nBiggest:'));
    for (const file of stats.biggest) console.log(`  ${formatSize(file.size).padStart(8)}  ${printable(file.name)}`);
  }
  if (stats.duplicates.count) {
    console.log(chalk.yellow(`\n${countFiles(stats.duplicates.count)} (${formatSize(stats.duplicates.size)}) ${stats.duplicates.count === 1 ? 'has' : 'have'} the same content as another file.`)
      + chalk.dim(' --duplicates separate puts them aside.'));
  }
  if (stats.leftAlone.length) {
    const reasons = [...new Set(stats.leftAlone.map((file) => file.reason))].join(', ');
    console.log(chalk.dim(`${countFiles(stats.leftAlone.length)} would be left alone (${reasons}).`));
  }
}

async function showConfig(file) {
  const { file: configFile, created } = await initConfig(file);
  console.log(created ? chalk.green(`Created ${configFile}`) : chalk.blue(`Settings file: ${configFile}`));
  console.log(await fs.readFile(configFile, 'utf8'));
  console.log(chalk.dim('Settings: parent, naming ("date", "file-date" or "keep-names"),'
    + ' duplicates ("keep", "skip" or "separate"), groupBy ("month" or "year"), categories, rules, ignore.'));
  console.log(chalk.dim(`A ${FOLDER_CONFIG} file in a folder overrides these settings there. Command-line options always win.`));
}

// Refuses (and explains) folders that are almost certainly a mistake to organize — a code
// project, the home folder, the top of the disk — unless --force or --dry-run.
async function checkProject(targetDir, options) {
  const risk = await riskReason(targetDir);
  if (risk && !options.force && !options.dryRun) {
    fail(`Not organizing ${targetDir}: ${risk}.`);
    console.error('Its files would be moved and renamed. Add --force if you really mean it.');
    return { allowed: false, risk };
  }
  return { allowed: true, risk };
}

const clock = () => {
  const now = new Date();
  return [now.getHours(), now.getMinutes(), now.getSeconds()].map((n) => String(n).padStart(2, '0')).join(':');
};

async function watch(targetDir, settings, options) {
  if (!(await checkProject(targetDir, options)).allowed) return;

  const abort = new AbortController();
  process.once('SIGINT', () => abort.abort());
  let moved = 0;

  console.log(chalk.blue(`Watching ${targetDir}`) + chalk.dim(' (files are organized once they stop changing, Ctrl+C stops)'));
  if (options.dryRun) console.log(chalk.yellow('Dry run: nothing will be moved.'));

  await watchFolder(targetDir, settings, {
    dryRun: options.dryRun,
    signal: abort.signal,
    onBatch: (results, { skipped = [] } = {}) => {
      const done = results.filter((result) => result.ok);
      moved += options.dryRun ? 0 : done.length;
      if (options.notify && !options.dryRun && done.length > 0) {
        notify(`Organized ${countFiles(done.length)} in ${path.basename(targetDir)} (${categorySummary(done)})`);
      }
      if (options.quiet) {
        // One line per batch; failures are still listed one by one.
        const verb = options.dryRun ? 'Would move' : 'Organized';
        if (done.length) console.log(chalk.green(`[${clock()}] ${verb} ${countFiles(done.length)}`));
        if (skipped.length) console.log(chalk.yellow(`[${clock()}] Left ${countFiles(skipped.length)} with the same content alone`));
      } else {
        for (const file of skipped) {
          console.log(chalk.yellow(`[${clock()}] Left alone: ${printable(file.name)} (same as ${printable(file.duplicateOf)})`));
        }
        for (const result of done) {
          const target = printable(path.join(result.folder, result.newName));
          const line = `[${clock()}] ${options.dryRun ? 'Would move' : 'Moved'}: ${printable(result.name)} -> ${target}`;
          console.log((options.dryRun ? chalk.cyan(line) : chalk.green(line)) + copyNote(result));
        }
      }
      for (const result of results.filter((item) => !item.ok)) {
        console.error(chalk.red(`[${clock()}] Failed: ${printable(result.name)} (${friendlyError(result.error)})`));
      }
    },
    onError: (error) => console.error(chalk.red(`[${clock()}] ${error.message}`)),
  });

  console.log(chalk.bold(`\nStopped watching. Organized ${countFiles(moved)}.`));
  if (moved > 0) console.log(chalk.dim(`Undo the last batch with: ${undoCommand(targetDir)}`));
}

async function organize(targetDir, settings, options) {
  const { allowed, risk } = await checkProject(targetDir, options);
  if (!allowed) return;
  const verbose = !options.quiet;
  const gap = verbose ? '\n' : '';

  if (verbose) console.log(chalk.blue(`Organizing files in: ${targetDir}`));
  if (risk && options.dryRun) console.log(chalk.yellow(`Heads up: ${risk}.`));

  const leftAlone = [];
  const scanned = await scanDirectory(targetDir, { ...settings, skipped: leftAlone });
  // Files skipped on purpose (still downloading, lock files, ignore patterns) are mentioned, not moved.
  if (leftAlone.length && verbose) {
    for (const file of leftAlone.slice(0, 5)) console.log(chalk.yellow(`Left alone: ${printable(file.name)} (${file.reason})`));
    if (leftAlone.length > 5) console.log(chalk.yellow(`…and ${countFiles(leftAlone.length - 5)} more left alone`));
  } else if (leftAlone.length) {
    console.log(chalk.yellow(`Left ${countFiles(leftAlone.length)} alone (${[...new Set(leftAlone.map((file) => file.reason))].join(', ')}).`));
  }
  if (settings.names) {
    const accounted = new Set([...scanned, ...leftAlone].map((file) => file.name));
    for (const name of settings.names) {
      if (!accounted.has(name)) console.log(chalk.yellow(`Left alone: ${printable(name)} (not in --only)`));
    }
  }
  const files = await markDuplicates(targetDir, scanned, { folders: organizedFolders(settings.categories, settings.parent) });
  const duplicates = files.filter((file) => file.duplicateOf);
  const plan = await buildPlan(targetDir, applyDuplicateMode(files, settings.duplicates), settings);

  if (settings.duplicates === 'skip' && duplicates.length > 0) {
    if (verbose) {
      for (const file of duplicates) console.log(chalk.yellow(`Left alone: ${printable(file.name)} (same as ${printable(file.duplicateOf)})`));
    } else {
      console.log(chalk.yellow(`Left ${countFiles(duplicates.length)} with the same content as another file alone.`));
    }
  }

  if (plan.length === 0) {
    console.log(chalk.yellow('No files needed organizing.'));
    return;
  }

  // A hint when copies are about to be organized like any other file.
  const duplicateHint = () => {
    if (settings.duplicates !== 'keep' || duplicates.length === 0) return;
    console.log(chalk.yellow(`${countFiles(duplicates.length)} had the same content as another file.`)
      + chalk.dim(' --duplicates separate puts copies in their own folder, --duplicates skip leaves them.'));
  };

  if (options.dryRun) {
    for (const move of verbose ? plan : []) {
      console.log(chalk.cyan(`Would move: ${printable(move.name)} -> ${printable(path.join(move.folder, move.newName))}`) + copyNote(move));
    }
    console.log(chalk.bold(`${gap}Dry run: ${countFiles(plan.length)} would be organized (${categorySummary(plan)}).`)
      + chalk.dim(' Nothing was moved.'));
    duplicateHint();
    return;
  }

  // Ctrl+C finishes the file in flight, then stops and still saves the undo history.
  const abort = new AbortController();
  const stop = () => abort.abort();
  process.once('SIGINT', stop);
  // Quiet runs in a terminal still show one line of progress, rewritten in place.
  const showProgress = !verbose && process.stdout.isTTY;
  const clearProgress = () => showProgress && process.stdout.write('\r\x1b[K');
  const results = await executePlan(plan, {
    signal: abort.signal,
    onProgress: (result, done, total) => {
      if (!result.ok) {
        clearProgress();
        console.error(chalk.red(`Failed: ${printable(result.name)} (${friendlyError(result.error)})`));
      } else if (verbose) {
        const verb = result.newName === result.name ? 'Moved' : 'Moved and Renamed';
        console.log(chalk.green(`${verb}: ${printable(result.name)} -> ${printable(path.join(result.folder, result.newName))}`) + copyNote(result));
      }
      if (showProgress) process.stdout.write(chalk.dim(`\rMoving files… ${done}/${total}`));
    },
  });
  clearProgress();
  process.off('SIGINT', stop);

  await recordRun(targetDir, results).catch((error) => {
    console.error(chalk.yellow(`Could not save undo history: ${error.message}`));
  });
  if (results.some((result) => result.ok)) await rememberFolder(targetDir);

  const done = results.filter((result) => result.ok);
  const moved = done.length;
  const failed = results.length - moved;

  if (moved > 0) console.log(chalk.bold.green(`${gap}Successfully organized ${countFiles(moved)}!`) + chalk.dim(` (${categorySummary(done)})`));
  if (failed > 0) fail(`${countFiles(failed)} could not be moved.`);
  if (abort.signal.aborted) {
    console.log(chalk.yellow(`Stopped early: ${countFiles(plan.length - results.length)} left untouched.`));
    process.exitCode = 130;
  }
  duplicateHint();
  if (moved > 0) console.log(chalk.dim(`Undo with: ${undoCommand(targetDir)}`));
}

program
  .name('org')
  .version(version)
  .description('Organize files into categorized folders. In a terminal, `org` opens an interactive preview first;'
    + ' add --yes to organize right away.')
  // Grouped, so the long list of options in --help is easy to scan.
  .optionsGroup('Where:')
  .option('-d, --dir <directory>', 'Directory to organize', '.')
  .option('-p, --parent <directory>', 'Destination root for category folders (relative to source, absolute or ~/path)')
  .addOption(new Option('--group-by <period>', 'Put files in date subfolders like images/2024-03 (by modified date)')
    .choices(GROUPINGS))
  .optionsGroup('Naming:')
  .option('-n, --name <filename>', 'Custom filename (replaces default date-based name)')
  .option('-k, --keep-names', 'Keep the original filenames, only sort files into folders')
  .option('--file-date', 'Name files by the day they were last modified instead of today')
  .optionsGroup('Which files:')
  .option('--only <categories>', 'Only organize these categories, comma-separated (e.g. images,videos)')
  .option('-x, --exclude <patterns...>', 'Leave files matching these patterns alone (e.g. "*.log")')
  .addOption(new Option('--duplicates <mode>', 'What to do with files whose content matches another file')
    .choices(DUPLICATE_MODES))
  .optionsGroup('How to run:')
  .option('-y, --yes', 'Organize right away, without the interactive preview')
  .option('-t, --tui', 'Open the interactive preview (what plain `org` does in a terminal)')
  .option('--dry-run', 'Show what would be moved without touching any files')
  .option('-w, --watch', 'Keep running and organize new files as they arrive (Ctrl+C stops)')
  .option('--notify', 'With --watch, show a desktop notification when files are organized')
  .option('-q, --quiet', 'Only print the summary, not a line per file')
  .option('--stats', 'Show what is in the folder (sizes, biggest files, duplicates) without moving anything')
  .option('--force', 'Organize even a code project, your home folder or the top of the disk')
  .optionsGroup('Undo:')
  .option('-u, --undo [runs]', 'Put the files from the last run (or last N runs) back under their original names')
  .option('--history', 'List the recent runs in the folder that can be undone')
  .optionsGroup('Settings:')
  .option('--config <file>', `Settings file to use (default: ${defaultConfigPath()})`)
  .option('--init-config', 'Create a starter settings file if there is none, and show it')
  .option('--no-color', 'Turn colors off (NO_COLOR=1 works too)')
  .addOption(new Option('--completion <shell>', 'Print a Tab-completion script for your shell').choices(SHELLS))
  .addHelpText('after', `
Examples:
  org -d ~/Downloads                       preview, pick and organize in the interactive UI
  org -d ~/Downloads -y                    organize right away, no questions asked
  org -d ~/Downloads --dry-run             show what would happen, move nothing
  org --undo -d ~/Downloads                put the last run back
  org --watch -d ~/Downloads               keep Downloads tidy while you work
  org -d ~/Pictures/import --file-date --group-by month
                                           photo library: images/2024-03/2024-03-14-1.jpg
  org *.pdf                                just these files (they must be in one folder)`)
  .argument('[files...]', 'Only organize these files (they must be in one folder)')
  .action(async (files, options) => {
    if (options.completion) {
      process.stdout.write(completionScript(options.completion, program.options));
      return;
    }

    if (options.initConfig) {
      await showConfig(options.config);
      return;
    }

    let targetDir = path.resolve(options.dir);
    let names = null;
    if (files.length > 0) {
      if (options.watch || options.undo || options.history) {
        fail('File names only work when organizing; --watch, --undo and --history work on a whole folder.');
        return;
      }
      try {
        ({ dir: targetDir, names } = await resolveFileArguments(files, fs, path));
      } catch (error) {
        fail(error.message);
        return;
      }
      if (program.getOptionValueSource('dir') === 'cli' && path.resolve(options.dir) !== targetDir) {
        fail(`The files are in ${targetDir}, not in --dir ${path.resolve(options.dir)}.`);
        return;
      }
    }

    if (!(await isDirectory(targetDir))) {
      fail(`Directory not found: ${targetDir}`);
      return;
    }

    if (options.history) {
      await showHistory(targetDir);
      return;
    }

    if (options.undo) {
      const count = options.undo === true ? 1 : Number(options.undo);
      if (!Number.isInteger(count) || count < 1) {
        fail(`--undo takes a number of runs, like --undo 3 (got "${options.undo}").`);
        return;
      }
      await undo(targetDir, { count, dryRun: options.dryRun, quiet: options.quiet });
      return;
    }

    const nameError = validateName(options.name);
    if (nameError) {
      fail(`Invalid --name: ${nameError}`);
      return;
    }
    if ([options.name, options.keepNames, options.fileDate].filter(Boolean).length > 1) {
      fail('Pick one way to name files: --name, --keep-names or --file-date.');
      return;
    }

    if (options.config && !(await fs.pathExists(options.config))) {
      fail(`Settings file not found: ${path.resolve(options.config)}`);
      return;
    }
    let settings;
    try {
      const { config, folderFile } = await loadSettingsFor(targetDir, options.config);
      settings = { ...resolveSettings(options, config), names, folderFile };
    } catch (error) {
      fail(error.message);
      return;
    }

    if (options.stats) {
      await showStats(targetDir, settings);
      return;
    }

    if (options.tui && (options.watch || options.yes)) {
      fail(`Use either --tui or --${options.watch ? 'watch' : 'yes'}, not both.`);
      return;
    }

    if (wantsTui(options, Boolean(process.stdin.isTTY && process.stdout.isTTY))) {
      const { runTui } = require('../src/tui');
      const session = await runTui({ targetDir, ...settings, version });
      const moved = session.results.filter((result) => result.ok).length;
      const failed = session.results.length - moved;
      if (moved > 0) console.log(chalk.green(`Organized ${countFiles(moved)} in ${session.targetDir}`));
      if (session.restored > 0) console.log(chalk.green(`Restored ${countFiles(session.restored)} to their original names`));
      if (failed > 0) fail(`${countFiles(failed)} could not be moved.`);
      return;
    }

    if (options.watch) {
      await watch(targetDir, settings, options);
      return;
    }

    await organize(targetDir, settings, options);
  });

program.parseAsync(process.argv).catch((err) => {
  fail(`Error organizing files: ${err.message}`);
});
