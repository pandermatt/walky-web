import type { Settings } from '../state/model';
import {
  PANEL_CSS, SLIDERS, buildSlider, buildToggle, swallowPointerEvents,
  type ChangeHandler, type ToggleSpec,
} from './controls';

/**
 * Ports gui/GUISettings and gui/PedestrianSettingsPanel: the debug overlays the
 * original could toggle, plus the pedestrian parameters it exposed. show3DEffect
 * is gone with the fake-3D.
 */
const TOGGLES: ToggleSpec[] = [
  { key: 'showConvexHull', label: 'Convex hulls' },
  { key: 'showVisibleLines', label: 'Visibility rays' },
  { key: 'showLineToTarget', label: 'Path to goal' },
  { key: 'showPreferredRadius', label: 'Preferred radius' },
  { key: 'showDebug', label: 'Debug info' },
  { key: 'sound', label: 'Arrival sound' },
];

const SLIDER_ORDER: (keyof Settings)[] = [
  'speed', 'pedestrianRadius', 'preferredSpace', 'brushSize', 'borderThickness',
];

export class SettingsPanel {
  private root: HTMLDivElement;
  private syncers: (() => void)[] = [];

  constructor(
    parent: HTMLElement,
    private settings: Settings,
    onChange: ChangeHandler,
    private onCopyMap: () => Promise<string>,
  ) {
    const style = document.createElement('style');
    style.textContent = PANEL_CSS;
    document.head.appendChild(style);

    this.root = document.createElement('div');
    this.root.className = 'wk-panel';
    this.root.hidden = true;

    const title = document.createElement('h2');
    title.textContent = 'Settings';
    this.root.appendChild(title);

    for (const key of SLIDER_ORDER) {
      const spec = SLIDERS[key as string];
      if (!spec) continue;
      const { el, sync } = buildSlider(spec, settings, onChange);
      this.syncers.push(sync);
      this.root.appendChild(el);
    }

    this.root.appendChild(document.createElement('hr'));

    for (const spec of TOGGLES) {
      const { el, sync } = buildToggle(spec, settings, onChange);
      this.syncers.push(sync);
      this.root.appendChild(el);
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
        note.textContent = 'Clipboard blocked by the browser';
      }
    });
    this.root.append(copy, note);

    swallowPointerEvents(this.root);
    parent.appendChild(this.root);
  }

  toggle(): boolean {
    this.root.hidden = !this.root.hidden;
    if (!this.root.hidden) this.sync();
    return this.visible;
  }

  close(): void { this.root.hidden = true; }
  get visible(): boolean { return !this.root.hidden; }

  /** Pull displayed values back from settings, after a change made elsewhere. */
  sync(): void {
    void this.settings;
    for (const s of this.syncers) s();
  }
}
