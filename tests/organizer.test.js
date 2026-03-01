const fs = require('fs-extra');
const path = require('path');
const { execSync } = require('child_process');

const TEST_DIR = path.resolve(__dirname, 'tmp-test');
const CLI_PATH = path.resolve(__dirname, '../bin/index.js');

describe('Smart Organizer CLI', () => {
  // Before each test, clean and create the test directory
  beforeEach(async () => {
    await fs.remove(TEST_DIR);
    await fs.ensureDir(TEST_DIR);
  });

  // After all tests, clean up
  afterAll(async () => {
    await fs.remove(TEST_DIR);
  });

  const runCLI = (args = '') => {
    return execSync(`node ${CLI_PATH} ${args}`, { encoding: 'utf8' });
  };

  test('should organize files into categorized folders', async () => {
    // 1. Create dummy files
    await fs.ensureFile(path.join(TEST_DIR, 'image.jpg'));
    await fs.ensureFile(path.join(TEST_DIR, 'video.mp4'));
    await fs.ensureFile(path.join(TEST_DIR, 'doc.pdf'));

    // 2. Run CLI
    runCLI(`-d ${TEST_DIR}`);

    // 3. Verify folders and files exist
    expect(fs.existsSync(path.join(TEST_DIR, 'images/image.jpg'))).toBe(true);
    expect(fs.existsSync(path.join(TEST_DIR, 'videos/video.mp4'))).toBe(true);
    expect(fs.existsSync(path.join(TEST_DIR, 'documents/doc.pdf'))).toBe(true);

    // 4. Verify original files are gone
    expect(fs.existsSync(path.join(TEST_DIR, 'image.jpg'))).toBe(false);
  });

  test('should organize files inside a parent folder if -p is provided', async () => {
    const PARENT_FOLDER = 'my-archive';
    await fs.ensureFile(path.join(TEST_DIR, 'image.png'));

    runCLI(`-d ${TEST_DIR} -p ${PARENT_FOLDER}`);

    expect(fs.existsSync(path.join(TEST_DIR, PARENT_FOLDER, 'images/image.png'))).toBe(true);
  });

  test('should put unknown extensions into "others"', async () => {
    await fs.ensureFile(path.join(TEST_DIR, 'something.xyz'));

    runCLI(`-d ${TEST_DIR}`);

    expect(fs.existsSync(path.join(TEST_DIR, 'others/something.xyz'))).toBe(true);
  });

  test('should rename file with a running number if it already exists in the target category', async () => {
    // 1. Setup: Create an existing file in the target directory
    await fs.ensureDir(path.join(TEST_DIR, 'images'));
    await fs.ensureFile(path.join(TEST_DIR, 'images/photo.jpg'));
    
    // 2. Setup: Create a new file with the same name in the root directory
    await fs.ensureFile(path.join(TEST_DIR, 'photo.jpg'));

    // 3. Run CLI
    runCLI(`-d ${TEST_DIR}`);

    // 4. Verify: Both files should exist in the 'images' folder
    expect(fs.existsSync(path.join(TEST_DIR, 'images/photo.jpg'))).toBe(true);
    expect(fs.existsSync(path.join(TEST_DIR, 'images/photo (1).jpg'))).toBe(true);
  });
});
