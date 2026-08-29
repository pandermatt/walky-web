import { Deck, OrthographicView, type OrthographicViewState } from '@deck.gl/core';
import { SolidPolygonLayer, ScatterplotLayer, LineLayer, PathLayer } from '@deck.gl/layers';
import { BLUE, ORANGE, RED, WHITE, YELLOW, type RGB } from '../palette';

export type Point = [number, number];

export interface Wall {
  id: number;
  polygons: Point[][];
  color: RGB;
  isGoal: boolean;
}

/** One drawable piece: a wall contributes one entry per polygon it owns. */
interface WallPiece {
  polygon: Point[];
  color: RGB;
}

export interface Ray {
  from: Point;
  to: Point;
}

export interface Agent {
  position: Point;
  color: RGB;
  radius: number;
  preferredSpace: number;
  selected: boolean;
}

export interface SceneState {
  /**
   * deck.gl compares props shallowly, so mutating a wall in place -- or pushing
   * onto the same array -- leaves it convinced nothing happened and it keeps the
   * stale GPU buffers. These revisions drive updateTriggers so in-place edits show.
   *
   * They are split deliberately. Walls change only when the map is edited, while
   * agents move every tick; sharing one counter re-tesselated every
   * wall polygon on every frame, which alone cost about 800ms a frame.
   */
  worldRevision: number;
  agentRevision: number;
  walls: Wall[];
  agents: Agent[];
  rays: Ray[];
  paths: Point[][];
  showPreferredRadius: boolean;
}

export class Scene {
  private deck: Deck<OrthographicView>;
  private canvas: HTMLCanvasElement;
  private cursor = 'default';

  /**
   * `onAfterRender` fires inside deck.gl's own draw loop. The 2D overlay paints
   * from there so dashed hulls land in the same frame as the walls they outline --
   * otherwise deck redraws a frame later than a plain requestAnimationFrame and
   * the dashes visibly slide against their walls while panning.
   */
  constructor(
    canvas: HTMLCanvasElement,
    initialViewState: OrthographicViewState,
    onAfterRender?: () => void,
  ) {
    this.canvas = canvas;
    this.deck = new Deck({
      canvas,
      views: new OrthographicView({ id: 'ortho' }),
      initialViewState,
      controller: false,
      layers: [],
      onAfterRender,
      // deck.gl's default is ({isDragging}) => isDragging ? 'grabbing' : 'grab',
      // and it writes container.style.cursor directly -- so the canvas showed a
      // grab cursor whatever the active tool was, overriding anything set on the
      // stage underneath it. The active tool owns the cursor instead.
      getCursor: () => this.cursor,
    });
  }

  /** The cursor deck.gl should paint on its canvas. */
  setCursor(cursor: string): void {
    if (cursor === this.cursor) return;
    this.cursor = cursor;
    // Applied directly as well as through getCursor: deck only re-reads getCursor
    // on its own pointer events, so without this the cursor would not change
    // until the next time the mouse moved over the canvas.
    this.canvas.style.cursor = cursor;
  }

  setViewState(viewState: OrthographicViewState): void {
    this.deck.setProps({ viewState });
  }

  render(state: SceneState): void {
    this.deck.setProps({ layers: this.buildLayers(state) });
    // setProps only marks deck dirty; it would otherwise paint on its own next
    // animation frame, one behind the overlay. Forcing the redraw here keeps the
    // two canvases on the same frame -- which also matters for MediaRecorder,
    // since it captures whatever is on the canvas at that moment.
    this.deck.redraw('walky');
  }

  private buildLayers(state: SceneState) {
    const { worldRevision, agentRevision, walls, agents, rays, paths, showPreferredRadius } = state;

    return [
      // Walls are flat 2D fills -- no shadow copy, no extrusion. A merged wall
      // owns several polygons, so it is flattened to one piece per polygon.
      new SolidPolygonLayer<WallPiece>({
        id: 'walls',
        data: walls.flatMap((w) => w.polygons.map((polygon) => ({ polygon, color: w.color }))),
        getPolygon: (piece) => piece.polygon,
        getFillColor: (piece) => piece.color as unknown as [number, number, number],
        filled: true,
        updateTriggers: { getPolygon: worldRevision, getFillColor: worldRevision },
      }),

      new LineLayer<Ray>({
        id: 'visibility-rays',
        data: rays,
        getSourcePosition: (r) => r.from,
        getTargetPosition: (r) => r.to,
        getColor: BLUE as unknown as [number, number, number],
        widthUnits: 'pixels',
        getWidth: 1,
        updateTriggers: { getSourcePosition: agentRevision, getTargetPosition: agentRevision },
      }),

      new PathLayer<Point[]>({
        id: 'goal-paths',
        data: paths,
        getPath: (p) => p,
        getColor: ORANGE as unknown as [number, number, number],
        widthUnits: 'pixels',
        getWidth: 2,
        capRounded: true,
        jointRounded: true,
        updateTriggers: { getPath: agentRevision },
      }),

      new ScatterplotLayer<Agent>({
        id: 'preferred-radius',
        data: showPreferredRadius ? agents : [],
        getPosition: (a) => a.position,
        getRadius: (a) => a.radius + a.preferredSpace,
        radiusUnits: 'common',
        filled: false,
        stroked: true,
        getLineColor: RED as unknown as [number, number, number],
        lineWidthUnits: 'pixels',
        getLineWidth: 1,
        updateTriggers: { getPosition: agentRevision, getRadius: agentRevision },
      }),

      // A filled dot in the colour of the goal it is heading for, with a white ring.
      new ScatterplotLayer<Agent>({
        id: 'pedestrians',
        data: agents,
        getPosition: (a) => a.position,
        getRadius: (a) => a.radius,
        radiusUnits: 'common',
        filled: true,
        getFillColor: (a) => a.color as unknown as [number, number, number],
        stroked: true,
        // Selected pedestrians wear a thicker yellow ring instead of the white
        // one, which is the original's selection colour.
        getLineColor: (a) => (a.selected ? YELLOW : WHITE) as unknown as [number, number, number],
        lineWidthUnits: 'pixels',
        getLineWidth: (a) => (a.selected ? 3 : 1),
        updateTriggers: {
          getPosition: agentRevision,
          getFillColor: agentRevision,
          getRadius: agentRevision,
          getLineColor: agentRevision,
          getLineWidth: agentRevision,
        },
      }),
    ];
  }

  finalize(): void {
    this.deck.finalize();
  }
}
