import { formatElapsed } from '../render/recorder';
import { injectStyle, installTheme } from './theme';

/**
 * The clock that shows while a recording is running.
 *
 * It has to be DOM, and that is the whole reason it is its own thing rather than
 * a line drawn with the rest of the overlay: the overlay canvas *is* what gets
 * recorded, so a clock painted there would be burnt into the video, ticking away
 * in the corner of every frame. Chrome cannot be in the picture it is measuring.
 *
 * Top centre, which is the one part of the screen the bar never occupies -- it is
 * in the top-left corner in a browser and across the bottom when installed -- and
 * where a screen recorder puts its indicator anyway.
 *
 * The chip is hidden from assistive technology entirely. A readout that changes
 * every second is noise however it is announced, and the state it is reporting is
 * already carried honestly by the Record button, which is a toggle and says
 * whether it is pressed.
 */
export const RECORDING_CSS = `
/* The same glass as the update chip; what is here is where it sits. */
#wk-recording {
  position: absolute; z-index: 12;
  top: calc(12px + env(safe-area-inset-top, 0px));
  left: 50%; transform: translateX(-50%);
  display: flex; align-items: center; gap: 8px;
  padding: 6px 14px; border-radius: var(--wk-r-cell);
  background: var(--wk-bar);
  border: var(--wk-glass-edge);
  box-shadow: var(--wk-glass-shadow);
  font: var(--wk-font); color: var(--wk-ink);
  /* Nothing in it is pressable, and it floats over the map: a tap that lands on
     the chip should be a tap on what is behind it. */
  pointer-events: none;
  /* The seconds change width in some faces; a tabular figure stops the chip
     twitching once a second. */
  font-variant-numeric: tabular-nums;
}
#wk-recording[hidden] { display: none; }

/* Framing: the chip is saying what to do, not how long it has been doing it. A
   dot that pulses like a recording light while nothing is being recorded would
   be the one part of the screen telling the truth backwards. */
#wk-recording[data-mode="hint"] .dot { display: none; }

/* Walky's own orange rather than a borrowed recording red. The accent is a fill
   and never text (see ui/theme.ts), and a dot is nothing but fill. */
#wk-recording .dot {
  width: 9px; height: 9px; border-radius: 50%;
  background: var(--wk-accent);
  animation: wk-recording-pulse 2s ease-in-out infinite;
}
@keyframes wk-recording-pulse {
  50% { opacity: .35; }
}
@media (prefers-reduced-motion: reduce) {
  #wk-recording .dot { animation: none; }
}
`;

export class RecordingChip {
  private root: HTMLDivElement;
  private readout: HTMLSpanElement;

  constructor(parent: HTMLElement) {
    installTheme();
    injectStyle('recording', RECORDING_CSS);

    this.root = document.createElement('div');
    this.root.id = 'wk-recording';
    this.root.hidden = true;
    this.root.setAttribute('aria-hidden', 'true');

    const dot = document.createElement('span');
    dot.className = 'dot';
    this.readout = document.createElement('span');

    this.root.append(dot, this.readout);
    parent.appendChild(this.root);
  }

  /** Shows the chip, or moves the clock on if it is already up. */
  update(ms: number): void {
    this.readout.textContent = formatElapsed(ms);
    this.root.dataset.mode = 'clock';
    this.root.hidden = false;
  }

  /**
   * The same chip carrying a sentence instead of a clock, for the moment before
   * a recording when the frame is being chosen. Same glass in the same place:
   * what is about to be a readout starts out as the instructions for it.
   */
  hint(message: string): void {
    this.readout.textContent = message;
    this.root.dataset.mode = 'hint';
    this.root.hidden = false;
  }

  hide(): void {
    this.root.hidden = true;
  }
}
