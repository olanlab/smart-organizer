const { wantsTui, undoCommand, parseOnly, resolveSettings, categorySummary } = require('../src/cli');
const { DEFAULT_CATEGORIES } = require('../src/organizer');
const { notifyCommand } = require('../src/notify');

describe('org command decisions', () => {
  test('plain org opens the TUI in a terminal and organizes right away elsewhere', () => {
    expect(wantsTui({}, true)).toBe(true);
    expect(wantsTui({ dir: '~/Downloads', parent: 'Sorted' }, true)).toBe(true);
    expect(wantsTui({}, false)).toBe(false);
  });

  test('--yes, --dry-run and --watch skip the TUI, --tui always opens it', () => {
    expect(wantsTui({ yes: true }, true)).toBe(false);
    expect(wantsTui({ dryRun: true }, true)).toBe(false);
    expect(wantsTui({ watch: true }, true)).toBe(false);
    expect(wantsTui({ tui: true }, false)).toBe(true);
  });

  test('undoCommand is short for the current folder and quoted when needed', () => {
    expect(undoCommand('/a/b', '/a/b')).toBe('org --undo');
    expect(undoCommand('/a/b', '/c')).toBe('org --undo -d /a/b');
    expect(undoCommand('/a/my \'files\'', '/c')).toBe('org --undo -d \'/a/my \'\\\'\'files\'\\\'\'\'');
  });

  test('parseOnly accepts known categories in any case and rejects typos', () => {
    expect(parseOnly('Images, videos', DEFAULT_CATEGORIES)).toEqual(['images', 'videos']);
    expect(parseOnly(undefined, DEFAULT_CATEGORIES)).toBeNull();
    expect(() => parseOnly('imgs', DEFAULT_CATEGORIES)).toThrow(/Unknown category "imgs"/);
  });

  test('command-line naming wins over the settings file, which fills in the rest', () => {
    const config = { parent: 'Sorted', naming: 'keep-names', duplicates: 'separate', ignore: ['*.log'] };

    const fromFile = resolveSettings({}, config);
    const fromCli = resolveSettings({ name: 'trip', parent: '', exclude: ['*.tmp'] }, config);

    expect(fromFile).toMatchObject({ parent: 'Sorted', keepNames: true, duplicates: 'separate', ignore: ['*.log'] });
    expect(fromCli).toMatchObject({ parent: '', name: 'trip', keepNames: false, ignore: ['*.log', '*.tmp'] });
  });

  test('notifications use osascript on macOS and notify-send on Linux, quoting safely', () => {
    const [command, args] = notifyCommand('Organized 2 files in "Downloads"', 'darwin');

    expect(command).toBe('osascript');
    expect(args[1]).toBe('display notification "Organized 2 files in \\"Downloads\\"" with title "Smart Organizer"');
    expect(notifyCommand('hi', 'linux')).toEqual(['notify-send', ['Smart Organizer', 'hi']]);
    expect(notifyCommand('hi', 'win32')).toBeNull();
  });

  test('completion scripts come from the options and are valid shell', () => {
    const { Option } = require('commander');
    const { spawnSync } = require('child_process');
    const { completionScript } = require('../src/completion');
    const options = [
      new Option('-d, --dir <directory>', 'Directory to organize'),
      new Option('--duplicates <mode>', 'What to do with [copies]').choices(['keep', 'skip']),
      new Option('-k, --keep-names', 'Keep the file\'s own name'),
    ];

    const zsh = completionScript('zsh', options);
    const bash = completionScript('bash', options);

    expect(zsh).toContain('\'(-d --dir)\'{-d,--dir}\'[Directory to organize]:folder:_files -/\'');
    expect(zsh).toContain('\'--duplicates[What to do with copies]:value:(keep skip)\'');
    expect(bash).toContain('--duplicates) COMPREPLY=($(compgen -W "keep skip" -- "$cur")); return ;;');
    expect(bash).toContain('compgen -W "-d --dir --duplicates -k --keep-names"');
    expect(spawnSync('bash', ['-n'], { input: bash }).status).toBe(0);
    const zshCheck = spawnSync('zsh', ['-n'], { input: zsh });
    if (!zshCheck.error) expect(zshCheck.status).toBe(0); // zsh isn't on every CI machine
  });

  test('categorySummary lists the biggest categories first', () => {
    const moves = [{ category: 'documents' }, { category: 'images' }, { category: 'images' }];

    expect(categorySummary(moves)).toBe('images 2 · documents 1');
  });
});
