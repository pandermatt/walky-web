import { BACKGROUND, toCss } from '../palette';

/**
 * Recording the map to a video file.
 *
 * The 2016 original had a Record button too, and behind it a window asking for a
 * resolution and a folder; it then wrote frame0.jpg, frame1.jpg and so on, one
 * image per map change, forever. Its own dialog carried three warnings in red
 * admitting what that meant: the zoom you were looking at was ignored, and what
 * you got was an image sequence rather than a movie. Neither is true here. One
 * tap gives one file, at the size and zoom on screen.
 *
 * Three things about *how* are worth stating, because each one is load-bearing.
 *
 * The capture is a composite rather than one of the app's canvases. Walky paints
 * on two -- deck.gl's for the walls and the crowd, a 2D one over it for the
 * hulls and the rubber band -- and neither of them paints the ground, which is a
 * CSS background on the body. A capture of either alone would be half a picture
 * on nothing. So a third, offscreen canvas is filled with the background, has
 * the two drawn onto it, and is what the video is made of.
 *
 * Frames are pushed from App.render() rather than pulled by a loop of this
 * module's own. render/scene.ts forces deck's redraw synchronously -- it says so
 * there, and says it is for this -- so the moment render() returns is the one
 * moment both canvases are certainly showing the frame that was just built.
 * Reading them at any other time would depend on preserveDrawingBuffer, a
 * luma.gl default nothing in this app asserts and whose loss would produce two
 * minutes of empty background with no error anywhere.
 *
 * And the composite is repainted on every capture, even when nothing moved. A
 * canvas track only emits a frame when the canvas was painted since the last
 * one, so a still map would otherwise become a single frame of enormous
 * duration -- a file that players and editors handle badly. Repainting
 * unconditionally is what makes captureStream(FPS) a steady stream instead.
 *
 * What is *not* in the video: the toolbar, the panels, the chip and the toast
 * are DOM, and the settings sheet is a <dialog> in the top layer. None of them
 * can appear in a canvas capture. The recording is the map and nothing but the
 * map, which is what PedestrianPanel drew.
 *
 * The plops are in it, when the sound setting is on. audio/plops.ts hands over a
 * stream of its own -- built on the first recording rather than up front, so a
 * session that never records never carries a destination node keeping the audio
 * context awake -- and its track joins the canvas track in one stream. A
 * recording made with the sound off is video only rather than a track of
 * silence, which is a meter that never moves and bitrate spent on nothing.
 */

/**
 * Containers in the order they are wanted.
 *
 * mp4 first, because a .webm is refused by iMessage, previews as a download in
 * Slack and will not open in QuickTime -- "one video file" that half the places
 * you would send it cannot play is not the fix this was meant to be. Safari's
 * MediaRecorder emits mp4 and nothing else, so it has to be in the list
 * regardless. Three spellings of it because Chrome's parser has wanted the full
 * profile string where Safari accepts the bare type.
 */
const CONTAINERS = [
  'video/mp4;codecs=avc1.42E01E',
  'video/mp4;codecs=avc1',
  'video/mp4',
  'video/webm;codecs=vp9',
  'video/webm;codecs=vp8',
  'video/webm',
];

/** The same order with a voice for the plops: AAC in an mp4, Opus in a webm. */
const CONTAINERS_WITH_AUDIO = [
  'video/mp4;codecs=avc1.42E01E,mp4a.40.2',
  'video/mp4;codecs=avc1,mp4a.40.2',
  'video/mp4',
  'video/webm;codecs=vp9,opus',
  'video/webm;codecs=vp8,opus',
  'video/webm',
];

/** Frames a second. 60 doubles the encode cost for a picture the eye reads the same. */
const FPS = 30;

/**
 * Shortest gap between two composites. render() is reached both from the
 * simulation's own loop and from the coalesced repaint, and a 120Hz display
 * would otherwise composite a two-megapixel canvas 120 times a second to feed a
 * 30fps stream.
 */
const MIN_FRAME_MS = 1000 / FPS;

/** Longest a recording may run before it stops itself. */
export const MAX_MS = 120_000;

/**
 * Pixels a captured frame may come to, whatever shape the window is.
 *
 * An area rather than a long side, because a phone held upright at three device
 * pixels per CSS pixel is 1170x2532 -- more pixels than 1080p, while its long
 * side reads as the larger number. Area is what both the fill rate and the
 * bitrate actually care about.
 */
const MAX_CAPTURE_PIXELS = 1920 * 1080;

/**
 * Bits a second per pixel.
 *
 * The default a browser picks is around 2.5Mbit/s at any size, which mushes the
 * white ring around every pedestrian -- the only high-frequency detail in the
 * frame, and the thing worth protecting. 0.08 comes to 5Mbit/s at 1080p30, which
 * is generous for flat fills on a static background and still bounded: bitrate
 * times MAX_MS is the peak memory a recording holds, and this is about 75MB.
 */
const BITS_PER_PIXEL_SECOND = 0.08;
const MIN_BITRATE = 2_000_000;
const MAX_BITRATE = 12_000_000;

/**
 * How often the encoder hands over what it has. Not for memory -- it holds the
 * same bytes either way -- but because Safari has delayed the single final
 * handover by seconds when asked for no timeslice at all, which reads as a Stop
 * button that did not work.
 */
const CHUNK_MS = 1000;

/** How long a saved file's URL is kept alive after the click that used it. */
const REVOKE_AFTER_MS = 60_000;

function defaultIsTypeSupported(type: string): boolean {
  return typeof MediaRecorder !== 'undefined'
    && typeof MediaRecorder.isTypeSupported === 'function'
    && MediaRecorder.isTypeSupported(type);
}

/**
 * The container this browser will actually record, or null if it will not.
 *
 * @param withAudio picks from the list that names an audio codec as well. A
 *   container asked for without one and handed a sound track writes the picture
 *   and drops the sound on some browsers, silently.
 * @param isSupported injected so the preference order can be checked without a
 *   browser -- the tests run in plain Node, where MediaRecorder does not exist.
 */
export function pickMimeType(
  withAudio = false,
  isSupported: (type: string) => boolean = defaultIsTypeSupported,
): string | null {
  for (const type of withAudio ? CONTAINERS_WITH_AUDIO : CONTAINERS) {
    if (isSupported(type)) return type;
  }
  return null;
}

/**
 * Whether recording is possible at all. Answered before the button is ever
 * pressed, so a browser that cannot do it gets a disabled cell saying why rather
 * than a live one that fails on the click.
 */
export function canRecord(): boolean {
  return typeof MediaRecorder !== 'undefined'
    && typeof HTMLCanvasElement !== 'undefined'
    && typeof HTMLCanvasElement.prototype.captureStream === 'function'
    && pickMimeType() !== null;
}

/** Rounded to an even number, which H.264 requires of both dimensions. */
function even(n: number): number {
  return Math.max(2, Math.round(n / 2) * 2);
}

/** The size a window of `w`x`h` device pixels is recorded at: area-capped, and even. */
export function captureSize(w: number, h: number): { w: number; h: number } {
  const scale = Math.min(1, Math.sqrt(MAX_CAPTURE_PIXELS / (w * h)));
  return { w: even(w * scale), h: even(h * scale) };
}

/**
 * Where a `srcW`x`srcH` picture lands inside a `dstW`x`dstH` frame: as large as
 * it goes without distorting, centred, with the background showing either side.
 *
 * Needed because the window can be resized in the middle of a recording and the
 * video cannot change shape -- a track that changes dimensions mid-stream
 * produces files many players choke on. Letterboxing reads honestly as the
 * window having got narrower.
 */
export function fitRect(
  srcW: number, srcH: number, dstW: number, dstH: number,
): { x: number; y: number; w: number; h: number } {
  const scale = Math.min(dstW / srcW, dstH / srcH);
  const w = srcW * scale;
  const h = srcH * scale;
  return { x: (dstW - w) / 2, y: (dstH - h) / 2, w, h };
}

/**
 * A frame to record instead of the whole window, in CSS pixels from the canvas's
 * top-left corner -- the same space a pointer event arrives in.
 */
export interface CropRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * The crop as a source rectangle in one canvas's own device pixels, clamped to
 * what that canvas actually has.
 *
 * Per canvas rather than once for both, because the two do not agree to the
 * pixel: deck's buffer is sized by luma at `floor(css * dpr)` and the overlay's
 * by `Math.round`, so they can differ by one. Uncropped that never showed,
 * because drawing each whole canvas into the same box stretches the difference
 * away; cropping reads real coordinates out of both, and a shared rectangle
 * would slide the overlay half a pixel off the picture underneath it.
 *
 * Clamped rather than trusted because the window can be made smaller than the
 * frame mid-recording. A crop that has fallen off the edge comes back as a zero
 * width, which capture() treats as nothing to draw -- a held frame, rather than
 * an exception every time round the loop.
 */
export function cropSource(
  crop: CropRect,
  canvasW: number, canvasH: number,
  cssW: number, cssH: number,
): { sx: number; sy: number; sw: number; sh: number } {
  if (cssW <= 0 || cssH <= 0) return { sx: 0, sy: 0, sw: 0, sh: 0 };
  const kx = canvasW / cssW;
  const ky = canvasH / cssH;
  const left = Math.max(0, Math.min(canvasW, crop.x * kx));
  const top = Math.max(0, Math.min(canvasH, crop.y * ky));
  const right = Math.max(left, Math.min(canvasW, (crop.x + crop.w) * kx));
  const bottom = Math.max(top, Math.min(canvasH, (crop.y + crop.h) * ky));
  return { sx: left, sy: top, sw: right - left, sh: bottom - top };
}

/** `0:07`, `1:04`. */
export function formatElapsed(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const seconds = total % 60;
  return `${Math.floor(total / 60)}:${String(seconds).padStart(2, '0')}`;
}

/** Two digits, for a filename that sorts by when it was made. */
function pad(n: number): string {
  return String(n).padStart(2, '0');
}

/**
 * `walky-2016-05-13-142317.mp4`.
 *
 * @param mime read off the recorder after it was built rather than the string it
 *   was asked for: isTypeSupported is advisory, and a browser may normalise or
 *   substitute what it actually writes.
 */
export function recordingFilename(mime: string, at: Date): string {
  const extension = mime.includes('mp4') ? 'mp4' : 'webm';
  const stamp = [
    at.getFullYear(), '-', pad(at.getMonth() + 1), '-', pad(at.getDate()), '-',
    pad(at.getHours()), pad(at.getMinutes()), pad(at.getSeconds()),
  ].join('');
  return `walky-${stamp}.${extension}`;
}

/**
 * Hands a blob to the browser as a download -- the first one in the app, which
 * has otherwise always passed things over through the clipboard.
 *
 * Called from inside the click on Save rather than when the recording stopped:
 * a download that no gesture asked for is one Safari is entitled to refuse. The
 * URL outlives the click by a minute rather than being revoked straight after
 * it, which breaks on large blobs in Safari and Firefox.
 */
export function saveBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), REVOKE_AFTER_MS);
}

/**
 * A recording in progress.
 *
 * Deliberately without a clock of its own, a cap of its own, or any callback:
 * the app already runs a one-second interval to tick the readout, and letting
 * that same interval enforce the limit keeps this class a thing that composites
 * and encodes, with nothing to mock.
 */
export class Recorder {
  /** The offscreen canvas the two live ones are composited onto. */
  private canvas: HTMLCanvasElement | null = null;
  private ctx: CanvasRenderingContext2D | null = null;
  private stream: MediaStream | null = null;
  private rec: MediaRecorder | null = null;
  private chunks: Blob[] = [];
  /** performance.now() at the start, which the readout and the cap both read. */
  private startedAt = 0;
  private lastFrameAt = 0;
  /** The framed region, or null for the whole window. Fixed for the take. */
  private crop: CropRect | null = null;

  constructor(
    private deckCanvas: HTMLCanvasElement,
    private overlayCanvas: HTMLCanvasElement,
  ) {}

  get active(): boolean {
    return this.rec !== null;
  }

  get elapsedMs(): number {
    return this.rec === null ? 0 : performance.now() - this.startedAt;
  }

  /** The container actually being written, once started. */
  get mimeType(): string {
    return this.rec?.mimeType ?? '';
  }

  /**
   * @param audio the plops, or null for a silent recording. Its track is joined
   *   to the picture's rather than replacing the stream, and it is deliberately
   *   never stopped on teardown: it belongs to the audio graph, and ending it
   *   would leave the next recording with a dead one.
   * @param crop the region to record, in CSS pixels, or null for everything.
   *   Held in screen space for the whole take rather than followed in world
   *   space: it is where the camera is pointed, so panning the map moves the
   *   crowd through the shot instead of dragging the shot after it. It is also
   *   the only reading under which the frame keeps the shape the video was
   *   opened with -- see fitRect.
   * @throws if the browser refuses the recorder anyway -- isTypeSupported saying
   *   yes is not a promise the constructor will accept it.
   */
  start(audio: MediaStream | null = null, crop: CropRect | null = null): void {
    if (this.rec) return;

    // Sound is the part that gives way. A browser that will write the picture but
    // knows no container with a voice in it gets a silent recording rather than
    // an error, which is the same bargain the plops themselves make.
    let sound = audio?.getAudioTracks() ?? [];
    let mime = pickMimeType(sound.length > 0);
    if (!mime && sound.length > 0) {
      sound = [];
      mime = pickMimeType(false);
    }
    if (!mime) throw new Error('this browser cannot record video');

    const source = this.deckCanvas;
    if (source.width === 0 || source.height === 0) {
      throw new Error('there is nothing on screen to record yet');
    }

    // The output takes the frame's shape, not the window's, so a doorway framed
    // tall is a tall video rather than a tall region letterboxed into a wide one.
    const src = this.sourceRect(source, crop);
    if (src.sw < 2 || src.sh < 2) throw new Error('that frame is too small to record');
    const size = captureSize(src.sw, src.sh);
    const canvas = document.createElement('canvas');
    canvas.width = size.w;
    canvas.height = size.h;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('this browser cannot composite the two canvases');

    const stream = canvas.captureStream(FPS);
    const tracks = sound.length > 0
      ? new MediaStream([...stream.getVideoTracks(), ...sound])
      : stream;
    const bitrate = Math.round(size.w * size.h * FPS * BITS_PER_PIXEL_SECOND);
    const rec = new MediaRecorder(tracks, {
      mimeType: mime,
      videoBitsPerSecond: Math.min(MAX_BITRATE, Math.max(MIN_BITRATE, bitrate)),
    });

    this.canvas = canvas;
    this.ctx = ctx;
    this.stream = stream;
    this.rec = rec;
    this.chunks = [];
    this.startedAt = performance.now();
    this.lastFrameAt = 0;
    this.crop = crop;

    rec.addEventListener('dataavailable', (event) => {
      if (event.data.size > 0) this.chunks.push(event.data);
    });
    rec.start(CHUNK_MS);

    // One frame immediately, so a recording stopped straight away is still a
    // file rather than nothing.
    this.capture();
  }

  /**
   * One frame, if enough time has passed for one.
   *
   * Called at the tail of App.render(), which is the only moment deck's
   * synchronous redraw is certainly the most recent thing to have touched the GL
   * canvas. Both drawImages are a texture copy on the GPU rather than a readback
   * -- getImageData is the call that would stall, and is not made.
   */
  capture(): void {
    const ctx = this.ctx;
    const canvas = this.canvas;
    if (!ctx || !canvas) return;

    const now = performance.now();
    if (now - this.lastFrameAt < MIN_FRAME_MS) return;
    this.lastFrameAt = now;

    ctx.fillStyle = toCss(BACKGROUND);
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    const deck = this.deckCanvas;
    if (deck.width === 0 || deck.height === 0) return;
    const from = this.sourceRect(deck, this.crop);
    if (from.sw < 1 || from.sh < 1) return;

    // One destination box for both, from the picture's shape; each canvas brings
    // its own source rectangle, since only the shapes agree and not the pixels.
    const box = fitRect(from.sw, from.sh, canvas.width, canvas.height);
    ctx.drawImage(deck, from.sx, from.sy, from.sw, from.sh, box.x, box.y, box.w, box.h);
    const over = this.sourceRect(this.overlayCanvas, this.crop);
    // The overlay is the one on top on screen, so it is the one on top here.
    ctx.drawImage(
      this.overlayCanvas,
      over.sx, over.sy, over.sw, over.sh,
      box.x, box.y, box.w, box.h,
    );
  }

  /** A canvas's whole buffer, or the part of it the crop names. */
  private sourceRect(
    canvas: HTMLCanvasElement,
    crop: CropRect | null,
  ): { sx: number; sy: number; sw: number; sh: number } {
    if (!crop) return { sx: 0, sy: 0, sw: canvas.width, sh: canvas.height };
    return cropSource(crop, canvas.width, canvas.height, canvas.clientWidth, canvas.clientHeight);
  }

  /**
   * Stops, and resolves with the file once every chunk has arrived.
   *
   * On the stop event rather than the last dataavailable: the final chunk is
   * guaranteed to arrive first, and stop is the only point at which the list is
   * known to be complete.
   */
  stop(): Promise<Blob> {
    const rec = this.rec;
    if (!rec) return Promise.resolve(new Blob([]));

    return new Promise<Blob>((resolve, reject) => {
      const finish = () => {
        const blob = new Blob(this.chunks, { type: rec.mimeType });
        this.release();
        resolve(blob);
      };
      rec.addEventListener('stop', finish, { once: true });
      rec.addEventListener('error', () => {
        this.release();
        reject(new Error('the browser stopped recording'));
      }, { once: true });

      if (rec.state === 'inactive') finish();
      else rec.stop();
    });
  }

  /**
   * Lets go of the stream. Without stopping the tracks the canvas capture keeps
   * running for the life of the page, long after anything is reading it.
   *
   * The canvas stream only: the plops' track is the audio graph's, and stopping
   * it would end it for good rather than for this recording.
   */
  private release(): void {
    this.stream?.getTracks().forEach((track) => track.stop());
    this.rec = null;
    this.stream = null;
    this.canvas = null;
    this.ctx = null;
    this.chunks = [];
    this.crop = null;
  }
}
