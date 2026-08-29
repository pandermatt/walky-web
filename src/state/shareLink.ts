import {
  FLAG_DEFLATED, LIMITS, ScenarioLinkError,
  base64UrlToBytes, bodyFlags, bytesToBase64Url,
  decodeScenarioBody, encodeScenario, encodeScenarioBody,
  readHeader, scenarioHeader,
} from './codec';
import type { ScenarioCore } from './scenario';

/**
 * The map as a link, and back.
 *
 * The payload rides in the fragment rather than the query string. A fragment is
 * never sent in the request, so a large map never becomes a large request line
 * in somebody's access log, no host or CDN request limit applies to it, and
 * nothing about the map leaves the device -- which for a project whose README
 * says "no backend, no analytics and no third-party anything" is the point
 * rather than a detail. It also keeps every shared link the same URL as far as
 * the HTTP cache and the service worker are concerned.
 *
 * The fragment is parsed as `&`-separated `key=value`, so a second key can be
 * added later without breaking a link already pasted somewhere.
 */
export const LINK_KEY = 'm';
export const LINK_PREFIX = `#${LINK_KEY}=`;

/**
 * The length that works everywhere without thinking about it -- the old IE
 * address-bar limit, and therefore the number third-party link handling is
 * actually tested against. A realistic map lands well under it.
 */
export const LINK_SAFE_CHARS = 2000;

/**
 * Past Chromium's practical URL ceiling. A link this long is not a link any
 * more, and handing over one that silently fails to open is worse than saying so.
 */
export const LINK_MAX_CHARS = 32000;

/**
 * What an inflated body is allowed to come to.
 *
 * Deflate is the one step here that can turn a small input into a large output,
 * so the cap the codec applies to counts has to be matched by a cap on the bytes
 * those counts are read from -- otherwise a kilobyte of crafted zeroes becomes
 * hundreds of megabytes before the first count is ever checked.
 */
const MAX_BODY_BYTES = 1 << 20;

function hasCompression(): boolean {
  return typeof CompressionStream !== 'undefined' && typeof DecompressionStream !== 'undefined';
}

async function through(
  bytes: Uint8Array,
  stream: TransformStream<BufferSource, Uint8Array>,
  limit: number,
): Promise<Uint8Array> {
  const source = new Blob([bytes as BlobPart]).stream() as unknown as ReadableStream<BufferSource>;
  const reader = source.pipeThrough(stream).getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.length;
    // Checked per chunk rather than at the end, so a bomb is abandoned while it
    // is still small rather than after it has been held in full.
    if (total > limit) {
      await reader.cancel();
      throw new ScenarioLinkError('that link unpacks to more than Walky can hold');
    }
    chunks.push(value);
  }
  const out = new Uint8Array(total);
  let at = 0;
  for (const chunk of chunks) { out.set(chunk, at); at += chunk.length; }
  return out;
}

/**
 * The fragment for a map: `#m=` followed by base64url.
 *
 * The body is deflated only when that actually comes out shorter. The codec's
 * varints and deltas have already taken most of the redundancy out -- deflate
 * finds about a further fifth of what is left -- so on a small map its own
 * header can cost more than it saves. A browser without CompressionStream still
 * produces a working link, just a longer one.
 */
export async function encodeLink(core: ScenarioCore): Promise<string> {
  const raw = encodeScenario(core);
  if (!hasCompression()) return LINK_PREFIX + bytesToBase64Url(raw);

  try {
    const body = encodeScenarioBody(core);
    const deflated = await through(body, new CompressionStream('deflate-raw'), MAX_BODY_BYTES);
    if (deflated.length + 3 >= raw.length) return LINK_PREFIX + bytesToBase64Url(raw);
    const out = new Uint8Array(deflated.length + 3);
    out.set(scenarioHeader(FLAG_DEFLATED | bodyFlags(core)), 0);
    out.set(deflated, 3);
    return LINK_PREFIX + bytesToBase64Url(out);
  } catch {
    // Compression is an optimisation. Failing at it is not a reason to fail at
    // sharing.
    return LINK_PREFIX + bytesToBase64Url(raw);
  }
}

/**
 * A payload back into a map. Takes the value alone, as readSharedPayload returns
 * it, or a whole fragment, as someone pasting a link would have.
 */
export async function decodeLink(payload: string): Promise<ScenarioCore> {
  const text = payload.startsWith('#') ? (readSharedPayload(payload) ?? '') : payload.trim();
  if (text === '') throw new ScenarioLinkError('that does not look like a Walky link');

  const bytes = base64UrlToBytes(text);
  const { flags, body } = readHeader(bytes);
  if ((flags & FLAG_DEFLATED) === 0) {
    if (body.length > MAX_BODY_BYTES) throw new ScenarioLinkError('that link is larger than Walky can hold');
    return decodeScenarioBody(body, flags);
  }
  if (!hasCompression()) throw new ScenarioLinkError('this browser cannot unpack that link');
  let inflated: Uint8Array;
  try {
    inflated = await through(body, new DecompressionStream('deflate-raw'), MAX_BODY_BYTES);
  } catch (err) {
    if (err instanceof ScenarioLinkError) throw err;
    throw new ScenarioLinkError('that link is cut short or damaged');
  }
  return decodeScenarioBody(inflated, flags);
}

/**
 * The map's payload out of a fragment, or null when there is none.
 *
 * A pure string function so that `location` never has to enter a module the
 * tests can reach. Garbage is returned rather than filtered: the decoder is the
 * validator, and a parser that guessed would only make its errors vaguer.
 */
export function readSharedPayload(hash: string): string | null {
  const text = hash.startsWith('#') ? hash.slice(1) : hash;
  for (const part of text.split('&')) {
    const at = part.indexOf('=');
    if (at > 0 && part.slice(0, at) === LINK_KEY) {
      const value = part.slice(at + 1);
      return value === '' ? null : value;
    }
  }
  return null;
}

/** A URL with its fragment removed, query intact. */
export function stripHash(href: string): string {
  return href.split('#')[0];
}

/** The whole shareable URL for a map: this page, with the map in its fragment. */
export async function shareUrl(core: ScenarioCore, href: string): Promise<string> {
  return stripHash(href) + await encodeLink(core);
}

export { ScenarioLinkError, LIMITS };
