# Smart Organizer CLI

A simple CLI tool to organize your files into categorized folders automatically.

## Installation

1.  Navigate to the project directory:
    ```bash
    cd smart-organizer
    ```

2.  Install dependencies:
    ```bash
    npm install
    ```

3.  Link the command globally (optional):
    ```bash
    npm link
    ```
    *Note: You might need `sudo` for this step.*

## Usage

### Run directly with Node.js
```bash
node bin/index.js -d <path-to-folder> -p <parent-folder-name>
```

### If linked globally
```bash
org -d <path-to-folder> -p <parent-folder-name>
```

### Examples
Organize the current directory into a folder named "Archive":
```bash
org -p Archive
```

Organize a specific downloads folder:
```bash
org -d ~/Downloads -p SortedFiles
```

## Categories supported
*   **Images**: jpg, png, gif, svg...
*   **Videos**: mp4, mkv, avi...
*   **Audio**: mp3, wav...
*   **Documents**: pdf, doc, txt...
*   **Archives**: zip, rar...
*   **Code**: js, py, html...
*   **Apps**: dmg, exe...
