import type { Settings } from '../state/model';
import { SLIDERS, buildSlider, swallowPointerEvents, type ChangeHandler } from './controls';

/**
 * A small panel of the settings that matter to whatever is active right now:
 * brush size and preferred space while the pedestrian tool is selected, speed
 * while the simulation runs.
 *
 * The full settings panel already holds all of these, but reaching for it means
 * leaving the tool you are using. These are the two cases where you adjust a
 * value and immediately want to see the effect.
 */
export class ContextPanel {
  private root: HTMLDivElement;
  private title: HTMLHeadingElement;
  private body: HTMLDivElement;
  private syncers: (() => void)[] = [];
  /** Which set of keys is currently built, so it is only rebuilt on a change. */
  private shown = '';

  constructor(
    parent: HTMLElement,
    private settings: Settings,
    private onChange: ChangeHandler,
  ) {
    this.root = document.createElement('div');
    this.root.className = 'wk-panel';
    this.root.hidden = true;

    this.title = document.createElement('h2');
    this.body = document.createElement('div');
    this.root.append(this.title, this.body);

    swallowPointerEvents(this.root);
    parent.appendChild(this.root);
  }

  /** Show the named sliders, or hide the panel when given none. */
  show(title: string, keys: (keyof Settings)[]): void {
    const signature = `${title}:${keys.join(',')}`;
    if (signature === this.shown) return;
    this.shown = signature;

    if (keys.length === 0) {
      this.root.hidden = true;
      return;
    }

    this.title.textContent = title;
    this.body.replaceChildren();
    this.syncers = [];
    for (const key of keys) {
      const spec = SLIDERS[key as string];
      if (!spec) continue;
      const { el, sync } = buildSlider(spec, this.settings, this.onChange);
      this.syncers.push(sync);
      this.body.appendChild(el);
    }
    this.root.hidden = false;
  }

  hide(): void {
    this.show('', []);
  }

  /** Pull displayed values back from settings, after a change made elsewhere. */
  sync(): void {
    for (const s of this.syncers) s();
  }
}
