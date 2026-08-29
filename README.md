# Walky

A pedestrian simulator that runs entirely in the browser. Draw walls, mark a goal,
paint a crowd, and watch it find its way.

This is a rewrite of [pandermatt/walky](https://github.com/pandermatt/walky), a
2016 school project by **Pascal Andermatt** and **Jan Huber** — Java, Swing and
Maven, with Dijkstra over a visibility graph and OpenStreetMap building footprints
as the environment. The original needed a JDK and Maven to run, so essentially
nobody ever saw it. This version is a static page.

It is a revival, not a redesign. The look is the original's, taken from the source
rather than from memory.

## The look, and where it comes from

| Element | Rule | Original |
|---|---|---|
| Background | `#1E1E1E` | `Color.DARK_GRAY.darker().darker()` |
| Wall colour | one random channel ≥150, other two 0–255 | `RandomGenerator.randomBrightColor()` |
| Pedestrian | filled dot in its goal's colour, white ring | `PedestrianPanel.drawPedestrian()` |
| Arrived | black | `IntelligentPedestrian` |
| Convex hull | dashed, in the wall's colour | `PedestrianPanel.drawConvexHulls()` |
| Path to goal | orange | `drawFastestPath()` |
| Visibility rays | blue | `drawVisibleLines()` |

Two details worth stating, because they are easy to get wrong:

- The background is `#1E1E1E`, not `#1F1F1F`. Java's `Color.darker()` multiplies by
  0.7 and truncates, so `DARK_GRAY` goes 64 → 44 → 30. It is derived in code from
  that operation rather than hardcoded, so it cannot drift.
- `randomBrightColor()` forces *one* channel bright and lets the other two range
  freely, so the mean saturation is 0.615 — about 37% of walls land near-neon and
  24% land pastel. The palette is genuinely mixed; the `#C419C0`-type colours are
  the third of the distribution that sticks in memory.

All toolbar icons are the original PNGs, unmodified — none needed redrawing, since
they are 128–626px. The toolbar strip is light because the icons were drawn for
Swing's light toolbar; `border.png` is a black outline that would vanish on a dark
strip.

The original's 32×32 cursor PNGs are **not** used. A fixed-size cursor image can't
show the real dimensions of what a tool is about to place — it can't grow with the
pedestrian radius or the brush size, and it blurs at whatever scale the browser
picks. Instead every tool uses a standard CSS cursor and draws its shape on the
canvas under the pointer, at true size and scaling with zoom, the way the
pedestrian brush already previewed its block.

## What changed inside, and why

### Navigation: the same algorithm, inverted

The original rebuilt the entire visibility graph and ran Dijkstra **per pedestrian
per step** (`IntelligentPedestrian.generateFastestPath`). That is why it crawled.

The pipeline is unchanged in shape — draw a polygon, take its convex hull, expand
the hull by the pedestrian radius, build a visibility graph over those corners, run
Dijkstra — but it runs once per *goal* per map edit instead of once per agent per
frame, producing a distance-to-goal for every node that all agents share. Cost goes
from O(agents × graph) per step to O(goals × graph) per edit. Paths are the same.

Supporting changes:

- **Convex hull**: Andrew's monotone chain, O(n log n), with an exact integer
  orientation test. Replaces the original's QuickHull (adapted from a 2007 web
  posting), which is O(n²) worst case and mishandles collinear input.
- **Dijkstra**: a 4-ary heap over flat typed arrays with lazy deletion. Nodes are
  indices, not objects, so a run allocates nothing but its output.
- **Convex decomposition**: each wall is split into convex parts. One hull per wall
  fills in concavities, which made a goal inside a U-shaped wall *unreachable* —
  every one of its nodes was discarded for sitting inside the U's hull, and
  Dijkstra got zero sources. Decomposing keeps navigation built from convex hulls
  while leaving real cavities open. A rectangle stays 1 part, an L becomes 2, a U
  becomes 3.
- **The whole-wall hull** is still drawn, and still earns its keep as a broad phase:
  anything that misses it cannot touch any of that wall's parts.

### Crowd behaviour

`PedestrianBehaviour` is ported closely — the integer 8-direction lattice, the
speed counter where a diagonal costs √2, the cadence that walks a shallow angle as
a staircase, and the ×100 penalty that makes pedestrians avoid crowds bound
elsewhere. Neighbour lookup is a spatial hash rebuilt each tick by counting sort,
replacing the original's scan over every pedestrian.

Bugs found while porting, all with regression tests:

- **A float32 deadlock.** The step budget is clamped to exactly √2 and a diagonal
  costs exactly √2. Held in a `Float32Array` the clamp rounds *down* below the
  cost, so the moment a pedestrian banked enough straight steps to want a diagonal
  it could never afford one and froze with a full counter. Java used `double`; the
  step accounting is `Float64Array`.
- **A missing pecking order.** `Map.getColosionPedestrian` only counts a neighbour
  as blocking if you do *not* outrank it, ranked by remaining distance to goal.
  Without that filter every member of a dense crowd yields to every other and the
  block churns in place: 0px of progress versus 129px per 400 ticks.
- **A total crowd deadlock.** Requiring strict non-overlap meant that any crowd
  packed tighter than `2 × radius` had no legal move anywhere and locked solid
  permanently — reachable by raising the radius setting. The rule is now "no worse
  than now", which keeps the no-overlap guarantee whenever it already holds. A
  dense crowd at a narrow gap went from 0/196 arriving to 196/196.
- **Speed did nothing.** `stepTowards` clamped the budget to √2 on every call, so
  speed above ~1.41 was inert in the original too. The cap is now the speed itself.

### Quality-of-life additions

- **Copy map to clipboard** (in Settings). Puts the whole scenario — walls, goals,
  pedestrians, settings, camera — on the clipboard as JSON, with each pedestrian
  flagged `stuck` when it currently has no route, and a summary line. A stuck
  pedestrian depends on the exact geometry around it, so this makes a case
  reproducible instead of describable. Falls back to the console if the browser
  refuses clipboard access.
- **Rectangles can be dragged** as well as click-then-click-again.
- **Freehand walls can be traced** by dragging, as well as placed vertex by vertex.
  A traced stroke is simplified with Ramer-Douglas-Peucker before it is saved:
  sampling produces a point every few pixels, and every one would become a polygon
  vertex. Vertex count drives the whole navigation pipeline — the hull, the split
  into convex parts, and the O(n²) visibility sweep over the resulting corners —
  so a traced blob goes from 241 sampled points to 23 vertices, a 10× reduction,
  with the outline never straying more than about 2.5 screen pixels from what was
  drawn.
- **Lasso selection of pedestrians.** Drag around part of a crowd to select it
  (shift adds to the selection); a quick straight drag falls back to a rectangular
  marquee, since a fast drag reports too few points to form a lasso. Selected
  pedestrians wear a yellow ring. The mark-goal tool then applies to the selection
  alone, and with nothing selected it applies to everyone — which is what the
  original did via `hasSelectedElements`.
- **Enclosures.** The border tool draws a hollow rectangular frame you can trap a
  crowd inside — drag it out, or click two corners. It is the one tool that makes
  a shape with an *inside*; every other tool produces a filled polygon, so tracing
  a boundary with them gives a blob rather than a room. The frame is four bars
  that overlap at the corners, since bars meeting at a shared point can leave a
  diagonal gap to slip through, and it is committed as a single wall so it is one
  thing to select, colour and delete. Thickness is a setting; a frame too small to
  hold anyone is refused and previewed in red rather than silently made.
- **One-shot tools disarm themselves.** Assigning a goal clears the selection and
  steps off the tool, so the next click cannot reassign by accident. Escape does
  the same from anywhere.
- **The mark-goal tool draws a line from every pedestrian to the pointer**, in the
  colour of the wall underneath — a port of `drawMarkTargetLine`, which used
  yellow. Since pedestrians wear their goal's colour, it previews what the crowd
  is about to become.

### Overlapping walls are no longer merged

The original absorbed any wall a new shape overlapped into a single `Wall`. That
existed because it navigated by **one convex hull per wall**, so two overlapping
walls had to become one for the hull to cover their union. Convex decomposition
removed the requirement — separate overlapping walls are already handled as
independent obstacles — and merging then only did harm:

- It cascaded. Draw an enclosure, then anything touching it, and the two became
  one object; repeat and the whole map was a single wall with one colour and one
  identity, impossible to select or delete apart.
- It defeated the broad phase. A single map-sized wall shell never rejects
  anything, so every visibility test walked every convex part.

Shapes now keep their own identity, and the dashed outline is drawn once per
*connected group* of touching shapes instead of per wall — the same picture
merging gave, without fusing anything. Grouping is recomputed from the current
walls whenever the map changes, so unlike merging it can never accumulate.

### Deliberate divergences

- **No fake 3D.** The original's "shadow" was `draw3DEffect`, a perspective
  extrusion away from the viewport centre. Walls are flat 2D fills.
- **No OpenStreetMap import.** Out of scope for this version. The wall model is a
  plain list of polygons, so a converter can be added without touching the
  simulation.
- **Rays are opt-in.** The original drew visibility rays for every pedestrian,
  which is unusable past a few hundred.
- **Graph nodes sit 2 units outside the blocking hull.** On the boundary,
  point-in-polygon is a coin flip and half the surrounding lattice cells are
  illegal, so pedestrians could not stand on their own waypoint.

## Performance

Measured on an **Apple M3 Max, 36 GB, macOS 26.6.2, Node 24.19**, via
`npx vite-node bench/simulation.ts` — a crowd pathing through a gap between two
walls toward a goal, 120 timed ticks after a warm-up.

| Agents | p50 ms/tick | p95 ms/tick |
|---:|---:|---:|
| 1,000 | 7.05 | 7.44 |
| 2,000 | 15.04 | 16.03 |
| 5,000 | 38.37 | 40.01 |
| 10,000 | 69.54 | 72.18 |
| 50,000 | 299.07 | 310.98 |
| 100,000 | 586.51 | 601.61 |

**About 2,000 agents hold a 60fps budget** (16.7ms) and about 4,500 hold 30fps.
Beyond that it stays smooth to interact with but the crowd advances in slower
motion.

Two honest caveats:

- This is the **simulation only**. Rendering is measured separately; deck.gl's
  `ScatterplotLayer` is not the bottleneck at these counts — the agent step is.
- The simulation still runs on the main thread. Moving it into a Web Worker (with
  double-buffered transferable arrays, no `SharedArrayBuffer`, so no COOP/COEP
  headers are needed) is the next step and would stop it blocking the frame. The
  remaining hot spot is the legality check, which does several spatial-hash
  queries per agent per step.

## Running it

```bash
npm install
npm run dev
```

```bash
npm run build
```

`npm run build` emits a fully static `dist/` — no backend, no auth, no analytics,
no tracking. It deploys to Cloudflare Pages as-is; `_headers` sets caching and
basic security headers.

```bash
npm test
```

## Credits

Original Walky (2016): **Pascal Andermatt** and **Jan Huber** —
<https://github.com/pandermatt/walky>. The Dijkstra implementation there credits a
StackOverflow answer by Luke; the convex hull adapted code by Alexander Hristov;
the zoom and pan listener came from Sam Lazarus' BuffonsNeedle.
