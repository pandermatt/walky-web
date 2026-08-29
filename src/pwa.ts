import { TOUCH } from './ui/appShell';

/**
 * Service worker registration, and the one piece of UI it needs.
 *
 * Walky holds the map you drew in memory and nowhere else, so an update must
 * never reload the page on its own -- it offers, and you decide when the crowd
 * you are watching is expendable.
 */

const CSS = `
#wk-toast {
  position: absolute; z-index: 20;
  right: calc(12px + env(safe-area-inset-right, 0px));
  bottom: calc(12px + env(safe-area-inset-bottom, 0px));
  display: flex; align-items: center; gap: 10px;
  padding: 8px 10px 8px 12px; border-radius: 8px;
  background: #ECECEC; border: 1px solid #9A9A9A;
  box-shadow: 0 2px 10px rgba(0,0,0,.5);
  font: 13px system-ui, -apple-system, sans-serif; color: #1E1E1E;
  transition: opacity .3s ease;
}
#wk-toast[hidden] { display: none; }
#wk-toast.fading { opacity: 0; }
#wk-toast button {
  padding: 5px 10px; cursor: pointer; font: inherit;
  background: #F7F7F7; border: 1px solid #B4B4B4; border-radius: 5px;
}
#wk-toast button:hover { background: #FFFFFF; }
/* The installed app's toolbar is a bar across the bottom, so the chip keeps its
   corner and sits above it -- --wk-toolbar-h is the bar's measured height (see
   ui/toolbar.ts) and 20px is the gap it floats at. */
@media ${TOUCH} {
  html[data-standalone] #wk-toast {
    bottom: calc(28px + var(--wk-toolbar-h, 0px) + env(safe-area-inset-bottom, 0px));
    max-width: calc(100vw - 24px);
  }
}
`;

let toast: HTMLDivElement | null = null;
let dismiss: number | undefined;

/**
 * @param action shown as a button; without one the toast retires by itself,
 *   since a message with nothing to do should not sit over the canvas.
 */
function showToast(stage: HTMLElement, message: string, action?: { label: string; run: () => void }): void {
  if (!toast) {
    const style = document.createElement('style');
    style.textContent = CSS;
    document.head.appendChild(style);
    toast = document.createElement('div');
    toast.id = 'wk-toast';
    toast.setAttribute('role', 'status');
    // The toast sits over the canvas; a click on it is not a click on the map.
    for (const type of ['pointerdown', 'pointerup', 'pointermove', 'wheel', 'dblclick']) {
      toast.addEventListener(type, (ev) => ev.stopPropagation());
    }
    stage.appendChild(toast);
  }

  window.clearTimeout(dismiss);
  toast.classList.remove('fading');
  toast.hidden = false;
  toast.replaceChildren(document.createTextNode(message));

  if (action) {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = action.label;
    button.addEventListener('click', action.run);
    toast.appendChild(button);
    return;
  }

  const el = toast;
  dismiss = window.setTimeout(() => {
    el.classList.add('fading');
    dismiss = window.setTimeout(() => { el.hidden = true; }, 300);
  }, 4000);
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
