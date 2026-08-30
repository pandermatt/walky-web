import type { Settings } from '../state/model';
import { TOUCH } from './appShell';
import { SLIDERS, buildSlider, installControls, swallowPointerEvents, type ChangeHandler } from './controls';
import { injectStyle } from './theme';

/**
 * A small panel of the settings that matter to whatever is active right now:
 * brush size and preferred space while the pedestrian tool is selected, speed
 * and preferred space while the simulation runs.
 *
 * The settings sheet already holds all of these, but reaching for it means
 * leaving the tool you are using. These are the cases where you adjust a value
 * and immediately want to see the effect.
 *
 * It stays a panel, and deliberately not a modal. It is an inspector on the
 * thing already in your hand, and taking the map away would be exactly the
 * leaving it exists to avoid. It needs no coordination with the sheet either --
 * showModal() makes the whole document outside the sheet inert, so while
 * settings is up this panel is untabbable and untouchable without containing a
 * single line that knows sheets exist.
 *
 * It does carry its own way out. Putting a tool down is one, and for a tool
 * panel it was once thought to be the only one needed; but a run has no tool in
 * hand to put down, so speed and preferred space sat over the map for as long as
 * the crowd walked whether or not anybody was still adjusting them. The X is
 * that missing gesture. It lasts exactly as long as the panel would go on saying
 * the same thing -- see dismiss() -- so pausing and playing again brings the run
 * controls back, which is the only way back to them: the sheet does not hold
 * speed.
 */
export const CONTEXT_CSS = `
/*
 * The column the panel lives in. It is the only tenant now that settings has
 * become a modal in the top layer, but the column stays: it is what keeps the
 * panel clear of the toolbar, and what lets it scroll on a screen too short for
 * it.
 */
#panels {
  position: absolute; z-index: 11; box-sizing: border-box;
  top: env(safe-area-inset-top, 0px);
  /* The 12px inset is the padding below; 72px is what clears the toolbar. */
  left: calc(72px + env(safe-area-inset-left, 0px));
  /* Scrolling a box clips it at its padding edge, and the panel's drop shadow
     falls outside its own border. The padding is the room that shadow needs;
     the offsets take it back off, so the panel sits where it always did. */
  padding: 12px;
  display: flex; flex-direction: column; gap: 8px;
  align-items: flex-start; pointer-events: none;
  max-height: calc(100vh - env(safe-area-inset-top, 0px) - env(safe-area-inset-bottom, 0px));
  overflow-y: auto;
  scrollbar-width: thin;
  /* #stage turns touch panning off so a drag draws instead of scrolling the
     map; this column has to opt back in or it cannot be scrolled by touch. */
  touch-action: pan-y;
}
#panels > * { pointer-events: auto; }

/* The panel is the other thing floating over the map, so it is made of what the
   bar is made of rather than being a flat card next to it. */
.wk-context {
  box-sizing: border-box; width: 232px; padding: 12px 14px;
  border-radius: var(--wk-r-card);
  background: var(--wk-bar);
  border: var(--wk-glass-edge);
  box-shadow: var(--wk-glass-shadow);
  font: var(--wk-font); color: var(--wk-ink);
}
@supports (backdrop-filter: blur(1px)) or (-webkit-backdrop-filter: blur(1px)) {
  .wk-context {
    background: rgba(236, 236, 236, .72);
    -webkit-backdrop-filter: var(--wk-glass-blur);
    backdrop-filter: var(--wk-glass-blur);
  }
}
.wk-context[hidden] { display: none; }
.wk-context .head {
  display: flex; align-items: center; justify-content: space-between; gap: 8px;
  margin-bottom: 10px;
}
.wk-context h2 { margin: 0; font-size: 13px; font-weight: 600; }
/* The X. Chrome beside the title rather than a control of its own: dimmed ink
   at the size the glyph needs to read as one stroke crossing another, in a cell
   only as tall as the title row it sits in. The press and the focus ring come
   from .wk-btn with it. */
.wk-context .close {
  width: 28px; height: 28px; padding: 0;
  display: grid; place-items: center;
  color: var(--wk-ink-dim); font-size: 17px; line-height: 1;
}
/* A thumb needs its 44px, and the title row is 28px tall. The negative margin is
   the difference put back: the target grows out past the header in every
   direction while the header keeps the height it has under a pointer. */
@media ${TOUCH} {
  .wk-context .close {
    width: var(--wk-tap); height: var(--wk-tap);
    margin: calc((28px - var(--wk-tap)) / 2);
  }
}
.wk-context .slider + .slider { margin-top: 10px; }

/*
 * Installed on a phone the panel moves to the bottom with the bar.
 *
 * It holds the settings belonging to the button that was just pressed, and the
 * far corner of the screen is no place for them: that reach is exactly what
 * moving the strip to the thumb was for, and leaving the panel behind would
 * have put the tool at one end of the phone and its controls at the other. So
 * it sits directly above the capsules, centred on them. What moves is the
 * placement and only that -- the same 232px capsule, the same sliders in it,
 * as on a laptop.
 *
 * --wk-toolbar-h is the bar's measured height (see ui/toolbar.ts), so the
 * column's bottom edge is the bar's top edge whether it wrapped to one row or
 * two, and the 12px padding above is the gap the panel floats at.
 */
@media ${TOUCH} {
  html[data-standalone] #panels {
    top: auto;
    bottom: calc(20px + var(--wk-toolbar-h, 0px) + env(safe-area-inset-bottom, 0px));
    left: env(safe-area-inset-left, 0px);
    right: env(safe-area-inset-right, 0px);
    align-items: center;
    max-height: calc(
      100vh - 20px - var(--wk-toolbar-h, 0px)
      - env(safe-area-inset-top, 0px) - env(safe-area-inset-bottom, 0px)
    );
  }
}

/* With nothing to show the column is not there at all, so that the height it
   publishes is 0 and the update chip keeps its own corner. Padding on an empty
   box is still a band of screen, and a chip clearing 24px of nothing would be a
   chip floating for no reason. */
#panels:not(:has(> :not([hidden]))) { padding: 0; }
`;

export class ContextPanel {
  private root: HTMLDivElement;
  private title: HTMLHeadingElement;
  private body: HTMLDivElement;
  private syncers: (() => void)[] = [];
  /**
   * Which set of keys is currently built, so it is only rebuilt on a change --
   * and, once dismissed, what holds it shut until there is a change to rebuild
   * for. See dismiss().
   */
  private shown = '';

  constructor(
    parent: HTMLElement,
    private settings: Settings,
    private onChange: ChangeHandler,
  ) {
    installControls();
    injectStyle('context', CONTEXT_CSS);

    this.root = document.createElement('div');
    this.root.className = 'wk-panel wk-context';
    this.root.hidden = true;
    // A named group rather than an unlabelled box: "Pedestrians" is what says
    // which tool these three sliders belong to.
    this.root.setAttribute('role', 'group');

    const head = document.createElement('header');
    head.className = 'head';
    this.title = document.createElement('h2');
    this.title.id = 'wk-context-title';
    this.root.setAttribute('aria-labelledby', this.title.id);
    // The glyph is the multiplication sign, which the subsetted face covers, so
    // the X costs no icon file and nothing in the precache list. It is hidden
    // from the accessibility tree because a label says what the button does
    // better than a character ever reads out.
    const close = document.createElement('button');
    close.type = 'button';
    close.className = 'wk-btn close';
    close.setAttribute('aria-label', 'Hide these controls');
    const glyph = document.createElement('span');
    glyph.setAttribute('aria-hidden', 'true');
    glyph.textContent = '\u00D7';
    close.appendChild(glyph);
    close.addEventListener('click', () => this.dismiss());
    head.append(this.title, close);

    this.body = document.createElement('div');
    this.root.append(head, this.body);

    swallowPointerEvents(this.root);
    parent.appendChild(this.root);
    this.publishHeight(parent);
  }

  /**
   * Publishes the column's height as --wk-context-h.
   *
   * Installed, the panel and the update chip both live over the bottom of the
   * screen, and the chip has to clear whichever of them is there. The bar
   * already publishes its own height for exactly that reason; this is the other
   * half of the same sum, and it has to be measured because how tall the panel
   * is depends on how many sliders the tool in hand asks for. The column
   * collapses to nothing while the panel is hidden, so the value is 0 whenever
   * there is no panel to clear.
   */
  private publishHeight(column: HTMLElement): void {
    const write = () => {
      const height = Math.round(column.getBoundingClientRect().height);
      document.documentElement.style.setProperty('--wk-context-h', `${height}px`);
    };
    write();
    new ResizeObserver(write).observe(column);
  }

  /** Show the named sliders, or hide the panel when given none. */
  show(title: string, keys: (keyof Settings)[]): void {
    const signature = `${title}:${keys.join(',')}`;
    if (signature === this.shown) return;
    this.shown = signature;

    if (keys.length === 0) {
      this.clear();
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

  /**
   * Puts the panel away until what it is about changes.
   *
   * The dismissal is the memo in show(): the signature is left standing, so
   * every later call describing the same panel is the early return it already
   * was, and the panel stays away without a flag saying so. A different one --
   * a tool picked up, a generator selected, or a run started after a pause,
   * which passes through the empty signature on the way -- does not match, and
   * builds and shows as usual. That is the way back to speed and preferred
   * space, which is worth being sure of: the settings sheet does not carry them.
   */
  dismiss(): void {
    this.clear();
    this.root.hidden = true;
  }

  get visible(): boolean { return !this.root.hidden; }

  /**
   * Forgets the controls along with them. Leaving the syncers behind meant
   * sync() went on writing values into a panel nobody could see, for the rest of
   * the session.
   */
  private clear(): void {
    this.body.replaceChildren();
    this.syncers = [];
  }

  /** Pull displayed values back from settings, after a change made elsewhere. */
  sync(): void {
    for (const s of this.syncers) s();
  }
}
