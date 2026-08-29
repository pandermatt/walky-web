import { App } from './app';
import { registerServiceWorker } from './pwa';
import { markAppShell } from './ui/appShell';

// Before anything builds its DOM, so the toolbar is laid out right on the first
// frame rather than jumping from the corner to the bottom of the screen.
markAppShell();

const stage = document.getElementById('stage') as HTMLElement;
const deckCanvas = document.getElementById('deck-canvas') as HTMLCanvasElement;
const overlayCanvas = document.getElementById('overlay') as HTMLCanvasElement;

const app = new App(stage, deckCanvas, overlayCanvas);

registerServiceWorker(stage);

(window as unknown as Record<string, unknown>).__walky = app;
