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

  test('should organize files into categorized folders and rename with date', async () => {
    // 1. Setup: Get today's date
    const today = new Date().toISOString().split('T')[0];
    
    // 2. Setup: Create dummy files
    await fs.ensureFile(path.join(TEST_DIR, 'image.jpg'));
    await fs.ensureFile(path.join(TEST_DIR, 'video.mp4'));

    // 3. Run CLI
    runCLI(`-d ${TEST_DIR}`);

    // 4. Verify: Files should be renamed in their categories
    expect(fs.existsSync(path.join(TEST_DIR, `images/${today}-1.jpg`))).toBe(true);
    expect(fs.existsSync(path.join(TEST_DIR, `videos/${today}-1.mp4`))).toBe(true);
  });

  test('should increment running number for multiple files in same category', async () => {
    const today = new Date().toISOString().split('T')[0];
    
    await fs.ensureFile(path.join(TEST_DIR, 'photo1.jpg'));
    await fs.ensureFile(path.join(TEST_DIR, 'photo2.jpg'));

    runCLI(`-d ${TEST_DIR}`);

    expect(fs.existsSync(path.join(TEST_DIR, `images/${today}-1.jpg`))).toBe(true);
    expect(fs.existsSync(path.join(TEST_DIR, `images/${today}-2.jpg`))).toBe(true);
  });

  test('should organize files inside a parent folder if -p is provided', async () => {
    const today = new Date().toISOString().split('T')[0];
    const PARENT_FOLDER = 'my-archive';
    await fs.ensureFile(path.join(TEST_DIR, 'image.png'));

    runCLI(`-d ${TEST_DIR} -p ${PARENT_FOLDER}`);

    expect(fs.existsSync(path.join(TEST_DIR, PARENT_FOLDER, `images/${today}-1.png`))).toBe(true);
  });

  test('should put unknown extensions into "others"', async () => {
    const today = new Date().toISOString().split('T')[0];
    await fs.ensureFile(path.join(TEST_DIR, 'something.xyz'));

    runCLI(`-d ${TEST_DIR}`);

    expect(fs.existsSync(path.join(TEST_DIR, `others/${today}-1.xyz`))).toBe(true);
  });
});
