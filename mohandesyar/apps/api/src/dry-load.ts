/**
 * Child-process entry for the install "dry-load" step (docs/03 §8 step 6): imports a module from the
 * store with the production resolve hooks and validates its definition, without touching the database
 * or the running server. Exit code 0 = loadable.
 */
import 'reflect-metadata';
import { loadModuleFromStore } from './core/modules/loader.js';

const [storeDir, id, version] = process.argv.slice(2);
if (!storeDir || !id || !version) {
  console.error('usage: dry-load <storeDir> <id> <version>');
  process.exit(2);
}
loadModuleFromStore(storeDir, id, version)
  .then((m) => {
    process.stdout.write(JSON.stringify({ ok: true, id: m.id, version: m.version, controllers: (m.definition.controllers ?? []).length }) + '\n');
    process.exit(0);
  })
  .catch((err: unknown) => {
    process.stdout.write(JSON.stringify({ ok: false, error: (err as Error).message }) + '\n');
    process.exit(1);
  });
