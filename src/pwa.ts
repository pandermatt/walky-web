import { TOUCH } from './ui/appShell';
import { injectStyle, installTheme } from './ui/theme';

/**
 * Service worker registration, and the one piece of UI it needs.
 *
 * Walky holds the map you drew in memory and nowhere else, so an update must
 * never reload the page on its own -- it offers, and you decide when the crowd
 * you are watching is expendable.
 */

export const TOAST_CSS = `
/* A chip in the corner, made of the same glass as the bar. Its buttons come
   from ui/theme.ts; what is here is where it sits. */
#wk-toast {
  position: absolute; z-index: 20;
  right: calc(12px + env(safe-area-inset-right, 0px));
  bottom: calc(12px + env(safe-area-inset-bottom, 0px));
  max-width: calc(100vw - 24px);
  display: flex; align-items: center; gap: 4px;
  padding: 6px 6px 6px 14px; border-radius: var(--wk-r-cell);
  background: var(--wk-bar);
  border: var(--wk-glass-edge);
  box-shadow: var(--wk-glass-shadow);
  font: var(--wk-font); color: var(--wk-ink);
  transition: opacity .3s ease;
}
@supports (backdrop-filter: blur(1px)) or (-webkit-backdrop-filter: blur(1px)) {
  #wk-toast {
    background: rgba(236, 236, 236, .72);
    -webkit-backdrop-filter: var(--wk-glass-blur);
    backdrop-filter: var(--wk-glass-blur);
  }
}
#wk-toast[hidden] { display: none; }
#wk-toast.fading { opacity: 0; }
#wk-toast .msg { flex: 1 1 auto; }
/* The dismissal is the quieter of the two, so it reads as the way past rather
   than the thing being offered. */
#wk-toast .wk-btn--quiet { color: var(--wk-ink-dim); font-weight: 400; }
@media (prefers-reduced-motion: reduce) { #wk-toast { transition: none; } }

/* Installed, the toolbar is a bar across the bottom, so the chip keeps its
   corner and sits above it -- --wk-toolbar-h is the bar's measured height (see
   ui/toolbar.ts) and 28px is the gap it floats at. */
@media ${TOUCH} {
  html[data-standalone] #wk-toast {
    bottom: calc(28px + var(--wk-toolbar-h, 0px) + env(safe-area-inset-bottom, 0px));
  }
}
`;

let toast: HTMLDivElement | null = null;
let message: HTMLSpanElement | null = null;
let dismiss: number | undefined;

function hideToast(): void {
  if (!toast) return;
  const el = toast;
  window.clearTimeout(dismiss);
  el.classList.add('fading');
  dismiss = window.setTimeout(() => { el.hidden = true; }, 300);
}

/**
 * @param action shown as a button. Without one the chip retires by itself, since
 *   a message with nothing to do should not sit over the canvas; with one it
 *   waits, because it is asking a question -- but it can now be told no. It used
 *   to be neither: an actionable chip skipped the timer and had no way out at
 *   all, so reloading was the only thing that ever removed it.
 */
function showToast(
  stage: HTMLElement,
  text: string,
  action?: { label: string; run: () => void },
): void {
  if (!toast) {
    installTheme();
    injectStyle('toast', TOAST_CSS);
    toast = document.createElement('div');
    toast.id = 'wk-toast';
    message = document.createElement('span');
    message.className = 'msg';
    // The live region is the sentence, not the chip: a container that announces
    // itself and also holds buttons is two things at once.
    message.setAttribute('role', 'status');
    toast.appendChild(message);
    // The chip sits over the canvas; a click on it is not a click on the map.
    for (const type of ['pointerdown', 'pointerup', 'pointermove', 'wheel', 'dblclick']) {
      toast.addEventListener(type, (ev) => ev.stopPropagation());
    }
    stage.appendChild(toast);
  }

  window.clearTimeout(dismiss);
  toast.classList.remove('fading');
  toast.hidden = false;
  toast.replaceChildren(message as HTMLSpanElement);
  (message as HTMLSpanElement).textContent = text;

  if (!action) {
    dismiss = window.setTimeout(hideToast, 4000);
    return;
  }

  const later = document.createElement('button');
  later.type = 'button';
  later.className = 'wk-btn wk-btn--text wk-btn--quiet';
  later.textContent = 'Later';
  later.addEventListener('click', hideToast);

  const confirm = document.createElement('button');
  confirm.type = 'button';
  confirm.className = 'wk-btn wk-btn--text';
  confirm.textContent = action.label;
  confirm.addEventListener('click', action.run);

  toast.append(later, confirm);
}

/**
 * Registers the worker built by the pwa() plugin. A no-op in development, where
 * there is no build output to precache -- and where a worker left over from a
 * production visit on the same origin would serve yesterday's app instead of
 * the file you just edited, so any stale one is torn down.
 */
export function registerServiceWorker(stage: HTMLElement): void {
  if (!('serviceWorker' in navigator)) return;

  if (!import.meta.env.PROD) {
    void navigator.serviceWorker.getRegistrations()
      .then((all) => Promise.all(all.map((reg) => reg.unregister())))
      .catch(() => { /* nothing we can do, and nothing that should stop the app */ });
    return;
  }

  navigator.serviceWorker.addEventListener('message', (event: MessageEvent) => {
    const type = (event.data as { type?: string } | null)?.type;
    if (type === 'walky-offline-ready') {
      showToast(stage, 'Walky is ready to run offline.');
    } else if (type === 'walky-updated') {
      showToast(stage, 'A new version is ready.', {
        label: 'Reload',
        run: () => location.reload(),
      });
    }
  });

  window.addEventListener('load', () => {
    void navigator.serviceWorker.register('./sw.js').catch((err: unknown) => {
      // Offline support is an enhancement; the app itself is already running.
      console.warn('Walky: offline support unavailable', err);
    });
  });
}
