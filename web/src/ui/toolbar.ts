import type { ToolId } from '../tools/types';
import { FINE, HANDHELD, TOUCH } from './appShell';
import { injectStyle, installTheme } from './theme';
import { attachTooltip } from './tooltip';

export type ActionId =
  | 'start' | 'undo' | 'clear' | 'record' | 'reset_pedestrians' | 'reset_zoom' | 'settings';

interface ButtonSpec {
  key: ToolId | ActionId;
  /** Filename inside public/icons, including the extension. */
  icon: string;
  title: string;
  /** 'toggle' actions show a pressed state, like a tool does. */
  kind: 'tool' | 'action' | 'toggle';
  /** How the shortcut is written, in the tooltip and to a screen reader. */
  shortcut?: string;
  /**
   * The `KeyboardEvent.key` that presses this button, unmodified. Left off
   * where the shortcut takes a modifier and the app binds it itself: undo is
   * Ctrl+Z, which is not one key and not one platform's spelling of it.
   */
  press?: string;
  /**
   * Present in the document but hidden where there is no mouse -- see the rule
   * at the foot of the stylesheet. A flag rather than leaving the button out at
   * build time, because the question is about the input in use and a hybrid
   * machine changes its answer while the page is open; a CSS rule follows that
   * and a list built once does not.
   */
  desktopOnly?: boolean;
}

/**
 * The strip, in three capsules: what the simulation is doing, what you draw it
 * with, and where you are looking from.
 *
 * Inside each capsule the order is by subject, which it was not always. The
 * eraser, the text tool and the generator were each appended to the end of the
 * tools capsule as they were built, so that adding one would not renumber the
 * digits of tools people already knew -- which left a generator ten cells away
 * from the pedestrian brush it is a variety of. A shortcut is learnt once and a
 * neighbour is read every time, so the tools are sorted by what they do now and
 * the digits follow them.
 *
 * The separators of the original gui/ToolboxPanel are these groups rather than
 * divider elements: each group is laid out as its own capsule, and a rule cannot
 * make a bar out of buttons that only have a line drawn between them. The gap
 * between two capsules is what the separator was saying.
 *
 * The strip is light because the original icons were drawn for Swing's light
 * toolbar -- border.png in particular is a black outline that would vanish on a
 * dark strip. Keeping the strip light is what makes the original art read as drawn.
 */
const GROUPS: { name: string; buttons: ButtonSpec[] }[] = [
  {
    name: 'run',
    buttons: [
      { key: 'start', icon: 'start.png', title: 'Start / pause', kind: 'action', shortcut: 'Space', press: ' ' },
      { key: 'reset_pedestrians', icon: 'reset_pedestrians.png', title: 'Reset pedestrians', kind: 'action' },
      // Beside start rather than below clear: what a recording captures is a
      // run, so it belongs with the buttons that run one. A toggle rather than
      // a one-shot, because a recording is a state you are in, and the pressed
      // cell is the only thing on the strip that says you are in it.
      { key: 'record', icon: 'record.png', title: 'Record', kind: 'toggle' },
      // Then the two that take something back, kept together and kept last so
      // that the capsule reads forwards before it reads backwards. The 2016
      // toolbar had no undo to place. Its shortcut is written in the tooltip by
      // the same rule as every other, rather than spelt inside this one label.
      { key: 'undo', icon: 'undo.png', title: 'Undo', kind: 'action', shortcut: 'Ctrl+Z' },
      { key: 'clear', icon: 'clear.png', title: 'Clear map', kind: 'action' },
    ],
  },
  {
    name: 'tools',
    buttons: [
      // 1 to 9 down the capsule, in the order they are drawn: the number is
      // "how far down the tools are you", which is a thing you can see, rather
      // than an initial you have to have been told (w for wall, but which of
      // rectangle, record and reset gets r?).
      //
      // Sorted by what a tool puts on the map. First the geometry the map is
      // made of, coarse to fine:
      { key: 'wall', icon: 'addWall.png', title: 'Wall tool', kind: 'tool', shortcut: '1', press: '1' },
      { key: 'rectangle', icon: 'addWallSquare.png', title: 'Rectangle wall tool', kind: 'tool', shortcut: '2', press: '2' },
      { key: 'border', icon: 'border.png', title: 'Border tool', kind: 'tool', shortcut: '3', press: '3' },
      // then the people and the business they have there. A generator is the
      // pedestrian brush that keeps brushing and a goal is where whatever either
      // one drops is headed, so the three of them only make sense read together;
      // the generator spent its first life on 0, at the far end of the capsule
      // from the tool it is a variety of.
      { key: 'pedestrian', icon: 'pedestrian.png', title: 'Add pedestrians', kind: 'tool', shortcut: '4', press: '4' },
      { key: 'generator', icon: 'generator.svg', title: 'Add generator', kind: 'tool', shortcut: '5', press: '5' },
      { key: 'goal', icon: 'goal.png', title: 'Mark goal', kind: 'tool', shortcut: '6', press: '6' },
      // then the pair that acts on what is already down instead of adding to it.
      // The eraser is next to the selection tool and not next to the walls it
      // eats, because what it has in common with them is its subject and what it
      // has in common with select is what you are doing: picking out one shape
      // that is already there.
      { key: 'select', icon: 'select.png', title: 'Selection tool', kind: 'tool', shortcut: '7', press: '7' },
      { key: 'erase', icon: 'erase.svg', title: 'Erase shapes', kind: 'tool', shortcut: '8', press: '8', desktopOnly: true },
      // and last the one tool that adds nothing to the simulation: a label is
      // for the person reading the map, not for anybody walking on it.
      { key: 'text', icon: 'text.svg', title: 'Add text', kind: 'tool', shortcut: '9', press: '9', desktopOnly: true },
    ],
  },
  {
    name: 'view',
    buttons: [
      // Pan is down here rather than among the tools because it does not touch
      // the map at all -- it moves the camera, and reset_zoom directly below it
      // is the button that puts the camera back. It stays a tool, with a tool's
      // pressed cell, because that is what it is: ported from
      // ZoomMouseListener.shiftView, where dragging panned only while it was the
      // selected tool, so a mouse has no other way to move the map.
      //
      // A touchscreen does -- two fingers, see the rule at the foot of the
      // stylesheet -- and the cell is withheld there for it.
      //
      // It keeps a digit either way, and the digit keeps its meaning by widening
      // from the capsule to the strip: Pan is the tenth tool counting down the
      // document, which puts it on 0 -- ten is where a row of single digits runs
      // out and 0 is the key that follows 9 along it.
      { key: 'shift', icon: 'shift.png', title: 'Pan', kind: 'tool', shortcut: '0', press: '0', desktopOnly: true },
      { key: 'reset_zoom', icon: 'reset_zoom.png', title: 'Reset zoom and position', kind: 'action' },
      { key: 'settings', icon: 'settings.png', title: 'Settings', kind: 'toggle' },
    ],
  },
];

const BUTTONS: ButtonSpec[] = GROUPS.flatMap((group) => group.buttons);

export interface Shortcut {
  key: ToolId | ActionId;
  kind: ButtonSpec['kind'];
}

/**
 * What a bare keypress arms, keyed by `KeyboardEvent.key`.
 *
 * Derived from the strip rather than written out again next to the key handler:
 * the digits mean how far down the strip a tool is -- counted across the
 * capsules, which is why Pan down in the view group is still the tenth -- so a
 * list of them kept somewhere else is a list that goes wrong the first time a
 * tool moves.
 * The app does the listening -- a shortcut is not the toolbar's to take from
 * whatever else has the keyboard -- and this is what it looks up.
 */
export const SHORTCUTS: ReadonlyMap<string, Shortcut> = new Map(
  BUTTONS.flatMap((spec) => (
    spec.press ? [[spec.press, { key: spec.key, kind: spec.kind }] as const] : []
  )),
);

/** ARIA spells its modifiers out in full; the tooltip writes them as people do. */
function ariaKeyshortcuts(shortcut: string): string {
  return shortcut.replace('Ctrl', 'Control');
}

export const TOOLBAR_CSS = `
/*
 * The strip: capsules of glass with the 2016 icons in them.
 *
 * It used to be a grey Swing box on a laptop and a row of glass capsules on a
 * phone, which is two toolbars to keep in step and was never a decision anybody
 * made -- the phone one came later and the first was simply left where it was.
 * The look is one look now. What still follows the device is the *placement*,
 * because that was a real argument: installed there is no browser chrome, so the
 * top-left corner is the far end of the screen from the hand holding the phone,
 * and iOS puts navigation at the bottom for that reason. A pointer wants it in
 * the corner. So the strip moves and the buttons do not change.
 *
 * The cells themselves come from ui/theme.ts; what is left here is where the
 * thing sits.
 */
#toolbar {
  position: absolute; z-index: 10;
  /* The insets are 0 today: without viewport-fit=cover iOS insets the web view
     above the status bar and the home indicator itself, so there is nothing to
     clear. They are written anyway so the strip stays correct if cover is ever
     turned on, rather than sitting under a notch until someone notices. */
  top: calc(12px + env(safe-area-inset-top, 0px));
  left: calc(12px + env(safe-area-inset-left, 0px));
  display: flex; flex-direction: column; gap: 8px; align-items: flex-start;
  /* Seventeen buttons do not fit a short window; without this the lower tools,
     settings among them, are simply unreachable. A wheel over a capsule scrolls
     this, since the capsule is what takes the pointer. */
  max-height: calc(100vh - 24px - env(safe-area-inset-top, 0px) - env(safe-area-inset-bottom, 0px));
  overflow-y: auto;
  scrollbar-width: thin;
  /* Between the capsules the bar is not there at all: only they take a tap, or
     the map would go dead across a band it is still visible through. */
  pointer-events: none;
}

/*
 * Liquid glass: a pane that samples the map behind it rather than covering it,
 * so a wall passing underneath still reads through the bar.
 *
 * saturate(180%) is the half that does the work -- blur alone gives frosted
 * plastic, greyed and flat, and pushing saturation back up is what makes the
 * colours behind bloom through. The inset highlight is the specular line along
 * the top edge.
 *
 * The fallback is not decoration: backdrop-filter is the whole effect, and
 * without it the pane is 72% opaque with the map legible through it. Where the
 * filter is unsupported the capsule goes fully opaque instead.
 */
#toolbar .group {
  pointer-events: auto;
  display: flex; flex-direction: column; flex: 0 0 auto;
  flex-wrap: wrap; justify-content: center;
  gap: 4px; padding: 6px;
  border-radius: var(--wk-r-cell);
  background: var(--wk-bar);
  border: var(--wk-glass-edge);
  box-shadow: var(--wk-glass-shadow);
}
@supports (backdrop-filter: blur(1px)) or (-webkit-backdrop-filter: blur(1px)) {
  #toolbar .group {
    background: rgba(236, 236, 236, .72);
    -webkit-backdrop-filter: var(--wk-glass-blur);
    backdrop-filter: var(--wk-glass-blur);
  }
}

/*
 * The play triangle, put in shadow.
 *
 * start.png is drawn in a neon rgb(76,218,67) that measures 1.9:1 against the
 * capsule and 1.3:1 where the capsule is over the dark map -- the one icon in
 * the strip nobody can see, while the rest of the set is black. WCAG 1.4.11 asks
 * 3:1 of a graphic that *is* the control.
 *
 * brightness(.49) is Java's Color.darker() applied twice: CSS's shorthand
 * filters multiply in sRGB, so this is the same channel arithmetic shadowOf()
 * does in palette.ts, and the same operation the accent's ink comes from. It
 * lands on rgb(37,106,32) -- 5.7:1 on the capsule, 3.2:1 over a dark map, and
 * still green. Recolouring the file would have hidden the rule inside a binary.
 *
 * setRunning swaps in pause.png, which is pure black; the filter leaves it black.
 */
#toolbar .wk-btn--cell[data-key="start"] img { filter: brightness(.49); }

/*
 * The cells that are not offered on a handheld.
 *
 * Record wants a two-minute sit-still and hands back a file a phone has nowhere
 * good to put; the text tool wants a keyboard. Neither is a control that works
 * worse on a phone -- they are controls a phone has no answer for -- so they are
 * taken out of the strip rather than left there to disappoint. \`display: none\`
 * removes the cell from the layout and from the accessibility tree both, and the
 * query is live, so a tab handed to an installed window or a desktop window
 * dragged narrow agrees without anything listening for it.
 *
 * The generator used to be withheld here too, on an argument about room rather
 * than input: a tool you place and then tune, over a screen that is mostly map
 * already. It goes down in one tap like the others and it tunes with one slider,
 * so the room it wanted was really the strip's, and the strip has it now that
 * Pan has gone to the pinch. A phone that can build a crowd should be able to
 * build the door the crowd comes out of.
 *
 * Two further rules at the foot of this stylesheet withhold the eraser and Pan,
 * and each asks a different question on purpose -- whether there is a mouse to
 * hover with, and whether there is a second finger to pan with. A laptop window
 * dragged narrow can still aim an eraser and still needs its Pan cell; it still
 * has nowhere to put a video.
 */
@media ${HANDHELD} {
  #toolbar .wk-btn--cell[data-key="record"],
  #toolbar .wk-btn--cell[data-key="text"] { display: none; }
}

/*
 * Installed on a touch device the strip becomes a bar across the bottom.
 *
 * \`pointer: coarse\` rather than a width breakpoint: this is about the hand,
 * not the viewport, and a phone in landscape is 844px wide while still being a
 * phone. An installed desktop window keeps the corner, which is where a pointer
 * wants it.
 *
 * The capsules wrap, so the layout follows the screen instead of being told
 * about it: portrait puts the tools on the row nearest the thumb with the run
 * and view controls sharing the row above, and landscape fits all three side by
 * side. \`order\` is what moves the tools capsule last, because the tools are
 * what a hand on a phone is reaching for all afternoon.
 *
 * Run and view sit on one row because between them they are six cells here --
 * record is withheld from one and Pan from the other -- and six cells fit a
 * phone across. Nothing arranges that; they are simply short enough to wrap
 * together, which is the point of letting the wrapping decide.
 *
 * The buttons stay in document order for anything reading the strip rather than
 * looking at it, which is also the order the digits are numbered in.
 */
@media ${TOUCH} {
  html[data-standalone] #toolbar {
    top: auto;
    left: calc(12px + env(safe-area-inset-left, 0px));
    right: calc(12px + env(safe-area-inset-right, 0px));
    bottom: calc(20px + env(safe-area-inset-bottom, 0px));
    flex-direction: row; flex-wrap: wrap;
    justify-content: center; align-items: flex-end;
    max-height: none; overflow: visible;
  }
  /* max-width so that a capsule too wide for the screen wraps inside itself
     rather than hanging off both edges: the group is flex: 0 0 auto, so without
     a cap it keeps its content width and the end cells go somewhere no thumb can
     reach. The tools capsule is seven across now and a 320px phone is 296px of
     usable bar, which is the case this is for. */
  html[data-standalone] #toolbar .group { flex-direction: row; max-width: 100%; }
  html[data-standalone] #toolbar .group[data-group="tools"] { order: 1; }
}

/*
 * The eraser is withheld from anything but a mouse.
 *
 * It is the one destructive tool on the strip, and a fingertip over a map of
 * shapes drawn against each other is the worst input there is for saying which
 * one to delete -- the finger covers the answer. A pointer can hover first and
 * see the outline go red before it commits, which is the whole safety net, and
 * a touchscreen has no hover to give.
 *
 * Not a width breakpoint, for the reason the bar's placement is not one either:
 * the question is what is in the hand. \`not all and\` is how a media query is
 * negated, and it is negated rather than written as coarse-or-no-hover so that
 * this rule and the one the app asks in setTool are the same sentence.
 */
@media not all and ${FINE} {
  #toolbar .wk-btn--cell[data-key="erase"] { display: none; }
}

/*
 * Pan is withheld from a touchscreen, which already has a better one.
 *
 * Two fingers travelling together pan the view whatever tool is armed (see the
 * pinch in app.ts), so on a phone the cell is a slower spelling of a gesture the
 * hand is already making -- and one that costs the tool you had in your hand to
 * use. A mouse has no equivalent: dragging belongs to whichever tool is armed,
 * as it did in ZoomMouseListener, so there the cell is the only way to move the
 * map and it stays.
 *
 * \`pointer: coarse\` and not the handheld query, which would also catch a
 * desktop window dragged under 640px -- that window has a mouse and no pinch,
 * and hiding Pan there would leave it with no way to move the map at all.
 */
@media ${TOUCH} {
  #toolbar .wk-btn--cell[data-key="shift"] { display: none; }
}
`;

export class Toolbar {
  private root: HTMLDivElement;
  private buttons = new Map<string, HTMLButtonElement>();
  /** The strip's last measured box; see publishMetrics and `frame`. */
  private box: DOMRect = new DOMRect();
  /** null means no tool is armed, which is the state after a one-shot action. */
  private activeTool: ToolId | null;

  constructor(
    parent: HTMLElement,
    initialTool: ToolId | null,
    private onTool: (id: ToolId) => void,
    private onAction: (id: ActionId) => void,
  ) {
    this.activeTool = initialTool;

    installTheme();
    injectStyle('toolbar', TOOLBAR_CSS);

    this.root = document.createElement('div');
    this.root.id = 'toolbar';

    for (const group of GROUPS) {
      const box = document.createElement('div');
      box.className = 'group';
      box.dataset.group = group.name;

      for (const spec of group.buttons) {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'wk-btn wk-btn--cell';
        btn.dataset.key = spec.key;
        btn.setAttribute('aria-label', spec.title);
        if (spec.shortcut) btn.setAttribute('aria-keyshortcuts', ariaKeyshortcuts(spec.shortcut));
        // Instead of `title`: the browser holds that back a second or two, which
        // for a strip of icon-only buttons is the same as not having it. The
        // aria-label above stays the accessible name; the tip is decoration.
        //
        // The tip is also where the shortcuts are published. There is no menu
        // bar to list them in, so a key nobody is told about is a key nobody
        // presses -- hovering the tool you were going to click anyway is the
        // one moment you are already looking at the answer.
        attachTooltip(btn, spec.shortcut ? `${spec.title} (${spec.shortcut})` : spec.title);
        // A tool starts pressed if it is the armed one; a toggle starts on its
        // own state, which is off. Comparing a toggle's key against the initial
        // *tool* used to give the right answer by accident, which is worse than
        // giving the wrong one.
        if (spec.kind === 'tool') {
          btn.setAttribute('aria-pressed', String(spec.key === initialTool));
        } else if (spec.kind === 'toggle') {
          btn.setAttribute('aria-pressed', 'false');
        }
        const img = document.createElement('img');
        img.src = `./icons/${spec.icon}`;
        img.alt = '';
        btn.appendChild(img);
        btn.addEventListener('click', () => {
          // A mouse press leaves the focus sitting on the button, and a focused
          // button answers Space by pressing itself -- so picking a tool with
          // the mouse would quietly turn the Space shortcut into "that tool
          // again". Keyboard focus is kept: that one is someone's place in the
          // strip, and :focus-visible is exactly the difference between the two.
          if (!btn.matches(':focus-visible')) btn.blur();
          if (spec.kind === 'tool') this.selectTool(spec.key as ToolId);
          else this.onAction(spec.key as ActionId);
        });
        this.buttons.set(spec.key, btn);
        box.appendChild(btn);
      }
      this.root.appendChild(box);
    }
    parent.appendChild(this.root);
    this.publishMetrics();
  }

  /**
   * Measures the strip: publishes its height as --wk-toolbar-h and keeps `frame`
   * current.
   *
   * The installed app's bar is a row of capsules that wraps according to the
   * screen, so it is one row deep in landscape and two in portrait, and both
   * the panels and the update chip have to stay clear of whichever it is.
   * Measuring it here is what lets everything downstream stay a CSS rule
   * instead of a second copy of the wrapping logic.
   */
  private publishMetrics(): void {
    const write = () => {
      this.box = this.root.getBoundingClientRect();
      const height = Math.round(this.box.height);
      document.documentElement.style.setProperty('--wk-toolbar-h', `${height}px`);
    };
    write();
    new ResizeObserver(write).observe(this.root);
    // Where the strip is can change without its size changing: installed, the
    // bar is pinned to the bottom edge, so a shorter window walks it up the
    // screen while it stays exactly as big -- and an observer watching for a
    // change of size hears nothing about that.
    window.addEventListener('resize', write);
  }

  /**
   * The box the strip occupies, in CSS pixels.
   *
   * For the debug readout, which is painted on the overlay canvas so that it is
   * there in a recording -- and a canvas cannot be asked to flow around a div,
   * so whatever draws over the map has to be told where the bar is and step
   * around it itself. Read from the measurement above rather than measured on
   * demand: this is asked once a frame while the readout is on, and a
   * getBoundingClientRect inside a render loop is a layout flush per frame.
   */
  get frame(): DOMRect { return this.box; }

  /**
   * Whether a cell is actually on offer, which on a handheld some are not.
   *
   * Asked of the stylesheet rather than of `matchMedia`, so the guard cannot
   * give a different answer from the rule that hides the cell: the media query
   * lives in one place (see HANDHELD in ui/appShell.ts) and this reads what it
   * decided. A second `matchMedia` call would be a second opinion, and a window
   * that has not been laid out yet reports a width of zero, which is a phone as
   * far as a width query is concerned and nothing at all as far as CSS is.
   */
  offers(key: ToolId | ActionId): boolean {
    const button = this.buttons.get(key);
    return button ? getComputedStyle(button).display !== 'none' : false;
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

  /**
   * Greys out an action there is nothing to do with -- undo with an empty
   * stack. A disabled button is the honest answer to "can I?", where one that
   * looks live and does nothing is not; `.wk-btn:disabled` carries the look.
   *
   * @param reason renames the cell while it is out, for something a browser
   *   simply cannot do -- recording, on the ones that cannot -- where "not now"
   *   is a dead end rather than an answer. The accessible name and not the tip,
   *   because a tip is not shown over a disabled control at all (see
   *   ui/tooltip.ts), so a name is the only place the sentence can go. Omitted,
   *   the button goes back to naming itself.
   */
  setEnabled(key: ActionId, enabled: boolean, reason?: string): void {
    const btn = this.buttons.get(key);
    if (!btn) return;
    btn.disabled = !enabled;
    const name = !enabled && reason
      ? reason
      : BUTTONS.find((spec) => spec.key === key)?.title;
    if (name) btn.setAttribute('aria-label', name);
  }

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
