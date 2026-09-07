import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Plugin } from 'vite';

/**
 * Lets tools/ogImage.html write the share card it just drew straight into the
 * repository.
 *
 * The card is rendered in a browser, because that is the only place the app's
 * own typeface exists: Google Sans Flex ships as woff2, which fontconfig cannot
 * read, so the previous SVG-and-rsvg pipeline quietly set the wordmark in
 * whatever face the machine had lying around. A canvas in a page loads the real
 * file and `fillText` draws with it.
 *
 * That leaves the question of how the bytes get from the page to
 * public/images/og.png. A download would land the file in ~/Downloads and leave
 * a manual move -- the step where the wrong file gets committed. So the dev
 * server takes the PNG on one fixed path and writes it to one fixed place.
 *
 * Dev only (`apply: 'serve'`), so nothing that ships can write anything.
 */
const ENDPOINT = '/__walky/og.png';

/** The eight bytes every PNG starts with. */
const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

export function ogWriter(outFile = 'public/images/og.png'): Plugin {
  return {
    name: 'walky-og-writer',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use(ENDPOINT, (req, res, next) => {
        if (req.method !== 'POST') {
          next();
          return;
        }
        const chunks: Buffer[] = [];
        req.on('data', (chunk: Buffer) => chunks.push(chunk));
        req.on('end', () => {
          const png = Buffer.concat(chunks);
          // The destination is a constant, so there is no path to traverse; what
          // is worth checking is that the body is actually an image, rather than
          // truncating a committed asset to whatever arrived.
          if (!png.subarray(0, PNG_MAGIC.length).equals(PNG_MAGIC)) {
            res.statusCode = 400;
            res.end('not a PNG');
            return;
          }
          writeFileSync(join(server.config.root, outFile), png);
          res.statusCode = 200;
          res.end(`${outFile} ${png.length}`);
        });
      });
    },
  };
}
