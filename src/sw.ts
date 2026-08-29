/**
 * Walky's service worker: the whole app, precached at install time.
 *
 * There is no backend and nothing is fetched from a third party, so "works
 * offline" is achievable outright rather than approximated -- every byte the
 * page can ask for is in the build output, and the build injects that exact
 * list below. Serving is therefore cache-first: a hit is authoritative, and the
 * network is only consulted for something the manifest did not anticipate.
 *
 * The two placeholders are replaced by the pwa() Vite plugin.
 */
export {};

const sw = self as unknown as ServiceWorkerGlobalScope;

/** Content hash of the whole build; a new build means a new cache. */
const VERSION: string = '__WALKY_VERSION__';
/**
 * Output-relative paths, injected by the build as a JSON string so that the
 * substitution survives whatever quoting the bundler settles on.
 */
const PRECACHE: string[] = JSON.parse('__WALKY_PRECACHE__');

const CACHE = `walky-${VERSION}`;
const CACHE_PREFIX = 'walky-';
/** The deployment root: sw.js sits next to index.html, whatever path it is served from. */
const BASE = new URL('./', sw.location.href);

sw.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    // `reload` skips the HTTP cache, so an install can never bake a stale copy
    // of an unhashed file (an icon, the manifest) into the offline snapshot.
    await cache.addAll(PRECACHE.map((path) => new Request(new URL(path, BASE), { cache: 'reload' })));
    await sw.skipWaiting();
  })());
});

sw.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const stale = (await caches.keys())
      .filter((key) => key.startsWith(CACHE_PREFIX) && key !== CACHE);
    await Promise.all(stale.map((key) => caches.delete(key)));
    await sw.clients.claim();

    // A page only ever hears from us once: either it can now be closed and
    // still work, or the copy it is running has been superseded on disk.
    const kind = stale.length > 0 ? 'walky-updated' : 'walky-offline-ready';
    for (const client of await sw.clients.matchAll({ type: 'window' })) {
      client.postMessage({ type: kind, version: VERSION });
    }
  })());
});

sw.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;
  if (new URL(request.url).origin !== sw.location.origin) return;

  // A navigation to any path inside the scope is the app: there is one page.
  if (request.mode === 'navigate') {
    event.respondWith(serveShell(request));
    return;
  }
  event.respondWith(serveAsset(request));
});

async function serveShell(request: Request): Promise<Response> {
  const cache = await caches.open(CACHE);
  const shell = await cache.match(new URL('index.html', BASE));
  if (shell) return shell;
  return fetch(request);
}

async function serveAsset(request: Request): Promise<Response> {
  const cache = await caches.open(CACHE);
  // Assets are content-hashed, so a hit is never stale; ignoreSearch keeps a
  // cache-busting query string from missing the copy we already hold.
  const hit = await cache.match(request, { ignoreSearch: true });
  if (hit) return hit;

  const response = await fetch(request);
  // Anything reached at runtime joins the snapshot, so the next visit needs it
  // no more than this one did.
  if (response.ok && response.type === 'basic') {
    await cache.put(request, response.clone());
  }
  return response;
}
