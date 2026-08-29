import { SETTING_RANGES, type Settings } from '../state/model';
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

/** Labels here; the ranges come from the model, which is also what a loaded map is clamped to. */
export const SLIDERS: Record<string, SliderSpec> = {
  speed: { key: 'speed', label: 'Simulation speed', ...SETTING_RANGES.speed },
  pedestrianRadius: { key: 'pedestrianRadius', label: 'Pedestrian radius', ...SETTING_RANGES.pedestrianRadius },
  personalSpace: { key: 'personalSpace', label: 'Personal space', ...SETTING_RANGES.personalSpace },
  brushSize: { key: 'brushSize', label: 'Brush size', ...SETTING_RANGES.brushSize },
  borderThickness: { key: 'borderThickness', label: 'Border thickness', ...SETTING_RANGES.borderThickness },
  labelSize: { key: 'labelSize', label: 'Text size', ...SETTING_RANGES.labelSize },
  labelWeight: { key: 'labelWeight', label: 'Text weight', ...SETTING_RANGES.labelWeight },
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
  border-radius: 999px; background: var(--wk-track);
  cursor: pointer; transition: background-color .2s ease;
}
.wk-panel input[type=checkbox]::after {
  content: ''; display: block; width: 27px; height: 27px; margin: 2px;
  border-radius: 50%; background: #FFF;
  /* Enough to read as a knob and no more; the sheet it sits in is flat. */
  box-shadow: 0 1px 2px rgba(0, 0, 0, .12);
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
    var(--wk-track) var(--fill, 0%) 100%
  );
  /* Same reason as the switch: the lead-in has to have an edge on white. */
  box-shadow: inset 0 0 0 .5px var(--wk-fill-edge);
}
.wk-panel input[type=range]::-webkit-slider-thumb {
  appearance: none; -webkit-appearance: none;
  width: 28px; height: 28px; margin-top: -12px;
  border-radius: 50%; background: #FFF;
  box-shadow: 0 1px 2px rgba(0, 0, 0, .12);
}
.wk-panel input[type=range]::-moz-range-track {
  height: 4px; border-radius: 2px; background: var(--wk-track);
}
.wk-panel input[type=range]::-moz-range-progress {
  height: 4px; border-radius: 2px; background: var(--wk-accent);
  box-shadow: inset 0 0 0 .5px var(--wk-fill-edge);
}
.wk-panel input[type=range]::-moz-range-thumb {
  width: 28px; height: 28px; border: 0; border-radius: 50%; background: #FFF;
  box-shadow: 0 1px 2px rgba(0, 0, 0, .12);
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
