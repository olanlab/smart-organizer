# Smart Organizer CLI

![Build Status](https://img.shields.io/github/actions/workflow/status/olanlab/smart-organizer/pipeline.yml?branch=main)
![NPM Version](https://img.shields.io/npm/v/@olanlab/smart-organizer)
![License](https://img.shields.io/github/license/olanlab/smart-organizer)

Sort a messy folder (Downloads, Desktop, a photo import) into category folders, with a preview first and an undo afterwards.

## Quick start
```bash
npm install -g @olanlab/smart-organizer

org -d ~/Downloads           # preview every file's new place, then press enter to organize
org --undo -d ~/Downloads    # changed your mind? everything goes back
```

## What it does
*   **Sorts** each file into a category folder: `images`, `videos`, `audio`, `documents`, `archives`, `code`, `apps` or `others`, plus your own categories and filename rules.
*   **Renames** it to `<name>-<n><ext>`: today's date (`2026-09-11-1.jpg`), the day the file was last modified (`--file-date`), a name you choose (`--name trip`), or keeps the original name (`--keep-names`). Numbers continue after files already there, so nothing is ever overwritten.
*   **Shows you first.** In a terminal, `org` opens an interactive preview where you can skip files and change options before anything moves. `org -y` organizes right away.
*   **Undoes** what it did: `org --undo` puts the last run back (or the last few), `org --history` lists them, and `u` / `h` do the same in the preview.
*   **Spots duplicates**, like `report.pdf` and `report (1).pdf`, and can keep them apart.
*   **Watches** a folder and organizes new files as they arrive (`--watch`).
*   **Stays out of trouble.** It leaves alone hidden files, folders, symlinks, downloads still in progress (`.crdownload`, `.part`, …) and Office lock files (`~$report.docx`), and refuses to organize a git project, your home folder or the top of the disk unless you add `--force`.

## Interactive preview
```bash
org -d ~/Downloads
```

Running `org` in a terminal opens the preview. It lists every file with the name and folder it will get. Command-line options (`-p`, `--file-date`, …) become its starting values, and terminals 100 columns or wider also show each file's size and date. Press `?` for all keys.

The bottom bar keeps the important shortcuts visible, wrapping them into rows to fit the terminal. It changes with the current screen, and save/cancel or yes/no stay visible even while typing a long name. In help, use `↑` / `↓` or `PgUp` / `PgDn` to see every key on a small terminal; any other key closes help.

**Thai keyboards work too.** With the Thai Kedmanee layout active, use the same physical keys: `ื` (`n`) sets a name, `ำ` (`e`) renames one file, `ี` (`u`) undoes, `ๆ` (`q`) quits, `ฝ` (`/`) filters and `ฦ` (`?`) opens help. Confirm with `ั` (`y`) or cancel with `ื` (`n`). Shift shortcuts work too, including `ฌ` (`G`) and `ฮ` (`V`). Literal `/` and `?` still filter and open help. Names, folder paths and search text accept Thai characters normally, including vowel and tone marks.

| Moving around | |
| --- | --- |
| `↑` `↓` / `j` `k` | Move (`PgUp` `PgDn`, `g` / `G` jump) |
| `/` | Filter: name words, `@images` for a category, `>100mb` / `<1kb` for sizes, combined (`enter` keeps it, `esc` clears it) |
| `s` | Sort by category, name, newest or largest (also the numbering order) |
| `i` | Show the current file's full name, destination, size and modified time |
| `v` / `V` | Open the current file in its default app / open the folder (Finder, Explorer, …) |

| Choosing files | |
| --- | --- |
| `space` | Skip or include the current file |
| `a` | Skip or include every file shown |
| `c` | Skip or include the current file's category (e.g. all images) |
| `x` | What to do with duplicates (shown in yellow): keep, skip or separate |

| Names and folders | |
| --- | --- |
| `n` | Set the file name (leave empty for a date) |
| `o` | Keep original names on / off |
| `f` | Name by each file's modified date on / off |
| `e` | Give the current file a name of its own (its extension stays; empty resets it) |
| `p` | Type the destination path directly (`Tab` opens the same browser as `b`) |
| `b` | Browse destination folders; create and rename folders there |
| `m` | Date subfolders: none, by month, by year |
| `d` | Change the **source** folder to organize (`~`, relative paths and `Tab` completion work; `↑` `↓` go through recent folders) |
| `r` | Scan the folder again |

| Doing it | |
| --- | --- |
| `enter` | Organize the selected files (asks for confirmation) |
| `u` | Undo the last run in this folder |
| `h` | Show past runs; `enter` on one undoes it and every newer run |
| `q` / `esc` | Quit |

### Choosing and managing destination folders

`d` changes the **Source**, where the files come from. `b` chooses the **Destination**, where category folders such as `images` and `documents` will be created. For example, use `d` for `~/Downloads` and `b` for `~/Archive` to organize files from Downloads into Archive. The top of the preview shows both; **(same as source)** means category folders will be created inside the source folder.

Press `b` (Thai `ิ`) in the preview or results to open the folder browser. The path next to **Browse** is the folder you are looking inside; it becomes the destination only when you press `s` or `space`.

| In the folder browser | |
| --- | --- |
| `↑` / `↓` | Highlight a folder |
| `enter` / `→` | Open the highlighted folder |
| `←` / `backspace` | Go up one folder |
| `s` / `space` | Use the current folder as the destination, then return to the file preview |
| `n` (Thai `ื`) | Create a new folder here; type its name and press Enter |
| `e` (Thai `ำ`) | Rename the highlighted folder and keep its contents |
| `/` (Thai `ฝ`) | Type a folder path; `Tab` completes it |
| `r` | Refresh the folder list |
| `esc` / `q` | Return without choosing another destination |

For example: `b` → `n` → type `Sorted` → Enter → Enter to open it → `s` to use it. Files will be sorted into `Sorted/images`, `Sorted/documents`, etc. You can also type an absolute path or `~/Archive` with `p`, or use `/` in the browser to jump to an existing folder on another drive.

Creating or renaming a folder takes effect when you submit its name; cancelling the browser later does not undo that operation. Existing files and folders are never replaced. Renaming a destination also updates the current source folder's undo history, so its organized files can still be restored. The active source folder and its parents cannot be renamed from this session. The browser lists visible folders; hidden paths can be opened by typing them.

## Command line
```bash
org                          # preview and organize the current folder
org -d ~/Downloads           # same, for another folder
org -d ~/Downloads -y        # organize right away, without the preview
org ~/Downloads/*.pdf        # only these files (they must be in one folder)
```

Scripts, pipes and cron jobs (anything without a terminal) organize right away, as if `-y` was given. `org --help` lists every option, grouped:

| Where | |
| --- | --- |
| `-d, --dir <directory>` | Folder to organize (default: current folder) |
| `-p, --parent <directory>` | Destination root for categories: relative to the source, an absolute path, or `~/path` |
| `--group-by <period>` | Date subfolders inside each category: `month` (`images/2024-03`) or `year` (`images/2024`), by modified date |

| Naming | |
| --- | --- |
| `-n, --name <filename>` | Base name for renamed files instead of today's date |
| `-k, --keep-names` | Keep the original filenames, only sort into folders |
| `--file-date` | Name files by the day they were last modified (numbered oldest first) |

| Which files | |
| --- | --- |
| `--only <categories>` | Only organize these categories, e.g. `--only images,videos` |
| `-x, --exclude <patterns...>` | Leave files matching these patterns alone, e.g. `-x "*.log" "invoice-*"` |
| `--duplicates <mode>` | Files with the same content as another: `keep` (default), `skip` or `separate` |

| How to run | |
| --- | --- |
| `-y, --yes` | Organize right away, without the preview |
| `-t, --tui` | Open the preview (what plain `org` does in a terminal) |
| `--dry-run` | Print what would be moved without touching any files |
| `-w, --watch` | Keep running and organize new files as they arrive |
| `--notify` | With `--watch`, show a desktop notification for each batch (macOS, Linux) |
| `-q, --quiet` | Only print the summary, not a line per file |
| `--stats` | Show what is in the folder (sizes per category, biggest files, duplicates) without moving anything |
| `--force` | Organize even a git project, your home folder or the top of the disk |

| Undo | |
| --- | --- |
| `-u, --undo [runs]` | Put the files from the last run (or the last N runs) back under their original names |
| `--history` | List the recent runs in the folder |

| Settings | |
| --- | --- |
| `--config <file>` | Use another settings file |
| `--init-config` | Create a starter settings file (never overwrites) and show it |
| `--no-color` | Turn colors off (`NO_COLOR=1` works too) |
| `--completion <shell>` | Print a Tab-completion script for `zsh` or `bash` (see below) |

### Tab completion
```bash
# zsh
mkdir -p ~/.zfunc && org --completion zsh > ~/.zfunc/_org
# then in ~/.zshrc, before compinit: fpath=(~/.zfunc $fpath)

# bash
org --completion bash > ~/.org-completion.bash && echo 'source ~/.org-completion.bash' >> ~/.bashrc
```

### Recipes
```bash
org -p Archive -y                                   # the current folder, into Archive/, straight away
org -d ~/Downloads -p ~/Documents/Archive --keep-names # choose another destination, preview first
org -d ~/Pictures/import --name japan-trip --dry-run # see the names first
org -d ~/Pictures/import --file-date --group-by month # a photo library: images/2024-03/2024-03-14-1.jpg
org -d ~/Downloads --only images,videos             # just the photos and videos
org -d ~/Downloads --duplicates separate            # copies go to duplicates/, to review and delete
org -d ~/Downloads --stats                          # what is taking up space, and how much the copies waste
```

## Undo
Every run is recorded in a hidden `.org-history.json` in the organized folder (the last 20 runs). `org --history` lists them, `org --undo` puts the newest one back, and `org --undo 3` the last three. Folders left empty by an undo are removed. In the preview, `u` undoes the last run and `h` shows the history.

If a file cannot be restored (for example, a new file has its original name), the remaining moves stay in history. Fix the conflict, then retry `org --undo` or `u`. Undoing several runs stops at the first blocked run. In the preview, Ctrl+C finishes the file currently being moved or restored and saves history before closing.

## Watch mode
```bash
org --watch -d ~/Downloads
```
A file is moved only after its size and modified time have stayed the same for 2 seconds, so downloads and copies in progress are left alone. The folder is also checked every 10 seconds, in case the system misses a change (network drives). Each batch can be undone with `org --undo`. Stop with Ctrl+C.

## Duplicates
Files with exactly the same content as another one (`report.pdf` and `report (1).pdf`, or a PDF you already organized last week) are spotted and marked `(copy of …)`. Nothing is ever deleted; `--duplicates` decides where copies go:

*   `keep` (default): organized like any other file
*   `skip`: left where they are
*   `separate`: moved into a `duplicates` folder, ready to review and throw away

## Settings file
Options you always use, extra categories and files to skip can live in `~/.config/smart-organizer/config.json` (or `$XDG_CONFIG_HOME/smart-organizer/config.json`, `%APPDATA%\smart-organizer\config.json` on Windows). Run `org --init-config` to create a starter file.

```json
{
  "parent": "Sorted",
  "naming": "file-date",
  "categories": {
    "design": [".psd", ".fig", ".sketch"]
  },
  "rules": {
    "screenshots": ["Screenshot*", "Screen Shot*", "ภาพหน้าจอ*"],
    "invoices": ["invoice*", "*receipt*"]
  },
  "ignore": ["*.log"]
}
```

| Setting | Meaning |
| --- | --- |
| `parent` | Default for `--parent` |
| `naming` | `"date"` (default), `"file-date"` or `"keep-names"` |
| `duplicates` | `"keep"` (default), `"skip"` or `"separate"` |
| `groupBy` | `"month"` or `"year"` date subfolders (default: none) |
| `categories` | Extra category folders; an extension listed here moves out of its built-in category |
| `rules` | Folders chosen by filename pattern, checked before extensions (screenshots, invoices, …) |
| `ignore` | Filename patterns to leave alone (`*` and `?` wildcards, case-insensitive) |

A folder can have its own settings in a hidden `.orgrc.json` (same format), for example `{"duplicates": "separate"}` in Downloads and `{"groupBy": "month"}` in Pictures. They apply on top of the global file: plain settings are replaced, `categories` and `rules` are merged, `ignore` patterns are added. The preview shows `(folder settings)` when one is in use.

Command-line options always win: `--name trip` overrides `"naming"`, and `-p ""` turns off a default parent.

## Categories
*   **Images**: jpg, png, gif, svg, heic, avif, camera RAW (cr2, nef, arw, dng)...
*   **Videos**: mp4, mkv, mov, webm, m4v...
*   **Audio**: mp3, wav, flac, opus, aiff...
*   **Documents**: pdf, doc, txt, rtf, odt, pages, numbers, epub...
*   **Archives**: zip, rar, tar.gz, 7z, zst...
*   **Code**: js, ts, py, rb, rs, swift, yaml...
*   **Apps**: dmg, exe, pkg, msi, deb, apk, iso...
*   **Others**: anything else

## Install from source
Needs Node.js 20 or newer.

1.  Navigate to the project directory:
    ```bash
    cd smart-organizer
    ```

2.  Install dependencies:
    ```bash
    npm install
    ```

3.  Link the command globally (optional), so `org` runs this copy:
    ```bash
    npm link
    ```
    *Note: You might need `sudo` for this step. Adding `--ignore-scripts` keeps the Git hooks setup from running as root.*

4.  Unlink the global command (optional):
    ```bash
    npm unlink -g @olanlab/smart-organizer
    ```
    *If you linked with `sudo`, you might need `sudo` here as well.*

`node bin/index.js` works the same as `org` from a clone.
