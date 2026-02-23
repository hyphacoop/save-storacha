import { describe, test, expect } from '@jest/globals';
import fs from 'fs/promises';
import path from 'path';

const SRC_DIR = path.join(process.cwd(), 'src');
const LOGGER_FILE = path.join(SRC_DIR, 'lib', 'logger.js');
const CONSOLE_CALL_PATTERN = /\bconsole\.(?:log|info|warn|error|debug)\s*\(/g;

async function listJsFiles(dir) {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const files = await Promise.all(entries.map(async (entry) => {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      return listJsFiles(fullPath);
    }
    if (entry.isFile() && fullPath.endsWith('.js')) {
      return [fullPath];
    }
    return [];
  }));
  return files.flat();
}

describe('logging policy', () => {
  test('does not use console.* outside logger module', async () => {
    const files = await listJsFiles(SRC_DIR);
    const offenders = [];

    for (const file of files) {
      if (file === LOGGER_FILE) {
        continue;
      }

      const content = await fs.readFile(file, 'utf8');
      if (CONSOLE_CALL_PATTERN.test(content)) {
        offenders.push(path.relative(process.cwd(), file));
      }
      CONSOLE_CALL_PATTERN.lastIndex = 0;
    }

    expect(offenders).toEqual([]);
  });
});
