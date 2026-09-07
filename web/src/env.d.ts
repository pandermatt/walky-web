/**
 * Walky's own version, substituted at build time from package.json by the
 * `define` in vite.config.ts.
 *
 * Deliberately not `__WALKY_VERSION__`: that name already belongs to the
 * service worker's build hash, which build/pwa.ts substitutes into a string
 * literal in src/sw.ts. Two different numbers under one name would be a trap
 * even though the two substitutions cannot actually collide.
 */
declare const __WALKY_APP_VERSION__: string;
