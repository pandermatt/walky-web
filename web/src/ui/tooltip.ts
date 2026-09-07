import { FINE } from './appShell';
import { injectStyle, installTheme } from './theme';

/**
 * The name of an icon, shown the moment a pointer enters it.
 *
 * The strip is thirteen pieces of 2016 artwork and no words, which is fine once
 * you know it and unreadable before then. `title` was the answer and is not one:
 * the browser holds it back for a second or two, so a pointer travelling along
 * the bar looking for the goal tool is never still long enough to be told
 * anything. What a pointer wants is the label now, and gone as soon as it leaves.
 *
 * One tip element for the whole app rather than one per button: only one can ever
 * be showing, and thirteen hidden capsules in the document is thirteen copies of
 * a thing that has no state of its own.
 *
 * It is `aria-hidden`. Every anchor already carries an `aria-label` -- the
 * accessible name is that, and a tooltip repeating it would have screen readers
 * say each button twice.
 */

/** The gap between an anchor and its tip, and the tip's margin from the edge. */
const GAP = 8;

export interface Rect { x: number; y: number; width: number; height: number }
export interface Size { width: number; height: number }

/**
 * Where the tip goes: to the right of its anchor, vertically centred on it.
 *
 * Right because that is where there is room. The strip is a column in the
 * top-left corner, so above and below a button are the buttons next to it, and
 * the map is off to the right. Installed on a phone the bar is along the bottom
 * instead -- but that device has no pointer, and the tip never shows there.
 *
 * Flipping is for the narrow window where the column's right edge and the
 * viewport's are close together; clamping is for the top and bottom of a tall
 * tip against a short window. Pure, and over plain numbers, so both are things
 * the tests can check without a browser.
 */
export function placeTip(anchor: Rect, tip: Size, view: Size): { x: number; y: number } {
  let x = anchor.x + anchor.width + GAP;
  if (x + tip.width > view.width - GAP) {
    const left = anchor.x - GAP - tip.width;
    // Only flip if the left side is genuinely better; against a viewport too
    // narrow for either side the clamp below is what keeps the tip on screen.
    if (left >= GAP) x = left;
  }
  x = Math.min(Math.max(x, GAP), Math.max(GAP, view.width - GAP - tip.width));

  let y = anchor.y + (anchor.height - tip.height) / 2;
  y = Math.min(Math.max(y, GAP), Math.max(GAP, view.height - GAP - tip.height));
  return { x, y };
}

export const TOOLTIP_CSS = `
/*
 * The same pane the toolbar's capsules are made of, at label size. It follows
 * the bar rather than inverting against it: a dark tip beside a light strip
 * would be a second material for no reason.
 */
#wk-tip {
  position: fixed; top: 0; left: 0; z-index: 20;
  /* Never takes the pointer: the tip sits next to what you are hovering, and a
     tip that could be hovered would flicker the moment it appeared under one. */
  pointer-events: none;
  padding: 5px 9px;
  border-radius: 8px;
  font: var(--wk-font); font-weight: 500; white-space: nowrap;
  color: var(--wk-ink);
  background: var(--wk-bar);
  border: var(--wk-glass-edge);
  box-shadow: var(--wk-glass-shadow);
  opacity: 0; visibility: hidden;
  transition: opacity .08s ease;
}
@supports (backdrop-filter: blur(1px)) or (-webkit-backdrop-filter: blur(1px)) {
  #wk-tip {
    background: rgba(236, 236, 236, .82);
    -webkit-backdrop-filter: var(--wk-glass-blur);
    backdrop-filter: var(--wk-glass-blur);
  }
}
/* No delay in either direction -- the whole point is that it answers while the
   pointer is still moving. The fade is only so it does not snap. */
#wk-tip[data-show] { opacity: 1; visibility: visible; }
@media (prefers-reduced-motion: reduce) {
  #wk-tip { transition: none; }
}
`;

let tip: HTMLDivElement | null = null;
/** Which anchor the tip is currently showing for, so a stale hide is ignored. */
let shownFor: HTMLElement | null = null;

function element(): HTMLDivElement {
  if (tip) return tip;
  installTheme();
  injectStyle('tooltip', TOOLTIP_CSS);
  tip = document.createElement('div');
  tip.id = 'wk-tip';
  tip.setAttribute('role', 'tooltip');
  tip.setAttribute('aria-hidden', 'true');
  document.body.appendChild(tip);

  // A tip pinned to a viewport position is wrong the instant anything moves it,
  // and the strip itself scrolls when the window is short. Capture, because the
  // scroll happens on the capsule column rather than on the window.
  const hideAll = () => hide();
  window.addEventListener('scroll', hideAll, true);
  window.addEventListener('resize', hideAll);
  window.addEventListener('keydown', (ev) => { if (ev.key === 'Escape') hide(); });
  return tip;
}

function hide(anchor?: HTMLElement): void {
  if (!tip) return;
  if (anchor && shownFor !== anchor) return;
  tip.removeAttribute('data-show');
  shownFor = null;
}

function show(anchor: HTMLElement, text: string): void {
  // Asked here rather than once at startup: a hybrid laptop answers differently
  // depending on which input the person last used.
  if (!window.matchMedia(FINE).matches) return;
  if (anchor instanceof HTMLButtonElement && anchor.disabled) return;

  const el = element();
  el.textContent = text;
  // Shown before measuring: a hidden element still lays out, but only once it
  // holds this text, so the width read below is this label's and not the last one's.
  el.setAttribute('data-show', '');
  shownFor = anchor;

  const a = anchor.getBoundingClientRect();
  const t = el.getBoundingClientRect();
  const { x, y } = placeTip(
    { x: a.x, y: a.y, width: a.width, height: a.height },
    { width: t.width, height: t.height },
    { width: window.innerWidth, height: window.innerHeight },
  );
  el.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px)`;
}

/**
 * Names `el` while a pointer is over it, or while it holds keyboard focus.
 *
 * Touch is left out on purpose rather than by omission: there is no hover to
 * hang a tip on, and showing one on tap would put a label over the map at the
 * exact moment the tap was meant to do something.
 */
export function attachTooltip(el: HTMLElement, text: string): void {
  el.addEventListener('pointerenter', (ev) => {
    // A pen hovers and a touch does not; a mouse is the case this is for, and
    // the one where a stray tip cannot end up stranded by a lifted finger.
    if (ev.pointerType === 'mouse') show(el, text);
  });
  el.addEventListener('pointerleave', () => hide(el));
  // A press is an answer to "what is this", so the tip has said its piece.
  el.addEventListener('pointerdown', () => hide(el));
  el.addEventListener('focus', () => {
    // Tabbing to a button should name it; clicking one already got the pointer
    // tip and does not need a second that outlives the pointer leaving.
    if (el.matches(':focus-visible')) show(el, text);
  });
  el.addEventListener('blur', () => hide(el));
}
