import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';

/** Finds the API package root (works from src/ under tsx and from the bundled dist/). */
export function apiRoot(): string {
  let dir = import.meta.dirname;
  for (let i = 0; i < 6; i++) {
    if (existsSync(join(dir, 'migrations', 'core'))) return dir;
    dir = dirname(dir);
  }
  throw new Error('cannot locate api root (migrations/core)');
}
