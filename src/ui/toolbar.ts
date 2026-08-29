import type { ToolId } from '../tools/types';

export type ActionId =
  | 'start' | 'clear' | 'record' | 'reset_pedestrians' | 'reset_zoom' | 'settings';

interface ButtonSpec {
  key: ToolId | ActionId;
  /** Filename inside public/icons, including the extension. */
  icon: string;
  title: string;
  kind: 'tool' | 'action';
}

/**
 * Button order and icons follow gui/ToolboxPanel.
 *
 * The strip is light because the original icons were drawn for Swing's light
 * toolbar -- border.png in particular is a black outline that would vanish on a
 * dark strip. Keeping the strip light is what makes the original art read as drawn.
 *
 * All icons are the original PNGs except the rectangle tool, which is an SVG. The
 * original addWallSquare.png was a house-with-a-plus nearly identical to the
 * freehand wall icon beside it, so the two were hard to tell apart in the strip.
 */
const BUTTONS: ButtonSpec[] = [
  { key: 'start', icon: 'start.png', title: 'Start / pause', kind: 'action' },
  { key: 'reset_pedestrians', icon: 'reset_pedestrians.png', title: 'Reset pedestrians', kind: 'action' },
  { key: 'clear', icon: 'clear.png', title: 'Clear map', kind: 'action' },
  { key: 'record', icon: 'record.png', title: 'Record', kind: 'action' },
  { key: 'wall', icon: 'addWall.png', title: 'Wall tool', kind: 'tool' },
  { key: 'rectangle', icon: 'rectangle.svg', title: 'Rectangle wall tool', kind: 'tool' },
  { key: 'border', icon: 'border.png', title: 'Border tool', kind: 'tool' },
  { key: 'pedestrian', icon: 'pedestrian.png', title: 'Add pedestrians', kind: 'tool' },
  { key: 'goal', icon: 'goal.png', title: 'Mark goal', kind: 'tool' },
  { key: 'select', icon: 'select.png', title: 'Selection tool', kind: 'tool' },
  { key: 'shift', icon: 'shift.png', title: 'Pan', kind: 'tool' },
  { key: 'reset_zoom', icon: 'reset_zoom.png', title: 'Reset zoom', kind: 'action' },
  { key: 'settings', icon: 'settings.png', title: 'Settings', kind: 'action' },
];

const CSS = `
#toolbar {
  position: absolute; top: 12px; left: 12px; z-index: 10;
  display: flex; flex-direction: column; gap: 4px;
  padding: 6px; border-radius: 8px;
  background: #ECECEC; border: 1px solid #9A9A9A;
  box-shadow: 0 2px 10px rgba(0,0,0,.5);
}
#toolbar button {
  width: 40px; height: 40px; padding: 5px; cursor: pointer;
  background: #F7F7F7; border: 1px solid #B4B4B4; border-radius: 5px;
  display: grid; place-items: center;
}
#toolbar button:hover { background: #FFFFFF; }
#toolbar button[aria-pressed="true"] { background: #C3D9F0; border-color: #4A7EBB; }
#toolbar button img { width: 100%; height: 100%; object-fit: contain; image-rendering: auto; }
#toolbar .sep { height: 1px; background: #B4B4B4; margin: 3px 1px; }
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

    for (const spec of BUTTONS) {
      if (spec.key === 'wall' || spec.key === 'reset_zoom') {
        const sep = document.createElement('div');
        sep.className = 'sep';
        this.root.appendChild(sep);
      }
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.title = spec.title;
      btn.setAttribute('aria-label', spec.title);
      if (spec.kind === 'tool') {
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
      this.root.appendChild(btn);
    }
    parent.appendChild(this.root);
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

  /** Swaps the start icon for pause, as ToolboxPanel did on toggle. */
  setRunning(running: boolean): void {
    const btn = this.buttons.get('start');
    const img = btn?.querySelector('img');
    if (img) img.src = `./icons/${running ? 'pause' : 'start'}.png`;
  }
}
