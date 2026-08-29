import type { Settings } from '../state/model';

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
/* Installed on a touch device the strip is a bar across the bottom: the corner
   it was being kept out of is free, and the room it leaves is what is above it.
   --wk-toolbar-h is the bar's measured height (see ui/toolbar.ts) and 20px is
   the gap it floats at. */
@media (pointer: coarse) {
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

  const sync = () => {
    input.value = String(settings[spec.key]);
    value.textContent = String(settings[spec.key]);
  };
  sync();

  input.addEventListener('input', () => {
    const next = Number(input.value);
    value.textContent = String(next);
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
