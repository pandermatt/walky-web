/**
 * Which files the service worker precaches, kept free of Node imports so it can
 * be unit tested next to the rest of the simulation.
 *
 * The offline guarantee is only as good as this list: anything the app can ask
 * for at runtime and that is missing here is a blank icon -- or a blank page --
 * the first time someone opens Walky on a plane.
 */

/** The service worker's own filename in the build output. */
export const SW_FILE = 'sw.js';

/**
 * Files the host consumes rather than serves, or that no browser ever requests.
 * `_headers` and `_redirects` are Cloudflare Pages control files.
 */
const SKIP = new Set(['_headers', '_redirects', '.DS_Store']);

const stripLeadingSlash = (path: string) => path.replace(/^\.?\//, '');

/**
 * @param bundleFiles paths Rollup emitted, relative to the output directory.
 * @param publicFiles paths copied verbatim from `public/`, relative to it.
 * @returns a sorted, deduplicated list of output-relative paths to precache.
 */
export function buildPrecacheList(
  bundleFiles: Iterable<string>,
  publicFiles: Iterable<string>,
): string[] {
  const out = new Set<string>();
  for (const raw of [...bundleFiles, ...publicFiles]) {
    const path = stripLeadingSlash(raw);
    // The worker is fetched by the browser's own update check, never through
    // the cache; precaching it would pin the version that is trying to retire.
    if (!path || path === SW_FILE || path.endsWith('.map')) continue;
    if (SKIP.has(path.split('/').pop() ?? '')) continue;
    out.add(path);
  }
  return [...out].sort();
}
