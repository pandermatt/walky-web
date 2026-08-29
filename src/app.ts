import { Scene, type SceneState } from './render/scene';
import { Overlay } from './render/overlay';
import { Viewport } from './render/viewport';
import { toCss, BACKGROUND, WHITE, type RGB } from './palette';
import {
  DEFAULT_SETTINGS, makeWall, makeTree, refreshHull, wallContains, wallOverlapsPolygon,
  type Settings, type Tree, type Wall,
} from './state/model';
import { pointInPolygon, type Point } from './sim/geometry';
import { Toolbar, type ActionId } from './ui/toolbar';
import { SettingsPanel } from './ui/settingsPanel';
import { WallTool } from './tools/wallTool';
import { RectangleTool } from './tools/rectangleTool';
import { ShiftTool } from './tools/shiftTool';
import { PedestrianTool } from './tools/pedestrianTool';
import { GoalTool } from './tools/goalTool';
import { TreeTool } from './tools/treeTool';
import { Navigation } from './sim/navigation';
import { Agents, unpackRgb } from './sim/agents';
import { SpatialHash } from './sim/spatialHash';
import type { PointerInfo, Tool, ToolContext, ToolId } from './tools/types';

export class App {
  private viewport = new Viewport();
  private scene: Scene;
  private overlay: Overlay;
  private toolbar: Toolbar;
  private settingsPanel: SettingsPanel;

  private walls: Wall[] = [];
  private trees: Tree[] = [];
  private settings: Settings = { ...DEFAULT_SETTINGS };
  private nav = new Navigation();
  private agents = new Agents();
  private hash = new SpatialHash();
  private running = false;
  private navDirty = true;

  private tools = new Map<ToolId, Tool>();
  private tool: Tool;
  private mouseWorld: Point | null = null;
  private lastScreen: Point | null = null;
  private frameRequested = false;
  /** Bumped on map edits only -- walls and trees. */
  private worldRevision = 0;
  /** Bumped every simulation tick -- agents, rays, paths. */
  private agentRevision = 0;

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
      new PedestrianTool(), new GoalTool(), new TreeTool(),
    ]) {
      this.tools.set(t.id, t as Tool);
    }
    this.tool = this.tools.get('rectangle')!;

    this.toolbar = new Toolbar(
      stage,
      'rectangle',
      (id) => this.setTool(id),
      (id) => this.runAction(id),
    );

    // Input binds to the deck canvas, not the stage: the toolbar is a sibling
    // inside the stage, so binding higher up made every toolbar click also land
    // on the canvas as a tool click.
    this.settingsPanel = new SettingsPanel(stage, this.settings, (key, value) => {
      this.settings[key] = value;
      // Radius changes the expanded hulls, so the navigation graph must be rebuilt.
      if (key === 'pedestrianRadius') this.navDirty = true;
      this.touch();
    });

    this.bindPointer(deckCanvas);
    this.resize();
    window.addEventListener('resize', () => this.resize());
    this.applyCursor();
    this.requestRender();
  }

  // ---- world mutations exposed to tools -----------------------------------

  private context: ToolContext = {
    addWall: (polygon) => this.addWall(polygon),
    addTree: (at) => { this.trees = [...this.trees, makeTree(at)]; this.touch(); },
    pedestrianBlock: (at) => this.pedestrianBlock(at),
    addPedestrians: (at) => {
      const spots = this.pedestrianBlock(at);
      if (spots.length === 0) return;
      for (const p of spots) this.agents.add(p);
      this.touch();
    },
    setGoalAt: (at) => {
      const hit = [...this.walls].reverse().find((w) => wallContains(w, at));
      if (!hit) return;
      for (const w of this.walls) w.isGoal = w.id === hit.id;
      this.navDirty = true;
      this.rebuildNavIfNeeded();
      for (let i = 0; i < this.agents.count; i++) {
        this.agents.setGoal(i, hit.id, hit.color);
      }
      this.touch();
    },
    selectAt: (at, extend) => {
      for (const w of this.walls) {
        const hit = wallContains(w, at);
        w.selected = hit ? true : extend ? w.selected : false;
      }
      this.touch();
    },
    selectWithin: (poly, extend) => {
      for (const w of this.walls) {
        const hit = w.polygons.flat().some((p: Point) => pointInPolygon(poly, p));
        w.selected = hit ? true : extend ? w.selected : false;
      }
      this.touch();
    },
    panBy: (dx, dy) => this.viewport.panBy(dx, dy),
    requestRender: () => this.requestRender(),
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
      this.lastScreen = e.screen;
      this.tool.onPointerDown?.(e, this.context);
      this.requestRender();
    });

    el.addEventListener('pointermove', (ev) => {
      const e = info(ev);
      this.mouseWorld = e.world;
      this.tool.onPointerMove?.(e, this.context);
      this.lastScreen = e.screen;
      if (this.settings.showDebug) this.requestRender();
    });

    el.addEventListener('pointerup', (ev) => {
      const e = info(ev);
      this.tool.onPointerUp?.(e, this.context);
      this.lastScreen = null;
      this.requestRender();
    });

    el.addEventListener('dblclick', (ev) => {
      this.tool.onDoubleClick?.(info(ev), this.context);
    });

    el.addEventListener('wheel', (ev) => {
      ev.preventDefault();
      // One notch per event, matching MouseWheelEvent.getWheelRotation().
      this.viewport.zoomAt(info(ev).screen, ev.deltaY > 0 ? 1 : -1);
      this.requestRender();
    }, { passive: false });

    el.addEventListener('contextmenu', (ev) => ev.preventDefault());

    window.addEventListener('keydown', (ev) => {
      if (ev.key === 'Escape') { this.tool.cancel?.(); this.requestRender(); }
    });
  }

  private setTool(id: ToolId): void {
    this.tool.cancel?.();
    const next = this.tools.get(id);
    if (next) this.tool = next;
    this.applyCursor();
    this.requestRender();
  }

  private applyCursor(): void {
    this.stage.style.cursor = this.tool.cursor;
  }

  private runAction(id: ActionId): void {
    switch (id) {
      case 'reset_zoom':
        this.viewport.reset();
        this.requestRender();
        break;
      case 'clear':
        this.walls = [];
        this.trees = [];
        this.agents.clear();
        this.running = false;
        this.toolbar.setRunning(false);
        this.navDirty = true;
        this.tool.cancel?.();
        this.touch();
        break;
      case 'start':
        this.running = !this.running;
        this.toolbar.setRunning(this.running);
        if (this.running) this.tick();
        break;
      case 'reset_pedestrians':
        this.agents.resetPositions();
        this.touch();
        break;
      case 'settings':
        this.settingsPanel.toggle();
        break;
      default:
        // record arrives with the MediaRecorder step
        break;
    }
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
   * Adds a shape, merging it with any wall it overlaps.
   *
   * Ports Map.addWall: a new shape drawn on top of existing ones absorbs them
   * into a single wall, so the convex hull is recomputed over the union and the
   * navigation graph sees one obstacle instead of several overlapping ones.
   * Pedestrians caught under the new shape are removed, and any heading for a
   * wall that got absorbed are retargeted onto the merged wall.
   */
  private addWall(polygon: Point[]): boolean {
    if (polygon.length < 3) return false;

    const overlapping = this.walls.filter((w) => wallOverlapsPolygon(w, polygon));
    const survivors = this.walls.filter((w) => !overlapping.includes(w));

    // The merged wall keeps the colour and goal status of what it absorbed, so a
    // goal does not silently stop being a goal because something was drawn on it.
    const inherited = overlapping.find((w) => w.isGoal) ?? overlapping[0];
    const merged = makeWall(
      [polygon, ...overlapping.flatMap((w) => w.polygons)],
      inherited?.color,
    );
    merged.isGoal = overlapping.some((w) => w.isGoal);
    refreshHull(merged);

    this.walls = [...survivors, merged];

    // Retarget anything that was heading for an absorbed wall.
    const absorbed = new Set(overlapping.map((w) => w.id));
    for (let i = 0; i < this.agents.count; i++) {
      if (absorbed.has(this.agents.goal[i])) {
        this.agents.setGoal(i, merged.id, merged.color);
      }
    }
    this.removeAgentsUnder(merged);

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
   * The hull outlines to draw: each wall's convex hull grown by the pedestrian
   * radius, which is the boundary a pedestrian's centre must stay outside of.
   */
  private expandedHulls(): { points: Point[]; color: RGB; faint: boolean }[] {
    const byId = new Map(this.walls.map((w) => [w.id, w.color]));
    // The whole-wall convex hull is the outline the original drew, and it is worth
    // keeping: on a convex wall it is the only line you see, and on a concave one
    // it frames the shape while the parts show what actually blocks.
    const shells = this.nav.shells.map((sh) => ({
      points: sh.hull,
      color: byId.get(sh.wallId) ?? WHITE,
      faint: false,
    }));
    const parts = this.nav.obstacles.map((ob) => ({
      points: ob.hull,
      color: byId.get(ob.wallId) ?? WHITE,
      faint: true,
    }));
    return [...parts, ...shells];
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
    this.agentRevision++;
    this.render();
    requestAnimationFrame(this.tick);
  };

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
      trees: this.trees,
      agents: this.agentViews(),
      rays: [],
      paths: this.settings.showLineToTarget ? this.goalPaths() : [],
      showPreferredRadius: this.settings.showPreferredRadius,
    };
    this.scene.setViewState(this.viewport.toViewState());
    this.scene.render(sceneState);
  }

  private drawOverlay(): void {
    const preview = this.tool.preview();
    this.overlay.render({
      hulls: this.expandedHulls(),
      showConvexHull: this.settings.showConvexHull,
      showDebug: this.settings.showDebug,
      pendingWallPoints: preview.pendingWallPoints,
      pendingRect: preview.pendingRect,
      selectionPolygon: preview.selectionPolygon,
      pendingPedestrians: preview.pendingPedestrians,
      pedestrianRadius: this.settings.pedestrianRadius,
      mouseWorld: this.mouseWorld,
      debugLines: this.debugLines(),
    });
  }

  /**
   * The route each pedestrian intends to take, for the orange overlay that ports
   * drawFastestPath(). Each path is its current position, the waypoint it is
   * walking to, then the rest of the route read off the Dijkstra predecessors --
   * so this costs a short array walk per agent, not a search.
   */
  private goalPaths(): Point[][] {
    const out: Point[][] = [];
    // A debug overlay, so it is capped: past this many routes the picture is an
    // unreadable mat of lines anyway, and building one array per agent per frame
    // starts to cost more than the simulation does.
    const limit = 1500;
    for (let i = 0; i < this.agents.count && out.length < limit; i++) {
      if (this.agents.arrived[i] || !this.agents.hasWaypoint[i]) continue;
      const goalId = this.agents.goal[i];
      if (goalId < 0) continue;
      const head: Point = [this.agents.x[i], this.agents.y[i]];
      const rest = this.nav.pathFromNode(this.agents.waypointNode[i], goalId);
      const path: Point[] = rest.length > 0
        ? [head, ...rest]
        : [head, [this.agents.waypointX[i], this.agents.waypointY[i]]];
      if (path.length >= 2) out.push(path);
    }
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
      out[i] = {
        position: [this.agents.x[i], this.agents.y[i]] as Point,
        color: unpackRgb(this.agents.color[i]),
        radius: r,
        preferredSpace: space,
      };
    }
    return out;
  }

  private debugLines(): string[] {
    const m = this.mouseWorld;
    return [
      `Pedestrians Alive: ${this.agents.count}`,
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
