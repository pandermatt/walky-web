import { describe, expect, it } from 'vitest';
import { ORANGE, WHITE, contrastRatio, shadowOf, toHex } from '../palette';
import { BUTTON_CSS, THEME_CSS } from '../ui/theme';
import { CONTROLS_CSS } from '../ui/controls';
import { SHEET_CSS } from '../ui/settingsSheet';
import { TOOLBAR_CSS } from '../ui/toolbar';
import { CONTEXT_CSS } from '../ui/contextPanel';
import { TOAST_CSS } from '../pwa';

/**
 * The chrome's stylesheets are plain strings, so the things that would otherwise
 * only be visible in a browser -- a misspelt custom property, a hex that crept
 * back in, an accent nobody can read -- are checkable here without one.
 */

const ALL_CSS = [
  THEME_CSS, BUTTON_CSS, CONTROLS_CSS, SHEET_CSS, TOOLBAR_CSS, CONTEXT_CSS, TOAST_CSS,
].join('\n');

describe('the accent', () => {
  it('is the path-to-goal orange put in shadow', () => {
    expect(toHex(shadowOf(ORANGE))).toBe('#7C6200');
  });

  it('is readable as text on both grounds it is written on', () => {
    const ink = shadowOf(ORANGE);
    // White cells, and the grouped-list ground behind them.
    expect(contrastRatio(ink, WHITE)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(ink, [242, 242, 247])).toBeGreaterThanOrEqual(4.5);
  });

  it('is not readable undarkened, which is why it is only ever a fill', () => {
    expect(contrastRatio(ORANGE, WHITE)).toBeLessThan(3);
  });
});

describe('contrastRatio', () => {
  it('matches the WCAG worked examples', () => {
    expect(contrastRatio(WHITE, [0, 0, 0])).toBeCloseTo(21, 5);
    // #767676 is the canonical "just passes on white" grey.
    expect(contrastRatio([118, 118, 118], WHITE)).toBeCloseTo(4.54, 2);
  });
});

describe('the stylesheets', () => {
  it('have retired every hand-copied colour they used to share', () => {
    // The blue and green were iOS's; the greys were the 2016 Swing chrome. Each
    // one existed in three places, which is what this test is here to prevent
    // happening again.
    for (const dead of ['#007AFF', '#34C759', '#F7F7F7', '#B4B4B4', '#9A9A9A']) {
      expect(ALL_CSS.toUpperCase()).not.toContain(dead);
    }
  });

  it('declare each --wk- property once, and override only what exists', () => {
    // The base block is the definition; anything after it is a deliberate
    // override -- today only --wk-tap, which follows the hand rather than the
    // look. A property appearing twice in the base is drift, not a decision.
    const base = THEME_CSS.slice(0, THEME_CSS.indexOf('@media'));
    const declared = [...base.matchAll(/(--wk-[\w-]+)\s*:/g)].map((m) => m[1]);
    expect(new Set(declared).size).toBe(declared.length);

    const overrides = [...THEME_CSS.slice(THEME_CSS.indexOf('@media'))
      .matchAll(/(--wk-[\w-]+)\s*:/g)].map((m) => m[1]);
    expect(overrides).toEqual(['--wk-tap']);
    expect(declared).toContain('--wk-tap');
  });

  it('use no --wk- property that is not defined', () => {
    const declared = new Set([...THEME_CSS.matchAll(/(--wk-[\w-]+)\s*:/g)].map((m) => m[1]));
    const used = new Set([...ALL_CSS.matchAll(/var\((--wk-[\w-]+)/g)].map((m) => m[1]));
    // A misspelt custom property fails silently in CSS; this is the only place
    // it can be seen without opening a browser.
    expect([...used].filter((name) => !declared.has(name))).toEqual([]);
  });

  it('press with one value, everywhere', () => {
    // Not tidiness for its own sake: the press dimmed to .4 in the toolbar and
    // .3 in the three other places purely because it had been transcribed four
    // times. Every :active opacity now has to come from the token.
    const presses = [...ALL_CSS.matchAll(/:active[^{]*\{[^}]*opacity:\s*([^;}]+)/g)]
      .map((m) => m[1].trim());
    expect(presses.length).toBeGreaterThan(0);
    expect([...new Set(presses)]).toEqual(['var(--wk-press)']);
  });
});
