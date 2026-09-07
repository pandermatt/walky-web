import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import type { Plugin } from 'vite';
import { buildPrecacheList, SW_FILE } from './precache.ts';

/**
 * Injects the precache manifest into src/sw.ts at build time.
 *
 * The list has to be generated rather than written by hand: Rollup's filenames
 * carry a content hash, so they change on every meaningful edit, and a manifest
 * that drifts out of date is an app that half-loads offline. Files copied from
 * `public/` are read straight from disk, since Vite passes them through without
 * ever putting them in the bundle.
 */
export function pwa(publicDir = 'public'): Plugin {
  return {
    name: 'walky-pwa',
    apply: 'build',
    enforce: 'post',
    generateBundle(_options, bundle) {
      const worker = bundle[SW_FILE];
      if (!worker || worker.type !== 'chunk') {
        this.error(`expected ${SW_FILE} in the bundle -- is it still a rollup input?`);
        return;
      }

      const publicFiles = listFiles(publicDir);
      const files = buildPrecacheList(Object.keys(bundle), publicFiles);

      // Hash what is actually served. Bundle names already encode their own
      // content; public files do not, so their bytes go in instead. The worker
      // is served too, and a change to how it caches is as much a new snapshot
      // as a change to what it caches -- its code goes in while the
      // placeholders below still stand, so the hash does not depend on itself.
      const digest = createHash('sha256');
      digest.update(worker.code);
      for (const path of files) {
        digest.update(path);
        digest.update('\0');
        if (publicFiles.includes(path)) digest.update(readFileSync(join(publicDir, path)));
      }
      const version = digest.digest('hex').slice(0, 16);

      // The whole string literal is replaced, quotes included, because the
      // minifier is free to rewrite them -- it currently prefers backticks.
      worker.code = worker.code
        .replace(/(['"`])__WALKY_VERSION__\1/, () => JSON.stringify(version))
        .replace(/(['"`])__WALKY_PRECACHE__\1/, () => JSON.stringify(JSON.stringify(files)));

      if (worker.code.includes('__WALKY_')) {
        this.error('service worker placeholders were not substituted');
      }
      this.info(`precaching ${files.length} files as walky-${version}`);
    },
  };
}

/** Every file under `dir`, as paths relative to it and separated by `/`. */
function listFiles(dir: string): string[] {
  const out: string[] = [];
  const walk = (current: string) => {
    for (const entry of readdirSync(current)) {
      const full = join(current, entry);
      if (statSync(full).isDirectory()) walk(full);
      else out.push(relative(dir, full).split(sep).join('/'));
    }
  };
  walk(dir);
  return out;
}
