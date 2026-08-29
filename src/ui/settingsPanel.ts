import type { Settings } from '../state/model';
import { isAppShell } from './appShell';
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

/**
 * The settings, as a panel over the map and -- installed on a phone -- as a
 * page of its own.
 *
 * A 232px panel floating in the corner is a desktop shape: on a phone it covers
 * most of the map anyway, so it may as well stop pretending and become the
 * screen, with a title bar and a way out. The same controls in the same order
 * either way; only the frame around them changes, and it changes in CSS.
 */
export class SettingsPanel {
  private root: HTMLDivElement;
  private syncers: (() => void)[] = [];
  /** Set while a history entry of ours is on the stack, waiting to be popped. */
  private pushed = false;

  constructor(
    parent: HTMLElement,
    private settings: Settings,
    onChange: ChangeHandler,
    private onCopyMap: () => Promise<string>,
    /** Told when the page closes itself, so the toolbar's button can follow. */
    private onClosed: () => void = () => {},
  ) {
    const style = document.createElement('style');
    style.textContent = PANEL_CSS;
    document.head.appendChild(style);

    this.root = document.createElement('div');
    this.root.className = 'wk-panel wk-settings';
    this.root.hidden = true;

    // The header and the body exist in both shapes; as a panel the header is
    // just the heading it always was, and the body is a plain block.
    const head = document.createElement('header');
    head.className = 'head';
    const title = document.createElement('h2');
    title.textContent = 'Settings';
    const done = document.createElement('button');
    done.type = 'button';
    done.className = 'done';
    done.textContent = 'Done';
    done.addEventListener('click', () => this.close());
    head.append(title, done);

    const body = document.createElement('div');
    body.className = 'body';
    this.root.append(head, body);

    /*
     * Each run of controls is a section, and the rule that used to divide them
     * rides along inside it. As a panel that is the same stack of controls with
     * the same lines between them -- a section box adds no spacing of its own.
     * As a page each one becomes an iOS grouped card and the rules go away,
     * because the card's edges already say what the line was saying.
     */
    const group = () => {
      const section = document.createElement('section');
      section.className = 'group';
      body.appendChild(section);
      return section;
    };

    const sliders = group();
    for (const key of SLIDER_ORDER) {
      const spec = SLIDERS[key as string];
      if (!spec) continue;
      const { el, sync } = buildSlider(spec, settings, onChange);
      this.syncers.push(sync);
      sliders.appendChild(el);
    }
    sliders.appendChild(document.createElement('hr'));

    const toggles = group();
    for (const spec of TOGGLES) {
      const { el, sync } = buildToggle(spec, settings, onChange);
      this.syncers.push(sync);
      toggles.appendChild(el);
    }
    toggles.appendChild(document.createElement('hr'));

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
    // The note sits outside the section: as a page it is the grey footnote
    // under a group, which is where iOS puts the sentence about a group.
    group().appendChild(copy);
    body.appendChild(note);

    swallowPointerEvents(this.root);
    parent.appendChild(this.root);

    // The back gesture is the only way out an installed app offers besides the
    // button, and it needs an entry of ours to pop. Popping it is the browser
    // telling us the page has been left, so there is nothing left to unwind.
    window.addEventListener('popstate', () => {
      if (!this.pushed) return;
      this.pushed = false;
      this.root.hidden = true;
      this.onClosed();
    });
  }

  toggle(): boolean {
    if (this.visible) this.close();
    else this.open();
    return this.visible;
  }

  open(): void {
    if (this.visible) return;
    this.root.hidden = false;
    this.sync();
    if (isAppShell()) {
      // Same URL, so this is a history entry and not navigation: there is one
      // page here, and going back from it lands where you already are.
      history.pushState({ walkySettings: true }, '');
      this.pushed = true;
    }
  }

  close(): void {
    if (!this.visible) return;
    this.root.hidden = true;
    // Done is a way out the caller did not ask for, so it has to say so; the
    // caller's own close() hears it back, which costs nothing.
    this.onClosed();
    if (!this.pushed) return;
    // Cleared first: the popstate this causes is our own doing, not a gesture.
    this.pushed = false;
    history.back();
  }

  get visible(): boolean { return !this.root.hidden; }

  /** Pull displayed values back from settings, after a change made elsewhere. */
  sync(): void {
    void this.settings;
    for (const s of this.syncers) s();
  }
}
