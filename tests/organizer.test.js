const fs = require('fs-extra');
const os = require('os');
const path = require('path');
const { execFileSync, spawnSync } = require('child_process');
const {
  formatDate,
  getExtension,
  validateName,
  findProjectRoot,
  riskReason,
  customName,
  friendlyError,
  scanDirectory,
  planMoves,
  buildPlan,
  executePlan,
} = require('../src/organizer');
const { version } = require('../package.json');

// Outside the repo on purpose: org refuses to organize folders inside a git project.
const TEST_DIR = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'org-cli-')), 'target');
const CLI_PATH = path.resolve(__dirname, '../bin/index.js');
// The CLI reads its settings from here, so a real ~/.config/smart-organizer never leaks into the tests.
const CONFIG_HOME = path.join(path.dirname(TEST_DIR), 'config');
const CONFIG_FILE = path.join(CONFIG_HOME, 'smart-organizer', 'config.json');
const CLI_OPTIONS = { encoding: 'utf8', env: { ...process.env, XDG_CONFIG_HOME: CONFIG_HOME } };

beforeEach(async () => {
  await fs.remove(TEST_DIR);
  await fs.remove(CONFIG_HOME);
  await fs.ensureDir(TEST_DIR);
});

afterAll(async () => {
  await fs.remove(path.dirname(TEST_DIR));
});

describe('Smart Organizer CLI', () => {
  const runCLI = (...args) => execFileSync('node', [CLI_PATH, ...args], CLI_OPTIONS);
  const spawnCLI = (...args) => spawnSync('node', [CLI_PATH, ...args], CLI_OPTIONS);
  const today = formatDate();

  test('an absolute destination keeps existing files, numbers collisions and can be undone', async () => {
    const parent = path.join(path.dirname(TEST_DIR), 'external-destination');
    await fs.outputFile(path.join(TEST_DIR, 'photo.jpg'), 'new photo');
    await fs.outputFile(path.join(parent, 'images', 'photo.jpg'), 'existing photo');
    const preview = runCLI('-d', TEST_DIR, '-p', parent, '--keep-names', '--dry-run');
    expect(preview).toContain(path.join(parent, 'images', 'photo-2.jpg'));
    expect(fs.existsSync(path.join(TEST_DIR, 'photo.jpg'))).toBe(true);
    runCLI('-d', TEST_DIR, '-p', parent, '--keep-names', '-y');
    expect(fs.readFileSync(path.join(parent, 'images', 'photo-2.jpg'), 'utf8')).toBe('new photo');
    expect(fs.readFileSync(path.join(parent, 'images', 'photo.jpg'), 'utf8')).toBe('existing photo');
    runCLI('-d', TEST_DIR, '--undo');
    expect(fs.readFileSync(path.join(TEST_DIR, 'photo.jpg'), 'utf8')).toBe('new photo');
    expect(fs.existsSync(path.join(parent, 'images', 'photo-2.jpg'))).toBe(false);
  });

  test('should organize files into categorized folders and rename with date', async () => {
    await fs.ensureFile(path.join(TEST_DIR, 'image.jpg'));
    await fs.ensureFile(path.join(TEST_DIR, 'video.mp4'));

    runCLI('-d', TEST_DIR);

    expect(fs.existsSync(path.join(TEST_DIR, `images/${today}-1.jpg`))).toBe(true);
    expect(fs.existsSync(path.join(TEST_DIR, `videos/${today}-1.mp4`))).toBe(true);
  });

  test('should increment running number for multiple files in same category', async () => {
    await fs.ensureFile(path.join(TEST_DIR, 'photo1.jpg'));
    await fs.ensureFile(path.join(TEST_DIR, 'photo2.jpg'));

    runCLI('-d', TEST_DIR);

    expect(fs.existsSync(path.join(TEST_DIR, `images/${today}-1.jpg`))).toBe(true);
    expect(fs.existsSync(path.join(TEST_DIR, `images/${today}-2.jpg`))).toBe(true);
  });

  test('should continue numbering after files from an earlier run', async () => {
    await fs.ensureFile(path.join(TEST_DIR, `images/${today}-1.jpg`));
    await fs.ensureFile(path.join(TEST_DIR, 'photo.jpg'));

    runCLI('-d', TEST_DIR);

    expect(fs.existsSync(path.join(TEST_DIR, `images/${today}-2.jpg`))).toBe(true);
  });

  test('should organize files inside a parent folder if -p is provided', async () => {
    const PARENT_FOLDER = 'my-archive';
    await fs.ensureFile(path.join(TEST_DIR, 'image.png'));

    runCLI('-d', TEST_DIR, '-p', PARENT_FOLDER);

    expect(fs.existsSync(path.join(TEST_DIR, PARENT_FOLDER, `images/${today}-1.png`))).toBe(true);
  });

  test('should put unknown extensions into "others"', async () => {
    await fs.ensureFile(path.join(TEST_DIR, 'something.xyz'));

    runCLI('-d', TEST_DIR);

    expect(fs.existsSync(path.join(TEST_DIR, `others/${today}-1.xyz`))).toBe(true);
  });

  test('should use custom filename if --name is provided', async () => {
    const CUSTOM_NAME = 'my-custom-file';
    await fs.ensureFile(path.join(TEST_DIR, 'photo.jpg'));

    runCLI('-d', TEST_DIR, '--name', CUSTOM_NAME);

    expect(fs.existsSync(path.join(TEST_DIR, `images/${CUSTOM_NAME}-1.jpg`))).toBe(true);
  });

  test('should keep original names with --keep-names', async () => {
    await fs.ensureFile(path.join(TEST_DIR, 'Holiday Photo.jpg'));

    const output = runCLI('-d', TEST_DIR, '--keep-names');

    expect(output).toContain(`Moved: Holiday Photo.jpg -> ${path.join('images', 'Holiday Photo.jpg')}`);
    expect(fs.existsSync(path.join(TEST_DIR, 'images', 'Holiday Photo.jpg'))).toBe(true);
  });

  test('should name files by their modified date with --file-date', async () => {
    const photo = path.join(TEST_DIR, 'old-photo.jpg');
    await fs.ensureFile(photo);
    const taken = new Date(2024, 4, 1, 12);
    await fs.utimes(photo, taken, taken);

    runCLI('-d', TEST_DIR, '--file-date');

    expect(fs.existsSync(path.join(TEST_DIR, 'images', '2024-05-01-1.jpg'))).toBe(true);
  });

  test('should reject --name together with --keep-names', () => {
    const result = spawnCLI('-d', TEST_DIR, '--name', 'x', '--keep-names');

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('Pick one way to name files');
  });

  test('should not move anything with --dry-run', async () => {
    await fs.ensureFile(path.join(TEST_DIR, 'photo.jpg'));

    const output = runCLI('-d', TEST_DIR, '--dry-run');

    expect(output).toContain(`photo.jpg -> ${path.join('images', `${today}-1.jpg`)}`);
    expect(fs.existsSync(path.join(TEST_DIR, 'photo.jpg'))).toBe(true);
    expect(fs.existsSync(path.join(TEST_DIR, 'images'))).toBe(false);
  });

  test('should reject a --name that is a path', async () => {
    await fs.ensureFile(path.join(TEST_DIR, 'photo.jpg'));

    const result = spawnCLI('-d', TEST_DIR, '--name', '../escaped');

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('Invalid --name');
    expect(fs.existsSync(path.join(TEST_DIR, 'photo.jpg'))).toBe(true);
  });

  test('should exit with an error when the directory does not exist', () => {
    const result = spawnCLI('-d', path.join(TEST_DIR, 'missing'));

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('Directory not found');
  });

  test('should put files back with --undo', async () => {
    await fs.outputFile(path.join(TEST_DIR, 'photo.jpg'), 'original');

    const organized = runCLI('-d', TEST_DIR);
    const undone = runCLI('-d', TEST_DIR, '--undo');

    expect(organized).toContain('Undo with: org --undo -d');
    expect(undone).toContain(`Restored: ${path.join('images', `${today}-1.jpg`)} -> photo.jpg`);
    expect(fs.readFileSync(path.join(TEST_DIR, 'photo.jpg'), 'utf8')).toBe('original');
    expect(fs.existsSync(path.join(TEST_DIR, 'images'))).toBe(false);
  });

  test('should only preview an undo with --dry-run', async () => {
    await fs.ensureFile(path.join(TEST_DIR, 'photo.jpg'));
    runCLI('-d', TEST_DIR);

    const output = runCLI('-d', TEST_DIR, '--undo', '--dry-run');

    expect(output).toContain('Would restore:');
    expect(fs.existsSync(path.join(TEST_DIR, 'images', `${today}-1.jpg`))).toBe(true);
    expect(fs.existsSync(path.join(TEST_DIR, 'photo.jpg'))).toBe(false);
  });

  test('should list runs with --history and undo several with --undo N', async () => {
    for (const name of ['one.jpg', 'two.jpg', 'three.jpg']) {
      await fs.ensureFile(path.join(TEST_DIR, name));
      runCLI('-d', TEST_DIR, '-k');
    }

    const history = runCLI('-d', TEST_DIR, '--history');
    const undone = runCLI('-d', TEST_DIR, '--undo', '2', '-q');

    expect(history).toMatch(/1\. .* 1 file .*three\.jpg -> images/);
    expect(history).toMatch(/3\. .* 1 file .*one\.jpg -> images/);
    expect(undone.trim()).toBe('Restored 2 files to their original names.');
    expect(fs.existsSync(path.join(TEST_DIR, 'three.jpg'))).toBe(true);
    expect(fs.existsSync(path.join(TEST_DIR, 'two.jpg'))).toBe(true);
    expect(fs.existsSync(path.join(TEST_DIR, 'images', 'one.jpg'))).toBe(true);
  });

  test('should reject an --undo count that is not a number', () => {
    const result = spawnCLI('-d', TEST_DIR, '--undo', 'all');

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('--undo takes a number of runs');
  });

  test('should preserve a blocked undo and older runs until the conflict is resolved', async () => {
    await fs.ensureFile(path.join(TEST_DIR, 'first.jpg'));
    runCLI('-d', TEST_DIR, '--name', 'trip');
    await fs.outputFile(path.join(TEST_DIR, 'second.jpg'), 'original');
    runCLI('-d', TEST_DIR, '--name', 'trip');
    await fs.outputFile(path.join(TEST_DIR, 'second.jpg'), 'new download');

    const blocked = spawnCLI('-d', TEST_DIR, '--undo', '2');
    expect(blocked.status).toBe(1);
    expect(blocked.stdout).toContain('Kept 1 file in undo history');
    expect(fs.existsSync(path.join(TEST_DIR, 'first.jpg'))).toBe(false);
    expect(fs.readFileSync(path.join(TEST_DIR, 'second.jpg'), 'utf8')).toBe('new download');
    await fs.move(path.join(TEST_DIR, 'second.jpg'), path.join(TEST_DIR, 'new-download.jpg'));
    expect(runCLI('-d', TEST_DIR, '--undo', '2')).toContain('Restored 2 files');
    expect(fs.readFileSync(path.join(TEST_DIR, 'second.jpg'), 'utf8')).toBe('original');
    expect(fs.existsSync(path.join(TEST_DIR, 'first.jpg'))).toBe(true);
  });

  test('should only print the summary with --quiet, broken down by category', async () => {
    for (const name of ['a.jpg', 'b.jpg', 'c.pdf']) await fs.ensureFile(path.join(TEST_DIR, name));

    const output = runCLI('-d', TEST_DIR, '-q');

    expect(output).not.toContain('Moved');
    expect(output).toContain('Successfully organized 3 files! (images 2 · documents 1)');
  });

  test('should organize only some categories with --only, and skip patterns with --exclude', async () => {
    for (const name of ['a.jpg', 'clip.mov', 'notes.txt', 'draft-1.jpg']) await fs.ensureFile(path.join(TEST_DIR, name));

    runCLI('-d', TEST_DIR, '-k', '--only', 'images,videos', '-x', 'draft-*');

    expect(fs.existsSync(path.join(TEST_DIR, 'images', 'a.jpg'))).toBe(true);
    expect(fs.existsSync(path.join(TEST_DIR, 'videos', 'clip.mov'))).toBe(true);
    expect(fs.existsSync(path.join(TEST_DIR, 'notes.txt'))).toBe(true);
    expect(fs.existsSync(path.join(TEST_DIR, 'draft-1.jpg'))).toBe(true);
  });

  test('should name the valid categories when --only has a typo', () => {
    const result = spawnCLI('-d', TEST_DIR, '--only', 'imgs');

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('Unknown category "imgs" in --only. Pick from: images, videos');
  });

  test('should say so when there is nothing to undo', () => {
    expect(runCLI('-d', TEST_DIR, '--undo')).toContain('Nothing to undo');
  });

  test('should refuse to organize a code project unless forced', async () => {
    await fs.ensureDir(path.join(TEST_DIR, '.git'));
    await fs.ensureFile(path.join(TEST_DIR, 'src', 'app.js'));
    await fs.ensureFile(path.join(TEST_DIR, 'src', 'logo.png'));
    const srcDir = path.join(TEST_DIR, 'src');

    const refused = spawnCLI('-d', srcDir);
    const preview = runCLI('-d', srcDir, '--dry-run');

    expect(refused.status).toBe(1);
    expect(refused.stderr).toContain('inside a code project');
    expect(preview).toContain('Heads up');
    expect(fs.existsSync(path.join(srcDir, 'logo.png'))).toBe(true);

    runCLI('-d', srcDir, '--force');
    expect(fs.existsSync(path.join(srcDir, 'images', `${today}-1.png`))).toBe(true);
  });

  test('should use defaults, categories and ignore patterns from the settings file', async () => {
    await fs.outputJson(CONFIG_FILE, {
      parent: 'Sorted',
      naming: 'keep-names',
      categories: { design: ['psd'] },
      ignore: ['*.log'],
    });
    for (const name of ['mockup.PSD', 'photo.jpg', 'debug.log']) await fs.ensureFile(path.join(TEST_DIR, name));

    runCLI('-d', TEST_DIR);

    expect(fs.existsSync(path.join(TEST_DIR, 'Sorted', 'design', 'mockup.PSD'))).toBe(true);
    expect(fs.existsSync(path.join(TEST_DIR, 'Sorted', 'images', 'photo.jpg'))).toBe(true);
    expect(fs.existsSync(path.join(TEST_DIR, 'debug.log'))).toBe(true);
  });

  test('should let a folder\'s .orgrc.json override the global settings there', async () => {
    await fs.outputJson(CONFIG_FILE, { parent: 'Sorted', categories: { design: ['.psd'] } });
    await fs.outputJson(path.join(TEST_DIR, '.orgrc.json'), { parent: '', naming: 'keep-names', rules: { shots: ['Screenshot*'] } });
    for (const name of ['mock.psd', 'Screenshot 1.png', 'x.jpg']) await fs.ensureFile(path.join(TEST_DIR, name));

    runCLI('-d', TEST_DIR);

    expect(fs.existsSync(path.join(TEST_DIR, 'design', 'mock.psd'))).toBe(true);
    expect(fs.existsSync(path.join(TEST_DIR, 'shots', 'Screenshot 1.png'))).toBe(true);
    expect(fs.existsSync(path.join(TEST_DIR, 'images', 'x.jpg'))).toBe(true);
    expect(fs.existsSync(path.join(TEST_DIR, '.orgrc.json'))).toBe(true);
  });

  test('should print without colors when NO_COLOR is set', async () => {
    await fs.ensureFile(path.join(TEST_DIR, 'a.jpg'));

    const output = execFileSync('node', [CLI_PATH, '-d', TEST_DIR], {
      ...CLI_OPTIONS, env: { ...CLI_OPTIONS.env, FORCE_COLOR: '1', NO_COLOR: '1' },
    });

    expect(output).not.toContain('\x1b[');
    expect(output).toContain('Successfully organized 1 file!');
  });

  test('should let command-line options win over the settings file', async () => {
    await fs.outputJson(CONFIG_FILE, { parent: 'Sorted', naming: 'keep-names' });
    await fs.ensureFile(path.join(TEST_DIR, 'photo.jpg'));

    runCLI('-d', TEST_DIR, '--name', 'trip', '-p', '');

    expect(fs.existsSync(path.join(TEST_DIR, 'images', 'trip-1.jpg'))).toBe(true);
  });

  test('should complain when an explicit --config file does not exist', () => {
    const result = spawnCLI('-d', TEST_DIR, '--config', path.join(TEST_DIR, 'typo.json'));

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('Settings file not found');
  });

  test('should explain a broken settings file', async () => {
    await fs.outputFile(CONFIG_FILE, '{ "naming": "sometimes" }');

    const result = spawnCLI('-d', TEST_DIR);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain(CONFIG_FILE);
    expect(result.stderr).toContain('"naming" must be one of');
  });

  test('should create a starter settings file once with --init-config', async () => {
    const first = runCLI('--init-config');
    await fs.outputJson(CONFIG_FILE, { naming: 'file-date' });
    const second = runCLI('--init-config');

    expect(first).toContain(`Created ${CONFIG_FILE}`);
    expect(first).toContain('"design"');
    expect(second).toContain('{"naming":"file-date"}');
  });

  test('should handle duplicates the way --duplicates says', async () => {
    const setup = async () => {
      await fs.emptyDir(TEST_DIR);
      await fs.outputFile(path.join(TEST_DIR, 'report.pdf'), 'same');
      await fs.outputFile(path.join(TEST_DIR, 'report (1).pdf'), 'same');
      const older = new Date(2024, 0, 1);
      await fs.utimes(path.join(TEST_DIR, 'report.pdf'), older, older);
    };

    await setup();
    const kept = runCLI('-d', TEST_DIR, '-k');
    expect(kept).toContain('(copy of report.pdf)');
    expect(kept).toContain('1 file had the same content as another file.');

    await setup();
    const skipped = runCLI('-d', TEST_DIR, '-k', '--duplicates', 'skip');
    expect(skipped).toContain('Left alone: report (1).pdf (same as report.pdf)');
    expect(fs.existsSync(path.join(TEST_DIR, 'report (1).pdf'))).toBe(true);

    await setup();
    runCLI('-d', TEST_DIR, '-k', '--duplicates', 'separate');
    expect(fs.existsSync(path.join(TEST_DIR, 'documents', 'report.pdf'))).toBe(true);
    expect(fs.existsSync(path.join(TEST_DIR, 'duplicates', 'report (1).pdf'))).toBe(true);
  });

  test('should group files into month folders, and undo should tidy them away', async () => {
    const photo = path.join(TEST_DIR, 'beach.jpg');
    await fs.ensureFile(photo);
    const taken = new Date(2024, 4, 1, 12);
    await fs.utimes(photo, taken, taken);

    runCLI('-d', TEST_DIR, '--group-by', 'month', '--file-date');
    const grouped = fs.existsSync(path.join(TEST_DIR, 'images', '2024-05', '2024-05-01-1.jpg'));
    runCLI('-d', TEST_DIR, '--undo');

    expect(grouped).toBe(true);
    expect(fs.existsSync(photo)).toBe(true);
    expect(fs.existsSync(path.join(TEST_DIR, 'images'))).toBe(false);
  });

  test('should organize just the files named on the command line', async () => {
    for (const name of ['a.jpg', 'b.pdf', 'c.mp3', 'd.crdownload']) await fs.ensureFile(path.join(TEST_DIR, name));

    const output = execFileSync('node', [CLI_PATH, '-k', 'a.jpg', 'c.mp3', 'd.crdownload'], { ...CLI_OPTIONS, cwd: TEST_DIR });

    expect(fs.existsSync(path.join(TEST_DIR, 'images', 'a.jpg'))).toBe(true);
    expect(fs.existsSync(path.join(TEST_DIR, 'audio', 'c.mp3'))).toBe(true);
    expect(fs.existsSync(path.join(TEST_DIR, 'b.pdf'))).toBe(true);
    expect(output).toContain('Left alone: d.crdownload (still downloading)');
  });

  test('should refuse named files from different folders, or that are not files', async () => {
    await fs.ensureFile(path.join(TEST_DIR, 'a.jpg'));
    await fs.ensureFile(path.join(TEST_DIR, 'sub', 'b.jpg'));

    const mixed = spawnCLI(path.join(TEST_DIR, 'a.jpg'), path.join(TEST_DIR, 'sub', 'b.jpg'));
    const missing = spawnCLI(path.join(TEST_DIR, 'nope.jpg'));

    expect(mixed.status).toBe(1);
    expect(mixed.stderr).toContain('must all be in one folder');
    expect(missing.stderr).toContain('Not a file');
  });

  test('should summarize a folder with --stats without moving anything', async () => {
    await fs.outputFile(path.join(TEST_DIR, 'big.mov'), 'x'.repeat(5000));
    await fs.outputFile(path.join(TEST_DIR, 'a.pdf'), 'same');
    await fs.outputFile(path.join(TEST_DIR, 'a (1).pdf'), 'same');
    await fs.ensureFile(path.join(TEST_DIR, 'song.mp3.part'));

    const output = runCLI('-d', TEST_DIR, '--stats');

    expect(output).toContain(`${TEST_DIR}: 3 files, 4.9 KB`);
    expect(output).toMatch(/videos\s+1 file\s+4\.9 KB/);
    expect(output).toMatch(/documents\s+2 files\s+8 B/);
    expect(output).toMatch(/Biggest:\n\s+4\.9 KB {2}big\.mov/);
    expect(output).toContain('1 file (4 B) has the same content as another file.');
    expect(output).toContain('1 file would be left alone (still downloading).');
    expect(fs.existsSync(path.join(TEST_DIR, 'big.mov'))).toBe(true);
  });

  test('should report the version from package.json', () => {
    expect(runCLI('--version').trim()).toBe(version);
  });
});

describe('organizer', () => {
  test('formatDate uses the local calendar date', () => {
    expect(formatDate(new Date(2026, 0, 5, 0, 30))).toBe('2026-01-05');
  });

  test('getExtension keeps compound archive extensions', () => {
    expect(getExtension('backup.tar.gz')).toBe('.tar.gz');
    expect(getExtension('Photo.JPG')).toBe('.jpg');
    expect(getExtension('README')).toBe('');
  });

  test('validateName rejects paths and blanks', () => {
    expect(validateName(undefined)).toBeNull();
    expect(validateName('trip')).toBeNull();
    expect(validateName('  ')).toMatch(/empty/);
    expect(validateName('../x')).toMatch(/path/);
    expect(validateName('a\\b')).toMatch(/path/);
  });

  test('scanDirectory reports why files were left alone, keeping hidden ones quiet', async () => {
    for (const name of ['.DS_Store', '~$report.docx', 'movie.mp4.crdownload', 'debug.log', 'keep.txt']) {
      await fs.ensureFile(path.join(TEST_DIR, name));
    }
    const skipped = [];

    await scanDirectory(TEST_DIR, { ignore: ['*.log'], skipped });

    expect(skipped.sort((a, b) => (a.name < b.name ? -1 : 1))).toEqual([
      { name: 'debug.log', reason: 'matches an ignore pattern' },
      { name: 'movie.mp4.crdownload', reason: 'still downloading' },
      { name: '~$report.docx', reason: 'Office lock file' },
    ]);
  });

  test('copies sort after their original, so "report.pdf" is numbered before "report (1).pdf"', async () => {
    await fs.ensureFile(path.join(TEST_DIR, 'report (1).pdf'));
    await fs.ensureFile(path.join(TEST_DIR, 'report.pdf'));

    const files = await scanDirectory(TEST_DIR);

    expect(files.map((file) => file.name)).toEqual(['report.pdf', 'report (1).pdf']);
  });

  test('scanDirectory skips hidden files, folders, symlinks, clutter and unfinished downloads', async () => {
    const skipped = ['.DS_Store', 'package.json', 'Thumbs.db', '~$report.docx', 'movie.mp4.crdownload', 'song.mp3.part'];
    for (const name of ['b.jpg', 'a.mp3', 'A10.jpg', 'A9.jpg', 'IMG_0001.HEIC', ...skipped]) {
      await fs.ensureFile(path.join(TEST_DIR, name));
    }
    await fs.ensureDir(path.join(TEST_DIR, 'folder'));
    await fs.symlink(path.join(TEST_DIR, 'missing-target'), path.join(TEST_DIR, 'broken.lnk'));

    const files = await scanDirectory(TEST_DIR);

    expect(files.map((file) => file.name)).toEqual(['A9.jpg', 'A10.jpg', 'b.jpg', 'IMG_0001.HEIC', 'a.mp3']);
    expect(files[0]).toMatchObject({ name: 'A9.jpg', ext: '.jpg', category: 'images' });
    expect(files[0].modified.getTime()).toBeGreaterThan(0);
  });

  test('riskReason flags the home folder and the top of the disk', async () => {
    expect(await riskReason(os.homedir())).toBe('it is your home folder');
    expect(await riskReason(path.parse(TEST_DIR).root)).toBe('it is the top of the disk');
    expect(await riskReason(TEST_DIR)).toBeNull();
  });

  test('friendlyError explains common failures in words', () => {
    const coded = (code) => Object.assign(new Error(`${code}: something, rename '/a/very/long/path'`), { code });

    expect(friendlyError(coded('EACCES'))).toBe('permission denied');
    expect(friendlyError(coded('EBUSY'))).toBe('the file is open in another app');
    expect(friendlyError(coded('ENOSPC'))).toBe('the disk is full');
    expect(friendlyError(new Error('dest already exists.'))).toBe('a file with that name appeared in the meantime');
    expect(friendlyError(new Error('something odd'))).toBe('something odd');
  });

  test('customName keeps the extension whatever is typed', () => {
    const file = { name: 'Scan.PDF', ext: '.pdf' };

    expect(customName(file, 'passport')).toBe('passport.PDF');
    expect(customName(file, 'passport.pdf')).toBe('passport.pdf');
    expect(customName(file, 'my.report')).toBe('my.report.PDF');
    expect(customName({ name: 'README', ext: '' }, 'notes')).toBe('notes');
  });

  test('findProjectRoot finds the git project a folder belongs to', async () => {
    await fs.ensureDir(path.join(TEST_DIR, 'repo', '.git'));
    await fs.ensureDir(path.join(TEST_DIR, 'repo', 'assets', 'icons'));
    await fs.ensureDir(path.join(TEST_DIR, 'plain'));

    expect(await findProjectRoot(path.join(TEST_DIR, 'repo', 'assets', 'icons'))).toBe(path.join(TEST_DIR, 'repo'));
    expect(await findProjectRoot(path.join(TEST_DIR, 'plain'))).toBeNull();
  });

  test('planMoves numbers per folder and extension, skipping taken names case-insensitively', () => {
    const files = [
      { name: 'x.jpg', ext: '.jpg', category: 'images' },
      { name: 'y.jpg', ext: '.jpg', category: 'images' },
      { name: 'z.png', ext: '.png', category: 'images' },
    ];
    const existing = new Map([['images', new Set(['trip-1.jpg'])]]);

    const plan = planMoves('/root', files, { name: 'Trip', existing });

    expect(plan.map((move) => move.newName)).toEqual(['Trip-2.jpg', 'Trip-3.jpg', 'Trip-1.png']);
    expect(plan[0].destination).toBe(path.join('/root', 'images', 'Trip-2.jpg'));
  });

  test('planMoves with fileDates names files by their own day, earliest first', () => {
    const files = [
      { name: 'a.jpg', ext: '.jpg', category: 'images', modified: new Date(2024, 4, 2, 10) },
      { name: 'b.jpg', ext: '.jpg', category: 'images', modified: new Date(2024, 4, 1, 18) },
      { name: 'c.jpg', ext: '.jpg', category: 'images', modified: new Date(2024, 4, 1, 9) },
    ];

    const plan = planMoves('/root', files, { fileDates: true });

    expect(plan.map((move) => [move.name, move.newName])).toEqual([
      ['a.jpg', '2024-05-02-1.jpg'],
      ['b.jpg', '2024-05-01-2.jpg'],
      ['c.jpg', '2024-05-01-1.jpg'],
    ]);
  });

  test('planMoves with groupBy puts files in month or year subfolders of their category', () => {
    const files = [
      { name: 'a.jpg', ext: '.jpg', category: 'images', modified: new Date(2024, 11, 31) },
      { name: 'b.jpg', ext: '.jpg', category: 'images', modified: new Date(2025, 0, 1) },
    ];
    const existing = new Map([[path.join('images', '2024-12'), new Set(['x-1.jpg'])]]);

    const monthly = planMoves('/root', files, { groupBy: 'month', name: 'x', existing });
    const yearly = planMoves('/root', files, { groupBy: 'year', name: 'x', parent: 'Sorted' });

    expect(monthly.map((move) => path.join(move.folder, move.newName))).toEqual([
      path.join('images', '2024-12', 'x-2.jpg'),
      path.join('images', '2025-01', 'x-1.jpg'),
    ]);
    expect(yearly.map((move) => move.folder)).toEqual([path.join('Sorted', 'images', '2024'), path.join('Sorted', 'images', '2025')]);
  });

  test('planMoves with keepNames keeps each name and only numbers clashes', () => {
    const files = [
      { name: 'Photo.JPG', ext: '.jpg', category: 'images' },
      { name: 'backup.tar.gz', ext: '.tar.gz', category: 'archives' },
      { name: 'README', ext: '', category: 'others' },
    ];
    const existing = new Map([['images', new Set(['photo.jpg', 'photo-2.jpg'])]]);

    const plan = planMoves('/root', files, { keepNames: true, existing });

    expect(plan.map((move) => move.newName)).toEqual(['Photo-3.JPG', 'backup.tar.gz', 'README']);
  });

  test('a name written with a separate accent mark counts as taken, like the disk sees it', async () => {
    await fs.ensureFile(path.join(TEST_DIR, 'documents', 'café-1.pdf')); // "é" as e + accent
    await fs.ensureFile(path.join(TEST_DIR, 'menu.pdf'));

    const plan = await buildPlan(TEST_DIR, await scanDirectory(TEST_DIR), { name: 'café' }); // "é" as one character

    expect(plan[0].newName).toBe('café-2.pdf');
  });

  test('executePlan keeps going after a failed move', async () => {
    await fs.ensureFile(path.join(TEST_DIR, 'a.jpg'));
    await fs.ensureFile(path.join(TEST_DIR, 'b.jpg'));
    const plan = await buildPlan(TEST_DIR, await scanDirectory(TEST_DIR), { name: 'pic' });
    await fs.remove(path.join(TEST_DIR, 'a.jpg')); // disappears between planning and moving

    const results = await executePlan(plan);

    expect(results.map((result) => result.ok)).toEqual([false, true]);
    expect(fs.existsSync(path.join(TEST_DIR, 'images', 'pic-2.jpg'))).toBe(true);
  });

  test('executePlan never overwrites a file that appeared after planning', async () => {
    await fs.ensureFile(path.join(TEST_DIR, 'a.jpg'));
    const plan = await buildPlan(TEST_DIR, await scanDirectory(TEST_DIR), { name: 'pic' });
    await fs.outputFile(path.join(TEST_DIR, 'images', 'pic-1.jpg'), 'keep me');

    const [result] = await executePlan(plan);

    expect(result.ok).toBe(false);
    expect(fs.readFileSync(path.join(TEST_DIR, 'images', 'pic-1.jpg'), 'utf8')).toBe('keep me');
  });
});
