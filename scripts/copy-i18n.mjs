import { cpSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();
const sourceDir = join(root, 'src', 'i18n', 'locales');
const targets = [
  join(root, 'dist', 'i18n', 'locales'),
  join(root, 'dist-electron', 'src', 'i18n', 'locales')
];

for (const target of targets) {
  mkdirSync(target, { recursive: true });
  cpSync(sourceDir, target, { recursive: true });
}
