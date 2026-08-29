import type { Settings } from '../state/model';
import { TOUCH } from './appShell';

/**
 * Slider and checkbox builders shared by the settings panel and the small
 * contextual panels a tool shows while it is active.
 */

export interface SliderSpec {
  key: keyof Settings;
  label: string;
  min: number;
  max: number;
  step: number;
}

export interface ToggleSpec {
  key: keyof Settings;
  label: string;
}

export type ChangeHandler = <K extends keyof Settings>(key: K, value: Settings[K]) => void;

export const SLIDERS: Record<string, SliderSpec> = {
  speed: { key: 'speed', label: 'Simulation speed', min: 1, max: 20, step: 1 },
  pedestrianRadius: { key: 'pedestrianRadius', label: 'Pedestrian radius', min: 3, max: 40, step: 1 },
  preferredSpace: { key: 'preferredSpace', label: 'Preferred space', min: 0, max: 90, step: 1 },
  brushSize: { key: 'brushSize', label: 'Brush size', min: 1, max: 8, step: 1 },
  borderThickness: { key: 'borderThickness', label: 'Border thickness', min: 2, max: 60, step: 1 },
};

export const PANEL_CSS = `
.wk-panel {
  padding: 12px 14px; border-radius: 8px; width: 232px;
  background: #ECECEC; border: 1px solid #9A9A9A;
  box-shadow: 0 2px 10px rgba(0,0,0,.5);
  font: 13px system-ui, -apple-system, sans-serif; color: #1E1E1E;
}
.wk-panel[hidden] { display: none; }
.wk-panel h2 { margin: 0 0 10px; font-size: 13px; font-weight: 600; }
.wk-panel .row { display: flex; align-items: center; gap: 8px; margin-bottom: 7px; }
.wk-panel .row label { flex: 1; }
.wk-panel .slider { display: block; margin-bottom: 10px; }
.wk-panel .slider:last-child { margin-bottom: 0; }
.wk-panel .slider .top { display: flex; justify-content: space-between; margin-bottom: 2px; }
.wk-panel .slider .val { font-variant-numeric: tabular-nums; color: #444; }
.wk-panel input[type=range] { width: 100%; }
.wk-panel hr { border: 0; border-top: 1px solid #C4C4C4; margin: 10px 0; }
.wk-panel button {
  width: 100%; padding: 7px 10px; cursor: pointer; font: inherit;
  background: #F7F7F7; border: 1px solid #B4B4B4; border-radius: 5px;
}
.wk-panel button:hover { background: #FFFFFF; }
/* Only the page has a way out to offer; as a panel the toolbar button is it. */
.wk-panel .done { display: none; }
.wk-panel .note { margin: 6px 0 0; font-size: 12px; color: #4A4A4A; min-height: 15px; }
#panels {
  position: absolute; z-index: 11; box-sizing: border-box;
  top: env(safe-area-inset-top, 0px);
  /* The 12px inset is the padding below; 84px is what clears the toolbar. */
  left: calc(72px + env(safe-area-inset-left, 0px));
  /* Scrolling a box clips it at its padding edge, and a panel's drop shadow
     falls outside its own border. The padding is the room that shadow needs;
     the offsets take it back off, so the panels sit where they always did. */
  padding: 12px;
  display: flex; flex-direction: column; gap: 8px;
  align-items: flex-start; pointer-events: none;
  /* The problem the toolbar's own max-height solves, one panel over: settings
     and a contextual panel open together are taller than a phone, and the
     controls at the bottom are otherwise simply unreachable. */
  max-height: calc(100vh - env(safe-area-inset-top, 0px) - env(safe-area-inset-bottom, 0px));
  overflow-y: auto;
  scrollbar-width: thin;
  /* #stage turns touch panning off so a drag draws instead of scrolling the
     map; this column has to opt back in or it cannot be scrolled by touch. */
  touch-action: pan-y;
}
#panels > * { pointer-events: auto; }
/*
 * Installed on a phone, settings stop being a panel and become a page, in the
 * shape iOS gives a settings screen.
 *
 * A 232px card floating in the corner covers most of a phone screen anyway, so
 * the honest shape is the screen: a title bar with a way out, groups of white
 * cells on a grey ground, and the controls a thumb expects to find -- a switch
 * rather than a checkbox, a slider with a knob it can catch. It is the same
 * markup either way, so nothing is built twice; only this stylesheet knows.
 *
 * The colours are iOS's own system palette, light appearance, because the
 * chrome over the map is already light -- the toolbar has to be, for the sake
 * of the original icons -- and a dark sheet would be the odd one out.
 *
 * position: fixed, so the page escapes the bounded, scrolling column the panels
 * live in; #panels is not a containing block for it (nothing here transforms),
 * and only its z-index has to rise so that the page covers the update chip as
 * well as the map.
 */
@media ${TOUCH} {
  html[data-standalone] #panels { z-index: 30; }

  /* Border-box inside the page, so a row asked for 44px is 44px tall and not
     44px plus whatever padding it happens to carry. */
  html[data-standalone] .wk-settings,
  html[data-standalone] .wk-settings * { box-sizing: border-box; }

  html[data-standalone] .wk-settings {
    position: fixed; inset: 0;
    width: auto; padding: 0;
    border: 0; border-radius: 0; box-shadow: none;
    background: #F2F2F7; color: #000;
    font-size: 17px;
    display: flex; flex-direction: column;
    /* Presented and dismissed the way a sheet is. allow-discrete is what lets
       a display: none element animate at all; where it is unsupported the page
       simply appears, which is what it did before. */
    transform: translateY(0);
    transition:
      transform .32s cubic-bezier(.32, .72, 0, 1),
      display .32s allow-discrete;
  }
  html[data-standalone] .wk-settings[hidden] { display: none; transform: translateY(100%); }
  @starting-style {
    html[data-standalone] .wk-settings { transform: translateY(100%); }
  }
  @media (prefers-reduced-motion: reduce) {
    html[data-standalone] .wk-settings { transition: none; transform: none; }
  }

  /*
   * A sheet's title bar: the title centred, the way out on the right. The
   * outer 1fr columns are equal, so the middle one is the middle of the screen
   * however wide "Done" turns out to be.
   */
  html[data-standalone] .wk-settings .head {
    display: grid; grid-template-columns: 1fr auto 1fr; align-items: center;
    /* A bar is 44px tall whatever is in it, plus whatever the status bar takes. */
    min-height: calc(44px + env(safe-area-inset-top, 0px));
    padding-top: calc(5px + env(safe-area-inset-top, 0px));
    padding-bottom: 5px;
    padding-left: calc(16px + env(safe-area-inset-left, 0px));
    padding-right: calc(16px + env(safe-area-inset-right, 0px));
    background: rgba(249, 249, 249, .94);
    border-bottom: .5px solid rgba(60, 60, 67, .29);
  }
  @supports (backdrop-filter: blur(1px)) or (-webkit-backdrop-filter: blur(1px)) {
    html[data-standalone] .wk-settings .head {
      background: rgba(249, 249, 249, .8);
      -webkit-backdrop-filter: blur(20px) saturate(180%);
      backdrop-filter: blur(20px) saturate(180%);
    }
  }
  html[data-standalone] .wk-settings .head h2 {
    grid-column: 2; margin: 0; font-size: 17px; font-weight: 600;
    letter-spacing: -.02em;
  }
  /* A bar button is text, not a button-looking thing: iOS tints it and leaves
     it at that. min-height keeps the tap target a thumb needs behind it. */
  html[data-standalone] .wk-settings .done {
    display: block; grid-column: 3; justify-self: end;
    width: auto; min-height: 34px; padding: 4px 0 4px 16px;
    background: none; border: 0; border-radius: 0;
    color: #007AFF; font-size: 17px; font-weight: 600;
  }
  html[data-standalone] .wk-settings .done:hover { background: none; }
  html[data-standalone] .wk-settings .done:active { opacity: .3; }

  html[data-standalone] .wk-settings .body {
    flex: 1; overflow-y: auto;
    /* #stage turns touch panning off so a drag draws instead of scrolling the
       map; the page has to opt back in to be scrollable at all, and contain
       stops a flick at the end of the list bouncing the app behind it. */
    touch-action: pan-y; overscroll-behavior: contain;
    padding-top: 20px;
    padding-bottom: calc(24px + env(safe-area-inset-bottom, 0px));
    padding-left: calc(16px + env(safe-area-inset-left, 0px));
    padding-right: calc(16px + env(safe-area-inset-right, 0px));
  }

  /* A grouped card. 10px and 35px are iOS's own corner and the gap it leaves
     between groups. */
  html[data-standalone] .wk-settings .group {
    background: #FFF; border-radius: 10px; margin-bottom: 35px;
  }
  html[data-standalone] .wk-settings .group:last-of-type { margin-bottom: 8px; }
  html[data-standalone] .wk-settings hr { display: none; }

  /* Cells. The separator starts at the text rather than the card's edge, which
     is the detail that makes a list read as iOS rather than as a table. */
  html[data-standalone] .wk-settings .group > * {
    position: relative; margin: 0; padding: 11px 16px;
  }
  html[data-standalone] .wk-settings .group > * + *::before {
    content: ''; position: absolute; left: 16px; right: 0; top: 0;
    height: .5px; background: rgba(60, 60, 67, .29);
  }

  html[data-standalone] .wk-settings .row {
    /* The checkbox is first in the markup, where a label belongs on iOS: the
       reversal puts the switch on the right without reordering anything. */
    flex-direction: row-reverse; min-height: 44px; gap: 12px;
  }
  html[data-standalone] .wk-settings .slider .top { margin-bottom: 2px; }
  html[data-standalone] .wk-settings .slider .val {
    color: rgba(60, 60, 67, .6); font-variant-numeric: tabular-nums;
  }

  /*
   * The contextual panel is the other thing floating over the map, so it is
   * made of what the bar is made of rather than staying a flat card next to it.
   * :not() keeps the page out of this: it is a screen, not something floating.
   */
  html[data-standalone] .wk-panel:not(.wk-settings) {
    border-radius: 14px;
    background: #ECECEC;
    border: .5px solid rgba(0, 0, 0, .08);
    box-shadow: inset 0 .5px 0 0 rgba(255, 255, 255, .7), 0 6px 20px rgba(0, 0, 0, .38);
  }
  @supports (backdrop-filter: blur(1px)) or (-webkit-backdrop-filter: blur(1px)) {
    html[data-standalone] .wk-panel:not(.wk-settings) {
      background: rgba(236, 236, 236, .72);
      -webkit-backdrop-filter: blur(20px) saturate(180%);
      backdrop-filter: blur(20px) saturate(180%);
    }
  }

  /*
   * The controls themselves are the platform's, so they are matched on the
   * panel rather than the page: the contextual panel is still a small floating
   * card, but a slider inside it is the same slider you just left.
   */

  /* The switch: 51x31 is the real one's size, and the knob travels the
     difference. */
  html[data-standalone] .wk-panel input[type=checkbox] {
    appearance: none; -webkit-appearance: none;
    flex: 0 0 auto; width: 51px; height: 31px; margin: 0;
    border-radius: 999px; background: rgba(120, 120, 128, .16);
    transition: background .2s ease;
  }
  html[data-standalone] .wk-panel input[type=checkbox]::after {
    content: ''; display: block; width: 27px; height: 27px; margin: 2px;
    border-radius: 50%; background: #FFF;
    box-shadow: 0 3px 8px rgba(0, 0, 0, .15), 0 1px 1px rgba(0, 0, 0, .16);
    transition: transform .2s ease;
  }
  html[data-standalone] .wk-panel input[type=checkbox]:checked { background: #34C759; }
  html[data-standalone] .wk-panel input[type=checkbox]:checked::after {
    transform: translateX(20px);
  }

  /* The slider: a 4px track that fills blue behind the knob, and a knob big
     enough to catch. --fill is written by buildSlider. */
  html[data-standalone] .wk-panel input[type=range] {
    appearance: none; -webkit-appearance: none;
    height: 28px; background: none;
  }
  html[data-standalone] .wk-panel input[type=range]::-webkit-slider-runnable-track {
    height: 4px; border-radius: 2px;
    background: linear-gradient(
      to right,
      #007AFF 0 var(--fill, 0%),
      rgba(120, 120, 128, .16) var(--fill, 0%) 100%
    );
  }
  html[data-standalone] .wk-panel input[type=range]::-webkit-slider-thumb {
    appearance: none; -webkit-appearance: none;
    width: 28px; height: 28px; margin-top: -12px;
    border-radius: 50%; background: #FFF;
    box-shadow: 0 0 0 .5px rgba(0, 0, 0, .04), 0 6px 13px rgba(0, 0, 0, .12),
      0 .5px 4px rgba(0, 0, 0, .12);
  }
  html[data-standalone] .wk-panel input[type=range]::-moz-range-track {
    height: 4px; border-radius: 2px; background: rgba(120, 120, 128, .16);
  }
  html[data-standalone] .wk-panel input[type=range]::-moz-range-progress {
    height: 4px; border-radius: 2px; background: #007AFF;
  }
  html[data-standalone] .wk-panel input[type=range]::-moz-range-thumb {
    width: 28px; height: 28px; border: 0; border-radius: 50%; background: #FFF;
    box-shadow: 0 1px 4px rgba(0, 0, 0, .2);
  }

  /* An action row: tinted text across the cell, no button of its own. */
  html[data-standalone] .wk-settings .group button {
    width: 100%; min-height: 44px;
    background: none; border: 0; border-radius: 0;
    color: #007AFF; font-size: 17px; text-align: left;
  }
  html[data-standalone] .wk-settings .group button:hover { background: none; }
  html[data-standalone] .wk-settings .group button:active { opacity: .3; }

  /* The sentence under a group, in iOS's footnote place and colour. */
  html[data-standalone] .wk-settings .note {
    margin: 0; padding: 0 16px;
    font-size: 13px; color: rgba(60, 60, 67, .6);
  }

  /* The strip is a bar across the bottom now: the corner the panels were being
     kept out of is free, and the room they have is what is above it.
     --wk-toolbar-h is the bar's measured height (see ui/toolbar.ts) and 20px is
     the gap it floats at. */
  html[data-standalone] #panels {
    left: env(safe-area-inset-left, 0px);
    max-height: calc(
      100vh - 16px - var(--wk-toolbar-h, 0px)
      - env(safe-area-inset-top, 0px) - env(safe-area-inset-bottom, 0px)
    );
  }
}
`;

/** A labelled range input bound to one setting. Returns the element and a refresher. */
export function buildSlider(
  spec: SliderSpec,
  settings: Settings,
  onChange: ChangeHandler,
): { el: HTMLElement; sync: () => void } {
  const wrap = document.createElement('div');
  wrap.className = 'slider';

  const top = document.createElement('div');
  top.className = 'top';
  const label = document.createElement('label');
  label.textContent = spec.label;
  const value = document.createElement('span');
  value.className = 'val';
  top.append(label, value);

  const input = document.createElement('input');
  input.type = 'range';
  input.min = String(spec.min);
  input.max = String(spec.max);
  input.step = String(spec.step);
  label.htmlFor = input.id = `set-${spec.key}-${Math.random().toString(36).slice(2, 8)}`;

  /**
   * How far along the track the knob is, as a percentage.
   *
   * A range input paints one track, not a filled part and an empty part, so the
   * iOS slider's blue lead-in has to come from a gradient that knows where the
   * knob is. Written whatever the shape, since the panel simply does not read it.
   */
  const setFill = () => {
    const fraction = (Number(input.value) - spec.min) / (spec.max - spec.min);
    input.style.setProperty('--fill', `${fraction * 100}%`);
  };

  const sync = () => {
    input.value = String(settings[spec.key]);
    value.textContent = String(settings[spec.key]);
    setFill();
  };
  sync();

  input.addEventListener('input', () => {
    const next = Number(input.value);
    value.textContent = String(next);
    setFill();
    onChange(spec.key, next as Settings[typeof spec.key]);
  });

  wrap.append(top, input);
  return { el: wrap, sync };
}

export function buildToggle(
  spec: ToggleSpec,
  settings: Settings,
  onChange: ChangeHandler,
): { el: HTMLElement; sync: () => void } {
  const row = document.createElement('div');
  row.className = 'row';
  const input = document.createElement('input');
  input.type = 'checkbox';
  input.id = `set-${spec.key}`;
  const label = document.createElement('label');
  label.textContent = spec.label;
  label.htmlFor = input.id;

  const sync = () => { input.checked = Boolean(settings[spec.key]); };
  sync();

  input.addEventListener('change', () => {
    onChange(spec.key, input.checked as Settings[typeof spec.key]);
  });
  row.append(input, label);
  return { el: row, sync };
}

/** Stops canvas tools reacting to clicks meant for a panel. */
export function swallowPointerEvents(el: HTMLElement): void {
  for (const type of ['pointerdown', 'pointerup', 'pointermove', 'wheel', 'dblclick']) {
    el.addEventListener(type, (ev) => ev.stopPropagation());
  }
}
