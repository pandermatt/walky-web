import type { Settings } from '../state/model';
import { injectStyle, installTheme } from './theme';

/**
 * The controls themselves -- a slider and a switch bound to one setting each --
 * shared by the settings sheet and the small contextual panel a tool shows while
 * it is active.
 *
 * They are the platform's controls in the platform's sizes, and they are that
 * everywhere now rather than only when installed. The reason they were once
 * gated is gone: the sheet and the panel are the same two surfaces on a laptop
 * as on a phone, and a slider that changed shape depending on how you had opened
 * the app was the odd thing, not the consistent one.
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

/**
 * `.wk-panel` is worn by both surfaces that hold controls, so a slider in the
 * contextual panel is the same slider you just left in the sheet.
 */
export const CONTROLS_CSS = `
.wk-panel .row {
  /* The checkbox is first in the markup, where a label belongs: the reversal
     puts the switch on the right without reordering anything. */
  display: flex; flex-direction: row-reverse; align-items: center; gap: 12px;
}
.wk-panel .row label { flex: 1; }
.wk-panel .slider { display: block; }
.wk-panel .slider .top {
  display: flex; justify-content: space-between; align-items: baseline;
  gap: 8px; margin-bottom: 2px;
}
.wk-panel .slider .val {
  color: var(--wk-ink-dim); font-variant-numeric: tabular-nums;
}

/* The switch: 51x31 is the real one's size, and the knob travels the
   difference. On, it carries Walky's accent rather than iOS's green. */
.wk-panel input[type=checkbox] {
  appearance: none; -webkit-appearance: none;
  flex: 0 0 auto; width: 51px; height: 31px; margin: 0;
  border-radius: 999px; background: rgba(120, 120, 128, .16);
  cursor: pointer; transition: background-color .2s ease;
}
.wk-panel input[type=checkbox]::after {
  content: ''; display: block; width: 27px; height: 27px; margin: 2px;
  border-radius: 50%; background: #FFF;
  box-shadow: 0 3px 8px rgba(0, 0, 0, .15), 0 1px 1px rgba(0, 0, 0, .16);
  transition: transform .2s ease;
}
.wk-panel input[type=checkbox]:checked {
  background: var(--wk-accent);
  /* WCAG 1.4.11 asks 3:1 of a control whose meaning *is* its colour, and the
     accent on white is 1.4:1 -- "is it on?" would be a question people answer
     wrong. A hairline is what makes a bright fill legible without dimming it,
     and it is the same hairline the grouped list already draws with. */
  box-shadow: inset 0 0 0 1px var(--wk-fill-edge);
}
.wk-panel input[type=checkbox]:checked::after { transform: translateX(20px); }
.wk-panel input[type=checkbox]:focus-visible {
  outline: 2px solid var(--wk-accent-text); outline-offset: 2px;
}

/* The slider: a 4px track that fills behind the knob, and a knob big enough to
   catch. --fill is written by buildSlider. */
.wk-panel input[type=range] {
  appearance: none; -webkit-appearance: none;
  width: 100%; height: 28px; margin: 0; background: none; cursor: pointer;
}
.wk-panel input[type=range]:focus-visible {
  outline: 2px solid var(--wk-accent-text); outline-offset: 2px;
}
.wk-panel input[type=range]::-webkit-slider-runnable-track {
  height: 4px; border-radius: 2px;
  background: linear-gradient(
    to right,
    var(--wk-accent) 0 var(--fill, 0%),
    rgba(120, 120, 128, .16) var(--fill, 0%) 100%
  );
  /* Same reason as the switch: the lead-in has to have an edge on white. */
  box-shadow: inset 0 0 0 .5px var(--wk-fill-edge);
}
.wk-panel input[type=range]::-webkit-slider-thumb {
  appearance: none; -webkit-appearance: none;
  width: 28px; height: 28px; margin-top: -12px;
  border-radius: 50%; background: #FFF;
  box-shadow: 0 0 0 .5px rgba(0, 0, 0, .04), 0 6px 13px rgba(0, 0, 0, .12),
    0 .5px 4px rgba(0, 0, 0, .12);
}
.wk-panel input[type=range]::-moz-range-track {
  height: 4px; border-radius: 2px; background: rgba(120, 120, 128, .16);
}
.wk-panel input[type=range]::-moz-range-progress {
  height: 4px; border-radius: 2px; background: var(--wk-accent);
  box-shadow: inset 0 0 0 .5px var(--wk-fill-edge);
}
.wk-panel input[type=range]::-moz-range-thumb {
  width: 28px; height: 28px; border: 0; border-radius: 50%; background: #FFF;
  box-shadow: 0 1px 4px rgba(0, 0, 0, .2);
}

@media (prefers-reduced-motion: reduce) {
  .wk-panel input[type=checkbox],
  .wk-panel input[type=checkbox]::after { transition: none; }
}
`;

/** Puts the theme and the control skins in place; safe to call more than once. */
export function installControls(): void {
  installTheme();
  injectStyle('controls', CONTROLS_CSS);
}

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
   * accent lead-in has to come from a gradient that knows where the knob is.
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
