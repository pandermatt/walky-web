import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import type { Plugin } from 'vite';

/**
 * Lets tools/wallpapers.html write the images it just drew into a directory.
 *
 * The same arrangement as ogWriter, and for the same reason: the pictures are
 * rendered in a browser, and a download would land twelve files in ~/Downloads
 * to be moved by hand. This takes them on one path and writes them to one place.
 *
 * It differs from ogWriter in that the filename comes from the request rather
 * than being a constant, because there is a set of them rather than one -- which
 * is the whole of the added risk, and is why the name is matched against a
 * pattern with no dot-segment and no slash in it before it is joined to
 * anything.
 *
 * The output directory is deliberately *not* public/. Walky's service worker
 * precaches everything under public/, so a wallpaper dropped there would be
 * pulled down in full the first time anyone opened the app -- twenty megabytes
 * against a 767KB bundle, to make an offline guarantee about files the app never
 * asks for. These are an artefact of the project rather than a part of it: they
 * are generated here, where the simulation that draws them lives, and committed
 * wherever they are served from.
 *
 * Dev only (`apply: 'serve'`), so nothing that ships can write anything.
 */
const ENDPOINT = '/__walky/wallpaper';

/** No slashes, no dot segments, no surprises. */
const NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*\.(png|webp)$/;

const MAGIC: Record<string, Buffer> = {
  png: Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  // RIFF....WEBP -- the four size bytes in between are skipped.
  webp: Buffer.from('RIFF'),
};

function looksRight(body: Buffer, extension: string): boolean {
  if (extension === 'webp') {
    return body.subarray(0, 4).equals(MAGIC.webp) && body.subarray(8, 12).toString() === 'WEBP';
  }
  return body.subarray(0, MAGIC.png.length).equals(MAGIC.png);
}

export function wallpaperWriter(outDir = 'wallpapers'): Plugin {
  return {
    name: 'walky-wallpaper-writer',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use(ENDPOINT, (req, res, next) => {
        if (req.method !== 'POST') {
          next();
          return;
        }
        const name = new URL(req.url ?? '', 'http://x').searchParams.get('name') ?? '';
        if (!NAME.test(name)) {
          res.statusCode = 400;
          res.end('bad name');
          return;
        }
        const chunks: Buffer[] = [];
        req.on('data', (chunk: Buffer) => chunks.push(chunk));
        req.on('end', () => {
          const body = Buffer.concat(chunks);
          if (!looksRight(body, name.split('.').pop() ?? '')) {
            res.statusCode = 400;
            res.end('not an image');
            return;
          }
          // resolve rather than join: WALKY_WALLPAPER_DIR is usually an absolute
          // path to another checkout, and join would bolt it onto this one.
          const target = resolve(server.config.root, outDir, name);
          mkdirSync(dirname(target), { recursive: true });
          writeFileSync(target, body);
          res.statusCode = 200;
          res.end(`${outDir}/${name} ${body.length}`);
        });
      });
    },
  };
}
