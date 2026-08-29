import { SPEED_MIN, SPEED_MAX, type Settings } from '../state/model';

/**
 * Ports gui/GUISettings and gui/PedestrianSettingsPanel: the debug overlays the
 * original could toggle, plus the pedestrian parameters it exposed. show3DEffect
 * is gone with the fake-3D.
 */

interface ToggleSpec { key: keyof Settings; label: string }
interface SliderSpec { key: keyof Settings; label: string; min: number; max: number; step: number }

const TOGGLES: ToggleSpec[] = [
  { key: 'showConvexHull', label: 'Convex hulls' },
  { key: 'showVisibleLines', label: 'Visibility rays' },
  { key: 'showLineToTarget', label: 'Path to goal' },
  { key: 'showPreferredRadius', label: 'Preferred radius' },
  { key: 'showDebug', label: 'Debug info' },
];

const SLIDERS: SliderSpec[] = [
  { key: 'speed', label: 'Simulation speed', min: SPEED_MIN, max: SPEED_MAX, step: 1 },
  { key: 'pedestrianRadius', label: 'Pedestrian radius', min: 3, max: 40, step: 1 },
  { key: 'preferredSpace', label: 'Preferred space', min: 0, max: 90, step: 1 },
  { key: 'brushSize', label: 'Brush size', min: 1, max: 8, step: 1 },
];

const CSS = `
#settings {
  position: absolute; top: 12px; left: 76px; z-index: 11; width: 232px;
  padding: 12px 14px; border-radius: 8px;
  background: #ECECEC; border: 1px solid #9A9A9A;
  box-shadow: 0 2px 10px rgba(0,0,0,.5);
  font: 13px system-ui, -apple-system, sans-serif; color: #1E1E1E;
}
#settings[hidden] { display: none; }
#settings h2 { margin: 0 0 10px; font-size: 13px; font-weight: 600; }
#settings .row { display: flex; align-items: center; gap: 8px; margin-bottom: 7px; }
#settings .row label { flex: 1; }
#settings .slider { display: block; margin-bottom: 10px; }
#settings .slider .top { display: flex; justify-content: space-between; margin-bottom: 2px; }
#settings .slider .val { font-variant-numeric: tabular-nums; color: #444; }
#settings input[type=range] { width: 100%; }
#settings hr { border: 0; border-top: 1px solid #C4C4C4; margin: 10px 0; }
#settings button {
  width: 100%; padding: 7px 10px; cursor: pointer; font: inherit;
  background: #F7F7F7; border: 1px solid #B4B4B4; border-radius: 5px;
}
#settings button:hover { background: #FFFFFF; }
#settings .note { margin: 6px 0 0; font-size: 12px; color: #4A4A4A; min-height: 15px; }
`;

export class SettingsPanel {
  private root: HTMLDivElement;
  private outputs = new Map<string, HTMLSpanElement>();

  constructor(
    parent: HTMLElement,
    private settings: Settings,
    private onChange: <K extends keyof Settings>(key: K, value: Settings[K]) => void,
    private onCopyMap: () => Promise<string>,
  ) {
    const style = document.createElement('style');
    style.textContent = CSS;
    document.head.appendChild(style);

    this.root = document.createElement('div');
    this.root.id = 'settings';
    this.root.hidden = true;

    const title = document.createElement('h2');
    title.textContent = 'Settings';
    this.root.appendChild(title);

    for (const spec of SLIDERS) {
      this.root.appendChild(this.buildSlider(spec));
    }

    const rule = document.createElement('hr');
    this.root.appendChild(rule);

    for (const spec of TOGGLES) {
      this.root.appendChild(this.buildToggle(spec));
    }

    this.root.appendChild(document.createElement('hr'));

    // Debugging aid: the whole scenario as JSON, ready to hand to someone else.
    const copy = document.createElement('button');
    copy.type = 'button';
    copy.textContent = 'Copy map to clipboard';
    const note = document.createElement('p');
    note.className = 'note';
    copy.addEventListener('click', async () => {
      try {
        note.textContent = await this.onCopyMap();
      } catch {
        // Clipboard access can be refused; say so rather than failing silently.
        note.textContent = 'Clipboard blocked by the browser';
      }
    });
    this.root.append(copy, note);

    // Keep canvas tools from reacting to clicks meant for the panel.
    for (const type of ['pointerdown', 'pointerup', 'wheel', 'dblclick']) {
      this.root.addEventListener(type, (ev) => ev.stopPropagation());
    }

    parent.appendChild(this.root);
  }

  private buildSlider(spec: SliderSpec): HTMLElement {
    const wrap = document.createElement('div');
    wrap.className = 'slider';

    const top = document.createElement('div');
    top.className = 'top';
    const label = document.createElement('label');
    label.textContent = spec.label;
    label.htmlFor = `set-${spec.key}`;
    const value = document.createElement('span');
    value.className = 'val';
    value.textContent = String(this.settings[spec.key]);
    top.append(label, value);

    const input = document.createElement('input');
    input.type = 'range';
    input.id = `set-${spec.key}`;
    input.min = String(spec.min);
    input.max = String(spec.max);
    input.step = String(spec.step);
    input.value = String(this.settings[spec.key]);
    input.addEventListener('input', () => {
      const next = Number(input.value);
      value.textContent = String(next);
      this.onChange(spec.key, next as Settings[typeof spec.key]);
    });

    this.outputs.set(spec.key, value);
    wrap.append(top, input);
    return wrap;
  }

  private buildToggle(spec: ToggleSpec): HTMLElement {
    const row = document.createElement('div');
    row.className = 'row';
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.id = `set-${spec.key}`;
    input.checked = Boolean(this.settings[spec.key]);
    const label = document.createElement('label');
    label.textContent = spec.label;
    label.htmlFor = input.id;
    input.addEventListener('change', () => {
      this.onChange(spec.key, input.checked as Settings[typeof spec.key]);
    });
    row.append(input, label);
    return row;
  }

  toggle(): void { this.root.hidden = !this.root.hidden; }
  get visible(): boolean { return !this.root.hidden; }
}
