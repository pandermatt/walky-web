import { Scene, type SceneState } from './render/scene';
import { Overlay } from './render/overlay';
import { Viewport, type Bounds } from './render/viewport';
import { toCss, BACKGROUND, WHITE, type RGB } from './palette';
import {
  DEFAULT_SETTINGS, makeWall, wallContains,
  type Settings, type Wall, type WallOptions,
} from './state/model';
import { expandPolygon, pointInPolygon, type Point } from './sim/geometry';
import { groupWalls, type WallGroup } from './state/groups';
import { Toolbar, type ActionId } from './ui/toolbar';
import {
  buildWorld, clampSettings, serializeScenario, scenarioToJson,
  type Scenario, type ScenarioCore, type SerializedAgent,
} from './state/scenario';
import { LINK_MAX_CHARS, LINK_SAFE_CHARS, shareUrl } from './state/shareLink';
import { SettingsSheet } from './ui/settingsSheet';
import { confirmAction } from './ui/confirmDialog';
import { ContextPanel } from './ui/contextPanel';
import { BorderTool } from './tools/borderTool';
import { SelectionTool } from './tools/selectionTool';
import { WallTool } from './tools/wallTool';
import { RectangleTool } from './tools/rectangleTool';
import { ShiftTool } from './tools/shiftTool';
import { PedestrianTool } from './tools/pedestrianTool';
import { GoalTool } from './tools/goalTool';
import { Navigation } from './sim/navigation';
import { Agents, unpackRgb, type AgentsSnapshot } from './sim/agents';
import { Plops } from './audio/plops';
import { showToast } from './pwa';
import { SpatialHash } from './sim/spatialHash';
import { EMPTY_PREVIEW, type PointerInfo, type Tool, type ToolContext, type ToolId } from './tools/types';

/**
 * The map as it was, kept so an edit can be taken back.
 *
 * Walls are cloned one level deep because `isGoal` and `selected` are written
 * in place; the polygons under them never are, so the geometry is shared rather
 * than copied and a snapshot costs a handful of objects. The crowd is the same
 * story -- see Agents.snapshot for what it keeps.
 */
interface MapSnapshot {
  walls: Wall[];
  agents: AgentsSnapshot;
}

/**
 * How many edits back you can go.
 *
 * Deep enough to cover a stretch of drawing, shallow enough that the snapshots
 * cannot quietly become the largest thing in memory: a snapshot's cost is the
 * crowd it holds, and a full one is around 100KB.
 */
const UNDO_DEPTH = 40;

export class App {
  private viewport = new Viewport();
  private scene: Scene;
  private overlay: Overlay;
  private toolbar: Toolbar;
  private settingsSheet: SettingsSheet;
  private contextPanel: ContextPanel;

  private walls: Wall[] = [];
  private settings: Settings = { ...DEFAULT_SETTINGS };
  private nav = new Navigation();
  private agents = new Agents();
  private hash = new SpatialHash();
  private plops = new Plops();
  private running = false;
  private navDirty = true;
  private groupCache: WallGroup[] | null = null;
  private groupCacheRevision = -1;

  /** Map states before each edit, oldest first; the top is the last edit. */
  private undoStack: MapSnapshot[] = [];

  private tools = new Map<ToolId, Tool>();
  /** No tool active is a real state: after a one-shot action, nothing is armed. */
  private tool: Tool | null = null;
  private mouseWorld: Point | null = null;
  private lastScreen: Point | null = null;
  /** Every finger currently down on the canvas, in element space. */
  private pointers = new Map<number, Point>();
  /** Gap and midpoint of the two fingers as of the last move, while pinching. */
  private pinch: { gap: number; mid: Point } | null = null;
  /**
   * A touch's pointerdown, held back until it is clear the finger is drawing
   * rather than opening a pinch.
   */
  private pendingTouch: { id: number; info: PointerInfo } | null = null;
  /** Set once the pinch has taken the gesture, until the last finger lifts. */
  private gestureTaken = false;
  private frameRequested = false;
  /** Bumped on map edits only -- the walls. */
  private worldRevision = 0;
  /** Bumped every simulation tick -- agents, rays, paths. */
  private agentRevision = 0;
  /**
   * Last result of goalPaths(), keyed by the revisions it was built from. While
   * paused the overlay is redrawn on every mouse move, and the predicted routes
   * behind it are a graph scan per pedestrian -- worth doing once per edit, not
   * once per frame.
   */
  private goalPathCache: Point[][] = [];
  private goalPathCacheKey = '';

  constructor(
    private stage: HTMLElement,
    deckCanvas: HTMLCanvasElement,
    overlayCanvas: HTMLCanvasElement,
  ) {
    document.body.style.background = toCss(BACKGROUND);

    this.scene = new Scene(deckCanvas, this.viewport.toViewState(), () => this.drawOverlay());
    this.overlay = new Overlay(overlayCanvas, this.viewport);

    for (const t of [
      new WallTool(), new RectangleTool(), new ShiftTool(),
      new PedestrianTool(), new GoalTool(), new SelectionTool(),
      new BorderTool(),
    ]) {
      this.tools.set(t.id, t as Tool);
    }
    this.tool = this.tools.get('rectangle') ?? null;

    this.toolbar = new Toolbar(
      stage,
      'rectangle',
      (id) => this.setTool(id),
      (id) => this.runAction(id),
    );

    // Nothing drawn yet, so there is nothing to take back.
    this.toolbar.setEnabled('undo', false);

    // Input binds to the deck canvas, not the stage: the toolbar is a sibling
    // inside the stage, so binding higher up made every toolbar click also land
    // on the canvas as a tool click.
    // One column so the settings panel and the contextual panel stack instead of
    // overlapping each other.
    const panels = document.createElement('div');
    panels.id = 'panels';
    stage.appendChild(panels);

    const onSettingChange = <K extends keyof Settings>(key: K, value: Settings[K]) => {
      this.settings[key] = value;
      // Radius changes the expanded hulls, so the graph must be rebuilt.
      if (key === 'pedestrianRadius') this.navDirty = true;
      // Both panels can show the same setting, so keep them in step.
      this.settingsSheet.sync();
      this.contextPanel.sync();
      this.touch();
    };

    // The sheet tells the toolbar what it is doing, opening and closing alike,
    // and nothing else writes that button's state. It used to be written from
    // three places and read back from none, so an open the toolbar had not asked
    // for -- and it can close itself, on Done, Escape, the backdrop or the back
    // gesture -- left the button showing the opposite of the truth.
    this.settingsSheet = new SettingsSheet(
      this.settings, onSettingChange,
      () => this.copyLinkToClipboard(), () => this.copyMapToClipboard(),
      () => this.toolbar.setPressed('settings', true),
      () => this.toolbar.setPressed('settings', false),
    );
    this.contextPanel = new ContextPanel(panels, this.settings, onSettingChange);

    this.bindPointer(deckCanvas);
    this.resize();
    window.addEventListener('resize', () => this.resize());
    this.applyCursor();
    this.requestRender();
  }

  // ---- world mutations exposed to tools -----------------------------------

  private context: ToolContext = {
    addWall: (polygon, options) => this.addWall(polygon, options),
    addWallShape: (polygons, options) => this.addWallShape(polygons, options),
    settings: () => this.settings,
    pedestrianBlock: (at) => this.pedestrianBlock(at),
    addPedestrians: (at) => {
      const spots = this.pedestrianBlock(at);
      // Nothing landed -- the brush was over a wall or a crowd -- so nothing
      // happened, and an undo step for it would be a step that undoes nothing.
      if (spots.length === 0) return;
      this.checkpoint();
      for (const p of spots) this.agents.add(p);
      this.touch();
    },
    setGoalAt: (at) => {
      const hit = [...this.walls].reverse().find((w) => wallContains(w, at));
      if (!hit) return;
      this.checkpoint();
      hit.isGoal = true;
      // With a selection, the goal applies to it alone; with nothing selected it
      // applies to everyone, as Map.setGoalForSelectedPedestrians did.
      const onlySelected = this.agents.selectionCount > 0;
      for (let i = 0; i < this.agents.count; i++) {
        if (onlySelected && !this.agents.selected[i]) continue;
        this.agents.setGoal(i, hit.id, hit.color);
      }
      this.pruneGoals(hit.id);
      this.navDirty = true;
      // Before the render: it draws the route of every agent to its own goal,
      // which reads the field this rebuild produces.
      this.rebuildNavIfNeeded();
      this.touch();
    },
    selectPedestrianAt: (at, extend) => {
      if (!extend) this.agents.clearSelection();
      const hit = this.agents.indexAt(at, this.settings.pedestrianRadius);
      if (hit >= 0) this.agents.selected[hit] = 1;
      this.touch();
    },
    selectPedestriansIn: (lasso, extend) => {
      if (!extend) this.agents.clearSelection();
      for (let i = 0; i < this.agents.count; i++) {
        if (pointInPolygon(lasso, [this.agents.x[i], this.agents.y[i]])) {
          this.agents.selected[i] = 1;
        }
      }
      this.touch();
    },
    clearSelection: () => { this.agents.clearSelection(); this.touch(); },
    selectionCount: () => this.agents.selectionCount,
    deactivateTool: () => this.setTool(null),
    activateTool: (id) => this.setTool(id),
    notify: (message) => showToast(this.stage, message),
    panBy: (dx, dy) => this.viewport.panBy(dx, dy),
    requestRender: () => this.requestRender(),
    colorAt: (at) => {
      const hit = [...this.walls].reverse().find((w) => wallContains(w, at));
      return hit ? (hit.color as unknown as [number, number, number]) : null;
    },
    worldPerPixel: () => 1 / this.viewport.scale,
    agentPositions: () => {
      const out: Point[] = new Array(this.agents.count);
      for (let i = 0; i < this.agents.count; i++) out[i] = [this.agents.x[i], this.agents.y[i]];
      return out;
    },
  };

  // ---- input --------------------------------------------------------------

  private bindPointer(el: HTMLElement): void {
    const info = (ev: PointerEvent | MouseEvent): PointerInfo => {
      const rect = (el as HTMLElement).getBoundingClientRect();
      const screen: Point = [ev.clientX - rect.left, ev.clientY - rect.top];
      const dx = this.lastScreen ? screen[0] - this.lastScreen[0] : 0;
      const dy = this.lastScreen ? screen[1] - this.lastScreen[1] : 0;
      return {
        screen,
        world: this.viewport.screenToWorld(screen),
        dxScreen: dx,
        dyScreen: dy,
        shiftKey: ev.shiftKey,
        buttons: ev.buttons,
      };
    };

    el.addEventListener('pointerdown', (ev) => {
      if (ev.button === 2) return;
      (el as HTMLElement).setPointerCapture?.(ev.pointerId);
      const e = info(ev);
      this.pointers.set(ev.pointerId, e.screen);

      if (this.pointers.size === 2) {
        // A second finger says the first one was never a stroke. Whatever it
        // began is taken back here, before the map starts moving under it.
        this.pendingTouch = null;
        this.tool?.cancel?.();
        this.lastScreen = null;
        this.gestureTaken = true;
        this.pinch = this.measurePinch();
        this.requestRender();
        return;
      }
      if (this.pointers.size > 2 || this.gestureTaken) return;

      this.lastScreen = e.screen;
      if (ev.pointerType === 'touch') {
        /*
         * Held rather than delivered. A tool that has already dropped a
         * pedestrian or reassigned a goal cannot be talked out of it by a
         * cancel(), and the second finger of a pinch arrives after the first --
         * so on a touchscreen the tool hears about the press only once the
         * finger has moved or lifted, which is when it is certainly a stroke.
         */
        this.pendingTouch = { id: ev.pointerId, info: e };
        return;
      }
      this.tool?.onPointerDown?.(e, this.context);
      this.requestRender();
    });

    el.addEventListener('pointermove', (ev) => {
      const e = info(ev);

      if (this.pinch) {
        this.pointers.set(ev.pointerId, e.screen);
        const now = this.measurePinch();
        if (now && this.pinch.gap > 0) {
          // The midpoint carries the map with it, so the same gesture pans:
          // two fingers travelling together are a drag, and holding the view
          // still under them would feel like the map had come loose.
          this.viewport.panBy(now.mid[0] - this.pinch.mid[0], now.mid[1] - this.pinch.mid[1]);
          this.viewport.zoomByRatio(now.mid, now.gap / this.pinch.gap);
          this.pinch = now;
          this.requestRender();
        }
        return;
      }
      if (this.gestureTaken) return;
      if (this.pendingTouch?.id === ev.pointerId) this.flushPendingTouch();

      this.mouseWorld = e.world;
      this.tool?.onPointerMove?.(e, this.context);
      this.lastScreen = e.screen;
      if (this.settings.showDebug) this.requestRender();
    });

    el.addEventListener('pointerup', (ev) => {
      if (this.releasePointer(ev.pointerId)) return;
      if (this.pendingTouch?.id === ev.pointerId) this.flushPendingTouch();
      const e = info(ev);
      this.tool?.onPointerUp?.(e, this.context);
      this.lastScreen = null;
      this.requestRender();
    });

    // The browser taking a gesture back mid-stroke: nothing was finished, so
    // nothing should be committed.
    el.addEventListener('pointercancel', (ev) => {
      this.releasePointer(ev.pointerId);
      this.pendingTouch = null;
      this.tool?.cancel?.();
      this.lastScreen = null;
      this.requestRender();
    });

    el.addEventListener('dblclick', (ev) => {
      this.tool?.onDoubleClick?.(info(ev), this.context);
    });

    el.addEventListener('wheel', (ev) => {
      ev.preventDefault();
      // One notch per event, matching MouseWheelEvent.getWheelRotation().
      this.viewport.zoomAt(info(ev).screen, ev.deltaY > 0 ? 1 : -1);
      this.requestRender();
    }, { passive: false });

    el.addEventListener('contextmenu', (ev) => ev.preventDefault());

    window.addEventListener('keydown', (ev) => {
      // Ctrl+Z, and Cmd+Z on a Mac. Shift+Ctrl+Z is redo everywhere else, so it
      // is left alone rather than quietly undoing instead.
      if ((ev.ctrlKey || ev.metaKey) && !ev.shiftKey && ev.key.toLowerCase() === 'z') {
        if (this.settingsSheet.visible) return;
        const field = (ev.target as HTMLElement | null)?.closest('input, textarea, [contenteditable]');
        if (field) return;
        ev.preventDefault();
        this.undo();
        return;
      }
      if (ev.key !== 'Escape') return;
      // The sheet is modal and answers Escape itself; the tool in your hand is
      // not what you meant to put down. This handler used to be the only way
      // settings closed at all, which is why leaving it also cleared the
      // selection and unarmed the tool.
      if (this.settingsSheet.visible) return;
      const target = ev.target as HTMLElement | null;
      if (target?.closest('input, button, [contenteditable]')) return;
      ev.preventDefault();
      this.tool?.cancel?.();
      this.agents.clearSelection();
      this.setTool(null);
    });
  }

  /** Gap and midpoint of the first two fingers down, or null if fewer than two. */
  private measurePinch(): { gap: number; mid: Point } | null {
    const [a, b] = [...this.pointers.values()];
    if (!a || !b) return null;
    return {
      gap: Math.hypot(b[0] - a[0], b[1] - a[1]),
      mid: [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2],
    };
  }

  /** Hands the tool the press it was not told about at the time. */
  private flushPendingTouch(): void {
    const held = this.pendingTouch;
    if (!held) return;
    this.pendingTouch = null;
    this.lastScreen = held.info.screen;
    this.tool?.onPointerDown?.(held.info, this.context);
  }

  /**
   * Forgets a finger.
   *
   * @returns true when the release belonged to the pinch and the tool should
   *   hear nothing about it -- including the finger still down after the other
   *   has gone, which is a leftover rather than the start of a stroke.
   */
  private releasePointer(id: number): boolean {
    this.pointers.delete(id);
    const wasGesture = this.gestureTaken;
    if (this.pinch && this.pointers.size < 2) this.pinch = null;
    else if (this.pinch) this.pinch = this.measurePinch();
    if (this.pointers.size === 0) this.gestureTaken = false;
    if (wasGesture) this.lastScreen = null;
    return wasGesture;
  }

  private setTool(id: ToolId | null): void {
    this.tool?.cancel?.();
    // A press held back for the old tool is not the new tool's to receive.
    this.pendingTouch = null;
    this.tool = id ? this.tools.get(id) ?? null : null;
    this.toolbar.selectTool(this.tool ? this.tool.id : null, true);
    // Nothing to close: the sheet is modal, so the toolbar is inert while it is
    // up and no tool can be picked from underneath it.
    this.updateContextPanel();
    this.applyCursor();
    this.requestRender();
  }

  /**
   * Shows the handful of settings that matter to whatever is active: the brush
   * controls while placing pedestrians, speed and preferred space while the
   * simulation runs.
   *
   * Both, when both are true. Painting a crowd into a running simulation is a
   * thing people do, and asking about the run first meant the brush controls
   * were simply withheld for as long as it lasted.
   */
  private updateContextPanel(): void {
    const brush = this.tool?.id === 'pedestrian';
    const keys: (keyof Settings)[] = [];
    if (brush) keys.push('brushSize', 'preferredSpace');
    if (this.running) {
      keys.push('speed');
      // Preferred space is not only the pitch a brushed block is painted at: it
      // is the room agents keep from each other on every tick, so watching a
      // crowd loosen or tighten as you drag it is exactly the case this panel
      // exists for. The brush already put it up when both are active.
      if (!brush) keys.push('preferredSpace');
    }
    if (keys.length === 0) {
      this.contextPanel.hide();
      return;
    }
    this.contextPanel.show(brush ? 'Pedestrians' : 'Running', keys);
  }

  private applyCursor(): void {
    const cursor = this.tool?.cursor ?? 'default';
    this.stage.style.cursor = cursor;
    // The deck canvas sits on top and paints its own cursor, so it needs telling.
    this.scene.setCursor(cursor);
  }

  /**
   * Box around everything drawn -- walls and pedestrians -- or null when
   * the map is empty. What reset-zoom aims the camera at.
   */
  private contentBounds(): Bounds | null {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    const add = (x: number, y: number) => {
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
    };
    for (const wall of this.walls) {
      for (const polygon of wall.polygons) for (const p of polygon) add(p[0], p[1]);
    }
    for (let i = 0; i < this.agents.count; i++) add(this.agents.x[i], this.agents.y[i]);
    return Number.isFinite(minX) ? { minX, minY, maxX, maxY } : null;
  }

  /**
   * Back to an empty map, stopped. What Clear does once it has asked, and what
   * loading a shared map does first -- there is one place that knows everything
   * a map is made of, so the two cannot drift apart.
   */
  private resetWorld(): void {
    this.walls = [];
    this.agents.clear();
    this.running = false;
    this.toolbar.setRunning(false);
    this.updateContextPanel();
    this.navDirty = true;
    this.tool?.cancel?.();
    this.touch();
  }

  private runAction(id: ActionId): void {
    switch (id) {
      case 'reset_zoom':
        this.viewport.reset(this.contentBounds());
        this.requestRender();
        break;
      case 'undo':
        this.undo();
        break;
      case 'clear':
        void this.clearMap();
        break;
      case 'start':
        this.running = !this.running;
        // Here rather than at the first arrival: an audio context only starts
        // unsuspended when it is created inside a user gesture, and this click is
        // the one gesture guaranteed to precede every plop.
        if (this.running) this.plops.arm();
        this.toolbar.setRunning(this.running);
        this.updateContextPanel();
        if (this.running) this.tick();
        break;
      case 'reset_pedestrians':
        this.agents.resetPositions();
        this.touch();
        break;
      case 'settings':
        this.settingsSheet.open();
        break;
      default:
        // record arrives with the MediaRecorder step
        break;
    }
  }

  /**
   * Throws the map away, having asked first.
   *
   * The question is the whole point of the method: clear is one cell in a strip
   * of them, and a mis-tap that lands here takes every wall someone has drawn.
   * Undo can bring it all back -- and the alert says so, since that is the fact
   * that makes the answer easy -- but finding that out after the map has gone is
   * a worse moment than being asked. Asked only when there is something to lose,
   * though: an alert over an empty map is a question with one answer, and
   * confirming nothing teaches people to confirm without reading.
   */
  private async clearMap(): Promise<void> {
    if (!this.isEmpty()) {
      const confirmed = await confirmAction({
        title: 'Clear the map?',
        message: 'Every wall and pedestrian goes. Undo brings them back.',
        confirmLabel: 'Clear',
        destructive: true,
      });
      if (!confirmed) return;
    }

    this.checkpoint();
    this.resetWorld();
  }

  /** Nothing drawn and nobody standing: what makes a question about losing it moot. */
  private isEmpty(): boolean {
    return this.walls.length === 0 && this.agents.count === 0;
  }

  /**
   * Remembers the map as it stands, before the edit about to change it.
   *
   * Taken by the edits themselves rather than by the input layer, and only once
   * something is definitely going to happen: a brush stroke that lands no
   * pedestrian and a goal click that hits no wall change nothing, and an undo
   * step that undoes nothing is worse than none -- it is a press that appears
   * to do nothing at all.
   *
   * What is not checkpointed: the selection, which is a way of looking at the
   * map rather than part of it, the camera, and reset-pedestrians, which puts
   * everyone back on an origin it never throws away and so undoes itself.
   */
  private checkpoint(): void {
    this.undoStack.push({
      walls: this.walls.map((w) => ({ ...w })),
      agents: this.agents.snapshot(),
    });
    // Oldest goes first once the stack is full, so the depth is a window on the
    // recent past rather than a limit on how long you may keep drawing.
    if (this.undoStack.length > UNDO_DEPTH) this.undoStack.shift();
    this.toolbar.setEnabled('undo', true);
  }

  /**
   * Puts the last edit back.
   *
   * The map only -- the run is left alone, since undoing a wall is not a
   * reason to stop the simulation. Pedestrians do go back to where they stood
   * when the edit was made, which is the whole point while paused and, mid-run,
   * is the honest reading of "as it was before".
   */
  private undo(): void {
    const previous = this.undoStack.pop();
    if (!previous) return;
    this.walls = previous.walls;
    this.agents.restore(previous.agents);
    this.navDirty = true;
    // Whatever is half-drawn was drawn on a map that no longer exists.
    this.tool?.cancel?.();
    this.toolbar.setEnabled('undo', this.undoStack.length > 0);
    this.updateContextPanel();
    this.touch();
  }

  // ---- rendering ----------------------------------------------------------

  private resize(): void {
    const w = this.stage.clientWidth;
    const h = this.stage.clientHeight;
    this.viewport.width = w;
    this.viewport.height = h;
    this.overlay.resize(w, h);
    this.requestRender();
  }

  // ---- simulation ---------------------------------------------------------

  /**
   * Adds a shape as its own wall.
   *
   * It used to absorb every wall it overlapped into one, ported from
   * Map.addWall. That existed because the original navigated by a single convex
   * hull per wall, so two overlapping walls had to become one for the hull to
   * cover their union. Convex decomposition removed that requirement -- separate
   * overlapping walls are already handled as independent obstacles -- and
   * merging then only did harm: it cascaded, so drawing anything against an
   * enclosure swallowed the enclosure, and it defeated the broad phase, since a
   * single map-sized wall shell never rejects anything.
   *
   * Shapes that touch are still drawn under one outline; see groupWalls.
   */
  private addWall(polygon: Point[], options?: WallOptions): boolean {
    return this.addWallShape([polygon], options);
  }

  /** Adds one wall built from several polygons, as the border tool needs. */
  private addWallShape(polygons: Point[][], options?: WallOptions): boolean {
    const usable = polygons.filter((p) => p.length >= 3);
    if (usable.length === 0) return false;

    this.checkpoint();
    const wall = makeWall(usable, options);
    this.walls = [...this.walls, wall];
    this.removeAgentsUnder(wall);
    this.navDirty = true;
    this.touch();
    return true;
  }

  /** Pedestrians standing where a wall was just drawn are removed. */
  private removeAgentsUnder(wall: Wall): void {
    for (let i = this.agents.count - 1; i >= 0; i--) {
      if (wallContains(wall, [this.agents.x[i], this.agents.y[i]])) {
        this.agents.removeAt(i);
      }
    }
  }

  /**
   * The outlines to draw, each grown by the pedestrian radius -- the boundary a
   * pedestrian's centre must stay outside of.
   *
   * Two sets, with a toggle each, and only what is switched on is built: the
   * hulls, one per connected group, and the convex parts, one per piece a wall
   * was decomposed into. Off, a set costs nothing per frame.
   */
  private expandedHulls(): { points: Point[]; color: RGB; faint: boolean }[] {
    const byId = new Map(this.walls.map((w) => [w.id, w.color]));

    // The solid outline is drawn once per connected group rather than per wall,
    // so shapes drawn against each other still read as one object -- the look
    // merging used to give, without merging their identities. Navigation keeps
    // its own per-wall shells, which serve a different purpose.
    const shells = this.settings.showConvexHull ? this.groups().map((g) => ({
      points: expandPolygon(g.hull, this.settings.pedestrianRadius),
      // The group's colour is its lowest-numbered member's, so it holds still as
      // unrelated shapes are drawn elsewhere.
      color: byId.get(g.wallIds[0]) ?? WHITE,
      faint: false,
    })) : [];
    const parts = this.settings.showConvexParts ? this.nav.obstacles.map((ob) => ({
      points: ob.hull,
      color: byId.get(ob.wallId) ?? WHITE,
      faint: true,
    })) : [];
    // Parts first: where both are on, the hull is the one drawn over the top.
    return [...parts, ...shells];
  }

  /** Connected wall groups, recomputed only when the map changes. */
  private groups(): WallGroup[] {
    if (this.groupCache && this.groupCacheRevision === this.worldRevision) {
      return this.groupCache;
    }
    this.groupCache = groupWalls(this.walls);
    this.groupCacheRevision = this.worldRevision;
    return this.groupCache;
  }

  /**
   * A pedestrian may not be dropped where its body would meet a wall.
   *
   * Tested against the expanded hull rather than the raw polygon: a pedestrian is
   * a circle of `radius`, so a centre merely outside the wall can still leave the
   * body overlapping it.
   */
  private isBlocked(p: Point): boolean {
    for (const ob of this.nav.obstacles) {
      if (p[0] < ob.bbox.minX || p[0] > ob.bbox.maxX
        || p[1] < ob.bbox.minY || p[1] > ob.bbox.maxY) continue;
      if (pointInPolygon(ob.hull, p)) return true;
    }
    return false;
  }

  /**
   * The legal spots in an n x n brush block centred on `at`.
   *
   * Ports Map.isThisALegalPedestrianCoordinate: a pedestrian may not be dropped
   * where it would touch a wall or overlap another pedestrian. Used both to place
   * and to draw the ghost preview, so what you see is exactly what you get.
   */
  private pedestrianBlock(at: Point): Point[] {
    // Placement legality is judged against the expanded hulls, so make sure they
    // reflect the current walls and radius before testing against them.
    this.rebuildNavIfNeeded();
    const r = this.settings.pedestrianRadius;
    const n = Math.max(1, this.settings.brushSize);
    // The original spaced a block by the full interaction diameter, so freshly
    // painted pedestrians start outside each other's preferred space.
    const pitch = 2 * (r + this.settings.preferredSpace);
    const half = ((n - 1) * pitch) / 2;
    const minGap = 2 * r;

    // Existing agents are found through the hash; agents chosen earlier in this
    // same block are checked directly, since the hash predates them.
    this.hash.build(this.agents.x, this.agents.y, this.agents.count, Math.max(1, minGap));

    const chosen: Point[] = [];
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) {
        const p: Point = [
          Math.round(at[0] - half + i * pitch),
          Math.round(at[1] - half + j * pitch),
        ];
        if (this.isBlocked(p)) continue;
        if (this.hash.query(p[0], p[1], minGap, -1, this.agents.x, this.agents.y).length > 0) continue;
        if (chosen.some((q) => Math.hypot(q[0] - p[0], q[1] - p[1]) < minGap)) continue;
        chosen.push(p);
      }
    }
    return chosen;
  }

  /**
   * Drops the goal flag from walls nobody is walking to.
   *
   * Several walls can be goals at once -- that is the point of selecting a group
   * and sending it somewhere of its own -- but a goal is not free: Navigation
   * runs a Dijkstra over the whole graph per goal wall, on every rebuild. So a
   * wall stays marked only while it is the one just picked, or while some
   * pedestrian still has it as their goal. Arrived pedestrians count: a crowd
   * standing at its goal is still standing at a goal.
   */
  private pruneGoals(justMarked: number): void {
    const wanted = new Set<number>([justMarked]);
    for (let i = 0; i < this.agents.count; i++) {
      const g = this.agents.goal[i];
      if (g >= 0) wanted.add(g);
    }
    for (const w of this.walls) w.isGoal = wanted.has(w.id);
  }

  private rebuildNavIfNeeded(): void {
    if (!this.navDirty) return;
    this.nav.rebuild(this.walls, this.settings.pedestrianRadius);
    this.navDirty = false;
  }

  private tick = (): void => {
    if (!this.running) return;
    this.rebuildNavIfNeeded();
    this.agents.step(
      this.nav, this.hash,
      this.settings.speed, this.settings.pedestrianRadius, this.settings.preferredSpace,
    );
    this.playArrivals();
    this.agentRevision++;
    this.render();
    requestAnimationFrame(this.tick);
  };

  /**
   * One plop per pedestrian that reached its goal this tick, panned by where it
   * landed on screen -- arrivals on the left are heard on the left. Offscreen
   * arrivals still sound, pinned to the side they went off.
   */
  private playArrivals(): void {
    const arrivals = this.agents.justArrived;
    if (!this.settings.sound || arrivals.length === 0) return;

    const half = this.viewport.width / 2;
    const pans = arrivals.map((i) => {
      const screen = this.viewport.worldToScreen([this.agents.x[i], this.agents.y[i]]);
      // Held short of a hard left/right, which sounds detached from the picture.
      return Math.max(-0.8, Math.min(0.8, ((screen[0] - half) / half) * 0.8));
    });
    this.plops.play(pans);
  }

  /** Record a world change and schedule a repaint. */
  private touch(): void {
    this.worldRevision++;
    this.agentRevision++;
    this.requestRender();
  }

  requestRender(): void {
    if (this.frameRequested) return;
    this.frameRequested = true;
    requestAnimationFrame(() => {
      this.frameRequested = false;
      this.render();
    });
  }

  private render(): void {
    // Keeps the expanded hulls, and so the dashed outlines, in step with the
    // walls and the current pedestrian radius. No-ops unless something changed.
    this.rebuildNavIfNeeded();
    this.renderScene();
    // Also paint directly, for changes that only touch the overlay (a rubber-band
    // line tracking the cursor) where deck.gl has nothing to redraw.
    this.drawOverlay();
  }

  private renderScene(): void {
    const sceneState: SceneState = {
      worldRevision: this.worldRevision,
      agentRevision: this.agentRevision,
      walls: this.walls,
      agents: this.agentViews(),
      rays: [],
      paths: this.settings.showLineToTarget ? this.goalPaths() : [],
      showPreferredRadius: this.settings.showPreferredRadius,
    };
    this.scene.setViewState(this.viewport.toViewState());
    this.scene.render(sceneState);
  }

  private drawOverlay(): void {
    const preview = this.tool?.preview() ?? EMPTY_PREVIEW;
    this.overlay.render({
      hulls: this.expandedHulls(),
      showDebug: this.settings.showDebug,
      pendingWallPoints: preview.pendingWallPoints,
      pendingWallTracing: preview.pendingWallTracing,
      pendingRect: preview.pendingRect,
      pendingPolygons: preview.pendingPolygons,
      pendingPolygonsInvalid: preview.pendingPolygonsInvalid,
      selectionPolygon: preview.selectionPolygon,
      pendingPedestrians: preview.pendingPedestrians,
      pedestrianRadius: this.settings.pedestrianRadius,
      cursorGhost: preview.cursorGhost,
      targetLines: preview.targetLines,
      // Only gathered when something is going to draw them, and only for the
      // pedestrians the goal would actually apply to.
      agentPositions: preview.targetLines ? this.targetableAgents() : [],
      agentColors: preview.targetLines ? this.targetableColors() : [],
      mouseWorld: this.mouseWorld,
      debugLines: this.debugLines(),
    });
  }

  /**
   * The route each pedestrian intends to take, for the orange overlay that ports
   * drawFastestPath(). Each path is its current position, the waypoint it is
   * walking to, then the rest of the route read off the Dijkstra predecessors --
   * so this costs a short array walk per agent, not a search.
   *
   * A pedestrian only gets a waypoint on its first step, so before the run
   * starts there is nothing to read. Marking a goal is exactly when the route is
   * worth seeing -- it is the answer to "where will they go?" -- so while paused
   * the first waypoint is picked here instead, and the rest follows the same
   * predecessors. That is one graph scan per pedestrian, hence the cache below:
   * paused, the picture only changes when the map, the crowd or the goal does.
   */
  private goalPaths(): Point[][] {
    const key = `${this.worldRevision}:${this.agentRevision}:${this.running ? 1 : 0}`;
    if (this.goalPathCacheKey === key) return this.goalPathCache;

    const out: Point[][] = [];
    // A debug overlay, so it is capped: past this many routes the picture is an
    // unreadable mat of lines anyway, and building one array per agent per frame
    // starts to cost more than the simulation does.
    const limit = 1500;
    for (let i = 0; i < this.agents.count && out.length < limit; i++) {
      if (this.agents.arrived[i]) continue;
      const goalId = this.agents.goal[i];
      if (goalId < 0) continue;
      const head: Point = [this.agents.x[i], this.agents.y[i]];
      let path: Point[];
      if (this.agents.hasWaypoint[i]) {
        const rest = this.nav.pathFromNode(this.agents.waypointNode[i], goalId);
        path = rest.length > 0
          ? [head, ...rest]
          : [head, [this.agents.waypointX[i], this.agents.waypointY[i]]];
      } else {
        // Predicted, not remembered. Skipped while running: an agent without a
        // waypoint mid-run is one whose route just failed, and re-searching it
        // every frame would put the per-agent search back into the loop the
        // whole navigation rewrite took it out of.
        if (this.running) continue;
        path = this.nav.routeFrom(head, goalId);
      }
      if (path.length >= 2) out.push(path);
    }

    this.goalPathCacheKey = key;
    this.goalPathCache = out;
    return out;
  }

  /**
   * deck.gl accessors want per-object records. Building them here keeps the
   * simulation on flat typed arrays, ready to move behind a worker in step 4.
   */
  private agentViews() {
    const out = new Array(this.agents.count);
    const r = this.settings.pedestrianRadius;
    const space = this.settings.preferredSpace;
    for (let i = 0; i < this.agents.count; i++) {
      // The room this one is actually keeping, not the setting: personal space
      // gives way as a crowd packs, and the ring is where you can watch it do so.
      // Nought until a pedestrian has taken a step, and then the setting stands in.
      const kept = this.agents.effectiveSpace[i];
      out[i] = {
        position: [this.agents.x[i], this.agents.y[i]] as Point,
        color: unpackRgb(this.agents.color[i]),
        radius: r,
        preferredSpace: kept > 0 ? kept : space,
        selected: this.agents.selected[i] === 1,
      };
    }
    return out;
  }

  /** The pedestrians a goal assignment would hit: the selection, or everyone. */
  private targetableIndices(): number[] {
    const onlySelected = this.agents.selectionCount > 0;
    const out: number[] = [];
    for (let i = 0; i < this.agents.count; i++) {
      if (onlySelected && !this.agents.selected[i]) continue;
      out.push(i);
    }
    return out;
  }

  private targetableAgents(): Point[] {
    return this.targetableIndices().map((i) => [this.agents.x[i], this.agents.y[i]] as Point);
  }

  private targetableColors(): RGB[] {
    return this.targetableIndices().map((i) => unpackRgb(this.agents.color[i]));
  }

  /**
   * The whole map as JSON on the clipboard.
   *
   * A stuck pedestrian depends on the exact walls, positions, goals and settings
   * around it, which is close to impossible to describe in words -- this makes a
   * case reproducible by handing over the snapshot.
   */
  private async copyMapToClipboard(): Promise<string> {
    const { json, note } = this.buildScenarioJson();
    try {
      await navigator.clipboard.writeText(json);
      return note;
    } catch {
      // Clipboard access needs a secure context and a user gesture, and can still
      // be refused. Don't lose the snapshot: put it on the console, where it can
      // be copied by hand.
      console.log('[walky] map snapshot:\n' + json);
      return `${note} — clipboard blocked, logged to console`;
    }
  }

  /** Everything on the map, as the plain snapshot the JSON and the link share. */
  private snapshot(): Scenario {
    const agents: SerializedAgent[] = [];
    const stuck: boolean[] = [];
    for (let i = 0; i < this.agents.count; i++) {
      const goalId = this.agents.goal[i];
      agents.push({
        x: this.agents.x[i],
        y: this.agents.y[i],
        originX: this.agents.originX[i],
        originY: this.agents.originY[i],
        goal: goalId,
        arrived: this.agents.arrived[i] === 1,
        color: unpackRgb(this.agents.color[i]),
      });
      // No route from here: exactly the pedestrians worth looking at.
      stuck.push(!this.agents.arrived[i] && goalId >= 0
        && this.nav.hasGoal(goalId)
        && this.nav.nextWaypoint([this.agents.x[i], this.agents.y[i]], goalId) === null);
    }
    return serializeScenario({
      settings: this.settings,
      view: {
        targetX: this.viewport.targetX,
        targetY: this.viewport.targetY,
        zoomLevel: this.viewport.zoomLevel,
      },
      walls: this.walls,
      agents,
      stuck,
    });
  }

  /** The scenario as JSON, plus a one-line summary. */
  buildScenarioJson(): { json: string; note: string } {
    const scenario = this.snapshot();
    const note = `${scenario.summary.walls} walls, ${scenario.summary.agents} pedestrians, `
      + `${scenario.summary.stuck} stuck`;
    return { json: scenarioToJson(scenario), note };
  }

  /**
   * The map as a link on the clipboard.
   *
   * It deliberately does not write the link into the address bar. That would be
   * a navigation, and it would make the URL a claim about a map that stops being
   * true the moment anything is drawn -- the same reason a shared link is cleared
   * once it has been read.
   */
  private async copyLinkToClipboard(): Promise<string> {
    const scenario = this.snapshot();
    const url = await shareUrl(scenario, location.href);
    const many = (n: number, noun: string) => `${n} ${noun}${n === 1 ? '' : 's'}`;
    const what = `${many(scenario.summary.walls, 'wall')}, ${many(scenario.summary.agents, 'pedestrian')}`;

    if (url.length > LINK_MAX_CHARS) {
      // Pedestrians are the bulk of a big map, and a link nobody can open is
      // worse than none: say so rather than hand over one that fails silently.
      return `Too big for a link — ${what}. Copy the map as JSON instead`;
    }
    const size = url.length.toLocaleString();
    const long = url.length > LINK_SAFE_CHARS
      ? `; ${size} characters, which some apps will shorten or cut`
      : '';
    try {
      await navigator.clipboard.writeText(url);
      return `Link copied — ${what}${long}`;
    } catch {
      // Same policy as the JSON button: clipboard access needs a secure context
      // and a gesture, and can still be refused. Don't lose the link.
      console.log('[walky] share link:\n' + url);
      return `${what} — clipboard blocked, link logged to console`;
    }
  }

  /**
   * Replaces the map with a scenario that came from somewhere else.
   *
   * Note the settings are assigned *into* the existing object rather than over
   * it: the same object is handed to the settings sheet and the contextual panel
   * at construction, and swapping it here would leave both panels editing an
   * object nothing reads any more.
   */
  loadScenario(core: ScenarioCore): void {
    // Opening a link over a map somebody has drawn takes it away as surely as
    // Clear does, so it is an edit like any other and undo can bring it back.
    // Only when there is something to lose: at startup, which is the usual way
    // in, the map is empty and an undo step there would undo nothing.
    if (!this.isEmpty()) this.checkpoint();
    this.resetWorld();

    Object.assign(this.settings, clampSettings(core.settings));

    const { walls, agents } = buildWorld(core);
    this.walls = walls;
    for (const agent of agents) this.agents.addRestored(agent);

    this.viewport.targetX = core.view.targetX;
    this.viewport.targetY = core.view.targetY;
    this.viewport.zoomLevel = core.view.zoomLevel;

    this.navDirty = true;
    this.settingsSheet.sync();
    this.contextPanel.sync();
    this.updateContextPanel();
    this.touch();
  }

  private debugLines(): string[] {
    const m = this.mouseWorld;
    return [
      `Pedestrians Alive: ${this.agents.count}`,
      `Selected: ${this.agents.selectionCount}`,
      `Walls: ${this.walls.length}`,
      `Zoom level: ${this.viewport.zoomLevel} (scale ${this.viewport.scale.toFixed(3)})`,
      m ? `X: ${Math.round(m[0])} / Y: ${Math.round(m[1])}` : 'X: - / Y: -',
    ];
  }

  toggleSetting<K extends keyof Settings>(key: K, value: Settings[K]): void {
    this.settings[key] = value;
    this.requestRender();
  }

  get toolbarRef(): Toolbar { return this.toolbar; }
}
