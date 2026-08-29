import { App } from './app';
import { registerServiceWorker, showToast } from './pwa';
import { markAppShell } from './ui/appShell';
import { decodeLink, readSharedPayload, stripHash } from './state/shareLink';

// Before anything builds its DOM, so the toolbar is laid out right on the first
// frame rather than jumping from the corner to the bottom of the screen.
markAppShell();

const stage = document.getElementById('stage') as HTMLElement;
const deckCanvas = document.getElementById('deck-canvas') as HTMLCanvasElement;
const overlayCanvas = document.getElementById('overlay') as HTMLCanvasElement;

const app = new App(stage, deckCanvas, overlayCanvas);

registerServiceWorker(stage);

/*
 * A shared map, if this page was opened by a link.
 *
 * It lives here rather than in the App because this is where the platform is
 * already wired up, and because the App has no other reason to know that a
 * `location` exists.
 */
const payload = readSharedPayload(location.hash);
if (payload) {
  /*
   * The fragment goes before the map arrives, and it goes with replaceState.
   *
   * A hash that survived the first edit would be a URL claiming to be a map it
   * is not -- and the reload it invites would then throw the edits away without
   * asking. So the URL is touched exactly once, to consume something, and never
   * to publish: `location.hash = ''` is not the way to do it, since that is a
   * same-document navigation and adds an entry on some engines. replaceState
   * fires no popstate, and it runs long before the settings sheet can push its
   * own entry, so the sheet's back-gesture token never hears about this.
   */
  history.replaceState(history.state, '', stripHash(location.href));

  void decodeLink(payload).then(
    (core) => {
      app.loadScenario(core);
      const many = (n: number, noun: string) => `${n} ${noun}${n === 1 ? '' : 's'}`;
      const what = `${many(core.walls.length, 'wall')}, ${many(core.agents.length, 'pedestrian')}`;
      showToast(stage, `Opened a shared map — ${what}.`);
    },
    (err: unknown) => {
      // The message is the decoder's: it knows whether the link was cut short,
      // too big, or never a Walky link at all. The map stays empty and the app
      // stays usable either way.
      showToast(stage, err instanceof Error ? err.message : 'That link could not be read.');
    },
  );
}

(window as unknown as Record<string, unknown>).__walky = app;
