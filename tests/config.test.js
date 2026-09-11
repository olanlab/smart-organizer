const fs = require('fs-extra');
const os = require('os');
const path = require('path');
const { parseConfig, loadConfig, initConfig } = require('../src/config');
const { buildCategories, scanDirectory } = require('../src/organizer');

const TEST_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'org-config-'));

afterAll(async () => {
  await fs.remove(TEST_DIR);
});

describe('settings file', () => {
  test('normalizes extensions and keeps the known settings', () => {
    expect(parseConfig({ parent: 'Sorted', naming: 'file-date', categories: { design: ['PSD', '.Fig'] }, ignore: ['*.log'] }))
      .toEqual({ parent: 'Sorted', naming: 'file-date', categories: { design: ['.psd', '.fig'] }, ignore: ['*.log'] });
  });

  test.each([
    [[], /JSON object/],
    [{ catagories: {} }, /unknown setting "catagories"/],
    [{ naming: 'sometimes' }, /"naming" must be one of: date, file-date, keep-names/],
    [{ duplicates: 'delete' }, /"duplicates" must be one of: keep, skip, separate/],
    [{ groupBy: 'week' }, /"groupBy" must be one of: month, year/],
    [{ categories: { 'a/b': ['.x'] } }, /plain folder name/],
    [{ categories: { design: '.psd' } }, /must be a list/],
    [{ rules: { shots: 'Screenshot*' } }, /"rules.shots" must be a list like \["Screenshot\*"\]/],
    [{ ignore: '*.log' }, /list of filename patterns/],
  ])('rejects %j', (data, message) => {
    expect(() => parseConfig(data)).toThrow(message);
  });

  test('a missing file means no settings, a broken one names the file', async () => {
    const broken = path.join(TEST_DIR, 'broken.json');
    await fs.outputFile(broken, '{ nope');

    expect(await loadConfig(path.join(TEST_DIR, 'missing.json'))).toEqual({});
    await expect(loadConfig(broken)).rejects.toThrow(`Problem in settings file ${broken}: `);
  });

  test('initConfig writes a starter file once and never overwrites it', async () => {
    const file = path.join(TEST_DIR, 'nested', 'config.json');

    const first = await initConfig(file);
    await fs.outputJson(file, { naming: 'keep-names' });
    const second = await initConfig(file);

    expect(first.created).toBe(true);
    expect(second.created).toBe(false);
    expect(await loadConfig(file)).toEqual({ naming: 'keep-names' });
  });
});

describe('recent folders', () => {
  const { MAX_RECENT, readRecent, rememberFolder, tildify } = require('../src/recent');

  test('are kept newest first, without repeats, up to a limit', async () => {
    process.env.XDG_CONFIG_HOME = path.join(TEST_DIR, 'recent-config');
    for (let i = 0; i < MAX_RECENT + 2; i++) await rememberFolder(`/folder/${i}`);
    await rememberFolder('/folder/5');

    const folders = await readRecent();

    expect(folders).toHaveLength(MAX_RECENT);
    expect(folders.slice(0, 2)).toEqual(['/folder/5', `/folder/${MAX_RECENT + 1}`]);
    expect(folders.filter((folder) => folder === '/folder/5')).toHaveLength(1);
  });

  test('tildify shortens paths in the home folder only', () => {
    expect(tildify(path.join(os.homedir(), 'Downloads'))).toBe(`~${path.sep}Downloads`);
    expect(tildify(os.homedir())).toBe('~');
    expect(tildify('/Volumes/USB')).toBe('/Volumes/USB');
  });
});

describe('custom categories', () => {
  test('extensions move to their custom category, which sorts before "others"', () => {
    const categories = buildCategories({ design: ['.psd', '.png'], others: ['.jpeg'] });

    expect(categories.of('mockup.PSD')).toBe('design');
    expect(categories.of('shot.png')).toBe('design');
    expect(categories.of('photo.jpg')).toBe('images');
    expect(categories.of('scan.jpeg')).toBe('others');
    expect(categories.order.slice(-2)).toEqual(['design', 'others']);
  });

  test('name rules win over extensions and get their own folder', () => {
    const categories = buildCategories({}, { screenshots: ['Screenshot*', 'ภาพหน้าจอ*'], invoices: ['invoice*'] });

    expect(categories.of('Screenshot 2026-09-11 at 10.23.45.png')).toBe('screenshots');
    expect(categories.of('ภาพหน้าจอ 2569-09-11 เวลา 10.23.45.png')).toBe('screenshots');
    expect(categories.of('INVOICE-0921.pdf')).toBe('invoices');
    expect(categories.of('holiday.png')).toBe('images');
    expect(categories.order.slice(-3)).toEqual(['screenshots', 'invoices', 'others']);
  });

  test('a compound extension can have its own category', () => {
    expect(buildCategories({ backups: ['.tar.gz'] }).of('site.tar.gz')).toBe('backups');
    expect(buildCategories().of('site.tar.gz')).toBe('archives');
  });

  test('scanDirectory uses custom categories and skips ignored patterns', async () => {
    const dir = path.join(TEST_DIR, 'scan');
    for (const name of ['a.psd', 'b.jpg', 'server.LOG', 'notes-old.txt', 'notes.txt']) {
      await fs.ensureFile(path.join(dir, name));
    }

    const files = await scanDirectory(dir, { categories: buildCategories({ design: ['.psd'] }), ignore: ['*.log', '*-old.*'] });

    expect(files.map((file) => [file.name, file.category])).toEqual([
      ['b.jpg', 'images'],
      ['notes.txt', 'documents'],
      ['a.psd', 'design'],
    ]);
  });
});
