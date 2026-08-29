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
  anything that misses it cannot touch any of that wall's parts. Freehand walls opt
  out of it entirely — see below.

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
- **Contextual panels.** Selecting the pedestrian tool brings up brush size and
  preferred space; running the simulation brings up speed. Both live in the full
  settings panel too, but these are the cases where you change a value and want to
  see the effect immediately, without leaving the tool you are holding. Picking any
  tool closes the settings panel, which otherwise sits over the canvas you are
  about to draw on, and the settings button shows a pressed state while it is open.
- **Two fingers pinch to zoom**, and carry the map with them as they go: a pinch
  that only scaled would feel as if the map had come loose from the fingers. The
  wheel keeps `ZoomMouseListener`'s stops, 1.1× a notch; fingers have no detents,
  so a pinch lands between them and the zoom level simply stops being a whole
  number. The second finger also takes back whatever the first one started —
  which is why, on a touchscreen only, a tool is told about a press when the
  finger moves or lifts rather than when it lands. A tool that has already
  dropped a pedestrian or reassigned every goal cannot be talked out of it by a
  `cancel()` afterwards, and the second finger of a pinch always arrives after
  the first.
- **One-shot tools disarm themselves.** Assigning a goal clears the selection and
  steps off the tool, so the next click cannot reassign by accident. Escape does
  the same from anywhere.
- **The mark-goal tool draws a line from every pedestrian to the pointer**, in the
  colour of the wall underneath — a port of `drawMarkTargetLine`, which used
  yellow. Since pedestrians wear their goal's colour, it previews what the crowd
  is about to become.
- **The route is drawn as soon as the goal is marked**, not once the simulation
  runs. The orange path overlay reads each pedestrian's current waypoint, and a
  pedestrian only gets one on its first step, so the map stayed bare until play
  was pressed — exactly when the question "where will they go?" is still open.
  Paused, the first waypoint is now chosen the same way the first step would
  choose it and the rest of the route read off the same Dijkstra predecessors, so
  the line drawn before play is the line walked after it. It is one graph scan per
  pedestrian, so the result is cached until the map, the crowd or the goal
  changes, and a running crowd still reads its waypoints as before.
- **Arrivals plop.** Every pedestrian that reaches its goal makes a short water-drop
  sound, panned to where it landed on screen. It is synthesised — a sine whose pitch
  falls by two thirds in a tenth of a second — so there is no asset to load and no
  decode. The interesting part is a crowd: a thousand pedestrians crossing the line
  together would be a thousand voices stacked into one clipped thud, so a batch is
  capped at four, each spread 35ms from the last and scaled by 1/√n, and a steady
  stream is allowed to queue no more than a quarter second ahead before plops are
  dropped rather than delayed. The result is popcorn instead of noise. The audio
  context is started from the Start click, since a context created anywhere but a
  user gesture begins suspended and plays nothing. Toggle it off in Settings.

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

### Freehand walls are not hulled

A convex hull is a summary, and it only reads as one when the shape it summarises
is roughly convex already: a rectangle, a frame, a blocky building. A freehand
trace is the opposite — an S, a spiral, a room drawn by hand — and its hull is a
blob with no resemblance to what was drawn. Worse, the dashed outline is drawn per
*connected group*, so one traced squiggle laid against a building stretched that
building's outline over both.

So the wall tool's shapes are left out of the convex hull calculation: they get no
hull of their own, and they contribute no points to the hull of the group they are
in. They still *group* — a traced shape laid across two buildings still puts both
under one outline, and that outline now wraps the two buildings rather than the
squiggle. Every other tool still hulls, because everything else makes a shape a
hull describes.

Nothing about navigation changes. Obstacles come from the convex *decomposition*
of each polygon, never from the whole-wall hull, so a traced shape blocks and is
walked around exactly as before; all that is given up is the broad-phase early
reject for that one wall, and the per-part test that replaces it gives the same
answer.

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

## Installable, and offline in the strong sense

Walky has no backend, no fonts from a CDN, no analytics and no third-party
anything, so "works offline" is a fact that can be arranged rather than a
degraded mode that has to be designed: every byte the page can ask for is in
`dist/`. A service worker precaches all of it on install and then serves
cache-first, so after the first visit the network is not consulted at all —
whether or not there is one.

The precache list is generated at build time by `build/pwa.ts` rather than
written by hand. Rollup's filenames carry a content hash, so a hand-kept list is
stale after the first edit, and a list that is one file short is a missing
toolbar icon on the plane. The plugin takes the emitted bundle plus everything
copied from `public/`, drops the worker itself, and substitutes both the list and
a hash of its contents into `src/sw.ts`. That hash names the cache, so a new
build lands in a new cache and the previous one is deleted on activation.

Updating is offered, never imposed. The map you have drawn lives in memory and
nowhere else, so a worker that reloaded the page to apply an update would throw
away the crowd you were watching. The new worker takes over for the *next* load
and the page shows a "new version is ready" chip with a Reload button; a first
install shows "ready to run offline" instead, and that one retires itself after
a few seconds. The worker is a production concern only — `npm run dev` registers
nothing, and unregisters anything a previous production visit left behind on the
same origin, which would otherwise serve yesterday's app over the file you just
edited.

Two things the manifest does not cover:

- **iOS reads almost none of it.** The home-screen icon, the app name and
  standalone display each need their own tag in `index.html`.
- **The status bar is not somewhere to draw.** `viewport-fit=cover`, and
  equally the translucent status-bar style, put the page *underneath* iOS's
  status bar — which then frosts whatever sits below it, and the top of the map
  wears a blurred band belonging to nothing. Left alone iOS insets the web view
  instead and the top of the map is the top of the map. The
  `env(safe-area-inset-*)` offsets stay in the layout anyway, where they resolve
  to 0, so nothing lands under a notch if cover is ever turned on.

The app icons are derived from `images/icon.png` — the original's own pedestrian
glyph — painted white on `#1E1E1E`, since a black glyph on transparency
disappears against a dark home screen. The maskable variant keeps the figure
inside the inner 80% so that a circular crop cannot take its head off.

### Installed on a phone, the toolbar moves to the thumb

Installed there is no browser chrome, which makes the top-left corner the far
end of the screen from the hand holding the phone — every tool switch a reach
across the whole map. In that one case the strip becomes a row of glass capsules
floating over the bottom of it, in the shape and for the reason iOS puts
navigation there. The pattern, the glass recipe included, is lifted from the tab
bar in [pandermatt/bern-hackt-2026](https://github.com/pandermatt/bern-hackt-2026).

The condition is `pointer: coarse` and not a width breakpoint, because this is a
fact about the hand rather than the viewport: a phone in landscape is 844px wide
and still a phone. An installed desktop window keeps the strip, which is where a
pointer wants it. Whether the app is installed is decided once, before anything
draws, and written to `<html>` as `data-standalone`; every rule that cares reads
that, so "the installed app" is defined in one place.

The glass is `blur(20px) saturate(180%)` over a 72%-opaque pane. The saturation
is the half that does the work — blur alone gives frosted plastic, greyed and
flat, and pushing the colour back up is what makes a wall passing underneath
bloom through. Where `backdrop-filter` is unsupported the capsule goes fully
opaque instead, since without the filter that pane is a 72%-opaque sheet with
the map legible through it.

The armed tool wears a tinted circle rather than the desktop strip's outlined
blue box, and a tap dims the cell rather than filling it: iOS acknowledges a
touch by dimming, and these icons are artwork that cannot be tinted, so the cell
does it on their behalf.

One capsule per group, and the groups are the three separators ToolboxPanel
already had: run, tools, view. They wrap, so the layout follows the screen
instead of being told about it — portrait puts the seven tools on their own row
nearest the thumb with the six others above, landscape fits all three side by
side, and no breakpoint decides it. The bar's height *is* measured, and
published as a custom property, because the panels and the update chip have to
clear whatever it came out to. Between the capsules the bar is not there at all:
only they take a tap, or the map would go dead across a band it is still visible
through.

Two deliberate differences from the bar this borrows from. The cells carry icons
and no labels — Walky's toolbar has never had words in it, and the original 2016
icons are the vocabulary the desktop strip already teaches. And the panels
scroll: settings and a contextual panel open together are taller than a phone,
which is the same problem the toolbar's own `max-height` was already solving one
panel over.

### And settings becomes a page

A 232px card floating in a corner is a desktop shape. On a phone it covers most
of the map anyway, so installed it stops pretending and becomes the screen, in
the shape iOS gives a settings screen: a title bar with the title centred and a
tinted **Done** on the right, groups of white cells on `#F2F2F7`, separators
that start at the text rather than the card's edge, switches instead of
checkboxes, and sliders with a blue lead-in and a knob big enough to catch. The
sizes and colours are the real ones — 51×31 for a switch, `#007AFF` and
`#34C759`, 10px corners, 35px between groups — because the shape is only
convincing at the values it actually uses.

It is the same markup either way. Each run of controls is a section, the rule
that used to divide them rides along inside it, and as a page the section
becomes the card and the rules go away, since the card's edges already say what
the line was saying. The controls themselves are matched on the panel rather
than the page, so the contextual panel gets the same slider you just left; that
panel is the other thing floating over the map, so it is made of the same glass
as the bar. Only the settings screen opts out of the glass — it is a screen, not
something floating.

The light appearance and not the dark one, deliberately. The chrome over the map
has to be light because the toolbar icons are 2016 artwork drawn for a light
Swing toolbar, and a dark sheet arriving over a light bar would be the odd one
out.

It arrives and leaves as a sheet does, sliding from the bottom on iOS's own
curve. That is a `display` transition with `allow-discrete` and `@starting-style`
rather than a class and a timer, so a browser that does not know the at-rule
simply shows the page, which is what it did before; `prefers-reduced-motion`
turns it off outright.

Opening it also pushes a history entry, which is the part that makes it a page
rather than a sheet: installed there is no browser chrome and no back button,
and the edge-swipe gesture is the way out people reach for. It needs an entry to
pop. Done pops the same one, so leaving by either route costs the same and the
history does not grow a step per visit. The URL never changes — there is one
page here, and going back from settings lands where you already are.

The contextual panels stay panels. They exist so you can change a value without
leaving the tool in your hand, and a full screen is exactly the leaving they
were built to avoid.

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
basic security headers, and keeps `sw.js` revalidated so a new build can reach
anyone still holding the old one.

```bash
npm run preview
```

The service worker only exists in a build, so `npm run preview` is where to check
the offline behaviour: load the page once, then kill the network and reload.

```bash
npm test
```

## Credits

Original Walky (2016): **Pascal Andermatt** and **Jan Huber** —
<https://github.com/pandermatt/walky>. The Dijkstra implementation there credits a
StackOverflow answer by Luke; the convex hull adapted code by Alexander Hristov;
the zoom and pan listener came from Sam Lazarus' BuffonsNeedle.
