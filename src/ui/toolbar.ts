import type { ToolId } from '../tools/types';
import { TOUCH } from './appShell';

export type ActionId =
  | 'start' | 'clear' | 'record' | 'reset_pedestrians' | 'reset_zoom' | 'settings';

interface ButtonSpec {
  key: ToolId | ActionId;
  /** Filename inside public/icons, including the extension. */
  icon: string;
  title: string;
  /** 'toggle' actions show a pressed state, like a tool does. */
  kind: 'tool' | 'action' | 'toggle';
}

/**
 * Button order and icons follow gui/ToolboxPanel.
 *
 * Its separators are groups here rather than divider elements, because the
 * installed app lays each group out as its own capsule and a rule cannot make
 * a bar out of buttons that only have a line drawn between them. On the desktop
 * strip the divider is still what a group boundary looks like.
 *
 * The strip is light because the original icons were drawn for Swing's light
 * toolbar -- border.png in particular is a black outline that would vanish on a
 * dark strip. Keeping the strip light is what makes the original art read as drawn.
 */
const GROUPS: { name: string; buttons: ButtonSpec[] }[] = [
  {
    name: 'run',
    buttons: [
      { key: 'start', icon: 'start.png', title: 'Start / pause', kind: 'action' },
      { key: 'reset_pedestrians', icon: 'reset_pedestrians.png', title: 'Reset pedestrians', kind: 'action' },
      { key: 'clear', icon: 'clear.png', title: 'Clear map', kind: 'action' },
      { key: 'record', icon: 'record.png', title: 'Record', kind: 'action' },
    ],
  },
  {
    name: 'tools',
    buttons: [
      { key: 'wall', icon: 'addWall.png', title: 'Wall tool', kind: 'tool' },
      { key: 'rectangle', icon: 'addWallSquare.png', title: 'Rectangle wall tool', kind: 'tool' },
      { key: 'border', icon: 'border.png', title: 'Border tool', kind: 'tool' },
      { key: 'pedestrian', icon: 'pedestrian.png', title: 'Add pedestrians', kind: 'tool' },
      { key: 'goal', icon: 'goal.png', title: 'Mark goal', kind: 'tool' },
      { key: 'select', icon: 'select.png', title: 'Selection tool', kind: 'tool' },
      { key: 'shift', icon: 'shift.png', title: 'Pan', kind: 'tool' },
    ],
  },
  {
    name: 'view',
    buttons: [
      { key: 'reset_zoom', icon: 'reset_zoom.png', title: 'Reset zoom and position', kind: 'action' },
      { key: 'settings', icon: 'settings.png', title: 'Settings', kind: 'toggle' },
    ],
  },
];

const BUTTONS: ButtonSpec[] = GROUPS.flatMap((group) => group.buttons);

const CSS = `
#toolbar {
  position: absolute; z-index: 10;
  /* The insets are 0 today: without viewport-fit=cover iOS insets the web view
     above the status bar and the home indicator itself, so there is nothing to
     clear. They are written anyway so the strip stays correct if cover is ever
     turned on, rather than sitting under a notch until someone notices. */
  top: calc(12px + env(safe-area-inset-top, 0px));
  left: calc(12px + env(safe-area-inset-left, 0px));
  display: flex; flex-direction: column; gap: 4px;
  padding: 6px; border-radius: 8px;
  background: #ECECEC; border: 1px solid #9A9A9A;
  box-shadow: 0 2px 10px rgba(0,0,0,.5);
  /* Thirteen buttons do not fit a short window; without this the lower tools,
     settings among them, are simply unreachable. */
  max-height: calc(100vh - 24px - env(safe-area-inset-top, 0px) - env(safe-area-inset-bottom, 0px));
  overflow-y: auto;
  scrollbar-width: thin;
}
#toolbar .group { display: flex; flex-direction: column; gap: 4px; flex: 0 0 auto; }
#toolbar button { flex: 0 0 auto; }
#toolbar button {
  width: 40px; height: 40px; padding: 5px; cursor: pointer;
  background: #F7F7F7; border: 1px solid #B4B4B4; border-radius: 5px;
  display: grid; place-items: center;
}
#toolbar button:hover { background: #FFFFFF; }
#toolbar button[aria-pressed="true"] { background: #C3D9F0; border-color: #4A7EBB; }
#toolbar button img { width: 100%; height: 100%; object-fit: contain; image-rendering: auto; }
#toolbar .sep { height: 1px; background: #B4B4B4; margin: 3px 1px; }

/*
 * The installed app, on a touch device: the strip becomes a row of capsules
 * floating over the bottom of the map.
 *
 * Installed there is no browser chrome, so the top-left corner is the far end
 * of the screen from the hand holding it, and every tool switch is a reach
 * across the whole map. iOS puts navigation at the bottom for that reason.
 *
 * \`pointer: coarse\` rather than a width breakpoint: this is about the hand,
 * not the viewport, and a phone in landscape is 844px wide while still being
 * a phone. An installed desktop window keeps the strip, which is where a
 * pointer wants it.
 *
 * One capsule per group, wrapping, so the layout follows the screen instead of
 * being told about it: portrait puts the seven tools on their own row nearest
 * the thumb with the six others above, and landscape fits all three side by
 * side. \`order\` is what moves the tools capsule last; the buttons stay in
 * ToolboxPanel's order for anything reading the document rather than looking
 * at it.
 */
@media ${TOUCH} {
  html[data-standalone] #toolbar {
    top: auto;
    left: calc(12px + env(safe-area-inset-left, 0px));
    right: calc(12px + env(safe-area-inset-right, 0px));
    bottom: calc(20px + env(safe-area-inset-bottom, 0px));
    flex-direction: row; flex-wrap: wrap;
    justify-content: center; align-items: flex-end;
    gap: 8px; padding: 0;
    max-height: none; overflow: visible;
    background: none; border: 0; box-shadow: none;
    /* The bar is a band across the map with gaps between its capsules; only the
       capsules should take a tap, or the map goes dead wherever one is not.
       Same split as #panels. */
    pointer-events: none;
  }
  html[data-standalone] #toolbar .sep { display: none; }
  html[data-standalone] #toolbar .group[data-group="tools"] { order: 1; }

  /*
   * Liquid glass: a pane that samples the map behind it rather than covering
   * it, so a wall passing underneath still reads through the bar.
   *
   * saturate(180%) is the half that does the work -- blur alone gives frosted
   * plastic, greyed and flat, and pushing saturation back up is what makes the
   * colours behind bloom through. The inset highlight is the specular line
   * along the top edge.
   *
   * The fallback is not decoration: backdrop-filter is the whole effect, and
   * without it the pane is 72% opaque with the map legible through it. Where
   * the filter is unsupported the capsule goes fully opaque instead.
   */
  html[data-standalone] #toolbar .group {
    pointer-events: auto;
    flex-direction: row; flex-wrap: wrap; justify-content: center;
    gap: 4px; padding: 6px;
    border-radius: 999px;
    background: #ECECEC;
    /* A hairline and a soft, wide shadow: a floating bar reads as sitting a
       little above the content, not as an outlined box drawn on top of it. */
    border: .5px solid rgba(0, 0, 0, .08);
    box-shadow: inset 0 .5px 0 0 rgba(255, 255, 255, .7), 0 6px 20px rgba(0, 0, 0, .38);
  }
  @supports (backdrop-filter: blur(1px)) or (-webkit-backdrop-filter: blur(1px)) {
    html[data-standalone] #toolbar .group {
      background: rgba(236, 236, 236, .72);
      -webkit-backdrop-filter: blur(20px) saturate(180%);
      backdrop-filter: blur(20px) saturate(180%);
    }
  }

  /* A cell, not a button: the capsule is the object, and only the armed tool
     wears a pill. 44px is the tap target a thumb needs. */
  html[data-standalone] #toolbar button {
    width: 44px; height: 44px; padding: 7px;
    border-radius: 999px;
    background: none; border-color: transparent;
    transition: background-color .15s ease;
  }
  html[data-standalone] #toolbar button:hover { background: none; }
  /* Dimming, which is how iOS acknowledges a tap; the icons are artwork and
     cannot be tinted, so the cell tints instead. */
  html[data-standalone] #toolbar button:active { opacity: .4; }
  html[data-standalone] #toolbar button[aria-pressed="true"] {
    background: rgba(0, 122, 255, .16); border-color: transparent;
  }
}
`;

export class Toolbar {
  private root: HTMLDivElement;
  private buttons = new Map<string, HTMLButtonElement>();
  /** null means no tool is armed, which is the state after a one-shot action. */
  private activeTool: ToolId | null;

  constructor(
    parent: HTMLElement,
    initialTool: ToolId | null,
    private onTool: (id: ToolId) => void,
    private onAction: (id: ActionId) => void,
  ) {
    this.activeTool = initialTool;

    const style = document.createElement('style');
    style.textContent = CSS;
    document.head.appendChild(style);

    this.root = document.createElement('div');
    this.root.id = 'toolbar';

    for (const [index, group] of GROUPS.entries()) {
      if (index > 0) {
        const sep = document.createElement('div');
        sep.className = 'sep';
        this.root.appendChild(sep);
      }
      const box = document.createElement('div');
      box.className = 'group';
      box.dataset.group = group.name;

      for (const spec of group.buttons) {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.title = spec.title;
        btn.setAttribute('aria-label', spec.title);
        if (spec.kind !== 'action') {
          btn.setAttribute('aria-pressed', String(spec.key === initialTool));
        }
        const img = document.createElement('img');
        img.src = `./icons/${spec.icon}`;
        img.alt = '';
        btn.appendChild(img);
        btn.addEventListener('click', () => {
          if (spec.kind === 'tool') this.selectTool(spec.key as ToolId);
          else this.onAction(spec.key as ActionId);
        });
        this.buttons.set(spec.key, btn);
        box.appendChild(btn);
      }
      this.root.appendChild(box);
    }
    parent.appendChild(this.root);
    this.publishHeight();
  }

  /**
   * Publishes the strip's height as --wk-toolbar-h.
   *
   * The installed app's bar is a row of capsules that wraps according to the
   * screen, so it is one row deep in landscape and two in portrait, and both
   * the panels and the update chip have to stay clear of whichever it is.
   * Measuring it here is what lets everything downstream stay a CSS rule
   * instead of a second copy of the wrapping logic.
   */
  private publishHeight(): void {
    const write = () => {
      const height = Math.round(this.root.getBoundingClientRect().height);
      document.documentElement.style.setProperty('--wk-toolbar-h', `${height}px`);
    };
    write();
    new ResizeObserver(write).observe(this.root);
  }

  /**
   * @param silent set when the app is telling the toolbar what happened, rather
   *   than the user clicking -- avoids bouncing the change straight back.
   */
  selectTool(id: ToolId | null, silent = false): void {
    this.activeTool = id;
    for (const spec of BUTTONS) {
      if (spec.kind !== 'tool') continue;
      this.buttons.get(spec.key)?.setAttribute('aria-pressed', String(spec.key === id));
    }
    if (!silent && id) this.onTool(id);
  }

  get tool(): ToolId | null { return this.activeTool; }

  /** Marks a toggle action as on or off, e.g. the settings button while open. */
  setPressed(key: ActionId, pressed: boolean): void {
    this.buttons.get(key)?.setAttribute('aria-pressed', String(pressed));
  }

  /** Swaps the start icon for pause, as ToolboxPanel did on toggle. */
  setRunning(running: boolean): void {
    const btn = this.buttons.get('start');
    const img = btn?.querySelector('img');
    if (img) img.src = `./icons/${running ? 'pause' : 'start'}.png`;
  }
}
