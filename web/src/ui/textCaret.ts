import { LABEL_MAX_CHARS } from '../state/model';

/**
 * The keyboard behind a label being typed on the canvas.
 *
 * A real `<input>`, kept out of sight, rather than a raw keydown listener. The
 * text is drawn on the overlay so that what you type looks exactly like what you
 * get -- but the *typing* is a solved problem nobody should solve again: an
 * input already knows about dead keys, an IME composing a character over several
 * presses, a phone's autocorrect, holding a key down, and paste. A key handler
 * knows about none of it and would collect a first draft of all of them.
 *
 * It also settles the shortcuts for free. The app holds its bare keys back from
 * anything matching `input, textarea, [contenteditable]` (see App.bindPointer),
 * so while this is focused "4" is the character four rather than the pedestrian
 * brush, and Escape belongs to the caret rather than to the tool.
 *
 * Hidden by size and opacity rather than `display: none` or `visibility:
 * hidden`, both of which make an element unfocusable. It is parked at the point
 * being typed at so that the operating system's own IME popup -- which follows
 * the caret, not the element -- opens where the words are appearing.
 */
export class TextCaret {
  private input: HTMLInputElement;
  private done: ((text: string | null) => void) | null = null;

  constructor(parent: HTMLElement, private onChange: (text: string) => void) {
    const input = document.createElement('input');
    input.type = 'text';
    input.maxLength = LABEL_MAX_CHARS;
    input.autocomplete = 'off';
    input.setAttribute('aria-label', 'Label text');
    input.style.cssText = [
      'position:absolute', 'width:1px', 'height:1px',
      'padding:0', 'border:0', 'background:transparent',
      'color:transparent', 'opacity:0', 'z-index:1',
    ].join(';');
    input.hidden = true;

    input.addEventListener('input', () => this.onChange(input.value));
    input.addEventListener('keydown', (ev) => {
      if (ev.key === 'Enter') {
        ev.preventDefault();
        this.finish(input.value);
      } else if (ev.key === 'Escape') {
        ev.preventDefault();
        this.finish(null);
      }
    });
    // Clicking elsewhere is not a way to abandon a sentence you have typed --
    // it is how you stop typing it. Blur keeps what is there, and an empty one
    // is nothing either way.
    //
    // Except onto the controls, which are part of the same act of writing: the
    // size slider sits beside the caret precisely so it can be dragged while a
    // word is half typed, and a control that ended the sentence you were sizing
    // would be a control nobody could use. The edit is parked instead, and taken
    // back up when the pointer is released.
    input.addEventListener('blur', (ev) => {
      const to = (ev as FocusEvent).relatedTarget;
      if (to instanceof Element && to.closest('.wk-panel')) {
        this.park();
        return;
      }
      this.finish(input.value);
    });

    this.input = input;
    parent.appendChild(input);
  }

  /**
   * Starts an edit at a point on screen, resolving with the finished text or
   * with null if it was called off.
   */
  open(screenX: number, screenY: number): Promise<string | null> {
    // Whatever was being typed is finished rather than thrown away: starting a
    // second label is another way of stopping the first, and it keeps what a
    // blur would have kept.
    this.finish(this.input.value);
    const input = this.input;
    input.value = '';
    input.style.left = `${Math.round(screenX)}px`;
    input.style.top = `${Math.round(screenY)}px`;
    input.hidden = false;
    // Focused after it is shown, since a hidden element takes no focus, and
    // without preventScroll a stage that has anywhere to scroll would jump.
    input.focus({ preventScroll: true });
    return new Promise((resolve) => { this.done = resolve; });
  }

  /** Ends any edit in progress, discarding it. */
  close(): void {
    this.finish(null);
  }

  /**
   * Holds an edit open while its own controls have the focus, and takes it back
   * as soon as the pointer is let go -- wherever that is, since a release over
   * the map is a click the tool is about to answer anyway.
   */
  private park(): void {
    if (!this.done) return;
    window.addEventListener('pointerup', () => {
      if (this.done) this.input.focus({ preventScroll: true });
    }, { once: true });
  }

  private finish(text: string | null): void {
    const done = this.done;
    if (!done) return;
    this.done = null;
    this.input.hidden = true;
    this.input.blur();
    done(text);
  }
}
