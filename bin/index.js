#!/usr/bin/env node

const fs = require('fs-extra');
const path = require('path');
const chalk = require('chalk');
const { program } = require('commander');

program
  .name('org')
  .version('1.0.0')
  .description('A CLI to organize files into categorized folders')
  .option('-d, --dir <directory>', 'Directory to organize', '.')
  .option('-p, --parent <name>', 'Name of the parent folder to store categories (optional)')
  .action(async (options) => {
    const targetDir = path.resolve(options.dir);

    if (!fs.existsSync(targetDir)) {
      console.error(chalk.red(`Directory not found: ${targetDir}`));
      process.exit(1);
    }

    console.log(chalk.blue(`Organizing files in: ${targetDir}`));

    try {
      const files = await fs.readdir(targetDir);
      let movedCount = 0;

      for (const file of files) {
        const filePath = path.join(targetDir, file);
        const stats = await fs.stat(filePath);

        if (stats.isDirectory()) continue; // Skip directories
        if (file.startsWith('.')) continue; // Skip hidden files (like .DS_Store)
        if (file === 'index.js' || file === 'package.json' || file === 'package-lock.json') continue; // Skip self

        const ext = path.extname(file).toLowerCase();
        const category = getCategory(ext);

        if (category) {
          // If parent option is provided, join it with category
          const categoryPath = options.parent ? path.join(options.parent, category) : category;
          const categoryDir = path.join(targetDir, categoryPath);
          
          await fs.ensureDir(categoryDir);
          
          let finalDestPath = path.join(categoryDir, file);
          let finalFileName = file;

          // If file exists, generate a unique name
          if (await fs.pathExists(finalDestPath)) {
            const ext = path.extname(file);
            const base = path.basename(file, ext);
            let counter = 1;

            while (await fs.pathExists(finalDestPath)) {
              finalFileName = `${base} (${counter})${ext}`;
              finalDestPath = path.join(categoryDir, finalFileName);
              counter++;
            }
          }

          await fs.move(filePath, finalDestPath);
          
          console.log(chalk.green(`Moved: ${file} -> ${categoryPath}/${finalFileName}`));
          movedCount++;
        }
      }

      if (movedCount === 0) {
        console.log(chalk.yellow('No files needed organizing.'));
      } else {
        console.log(chalk.bold.green(`
Successfully organized ${movedCount} files!`));
      }

    } catch (err) {
      console.error(chalk.red('Error organizing files:'), err);
    }
  });

function getCategory(ext) {
  const categories = {
    images: ['.jpg', '.jpeg', '.png', '.gif', '.svg', '.webp', '.bmp', '.tiff'],
    videos: ['.mp4', '.mkv', '.mov', '.avi', '.wmv', '.flv'],
    audio: ['.mp3', '.wav', '.flac', '.ogg', '.m4a', '.aac'],
    documents: ['.pdf', '.doc', '.docx', '.txt', '.xls', '.xlsx', '.ppt', '.pptx', '.csv', '.md'],
    archives: ['.zip', '.rar', '.tar', '.gz', '.7z', '.bz2'],
    code: ['.js', '.ts', '.py', '.go', '.java', '.c', '.cpp', '.html', '.css', '.json', '.sh'],
    apps: ['.dmg', '.exe', '.app', '.pkg']
  };

  for (const [category, extensions] of Object.entries(categories)) {
    if (extensions.includes(ext)) {
      return category;
    }
  }

  return 'others'; // Default category
}

program.parse(process.argv);
