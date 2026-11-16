import { readFileSync } from 'node:fs';

/** This package's version, read from its package.json (one folder up from both `src` and `dist`). */
export const VERSION: string = (
  JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as { version: string }
).version;
