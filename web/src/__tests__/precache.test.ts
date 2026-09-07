import { describe, expect, it } from 'vitest';
import { buildPrecacheList, SW_FILE } from '../../build/precache';

describe('buildPrecacheList', () => {
  it('keeps every emitted asset so nothing is fetched on first offline load', () => {
    const files = buildPrecacheList(
      ['index.html', 'assets/main-a1b2c3.js', 'assets/main-d4e5f6.css'],
      ['icons/start.png', 'images/icon-192.png', 'manifest.webmanifest'],
    );
    expect(files).toEqual([
      'assets/main-a1b2c3.js',
      'assets/main-d4e5f6.css',
      'icons/start.png',
      'images/icon-192.png',
      'index.html',
      'manifest.webmanifest',
    ]);
  });

  it('leaves the worker out of its own manifest', () => {
    expect(buildPrecacheList([SW_FILE, 'index.html'], [])).toEqual(['index.html']);
  });

  it('drops host control files and source maps, which no page requests', () => {
    const files = buildPrecacheList(
      ['index.html', 'assets/main-a1b2c3.js.map'],
      ['_headers', '_redirects', '.DS_Store'],
    );
    expect(files).toEqual(['index.html']);
  });

  it('normalises leading slashes and deduplicates', () => {
    expect(buildPrecacheList(['./index.html', '/index.html'], ['index.html']))
      .toEqual(['index.html']);
  });
});
