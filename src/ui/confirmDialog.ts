import { injectStyle, installTheme } from './theme';

/**
 * The one destructive-action question, asked the way the platform asks it.
 *
 * Clearing the map throws away everything drawn and there is no undo behind it,
 * so the button cannot be the whole gesture -- a mis-tap on a 44px cell between
 * "reset pedestrians" and "record" used to cost the entire scenario. An alert is
 * the smallest thing that turns one tap into a decision.
 *
 * It is a <dialog> opened with showModal(), for the same reasons the settings
 * sheet is one: the top layer, the dimmed backdrop, the focus trap, Escape and
 * the back gesture all arrive for free, and the toolbar underneath is inert
 * while the question stands. The look is the sheet's vocabulary at alert size --
 * a white card on the dim, the title in the sheet's ink, and the two answers as
 * a hairline-divided row along the foot.
 */
export const ALERT_CSS = `
.wk-alert {
  /* Positioned rather than left to the UA, which differs between engines on
     what a modal dialog's box is; the same centring the sheet uses. */
  position: fixed; inset: 0; margin: auto;
  box-sizing: border-box; padding: 0; border: 0;
  width: min(300px, calc(100vw - 48px));
  max-width: none;
  height: fit-content;
  border-radius: var(--wk-r-card);
  overflow: hidden;
  background: var(--wk-card); color: var(--wk-ink);
  font: 13px/1.4 var(--wk-font-family);
  text-align: center;
}
.wk-alert, .wk-alert * { box-sizing: border-box; }
.wk-alert[open] { display: block; }

/*
 * Arriving and leaving. Same construction as the sheet: \`@starting-style\` plus
 * \`display\` under \`allow-discrete\` for the way in, and .wk-leaving for the way
 * out, because close() drops a dialog out of the top layer at once and would
 * otherwise cut the exit dead. An alert is quicker than a sheet -- it is a
 * question, and a question that takes a third of a second to appear reads as
 * hesitation -- so it grows from slightly under size rather than sliding.
 */
.wk-alert {
  opacity: 0; transform: scale(.9);
  transition:
    opacity .18s ease,
    transform .18s cubic-bezier(.32, .72, 0, 1),
    display .18s allow-discrete;
}
.wk-alert[open] { opacity: 1; transform: scale(1); }
.wk-alert[open].wk-leaving { opacity: 0; transform: scale(.98); }
@starting-style {
  .wk-alert[open] { opacity: 0; transform: scale(.9); }
}
.wk-alert::backdrop {
  background: rgba(0, 0, 0, 0);
  transition: background-color .18s ease, display .18s allow-discrete;
}
.wk-alert[open]::backdrop { background: rgba(0, 0, 0, .4); }
.wk-alert[open].wk-leaving::backdrop { background: rgba(0, 0, 0, 0); }
@starting-style {
  .wk-alert[open]::backdrop { background: rgba(0, 0, 0, 0); }
}
@media (prefers-reduced-motion: reduce) {
  .wk-alert, .wk-alert::backdrop { transition: none; }
  .wk-alert, .wk-alert[open].wk-leaving { transform: none; opacity: 1; }
}

.wk-alert .text { padding: 20px 16px 18px; }
.wk-alert .text h2 {
  margin: 0; font-size: 17px; font-weight: 600; line-height: 1.3;
  letter-spacing: -.01em;
}
.wk-alert .text p {
  margin: 4px 0 0; font-size: 13px; line-height: 1.35; color: var(--wk-ink-dim);
}

/*
 * The answers, side by side under a hairline: the shape an alert has had since
 * before any of this, and the one place in the app where two buttons carry equal
 * weight. The rules are drawn with a grid gap over the hairline colour so that
 * the horizontal and the vertical are the same line, at whatever a device calls
 * one pixel.
 */
.wk-alert .answers {
  display: grid; grid-template-columns: 1fr 1fr;
  gap: 1px; background: var(--wk-hairline);
  border-top: 1px solid var(--wk-hairline);
}
.wk-alert .answers .wk-btn {
  min-height: var(--wk-tap); padding: 11px 12px;
  border-radius: 0; background: var(--wk-card);
  font-size: 17px; text-align: center;
  color: var(--wk-accent-text);
}
/* Cancel is the safe answer, so it is the plain one; the destructive answer
   carries the weight and the red. */
.wk-alert .answers .wk-btn--confirm { font-weight: 600; }
.wk-alert .answers .wk-btn--danger {
  /* iOS's system red in its darker variant: #FF3B30 measures 3.0:1 on white,
     which is under the floor for text, and this one is 5.6:1. */
  color: #D70015;
}
`;

export interface ConfirmOptions {
  title: string;
  /** The sentence under the title; what the action actually costs. */
  message?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  /** Paints the confirming answer red. True for anything that destroys work. */
  destructive?: boolean;
}

/**
 * Asks, and resolves to what was answered.
 *
 * Every way out that is not the confirming button is a no: Cancel, Escape, the
 * Android back gesture and a click on the backdrop all resolve false, so there
 * is no route through this dialog that destroys anything by accident.
 *
 * The element is built per call and removed on the way out. An alert is not a
 * surface the app keeps around -- it exists for the length of one question --
 * and building it fresh means the caller's wording is simply the wording, with
 * nothing to sync afterwards.
 */
export function confirmAction(options: ConfirmOptions): Promise<boolean> {
  installTheme();
  injectStyle('alert', ALERT_CSS);

  const root = document.createElement('dialog');
  root.className = 'wk-alert';

  const text = document.createElement('div');
  text.className = 'text';
  const title = document.createElement('h2');
  title.id = `wk-alert-title-${++sequence}`;
  title.textContent = options.title;
  root.setAttribute('aria-labelledby', title.id);
  text.appendChild(title);
  if (options.message) {
    const message = document.createElement('p');
    message.id = `wk-alert-body-${sequence}`;
    message.textContent = options.message;
    root.setAttribute('aria-describedby', message.id);
    text.appendChild(message);
  }

  const answers = document.createElement('div');
  answers.className = 'answers';
  const cancel = document.createElement('button');
  cancel.type = 'button';
  cancel.className = 'wk-btn';
  cancel.textContent = options.cancelLabel ?? 'Cancel';
  const confirm = document.createElement('button');
  confirm.type = 'button';
  confirm.className = 'wk-btn wk-btn--confirm';
  if (options.destructive) confirm.classList.add('wk-btn--danger');
  confirm.textContent = options.confirmLabel ?? 'OK';
  answers.append(cancel, confirm);

  root.append(text, answers);
  document.body.appendChild(root);

  const opener = document.activeElement as HTMLElement | null;

  return new Promise<boolean>((resolve) => {
    let settled = false;
    let exitTimer = 0;

    const finish = (): void => {
      window.clearTimeout(exitTimer);
      root.removeEventListener('transitionend', onExitEnd);
      root.close();
      root.remove();
      // Only now: a modal dialog holds focus, so handing it back before the
      // close would simply be refused.
      if (opener?.isConnected) opener.focus({ preventScroll: true });
    };

    const onExitEnd = (ev: TransitionEvent): void => {
      if (ev.target !== root) return;
      finish();
    };

    const answer = (value: boolean): void => {
      if (settled) return;
      settled = true;
      // The answer is the caller's straight away; the animation is only the
      // dialog taking its leave, and the map should not wait for it.
      resolve(value);
      root.classList.add('wk-leaving');
      if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
        finish();
        return;
      }
      // transitionend is the signal; the timer is the promise that one arrives
      // at all, since an engine that ignored the transition would otherwise
      // leave the alert on screen forever.
      root.addEventListener('transitionend', onExitEnd);
      exitTimer = window.setTimeout(finish, 400);
    };

    cancel.addEventListener('click', () => answer(false));
    confirm.addEventListener('click', () => answer(true));

    // Escape, and the back gesture on Android, both arrive as `cancel`.
    root.addEventListener('cancel', (ev) => {
      ev.preventDefault();
      answer(false);
    });

    // A click on the backdrop. The dialog *is* the card, so "did you hit the
    // element" is not the question -- the question is whether the point was
    // inside its box, which is false only for the backdrop. Guarding on the
    // target first keeps a keyboard-activated click, which reports (0, 0), from
    // reading as a click in the far corner.
    root.addEventListener('click', (ev) => {
      if (ev.target !== root) return;
      const box = root.getBoundingClientRect();
      const inside = ev.clientX >= box.left && ev.clientX <= box.right
        && ev.clientY >= box.top && ev.clientY <= box.bottom;
      if (!inside) answer(false);
    });

    root.showModal();
    // The safe answer takes focus, so a stray Return or Space cancels rather
    // than clears.
    cancel.focus({ preventScroll: true });
  });
}

/** Keeps the labelling ids of two alerts apart, however briefly both exist. */
let sequence = 0;
