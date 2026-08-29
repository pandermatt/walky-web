import { Scene, type SceneState } from './render/scene';
import { Overlay } from './render/overlay';
import { Viewport } from './render/viewport';
import { toCss, BACKGROUND, WHITE, type RGB } from './palette';
import {
  DEFAULT_SETTINGS, makeWall, makeTree, wallContains,
  type Settings, type Tree, type Wall, type WallOptions,
} from './state/model';
import { expandPolygon, pointInPolygon, type Point } from './sim/geometry';
import { groupWalls, type WallGroup } from './state/groups';
import { Toolbar, type ActionId } from './ui/toolbar';
import { serializeScenario, scenarioToJson, type SerializedAgent } from './state/scenario';
import { SettingsPanel } from './ui/settingsPanel';
import { ContextPanel } from './ui/contextPanel';
import { BorderTool } from './tools/borderTool';
import { SelectionTool } from './tools/selectionTool';
import { WallTool } from './tools/wallTool';
import { RectangleTool } from './tools/rectangleTool';
import { ShiftTool } from './tools/shiftTool';
import { PedestrianTool } from './tools/pedestrianTool';
import { GoalTool } from './tools/goalTool';
import { TreeTool } from './tools/treeTool';
import { Navigation } from './sim/navigation';
import { Agents, unpackRgb } from './sim/agents';
import { SpatialHash } from './sim/spatialHash';
import { EMPTY_PREVIEW, type PointerInfo, type Tool, type ToolContext, type ToolId } from './tools/types';

export class App {
  private viewport = new Viewport();
  private scene: Scene;
  private overlay: Overlay;
  private toolbar: Toolbar;
  private settingsPanel: SettingsPanel;
  private contextPanel: ContextPanel;

  private walls: Wall[] = [];
  private trees: Tree[] = [];
  private settings: Settings = { ...DEFAULT_SETTINGS };
  private nav = new Navigation();
  private agents = new Agents();
  private hash = new SpatialHash();
  private running = false;
  private navDirty = true;
  private groupCache: WallGroup[] | null = null;
  private groupCacheRevision = -1;

  private tools = new Map<ToolId, Tool>();
  /** No tool active is a real state: after a one-shot action, nothing is armed. */
  private tool: Tool | null = null;
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
      new PedestrianTool(), new GoalTool(), new TreeTool(), new SelectionTool(),
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
      this.settingsPanel.sync();
      this.contextPanel.sync();
      this.touch();
    };

    this.settingsPanel = new SettingsPanel(
      panels, this.settings, onSettingChange, () => this.copyMapToClipboard(),
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
      // With a selection, the goal applies to it alone; with nothing selected it
      // applies to everyone, as Map.setGoalForSelectedPedestrians did.
      const onlySelected = this.agents.selectionCount > 0;
      for (let i = 0; i < this.agents.count; i++) {
        if (onlySelected && !this.agents.selected[i]) continue;
        this.agents.setGoal(i, hit.id, hit.color);
      }
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
      this.lastScreen = e.screen;
      this.tool?.onPointerDown?.(e, this.context);
      this.requestRender();
    });

    el.addEventListener('pointermove', (ev) => {
      const e = info(ev);
      this.mouseWorld = e.world;
      this.tool?.onPointerMove?.(e, this.context);
      this.lastScreen = e.screen;
      if (this.settings.showDebug) this.requestRender();
    });

    el.addEventListener('pointerup', (ev) => {
      const e = info(ev);
      this.tool?.onPointerUp?.(e, this.context);
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
      if (ev.key === 'Escape') { this.tool?.cancel?.(); this.agents.clearSelection(); this.setTool(null); }
    });
  }

  private setTool(id: ToolId | null): void {
    this.tool?.cancel?.();
    this.tool = id ? this.tools.get(id) ?? null : null;
    this.toolbar.selectTool(this.tool ? this.tool.id : null, true);
    // Picking a tool means you are done with settings; leaving it open would sit
    // over the canvas you are about to draw on.
    this.closeSettings();
    this.updateContextPanel();
    this.applyCursor();
    this.requestRender();
  }

  private closeSettings(): void {
    this.settingsPanel.close();
    this.toolbar.setPressed('settings', false);
  }

  /**
   * Shows the handful of settings that matter to whatever is active: the brush
   * controls while placing pedestrians, speed while the simulation runs.
   */
  private updateContextPanel(): void {
    if (this.running) {
      this.contextPanel.show('Running', ['speed']);
      return;
    }
    if (this.tool?.id === 'pedestrian') {
      this.contextPanel.show('Pedestrians', ['brushSize', 'preferredSpace']);
      return;
    }
    this.contextPanel.hide();
  }

  private applyCursor(): void {
    const cursor = this.tool?.cursor ?? 'default';
    this.stage.style.cursor = cursor;
    // The deck canvas sits on top and paints its own cursor, so it needs telling.
    this.scene.setCursor(cursor);
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
        this.updateContextPanel();
        this.navDirty = true;
        this.tool?.cancel?.();
        this.touch();
        break;
      case 'start':
        this.running = !this.running;
        this.toolbar.setRunning(this.running);
        this.updateContextPanel();
        if (this.running) this.tick();
        break;
      case 'reset_pedestrians':
        this.agents.resetPositions();
        this.touch();
        break;
      case 'settings':
        this.toolbar.setPressed('settings', this.settingsPanel.toggle());
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
   * The hull outlines to draw: each wall's convex hull grown by the pedestrian
   * radius, which is the boundary a pedestrian's centre must stay outside of.
   */
  private expandedHulls(): { points: Point[]; color: RGB; faint: boolean }[] {
    const byId = new Map(this.walls.map((w) => [w.id, w.color]));

    // The solid outline is drawn once per connected group rather than per wall,
    // so shapes drawn against each other still read as one object -- the look
    // merging used to give, without merging their identities. Navigation keeps
    // its own per-wall shells, which are tighter and so a better broad phase.
    const shells = this.groups().map((g) => ({
      points: expandPolygon(g.hull, this.settings.pedestrianRadius),
      color: byId.get(g.wallIds[0]) ?? WHITE,
      faint: false,
    }));
    const parts = this.nav.obstacles.map((ob) => ({
      points: ob.hull,
      color: byId.get(ob.wallId) ?? WHITE,
      faint: true,
    }));
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
    const preview = this.tool?.preview() ?? EMPTY_PREVIEW;
    this.overlay.render({
      hulls: this.expandedHulls(),
      showConvexHull: this.settings.showConvexHull,
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

  /** The scenario as JSON, plus a one-line summary. */
  buildScenarioJson(): { json: string; note: string } {
    const agents: SerializedAgent[] = [];
    for (let i = 0; i < this.agents.count; i++) {
      const goalId = this.agents.goal[i];
      agents.push({
        x: this.agents.x[i],
        y: this.agents.y[i],
        originX: this.agents.originX[i],
        originY: this.agents.originY[i],
        goal: goalId,
        arrived: this.agents.arrived[i] === 1,
        // No route from here: exactly the pedestrians worth looking at.
        stuck: !this.agents.arrived[i] && goalId >= 0
          && this.nav.hasGoal(goalId)
          && this.nav.nextWaypoint([this.agents.x[i], this.agents.y[i]], goalId) === null,
      });
    }
    const scenario = serializeScenario({
      settings: this.settings,
      view: {
        targetX: this.viewport.targetX,
        targetY: this.viewport.targetY,
        zoomLevel: this.viewport.zoomLevel,
      },
      walls: this.walls,
      trees: this.trees,
      agents,
    });
    const note = `${scenario.summary.walls} walls, ${scenario.summary.agents} pedestrians, `
      + `${scenario.summary.stuck} stuck`;
    return { json: scenarioToJson(scenario), note };
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
