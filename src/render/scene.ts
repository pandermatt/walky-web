import { Deck, OrthographicView, type OrthographicViewState } from '@deck.gl/core';
import { SolidPolygonLayer, ScatterplotLayer, LineLayer, PathLayer, IconLayer } from '@deck.gl/layers';
import { BLUE, ORANGE, RED, WHITE, type RGB } from '../palette';

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

export interface Tree {
  position: Point;
  radius: number;
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
}

export interface SceneState {
  /**
   * deck.gl compares props shallowly, so mutating a wall in place -- or pushing
   * onto the same array -- leaves it convinced nothing happened and it keeps the
   * stale GPU buffers. These revisions drive updateTriggers so in-place edits show.
   *
   * They are split deliberately. Walls and trees change only when the map is
   * edited, while agents move every tick; sharing one counter re-tesselated every
   * wall polygon on every frame, which alone cost about 800ms a frame.
   */
  worldRevision: number;
  agentRevision: number;
  walls: Wall[];
  trees: Tree[];
  agents: Agent[];
  rays: Ray[];
  paths: Point[][];
  showPreferredRadius: boolean;
}

export class Scene {
  private deck: Deck<OrthographicView>;

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
    this.deck = new Deck({
      canvas,
      views: new OrthographicView({ id: 'ortho' }),
      initialViewState,
      controller: false,
      layers: [],
      onAfterRender,
    });
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
    const { worldRevision, agentRevision, walls, trees, agents, rays, paths, showPreferredRadius } = state;

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

      new IconLayer<Tree>({
        id: 'trees',
        data: trees,
        getPosition: (t) => t.position,
        getSize: (t) => t.radius * 2,
        sizeUnits: 'common',
        getIcon: () => ({ url: './images/tree.png', width: 256, height: 256, anchorX: 128, anchorY: 128 }),
        updateTriggers: { getPosition: worldRevision, getSize: worldRevision },
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
        getLineColor: WHITE as unknown as [number, number, number],
        lineWidthUnits: 'pixels',
        getLineWidth: 1,
        updateTriggers: { getPosition: agentRevision, getFillColor: agentRevision, getRadius: agentRevision },
      }),
    ];
  }

  finalize(): void {
    this.deck.finalize();
  }
}
