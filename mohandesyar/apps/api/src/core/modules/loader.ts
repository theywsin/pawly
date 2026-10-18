import { join } from 'node:path';
import { parseManifest, type ModuleManifest } from '@mohandesyar/module-sdk';
import type { ModuleDefinition } from '@mohandesyar/module-sdk/server';
import { verifyInstalledDirectory } from '@mohandesyar/module-package';
import { installModuleResolveHooks, nativeLoad } from './hooks.js';

export interface LoadedModule {
  id: string;
  version: string;
  dir: string;
  manifest: ModuleManifest;
  definition: ModuleDefinition;
}

export function versionDir(storeDir: string, id: string, version: string): string {
  return join(storeDir, id, version);
}

/**
 * Loads one installed module version from the store: re-verifies every file against CHECKSUMS (detects
 * tampering on disk), then imports the backend entry and validates the exported definition.
 */
export async function loadModuleFromStore(storeDir: string, id: string, version: string): Promise<LoadedModule> {
  installModuleResolveHooks(storeDir);
  const dir = versionDir(storeDir, id, version);
  await verifyInstalledDirectory(dir);
  const { readFile } = await import('node:fs/promises');
  const parsed = parseManifest(JSON.parse(await readFile(join(dir, 'module.manifest.json'), 'utf8')));
  if (!parsed.ok) throw new Error(`invalid manifest: ${parsed.errors.join('; ')}`);
  const manifest = parsed.manifest;
  if (manifest.id !== id || manifest.version !== version) throw new Error(`store path does not match manifest (${manifest.id}@${manifest.version})`);
  const mod = nativeLoad(join(dir, manifest.backend.entry));
  const definition = (mod.default ?? mod.module) as ModuleDefinition | undefined;
  if (!definition || typeof definition !== 'object') throw new Error('backend entry must default-export defineModule({...})');
  const declaredId = (definition.manifest as { id?: string } | undefined)?.id;
  if (declaredId && declaredId !== id) throw new Error(`backend definition declares module "${declaredId}"`);
  for (const c of definition.controllers ?? []) if (typeof c !== 'function') throw new Error('controllers must be classes');
  for (const name of Object.keys(definition.publicServices ?? {})) {
    if (!manifest.provides.services.some((s) => s.name === name)) throw new Error(`public service "${name}" not declared in manifest.provides`);
  }
  for (const type of Object.keys(definition.eventHandlers ?? {})) {
    if (!manifest.events.consumes.some((e) => e.type === type)) throw new Error(`event handler for "${type}" not declared in manifest.events.consumes`);
  }
  return { id, version, dir, manifest, definition };
}
