import type { Settings } from '../state/model';
import { isAppShell, TOUCH } from './appShell';
import {
  SLIDERS, buildSlider, buildToggle, installControls,
  type ChangeHandler, type ToggleSpec,
} from './controls';
import { injectStyle } from './theme';

/**
 * The overlays gui/GUISettings could draw, which is all this group has ever
 * been: they are the ones you turn on to see why the crowd is doing what it is
 * doing, and they are no use to anyone who is not asking that. show3DEffect is
 * gone with the fake-3D.
 *
 * Arrival sound used to be the seventh row here, for no better reason than
 * being the seventh switch. It is a preference, not an overlay, so it has gone
 * to live with the pedestrians it belongs to.
 */
const DEBUG_TOGGLES: ToggleSpec[] = [
  { key: 'showConvexHull', label: 'Convex hulls' },
  { key: 'showConvexParts', label: 'Convex parts' },
  { key: 'showVisibleLines', label: 'Visibility rays' },
  { key: 'showLineToTarget', label: 'Path to goal' },
  { key: 'showPersonalSpace', label: 'Space rings' },
  { key: 'showDebug', label: 'Debug info' },
];

/** A pedestrian plops when it arrives; see plops.ts. */
const SOUND_TOGGLE: ToggleSpec = { key: 'sound', label: 'Arrival sound' };

/*
 * Two sliders, where there were seven.
 *
 * Speed, brush size, preferred space and the two text axes all left, because
 * the contextual panel already offers each of them at the moment it matters --
 * beside the tool in your hand, with the map still in front of you. A second
 * copy in here was the worse of the two: further away, and behind a modal that
 * covers the thing you are adjusting. These are the two nothing else offers.
 */
const PEDESTRIAN_SLIDERS: (keyof Settings)[] = ['pedestrianRadius'];
const DRAWING_SLIDERS: (keyof Settings)[] = ['borderThickness'];

export const SHEET_CSS = `
/*
 * The settings, as one sheet on every device.
 *
 * There used to be two of these: a 232px card floating in a corner, and -- when
 * installed -- a full screen page. Neither was a modal, which is why two
 * surfaces could be open at once and why closing it was never quite reliable.
 * It is a <dialog> opened with showModal() now, and that single change buys the
 * dimmed backdrop, the focus trap, Escape, and everything behind it going inert;
 * the top layer also takes it out of the panels column, so there is no z-index
 * left to lose.
 *
 * The shape still follows the device, because that part was right: a centred
 * card where there is room around it, the screen itself where there is not.
 * Same markup either way; only this stylesheet knows.
 *
 * The light appearance, deliberately. The chrome over the map has to be light --
 * the toolbar icons are 2016 artwork drawn for a light Swing toolbar -- and a
 * dark sheet arriving over a light bar would be the odd one out. What changed is
 * the tint: iOS's system blue is gone for Walky's own orange, which is the
 * colour the path to a goal is drawn in. See ui/theme.ts for how the readable
 * half of it is derived.
 */
.wk-sheet {
  /* Positioned rather than left to the UA, which differs between engines on
     what a modal dialog's box is. Fixed and inset with a definite width, a
     fit-content height and auto margins is the centring that holds everywhere. */
  position: fixed; inset: 0; margin: auto;
  box-sizing: border-box; padding: 0; border: 0;
  width: min(420px, calc(100vw - 32px));
  max-width: none;
  height: fit-content;
  max-height: min(680px, 82vh);
  border-radius: var(--wk-r-sheet);
  overflow: hidden;
  background: var(--wk-card); color: var(--wk-ink);
  font: 17px/1.35 var(--wk-font-family);
  /* No shadow. The backdrop is already dimming everything behind it, so a drop
     shadow would be depth drawn twice -- and the sheet is flat now: one white
     ground, grey groups on it, and nothing pretending to float above anything. */
}
.wk-sheet, .wk-sheet * { box-sizing: border-box; }
/* The UA already hides a closed dialog; this only says what an open one is. */
.wk-sheet[open] { display: flex; flex-direction: column; }

/*
 * Presented and dismissed the way a sheet is.
 *
 * Arriving is the easy half: \`@starting-style\` plus \`display\` under
 * \`allow-discrete\` is what lets an element that was display: none animate in
 * at all. Leaving is the half that needed care -- a dialog drops out of the top
 * layer the instant close() runs, which cuts the exit dead, and the \`overlay\`
 * property that would hold it there is Chromium's alone. So the sheet is never
 * closed while it is still moving: it wears .wk-leaving, animates out under its
 * own [open] attribute, and close() happens at the end of that. Same exit on
 * every engine, and installed iOS -- the shape where the slide-out actually
 * reads -- keeps it.
 */
.wk-sheet {
  opacity: 0; transform: scale(.96);
  transition:
    opacity .28s ease,
    transform .28s cubic-bezier(.32, .72, 0, 1),
    display .28s allow-discrete;
}
.wk-sheet[open] { opacity: 1; transform: scale(1); }
.wk-sheet[open].wk-leaving { opacity: 0; transform: scale(.96); }
@starting-style {
  .wk-sheet[open] { opacity: 0; transform: scale(.96); }
}
.wk-sheet::backdrop {
  background: rgba(0, 0, 0, 0);
  transition: background-color .28s ease, display .28s allow-discrete;
}
.wk-sheet[open]::backdrop { background: rgba(0, 0, 0, .4); }
.wk-sheet[open].wk-leaving::backdrop { background: rgba(0, 0, 0, 0); }
@starting-style {
  .wk-sheet[open]::backdrop { background: rgba(0, 0, 0, 0); }
}
@media (prefers-reduced-motion: reduce) {
  .wk-sheet, .wk-sheet::backdrop { transition: none; }
  .wk-sheet, .wk-sheet[open].wk-leaving { transform: none; opacity: 1; }
}

/*
 * The title, said properly: large, bold and hard against the left edge, with
 * the way out opposite it.
 *
 * It was a 17px label centred in a 44px bar, which is what iOS does to a title
 * when it has a navigation stack to fit around it. This sheet has no stack --
 * there is one screen here and Done is the only control -- so the bar was
 * borrowed furniture. A large left-aligned title reads as the name of the place
 * you are in rather than as a label above it, and it gives the sheet a top-left
 * anchor to hang the rest of the layout from.
 *
 * No rule under it and no blur behind it: the head and the body are the same
 * white ground, and the groups below are what the eye lands on.
 */
.wk-sheet .head {
  flex: 0 0 auto;
  display: grid; grid-template-columns: 1fr auto; align-items: center;
  gap: 12px;
  padding: calc(22px + env(safe-area-inset-top, 0px))
           calc(20px + env(safe-area-inset-right, 0px)) 14px
           calc(20px + env(safe-area-inset-left, 0px));
  background: var(--wk-card);
}
.wk-sheet .head h2 {
  margin: 0; font-size: 34px; font-weight: 700; line-height: 1.05;
  letter-spacing: -.03em;
}
.wk-sheet .head .wk-btn { justify-self: end; }

.wk-sheet .body {
  flex: 1 1 auto; min-height: 0; overflow-y: auto;
  /* #stage turns touch panning off so a drag draws instead of scrolling the
     map; the sheet has to opt back in to be scrollable at all, and contain stops
     a flick at the end of the list bouncing the app behind it. */
  touch-action: pan-y; overscroll-behavior: contain;
  padding: 2px calc(20px + env(safe-area-inset-right, 0px))
           calc(24px + env(safe-area-inset-bottom, 0px))
           calc(20px + env(safe-area-inset-left, 0px));
}

/*
 * A group: grey, generously rounded, sitting on the sheet's white.
 *
 * The inversion is the point. White cells on a grey ground is iOS's grouped
 * list, and it makes the ground the subject -- the cells float on it. Grey
 * blocks on white makes the groups the subject and the sheet merely the paper
 * they are printed on, which is what they are. The corner is 20px rather than
 * iOS's 10 because at that radius a block stops reading as a rectangle with the
 * corners taken off and starts reading as one shape.
 *
 * They sit 12px apart rather than 35. The old gap had to carry the separation
 * on its own, since two white cards on grey are told apart by the space between
 * them; two grey blocks on white are told apart by being grey.
 */
.wk-sheet .group {
  background: var(--wk-group); border-radius: var(--wk-r-group);
  margin-bottom: 12px; overflow: hidden;
}

/* Cells. The separator starts at the text rather than the block's edge, which
   is the detail that makes a list read as a list rather than as a table. */
.wk-sheet .group > * { position: relative; margin: 0; padding: 13px 18px; }
.wk-sheet .group > * + *::before {
  content: ''; position: absolute; left: 18px; right: 0; top: 0;
  height: 1px; background: rgba(60, 60, 67, .1);
}
.wk-sheet .row { min-height: var(--wk-tap); }

/*
 * The name over a group.
 *
 * The blocks were unlabelled, which left the sheet grouped by what a control
 * happens to be -- every slider, then every switch -- rather than by what it is
 * for. That is how a JSON dump for a bug report ended up filed next to the
 * share link and the arrival sound ended up among the debug overlays: with
 * nothing named, nothing was obviously in the wrong place. Naming them is what
 * makes "this block is debug only" a thing the sheet says rather than a thing
 * you infer.
 *
 * It sits outside the block, in the note's typeface and colour, so a heading
 * above a group and a sentence below one read as the same voice talking about
 * it -- and so the block itself stays one uninterrupted shape.
 */
.wk-sheet .group-title {
  margin: 18px 0 6px; padding: 0 18px;
  font-size: 13px; font-weight: 600; letter-spacing: -.01em;
  color: var(--wk-ink-dim);
}
/* The head already leaves 14px under the title; the first heading needs no more. */
.wk-sheet .body > .group-title:first-child { margin-top: 4px; }

/* The sentence under a group, in iOS's footnote place and colour: close under
   the card it belongs to, and carrying the gap to the next thing itself. */
.wk-sheet .group:has(+ .note) { margin-bottom: 6px; }
.wk-sheet .note {
  margin: 0 0 12px; padding: 0 18px;
  font-size: 13px; color: var(--wk-ink-dim); min-height: 16px;
}
/* A note already carries its own gap down to whatever follows, so a heading
   after one takes the note's 12px rather than adding its own 18 to it. */
.wk-sheet .note + .group-title { margin-top: 6px; }

/*
 * The name at the foot of it.
 *
 * iOS ends a settings screen by saying what you are looking at, and Walky has
 * more reason than most: it is a rewrite, and the people whose project this was
 * belong on the last line of it. The version is injected from package.json at
 * build time so that it cannot drift away from what is actually running.
 *
 * The two names are links, which is what "the people whose project this was" is
 * worth once the page is somewhere anyone can find: a credit nobody can follow
 * credits nobody. The policy line under them is the other half of being
 * publicly hosted -- the app stores nothing and asks for nothing, but it is
 * still served from somewhere, and saying where is not optional.
 */
.wk-sheet .about {
  padding: 24px 18px 0; text-align: center; color: var(--wk-ink-dim);
}
.wk-sheet .about .name {
  margin: 0; font-size: 20px; font-weight: 600; letter-spacing: -.02em;
  color: var(--wk-ink);
}
.wk-sheet .about .version { margin: 2px 0 0; font-size: 13px; }
.wk-sheet .about .credit { margin: 10px 0 0; font-size: 13px; line-height: 1.45; }
/* A line clear of the credit, so it reads as its own statement rather than as a
   third clause of the sentence above it. */
.wk-sheet .about .legal { margin: 14px 0 0; font-size: 13px; }

/* The tint every other piece of interactive text in the app wears. A name in
   running prose keeps its underline -- without one it is just a word in a
   sentence that happens to be coloured -- while the policy line stands alone
   and needs no such help. */
.wk-sheet .about a { color: var(--wk-accent-text); text-decoration: none; }
/* A name is one word for wrapping purposes: "Jan" ending a line and "Huber"
   starting the next is a person torn in half. The sentence has other places it
   can break. */
.wk-sheet .about .credit a { text-decoration: underline; white-space: nowrap; }
/* An anchor is not a .wk-btn and inherits none of its ring, so it says the same
   thing here in its own words. */
.wk-sheet .about a:focus-visible {
  outline: 2px solid var(--wk-accent-text); outline-offset: 2px;
  border-radius: 3px;
}

/*
 * Installed on a phone, the sheet is the screen: there is no browser chrome
 * around it to leave room for, and a card floating in the middle of a phone
 * would be a card with nothing behind it. It arrives from the bottom, on iOS's
 * own curve, because that is where a sheet comes from.
 */
@media ${TOUCH} {
  html[data-standalone] .wk-sheet {
    inset: 0; margin: 0;
    width: 100%; height: 100%; max-height: none;
    border-radius: 0;
    opacity: 1; transform: translateY(100%);
    transition:
      transform .32s cubic-bezier(.32, .72, 0, 1),
      display .32s allow-discrete;
  }
  html[data-standalone] .wk-sheet[open] { transform: translateY(0); }
  html[data-standalone] .wk-sheet[open].wk-leaving { transform: translateY(100%); }
  @starting-style {
    html[data-standalone] .wk-sheet[open] { transform: translateY(100%); }
  }
  @media (prefers-reduced-motion: reduce) {
    html[data-standalone] .wk-sheet { transition: none; }
    html[data-standalone] .wk-sheet,
    html[data-standalone] .wk-sheet[open].wk-leaving { transform: none; }
  }
}
`;

/** Distinguishes our history entry from anyone else's; see open() and close(). */
let sequence = 0;

/**
 * An outbound link for the footer.
 *
 * A new tab rather than this one, because leaving is not what someone reading
 * the credits asked for: the simulation they were running is in this tab, and a
 * scenario lives in the URL, so navigating away is how you lose it. The `rel` is
 * belt and braces -- `target="_blank"` implies `noopener` in every engine that
 * ships today, and `_headers` already sends `Referrer-Policy: no-referrer` -- but
 * it costs nothing and does not depend on either staying true.
 */
function link(text: string, href: string): HTMLAnchorElement {
  const a = document.createElement('a');
  a.href = href;
  a.textContent = text;
  a.target = '_blank';
  a.rel = 'noopener noreferrer';
  return a;
}

/**
 * The settings, as a modal sheet.
 *
 * showModal() is doing most of the work here. It puts the sheet in the top
 * layer, dims what is behind it, traps focus inside it and makes the rest of the
 * app inert -- so "never two open at once" stops being something the app tries
 * to arrange and becomes something it cannot violate. The toolbar is
 * untappable while the sheet is up, which is also what retires the old race
 * between a re-open and an in-flight history.back().
 */
export class SettingsSheet {
  private root: HTMLDialogElement;
  private syncers: (() => void)[] = [];
  /**
   * The footnote under each of the two groups that has a button in it.
   *
   * One note used to serve both, on the grounds that only one of them can have
   * been pressed last. That stopped being true of the *place* when the buttons
   * went to opposite ends of the sheet: an answer about the link has no business
   * appearing under the debug block, and vice versa.
   */
  private shareNote: HTMLParagraphElement;
  private debugNote: HTMLParagraphElement;
  /**
   * The id of the history entry we pushed, or null when we have none.
   *
   * A token rather than a flag: a popstate carries the state of the entry it
   * landed on, so comparing it against ours answers "is our entry still the
   * current one" exactly, where a boolean could only say that one existed.
   */
  private entry: number | null = null;
  /** Set while the sheet is animating out; see close(). */
  private leaving = false;
  /** Whatever had focus when the sheet opened, to give it back on the way out. */
  private opener: HTMLElement | null = null;
  private exitTimer = 0;

  constructor(
    private settings: Settings,
    onChange: ChangeHandler,
    private onCopyLink: () => Promise<string>,
    private onCopyMap: () => Promise<string>,
    /** Told whenever the sheet opens or closes, by whatever route. */
    private onOpened: () => void = () => {},
    private onClosed: () => void = () => {},
  ) {
    installControls();
    injectStyle('sheet', SHEET_CSS);

    this.root = document.createElement('dialog');
    this.root.className = 'wk-panel wk-sheet';

    const head = document.createElement('header');
    head.className = 'head';
    const title = document.createElement('h2');
    title.id = 'wk-sheet-title';
    title.textContent = 'Settings';
    this.root.setAttribute('aria-labelledby', title.id);
    const done = document.createElement('button');
    done.type = 'button';
    done.className = 'wk-btn wk-btn--bar';
    done.textContent = 'Done';
    done.addEventListener('click', () => this.close());
    head.append(title, done);

    const body = document.createElement('div');
    body.className = 'body';
    this.root.append(head, body);

    /*
     * Each run of controls is a grouped card under its name, the way iOS groups
     * a settings list; the card's edges say what a dividing rule used to say,
     * and the name says which of these lists you are in.
     *
     * The heading is a real one and the section points at it, so a screen
     * reader announces the block as "Debug, group" rather than reading six
     * unattributed switches -- the caption is the whole reason for the regroup,
     * and it would be a shame for it to be visual only.
     */
    let groups = 0;
    const group = (title: string) => {
      const heading = document.createElement('h3');
      heading.className = 'group-title';
      heading.id = `wk-sheet-group-${++groups}`;
      heading.textContent = title;
      const section = document.createElement('section');
      section.className = 'group';
      section.setAttribute('aria-labelledby', heading.id);
      body.append(heading, section);
      return section;
    };

    const sliders = (into: HTMLElement, keys: (keyof Settings)[]) => {
      for (const key of keys) {
        const spec = SLIDERS[key as string];
        if (!spec) continue;
        const { el, sync } = buildSlider(spec, settings, onChange);
        this.syncers.push(sync);
        into.appendChild(el);
      }
    };

    const toggle = (into: HTMLElement, spec: ToggleSpec) => {
      const { el, sync } = buildToggle(spec, settings, onChange);
      this.syncers.push(sync);
      into.appendChild(el);
    };

    const note = () => {
      const el = document.createElement('p');
      el.className = 'note';
      el.setAttribute('role', 'status');
      return el;
    };

    this.shareNote = note();
    this.debugNote = note();

    /*
     * A button that puts the map on the clipboard and says what it put there.
     *
     * `busy` is not decoration: encoding a large crowd takes long enough to
     * press twice, and two encodes racing to write a note is two answers and
     * one winner. It is still one flag across both buttons, because it is the
     * encode that is slow and there is only one map to encode.
     */
    let busy = false;
    const handOver = (label: string, into: HTMLElement, run: () => Promise<string>) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'wk-btn wk-btn--row';
      button.textContent = label;
      button.addEventListener('click', async () => {
        if (busy) return;
        busy = true;
        try {
          into.textContent = await run();
        } catch {
          into.textContent = 'Clipboard blocked by the browser';
        } finally {
          busy = false;
        }
      });
      return button;
    };

    /*
     * Sharing at the top, because handing the map to someone is the one thing
     * in here you come to the sheet specifically to do -- everything else is a
     * value you adjust while you are already looking at something.
     *
     * Only the link. The two used to sit together on the strength of both being
     * a copy, but they answer different questions to different people: the link
     * reopens the map, which is what you want when you are showing someone
     * something. The JSON describes it, down to which pedestrians are stuck,
     * which is what you want when you are reporting a bug -- so that one has
     * gone to the bottom of the sheet with the rest of the debugging.
     */
    const sharing = group('Sharing');
    sharing.appendChild(handOver('Copy link to this map', this.shareNote, () => this.onCopyLink()));
    // The note sits outside the card: it is the grey footnote under a group,
    // which is where iOS puts the sentence about one.
    body.appendChild(this.shareNote);

    // The crowd itself: how big one of them is, and whether you hear it arrive.
    const pedestrians = group('Pedestrians');
    sliders(pedestrians, PEDESTRIAN_SLIDERS);
    toggle(pedestrians, SOUND_TOGGLE);

    sliders(group('Drawing'), DRAWING_SLIDERS);

    const debug = group('Debug');
    for (const spec of DEBUG_TOGGLES) toggle(debug, spec);
    debug.appendChild(handOver('Copy map to clipboard', this.debugNote, () => this.onCopyMap()));
    body.appendChild(this.debugNote);

    body.appendChild(this.buildAbout());

    // The sheet is a modal in the top layer, so it belongs to the document
    // rather than to the panels column it used to share with the contextual
    // panel. Out of #stage it also means a click on it can never reach the
    // canvas tools, which is what swallowPointerEvents was for.
    document.body.appendChild(this.root);

    // Escape, and the back gesture on Android, both arrive as `cancel`. Taking
    // it over means every way out leaves by the same door -- otherwise the
    // browser would close the dialog behind our back and our history entry
    // would be stranded on the stack.
    this.root.addEventListener('cancel', (ev) => {
      ev.preventDefault();
      this.close();
    });

    // A click on the backdrop. The dialog *is* the card, so "did you hit the
    // element" is not the question -- the question is whether the point was
    // inside its box, which is false only for the backdrop. Guarding on the
    // target first keeps a keyboard-activated click, which reports (0, 0), from
    // reading as a click in the far corner.
    this.root.addEventListener('click', (ev) => {
      if (ev.target !== this.root) return;
      const box = this.root.getBoundingClientRect();
      const inside = ev.clientX >= box.left && ev.clientX <= box.right
        && ev.clientY >= box.top && ev.clientY <= box.bottom;
      if (!inside) this.close();
    });

    // The back gesture is the way out an installed app offers besides the
    // button, and it needs an entry of ours to pop. Landing anywhere that is not
    // our entry means the sheet has been left.
    window.addEventListener('popstate', () => {
      if (this.entry === null) return;
      if (this.currentEntry() === this.entry) return;
      this.entry = null;
      this.close();
    });
  }

  /** The `walkySheet` token of the entry the browser is currently on, if any. */
  private currentEntry(): number | null {
    const state = history.state as { walkySheet?: number } | null;
    return typeof state?.walkySheet === 'number' ? state.walkySheet : null;
  }

  private buildAbout(): HTMLElement {
    const about = document.createElement('footer');
    about.className = 'about';

    const name = document.createElement('p');
    name.className = 'name';
    name.textContent = 'Walky';

    const version = document.createElement('p');
    version.className = 'version';
    version.textContent = `Version ${__WALKY_APP_VERSION__}`;

    const credit = document.createElement('p');
    credit.className = 'credit';
    credit.append(
      'A revival of the 2016 original by ',
      link('Pascal Andermatt', 'https://pandermatt.ch/'),
      ' and ',
      link('Jan Huber', 'https://www.jan-huber.ch'),
      '.',
    );

    const legal = document.createElement('p');
    legal.className = 'legal';
    legal.append(link('Privacy Policy', 'https://pandermatt.ch/privacy-policy/'));

    about.append(name, version, credit, legal);
    return about;
  }

  open(): void {
    // Only reachable through window.__walky: while the sheet is leaving it is
    // still modal, so the toolbar that would ask for it is inert. Cutting the
    // exit short is nonetheless the right answer to being asked.
    if (this.leaving) this.finishExit();
    if (this.visible) return;
    this.opener = document.activeElement as HTMLElement | null;
    this.root.showModal();
    this.sync();
    if (isAppShell()) {
      // Same URL, so this is a history entry and not navigation: there is one
      // page here, and going back from it lands where you already are.
      this.entry = ++sequence;
      history.pushState({ walkySheet: this.entry }, '');
    }
    this.onOpened();
  }

  /**
   * The one way out, whichever route asked for it: Done, Escape, the backdrop,
   * or the back gesture.
   *
   * It starts the exit rather than finishing it -- the dialog stays open, and
   * therefore in the top layer, for as long as it is still moving. Everything
   * that is not the animation happens now, though: the button un-presses on the
   * press, not a third of a second later.
   */
  close(): void {
    if (!this.visible || this.leaving) return;
    this.leaving = true;
    const entry = this.entry;
    this.entry = null;
    this.root.classList.add('wk-leaving');
    this.onClosed();
    // Only when the entry we pushed is still the one the browser is on. Popping
    // otherwise would take a step someone else owns -- and when the pop is what
    // closed us in the first place, there is nothing left to unwind.
    if (entry !== null && this.currentEntry() === entry) history.back();

    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      this.finishExit();
      return;
    }
    // transitionend is the signal; the timer is the promise that one arrives at
    // all, since an engine that ignored the transition would otherwise leave the
    // sheet open forever. The target check is because a control inside the sheet
    // has transitions of its own, and they bubble.
    this.root.addEventListener('transitionend', this.onExitEnd);
    this.exitTimer = window.setTimeout(() => this.finishExit(), 500);
  }

  private onExitEnd = (ev: TransitionEvent): void => {
    if (ev.target !== this.root) return;
    this.finishExit();
  };

  private finishExit(): void {
    if (!this.leaving) return;
    this.leaving = false;
    window.clearTimeout(this.exitTimer);
    this.root.removeEventListener('transitionend', this.onExitEnd);
    this.root.classList.remove('wk-leaving');
    this.shareNote.textContent = '';
    this.debugNote.textContent = '';
    this.root.close();
    // Only now: a modal dialog holds focus, so handing it back before the close
    // would simply be refused.
    if (this.opener?.isConnected) this.opener.focus({ preventScroll: true });
    this.opener = null;
  }

  /** True from the moment it opens until it has finished animating away. */
  get visible(): boolean { return this.root.open; }

  /** Pull displayed values back from settings, after a change made elsewhere. */
  sync(): void {
    void this.settings;
    for (const s of this.syncers) s();
  }
}
