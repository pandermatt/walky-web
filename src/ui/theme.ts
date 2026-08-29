import { ORANGE, shadowOf, toCss, withAlpha } from '../palette';
import { TOUCH } from './appShell';

/**
 * The vocabulary every other surface spends: one set of custom properties, and
 * one set of button roles built out of them.
 *
 * The chrome grew one surface at a time, and each one arrived with its own copy
 * of everything -- three stylesheets defining eight button looks between them,
 * the same grey cell hand-copied with padding that had drifted to 5px, 7px 10px
 * and 5px 10px, and a press that dimmed to .4 in the toolbar and .3 everywhere
 * else. None of that was a decision; it was three transcriptions of one. This
 * module is the single copy, and a surface that wants a button now asks for a
 * role instead of restating the declarations.
 */

/**
 * Walky's accent, derived rather than picked.
 *
 * The tint has to be the app's own colour, and the app's own colour is the one
 * the path to a goal is drawn in -- ORANGE, straight from the 2016 palette. At
 * full strength it is a fill: a switch that is on, the lead-in behind a slider
 * knob, the circle under the armed tool, none of which carry text.
 *
 * As text it is unreadable -- #FFC800 on white is 1.4:1 -- so the text tint is
 * that same colour under `shadowOf`, which is Java's `Color.darker()` applied
 * twice: the operation that already derives the #1E1E1E background and the
 * shadow every wall casts. It comes out at rgb(124,98,0), which measures 5.8:1
 * on white. The accent is therefore one colour and its own shadow, not two
 * colours that happen to be near each other.
 */
const ACCENT = toCss(ORANGE);
const ACCENT_TEXT = toCss(shadowOf(ORANGE));
const ACCENT_TINT = withAlpha(ORANGE, 0.28);

export /*
 * Walky's typeface.
 *
 * Google Sans Flex, self-hosted. Every other surface in the app already commits
 * to a specific value rather than borrowing one -- the background is derived,
 * the wall colours are the original's rule, the accent is the path colour in
 * shadow -- and the type was the last thing still deferring to whatever the
 * device happened to have. `system-ui` meant Walky read as SF Pro on a Mac,
 * Segoe on Windows and Roboto on Android: three apps wearing one another's
 * clothes, and none of them Walky's.
 *
 * It is a variable font on one axis, weight, which is all a chrome of labels and
 * a wordmark asks for. The latin subset is 50KB against a 767KB bundle. The
 * width, optical-size, slant and rounded-terminal axes the family also carries
 * are pinned at their defaults by the subsetter; ROND in particular would suit a
 * chrome made entirely of capsules, and costs 20KB if it is ever wanted.
 *
 * Served from public/, so the precache list picks it up with the icons and the
 * offline guarantee stays true -- a font fetched from fonts.googleapis.com would
 * have quietly made "offline in the strong sense" a lie, and failed silently
 * rather than loudly, since there is no CSP to stop it. The URL is relative to
 * the document for the same reason the toolbar icons are: the app is built with
 * a relative base and can be served from a subpath.
 *
 * The fallback stack is kept and the range declared: before the file lands, if
 * it never lands, or for a character outside latin, the platform's own face
 * answers instead.
 */
const FONT_CSS = `
@font-face {
  font-family: 'Google Sans Flex';
  font-style: normal;
  font-weight: 100 1000;
  font-display: swap;
  src: url('./fonts/google-sans-flex-latin.woff2') format('woff2');
  unicode-range: U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA,
    U+02DC, U+0304, U+0308, U+0329, U+2000-206F, U+20AC, U+2122, U+2191, U+2193,
    U+2212, U+2215, U+FEFF, U+FFFD;
}
`;

export const THEME_CSS = `
:root {
  --wk-accent: ${ACCENT};
  --wk-accent-text: ${ACCENT_TEXT};
  --wk-accent-tint: ${ACCENT_TINT};

  --wk-ink: #1E1E1E;
  --wk-ink-dim: rgba(60, 60, 67, .6);
  --wk-hairline: rgba(60, 60, 67, .29);
  /* The edge a bright fill needs to have on white; see controls.ts. */
  --wk-fill-edge: rgba(0, 0, 0, .22);

  /* The three grounds: the bar's pane, a grouped cell, and the sheet behind it. */
  --wk-bar: #ECECEC;
  --wk-card: #FFFFFF;
  --wk-group: #F2F2F7;

  --wk-r-cell: 999px;
  --wk-r-card: 14px;
  --wk-r-group: 10px;

  /* One press feedback and one focus ring, everywhere. */
  --wk-press: .3;

  /*
   * The tap target. 44px is what a thumb needs; a pointer does not, and thirteen
   * 44px cells stacked in a column are taller than a short laptop window. So the
   * size follows the hand while the look does not: the cell is the same round,
   * transparent, tint-when-armed object either way.
   */
  --wk-tap: 40px;

  --wk-font-family: 'Google Sans Flex', system-ui, -apple-system, sans-serif;
  --wk-font: 13px/1.4 var(--wk-font-family);

  /* The toolbar's measured height, republished by ui/toolbar.ts on every resize
     so that the panel column and the update chip can clear whatever the bar
     wrapped to. Declared here at zero so the property always exists. */
  --wk-toolbar-h: 0px;

  /*
   * Liquid glass, as one recipe. saturate(180%) is the half that does the work:
   * blur alone gives frosted plastic, greyed and flat, and pushing the colour
   * back up is what makes a wall passing underneath bloom through. Where the
   * filter is unsupported the pane goes fully opaque instead -- see the @supports
   * blocks that pair with these, since a custom property cannot carry a fallback.
   */
  --wk-glass-edge: .5px solid rgba(0, 0, 0, .08);
  --wk-glass-shadow: inset 0 .5px 0 0 rgba(255, 255, 255, .7), 0 6px 20px rgba(0, 0, 0, .38);
  --wk-glass-blur: blur(20px) saturate(180%);
}

@media ${TOUCH} {
  :root { --wk-tap: 44px; }
}

/* One baseline, so anything that does not set its own font still gets Walky's. */
body { font-family: var(--wk-font-family); }
`;

/**
 * The button roles.
 *
 * Four of them, and every button in the app is one: an icon cell in a bar, a
 * tinted text button, the heavier text button a title bar carries, and a row
 * across a grouped card. What used to differ between copies -- the press, the
 * radius, the target size -- now comes from the properties above, so the
 * toolbar's press and the sheet's press are the same declaration.
 */
export const BUTTON_CSS = `
.wk-btn {
  appearance: none; -webkit-appearance: none;
  box-sizing: border-box; margin: 0;
  background: none; border: 0; border-radius: var(--wk-r-cell);
  font: inherit; color: inherit; text-align: inherit;
  cursor: pointer;
  transition: background-color .15s ease, opacity .15s ease;
}
/* Dimming, which is how iOS acknowledges a press; the 2016 icons are artwork
   and cannot be tinted, so the cell dims on their behalf. */
.wk-btn:active { opacity: var(--wk-press); }
.wk-btn:disabled { opacity: .4; cursor: default; }
/* Nothing here had a focus ring at all before. :focus-visible rather than
   :focus, so a pointer press does not leave one behind. */
.wk-btn:focus-visible {
  outline: 2px solid var(--wk-accent-text); outline-offset: 2px;
}
@media (prefers-reduced-motion: reduce) {
  .wk-btn { transition: none; }
}

/* An icon cell in a bar. The capsule around it is the object; only the armed
   tool wears a circle of its own. */
.wk-btn--cell {
  flex: 0 0 auto;
  width: var(--wk-tap); height: var(--wk-tap); padding: 7px;
  display: grid; place-items: center;
}
.wk-btn--cell img {
  width: 100%; height: 100%; object-fit: contain; image-rendering: auto;
}
.wk-btn--cell[aria-pressed="true"] { background: var(--wk-accent-tint); }

/* Tinted text, no box: what a control inside a bar looks like. */
.wk-btn--text {
  padding: 6px 10px; color: var(--wk-accent-text); font-weight: 600;
}

/* The same, at the weight and size a title bar wants. */
.wk-btn--bar {
  min-height: 34px; padding: 4px 10px;
  border-radius: 8px;
  color: var(--wk-accent-text); font-size: 17px; font-weight: 600;
}

/* An action across a grouped cell: tinted text the width of the card, with the
   card's own corners rather than any of its own. */
.wk-btn--row {
  display: block; width: 100%; min-height: var(--wk-tap);
  padding: 11px 16px; border-radius: 0;
  color: var(--wk-accent-text); font-size: 17px; text-align: left;
}
`;

/**
 * Adds a stylesheet to the head once, whoever asks and however often.
 *
 * Every component used to build its own `<style>` in its constructor, which is
 * one copy per instance of anything ever constructed twice, and no way for two
 * of them to share a rule. Keying on the id makes the injection idempotent and
 * makes "the theme is already there" something a module can simply assume.
 */
export function injectStyle(id: string, css: string): void {
  if (document.head.querySelector(`style[data-wk="${id}"]`)) return;
  const style = document.createElement('style');
  style.dataset.wk = id;
  style.textContent = css;
  document.head.appendChild(style);
}

/** Puts the tokens and the button roles in place. Safe to call from anywhere. */
export function installTheme(): void {
  // The face first: an @font-face the tokens then name.
  injectStyle('font', FONT_CSS);
  injectStyle('theme', THEME_CSS);
  injectStyle('buttons', BUTTON_CSS);
}
