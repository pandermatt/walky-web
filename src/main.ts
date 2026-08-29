import { App } from './app';

const stage = document.getElementById('stage') as HTMLElement;
const deckCanvas = document.getElementById('deck-canvas') as HTMLCanvasElement;
const overlayCanvas = document.getElementById('overlay') as HTMLCanvasElement;

const app = new App(stage, deckCanvas, overlayCanvas);

(window as unknown as Record<string, unknown>).__walky = app;
