import { Deck, OrthographicView, type OrthographicViewState } from '@deck.gl/core';
import { SolidPolygonLayer, ScatterplotLayer, LineLayer, PathLayer } from '@deck.gl/layers';
import { BLUE, ORANGE, RED, WHITE, YELLOW, type RGB } from '../palette';
import type { EraseTarget } from '../tools/types';

export type Point = [number, number];

export interface Wall {
  id: number;
  polygons: Point[][];
  color: RGB;
  isGoal: boolean;
}

/** One drawable piece: a wall contributes one entry per polygon it owns. */
interface WallPiece {
  /** The wall it belongs to, so all of a border frame's bars fade together. */
  wallId: number;
  polygon: Point[];
  color: RGB;
}

/**
 * How opaque a shape the eraser is over is drawn.
 *
 * Enough that it is plainly still there and still its own colour -- this says
 * "about to go", not "gone" -- and little enough that the dark map reads
 * through it from across the shape rather than only at the outlined edge.
 */
const ERASING_ALPHA = 90;
const SOLID_ALPHA = 255;

/**
 * How opaque a generator's block is drawn.
 *
 * Short of solid on purpose. It is not a wall -- pedestrians walk out of it and
 * across it, and a fill they disappeared behind would read as one more obstacle
 * on a map made of obstacles. Enough to be a block, little enough to be a floor.
 */
const GENERATOR_ALPHA = 150;

/** RGB plus the alpha this piece should be drawn at. */
function withAlpha(color: RGB, alpha: number): [number, number, number, number] {
  return [color[0], color[1], color[2], alpha];
}

export interface Ray {
  from: Point;
  to: Point;
}

/**
 * A generator as the scene draws it: the rounded block it occupies, and whether
 * it is the one the pointer has hold of.
 *
 * The polygon comes ready-made rather than being derived here from a centre and
 * a radius, so that what is drawn, what a click hits and what the tool previewed
 * are all the same call to generatorRoundedSquare.
 */
export interface GeneratorView {
  id: number;
  polygon: Point[];
  color: RGB;
  selected: boolean;
}

export interface Agent {
  position: Point;
  color: RGB;
  radius: number;
  personalSpace: number;
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
  generators: GeneratorView[];
  agents: Agent[];
  rays: Ray[];
  paths: Point[][];
  showPersonalSpace: boolean;
  /**
   * What the eraser is hovering, drawn faded. Null whenever that is not the
   * tool in hand -- which is nearly always.
   */
  erasing: EraseTarget | null;
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
    const {
      worldRevision, agentRevision, walls, generators, agents,
      rays, paths, showPersonalSpace, erasing,
    } = state;
    const fadedWall = erasing?.kind === 'wall' ? erasing.id : -1;
    const fadedAgent = erasing?.kind === 'pedestrian' ? erasing.id : -1;
    const fadedGenerator = erasing?.kind === 'generator' ? erasing.id : -1;

    return [
      // Walls are flat 2D fills -- no shadow copy, no extrusion. A merged wall
      // owns several polygons, so it is flattened to one piece per polygon.
      new SolidPolygonLayer<WallPiece>({
        id: 'walls',
        data: walls.flatMap((w) => (
          w.polygons.map((polygon) => ({ wallId: w.id, polygon, color: w.color }))
        )),
        getPolygon: (piece) => piece.polygon,
        getFillColor: (piece) => withAlpha(
          piece.color, piece.wallId === fadedWall ? ERASING_ALPHA : SOLID_ALPHA,
        ),
        filled: true,
        // The hover is in the trigger as well as the revision: it changes what
        // the colours are without changing the map, and a trigger that only
        // watched the map would keep the buffers it built before the pointer
        // arrived.
        updateTriggers: {
          getPolygon: worldRevision,
          getFillColor: `${worldRevision}:${fadedWall}`,
        },
      }),

      // Over the walls and under the crowd, which is where it stands: a
      // generator is a thing on the floor that people come out of, and a
      // pedestrian half-out of one should be in front of it.
      //
      // Two layers because it is two marks. The fill is the block in the colour
      // of the goal it is pinned to -- white, and so plainly unwired, until it
      // is. The outline is the same white ring the pedestrians wear, and turns
      // the same thick yellow when it is selected, because being picked in order
      // to be sent somewhere is exactly what it shares with them.
      //
      // Both are drawn on the rounded shape rather than the bare footprint. On a
      // map whose every obstacle is a hard rectangle, taken corners are the one
      // difference readable at any zoom without a legend: it looks like an icon
      // sitting on the floor, which is what it is.
      new SolidPolygonLayer<GeneratorView>({
        id: 'generators',
        data: generators,
        getPolygon: (g) => g.polygon,
        getFillColor: (g) => withAlpha(
          g.color, g.id === fadedGenerator ? ERASING_ALPHA : GENERATOR_ALPHA,
        ),
        filled: true,
        updateTriggers: {
          getPolygon: worldRevision,
          getFillColor: `${worldRevision}:${fadedGenerator}`,
        },
      }),

      new PathLayer<GeneratorView>({
        id: 'generator-outlines',
        data: generators,
        // Closed by hand: a path is a line, and the ring wants its last point
        // joined back to its first.
        getPath: (g) => [...g.polygon, g.polygon[0]],
        getColor: (g) => (g.selected ? YELLOW : WHITE) as unknown as [number, number, number],
        widthUnits: 'pixels',
        getWidth: (g) => (g.selected ? 3 : 1),
        jointRounded: true,
        updateTriggers: {
          getPath: worldRevision,
          getColor: worldRevision,
          getWidth: worldRevision,
        },
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
        data: showPersonalSpace ? agents : [],
        getPosition: (a) => a.position,
        getRadius: (a) => a.radius + a.personalSpace,
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
        getFillColor: (a, { index }) => withAlpha(
          a.color, index === fadedAgent ? ERASING_ALPHA : SOLID_ALPHA,
        ),
        stroked: true,
        // Selected pedestrians wear a thicker yellow ring instead of the white
        // one, which is the original's selection colour.
        getLineColor: (a) => (a.selected ? YELLOW : WHITE) as unknown as [number, number, number],
        lineWidthUnits: 'pixels',
        getLineWidth: (a) => (a.selected ? 3 : 1),
        updateTriggers: {
          getPosition: agentRevision,
          getFillColor: `${agentRevision}:${fadedAgent}`,
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
