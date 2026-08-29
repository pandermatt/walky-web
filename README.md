# Walky

A pedestrian simulator that runs entirely in the browser. Draw walls, mark a goal,
paint a crowd, and watch it find its way.

This is a rewrite of [pandermatt/walky](https://github.com/pandermatt/walky), a
2016 school project by **Pascal Andermatt** and **Jan Huber** — Java, Swing and
Maven, with Dijkstra over a visibility graph and OpenStreetMap building footprints
as the environment. The original needed a JDK and Maven to run, so essentially
nobody ever saw it. This version is a static page.

It is a revival, not a redesign. The look is the original's, taken from the source
rather than from memory, and so is the navigation and the lattice the crowd walks
on. The one place it knowingly departs is how a pedestrian picks its next step,
which the original wired to the preferred-space setting in a way that made the
setting counterproductive — see [Crowd behaviour](#crowd-behaviour).

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

The chrome's accent is derived from that table rather than picked next to it. A
tint has to be the app's own colour, and the app's own colour is the one the path
to a goal is drawn in — `ORANGE`, `#FFC800`. At full strength it is a fill: a
switch that is on, the lead-in behind a slider knob, the circle under the armed
tool. As *text* it is unreadable — 1.4:1 on white — so tinted text is that same
orange under `shadowOf`, which is `Color.darker()` applied twice: the operation
that already derives the background above and the shadow every wall casts. It
comes out `#7C6200` and measures 5.8:1 on white. The accent is therefore one
colour and its own shadow, not two colours that happen to sit near each other,
and both halves are computed in `ui/theme.ts` rather than written down.

The bright fills carry a hairline. WCAG asks 3:1 of a control whose meaning *is*
its colour, and `#FFC800` on a white cell is 1.4:1 — an outline is what makes a
bright fill legible without dimming it, and "is that switch on?" is not a
question to leave people answering wrong.

The typeface is **Google Sans Flex**, self-hosted. Every other value in this
section is committed to rather than borrowed — the background is derived, the
wall colours are the original's rule, the accent is the path colour in shadow —
and the type was the last thing still deferring to whatever the device happened
to have. `system-ui` meant Walky read as SF Pro on a Mac, Segoe on Windows and
Roboto on Android: three apps wearing one another's clothes, and none of them
Walky's.

One axis, weight, which is all a chrome of labels and a wordmark asks for; the
latin subset is 50KB against a 767KB bundle. The family also carries width,
optical-size, slant and rounded-terminal axes, pinned at their defaults by the
subsetter — `ROND` in particular would suit a chrome made entirely of capsules,
and costs 20KB if it is ever wanted. It is served from `public/`, so the
precache list picks it up alongside the icons and "offline in the strong sense"
stays true; a `<link>` to `fonts.googleapis.com` would have quietly made that a
lie, and there is no CSP to have caught it. The fallback stack is kept and the
unicode range declared, so before the file lands — or for a character outside
latin — the platform's own face answers instead.

Swapping it in is nearly invisible in practice, which is the one piece of luck
here: the toolbar carries icons and no labels, so the first paint has essentially
no text in it to reflow.

The debug overlay stays on the platform's monospace. It is a diagnostic readout
drawn to canvas, and it should look like one.

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
  becomes 3. The parts have a toggle of their own, **Convex parts**, off by
  default: they are a diagnostic for how a shape was split, and a traced shape
  wears one along every edge and a diagonal across every notch, which buries the
  hull that the hull toggle is named for.
- **The whole-wall hull** is still drawn, and still earns its keep as a broad phase:
  anything that misses it cannot touch any of that wall's parts — which holds only
  while the shell really contains them, so it is expanded by `hypot(2, 1)` radii
  rather than one: a needle part can have a far sharper corner than the hull does,
  and its miter-limited corner then reaches further out than the hull's.

### Crowd behaviour

The lattice is the original's: eight integer directions, a speed counter where a
diagonal costs √2, and a pecking order by remaining distance to the goal.
Neighbour lookup is a spatial hash rebuilt each tick by counting sort, replacing
the original's scan over every pedestrian. How a pedestrian *chooses* among those
eight directions is not the original's, and the rest of this section is why.

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
- **Personal space that pulled.** `totalToNearDistance` scored a cell as
  `Σ (preferred − distance)`, unclamped, over a query circle of radius
  `2 × radius + preferred`. The *gradient* of that is repulsive, so it reads as
  correct; the fault is at the rim. A neighbour crossing into the circle arrives
  contributing `preferred − reach`, which is `−2 × radius` — times 100 for anyone
  bound elsewhere. At the default radius and a preferred space of 90 that is
  **−2600 for one distant stranger entering range, against +64 for a same-goal
  pedestrian standing at body contact**. Cells were being scored on how many
  far-away strangers they could see, and a crowd drifted toward the fringe of the
  largest group headed somewhere else. Only an intrusion counts now.

#### Beyond the port: why the step rule was replaced

The reported complaint was that raising **Personal space** (then called Preferred
space) made pedestrians
shove each other rather than give each other room. It did, and no amount of
tuning would have fixed it, because the setting was wired to the wrong thing.

`stepTowards` asked one question — *is anyone inside my preferred space?* — and on
a yes it stopped navigating outright and moved solely to relieve the crush. The
reach of that question **is** the preferred space, so at 90 it was a 116px trigger
radius: in any crowd it was always on. A crowd that has stopped walking anywhere
and is only pushing away from itself is precisely what shoving looks like, and
turning the dial up put more of the crowd into that state.

It was never bodies interpenetrating. `isLegal` returns early when a candidate
cell is clear, so its "no worse than now" branch is only reachable from an
already-overlapping state and cannot create an overlap — which the suite asserts
over 600 ticks. The shoving was **movement selection**: in that branch `dx` and
`dy` were each forced to ±1 (the probe sampled `+1` and inferred `−1` without
testing it) and the diagonal cadence was bypassed, so every crowded pedestrian
took a diagonal step every single tick, in a direction read off a one-sided probe
of a discontinuous field.

A pedestrian now scores all nine things it could do — the eight neighbouring cells
and **standing still** — and takes the cheapest. Progress and comfort are always
weighed against each other, so a crowded pedestrian slows, sidesteps or waits, but
never stops heading for its goal. The terms, and what each is for:

- **Progress, per unit of step budget.** Rate rather than distance is what walks a
  shallow approach angle as a staircase: toward a 45° target a diagonal gains √2
  for √2 spent and wins, toward a shallow one it gains barely more than an axis
  step for half again the cost and loses. The original bought that shape with an
  explicit cadence counter, which has retired — it falls out of the geometry.
- **Discomfort, decaying exponentially.** Under the original's linear falloff a
  dozen distant neighbours outvote the one person you are about to walk into.
- **Anisotropy.** A neighbour behind you counts a fifth of one ahead (Helbing and
  Johansson's λ, fitted to video of real crowds). Without it, pressure from behind
  scatters the front rank sideways — the other half of the shoving.
- **Anticipation.** Every neighbour is judged one lookahead along its own heading,
  so converging paths resolve before they touch instead of after.
- **A turn penalty**, priced above a whole step of progress. It is what separates
  walking from shimmering: reversals fell from 13.8% of all moves to 0.7%.
- **A passing side.** Given the choice, step the way everyone else steps.
- **The cost of standing still**, which starts low and grows. Queuing at a
  bottleneck rather than barging, with a guarantee that a jam still drains:
  patience runs out, and a pedestrian who has waited long enough accepts a squeeze
  it first refused.

Two further departures, both aimed squarely at the same complaint:

- **Personal space compresses with density** — the fundamental diagram. Rather
  than eighty pedestrians all trying to hold 80px apart in a corridor that cannot
  give it and settling the shortfall by shoving, the asking price comes down: an
  isolated pedestrian keeps 78px of it, a packed one 45px, and it goes back up
  when the crush lifts. Turn on **Space rings** and they can be watched
  tightening. Density is judged in a window fixed to the body radius, deliberately
  not the interaction reach — the reach grows with the setting, so counting inside
  it finds more neighbours exactly when the setting is raised, compressing as hard
  as the setting had loosened and leaving the dial doing nothing.
- **Pedestrians differ.** How much room one wants and how briskly it walks vary a
  little. A crowd that agrees on both locks into ranks and nobody ever has reason
  to overtake. The trait is derived from where a pedestrian was placed rather than
  stored, so it survives undo and Reset without the snapshot carrying it.
- **A crowd presses.** Density on its own is circular — a crowd holds the spacing
  it wants, so the density that would compress that spacing never arises, and a
  queue backed up by a hundred people stood as politely as a queue of three: 125
  of 143 simply waiting, holding 40px gaps. What it misses is that being leaned on
  is not being near. The people behind you want to be where you are standing and
  cannot get there, and that is a load whether or not they have closed the
  distance. So a held-up pedestrian aimed at you leans on you, and passes on what
  is leaning on it as well as its own weight — the load builds along a queue and
  peaks at the front, against the barrier, which is why a crush is dangerous at
  the front and unremarkable at the back. It lowers what a pedestrian asks for; it
  never moves anybody, and **bodies still never overlap**.
- **Some of them press harder.** Assertiveness points *outward*, at what a
  pedestrian is to everybody else: it commands more of the crowd's regard, leans
  harder on whoever is in front, and finds standing still dearer. Letting it point
  inward as well — some of them minding the crowd less, or keeping a smaller
  bubble — reads like the same idea and behaves like the opposite one. It varies
  the geometry the crowd packs into, and a narrow bottleneck then arches over and
  *stays* arched: even a five percent spread took a 64-strong crowd from all
  through to as few as two.

Two things pressure must not do, both found the hard way. It must combine with
density by taking whichever asks for less, never by multiplying — the product runs
to nothing in a few ticks, the crowd packs to body contact where "no worse than
now" has no move to offer anyone, and a bottleneck arches permanently: 64 through
became 12 through and then nothing for eighteen hundred further ticks. And a crush
must only close up the space kept from people going the *same* way. Tolerating an
oncoming stream at close range is not a queue, it is a collision, and it quietly
dismantles lane formation.

**×100 became ×2.5.** With an exponential falloff and a passing side already
separating counterflow, the original multiplier was no longer doing that work,
only distorting it — it made two streams mutually repulsive without ever settling
who went which way, so they held each other up.

Counterflow deserves a caveat rather than a number, and it is the honest weak spot
of the model. Two streams through one corridor is by far the least reproducible
thing it does: shifting where the crowds are placed by a single pixel — a change
nobody could describe — swings how many get through from 12 of 112 to 102. The
streams reliably separate, and they reliably do better than the ported rule's 2 of
112, but any single figure for throughput is measuring the layout rather than the
model. The test runs three layouts and asserts only what survives all of them.

Measured on a corridor of 80 pedestrians, sweeping personal space from 0 to 80:

| | ported | now |
|---|---:|---:|
| arrive at personal space 80 | 50/80 | 80/80 |
| mean nearest-neighbour gap, 0 → 80 | flat | 34.6px → 52.2px |
| area the crowd spreads over | 24.8× | 3.1× |
| steps that reverse the one before | 13.8% | 0.7% |

None of this is free, and it is not a speed-up either. Nine candidates cost more
to score than three; what pays for them is structure — one hash query per step
instead of about seven, a legality check that walks a short list of touchable
bodies rather than re-querying, and a neighbourhood summarised once into a
discomfort *gradient* that each candidate meets with a single dot product. Every
candidate sits within √2px, so that first-order term is the whole story to a
fraction of a pixel. Interleaved against the ported rule on one machine to cancel
drift, at 2,000 agents: p50 within a few percent, p95 about 8% higher.

`src/__tests__/crowd.test.ts` covers the table above. The older
`behaviour.test.ts` asserts the invariants — nobody overlaps, nobody enters a
wall, everybody arrives — and every one of them stayed green throughout the
behaviour it describes, which is why the second file exists.

### Quality-of-life additions

- **Copy link to this map** (in Settings). The whole scenario — walls, goals,
  the crowd with its origins and colours, the camera and the settings — packed
  into the URL itself, so a map can be handed to someone by pasting a link.
  There is no backend to upload it to and no account to save it under: the map
  travels inside the fragment, which is never sent to a server, so nothing about
  it leaves the device it was drawn on.

  Getting a map into a URL takes some squeezing. As JSON a six-wall map with a
  hundred and fifty pedestrians is about 37 kB; the same map comes to 817 bytes
  as packed bytes, and 231 characters of link. Three things do that. Varints,
  because nearly every number in a map is small and JSON spends a byte a digit on
  all of them. Deltas, because one running cursor walks every wall vertex and
  another walks the crowd, so a map drawn far from the origin costs no more than
  one drawn on it, and a brushed block of pedestrians is a lattice of tiny steps.
  And no floats at all: every wall vertex and pedestrian position in Walky is
  already a whole number, so storing them as integers is exact rather than merely
  close — and NaN and Infinity become unrepresentable, which removes a whole
  class of bad input rather than validating it. `deflate-raw`, which the browser
  already has, then takes about another 30% off a real crowd. There is nothing to
  install for any of it.

  A pasted link is untrusted input, so the decoder refuses rather than guesses:
  a wrong header, a version it does not know, a count larger than the app could
  hold, deltas walking off the map, a body that unpacks to more than a megabyte,
  or a single byte left over at the end. Truncation is the common case — chat
  apps cut long links — and every truncation of a real payload is an error rather
  than half a map. The note under the button reports the length and warns past
  2000 characters, where third-party link handling stops being reliable; past
  32000 it declines to make a link at all and points at the JSON instead, because
  handing over a link that silently fails to open is worse than saying so.

  A shared link is read once, at startup, and then taken out of the address bar.
  A hash that survived the first edit would be a URL claiming to be a map it is
  no longer, and the reload it invites would throw those edits away without
  asking. So the URL is touched exactly once, to consume something, and never to
  publish.
- **Copy map to clipboard** (in Settings). The same scenario as JSON, with each
  pedestrian flagged `stuck` when it currently has no route, and a summary line.
  The link reopens a map; this one describes it, which is what a bug report
  wants. A stuck pedestrian depends on the exact geometry around it, so this
  makes a case reproducible instead of describable. Falls back to the console if
  the browser refuses clipboard access.
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
  personal space; running the simulation brings up speed and personal space,
  since the room agents keep from each other is as much a live dial as the clock
  they run on. Both live in the full
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
- **Record.** The button was in the 2016 toolbar and it is the same button here,
  meaning the same thing. Behind it, though, was a window: pick a resolution from
  a combo box, pick a folder, press Start — and `PedestrianPanel` then wrote
  `frame0.jpg`, `frame1.jpg` and on, one image per map change, forever, with no
  frame rate anywhere in it. They were PNGs despite the extension. The dialog
  carried three warnings in red admitting most of this: that the zoom you had
  chosen was ignored, and that what you got was an image sequence and not a movie
  file. Neither is true now. One tap records what is on screen, at the size and
  zoom you are looking at; a second tap stops, and offers a single video file to
  save. It starts the crowd walking, because a video of a map standing still is
  not what anybody presses Record for, and it stops itself once every pedestrian
  bound for a goal has reached one — a simulation is a thing that finishes, and a
  recording that sits on the finished picture until somebody notices is not what
  anyone would keep. It holds a second and a half on the end first, so the video
  finishes after the last plop rather than on it. Pedestrians with no goal are not
  waited for; they were never going anywhere.

  The picture is composited rather than captured. Walky paints on two canvases —
  deck.gl's for the walls and the crowd, a 2D one over it for the dashed hulls and
  the rubber band — and neither of them paints the ground, which is a CSS
  background. So a third canvas offscreen is filled with `#1E1E1E`, has the two
  drawn onto it, and is what the video is made of. It is repainted on every frame
  even when nothing has moved, because a canvas only hands the recorder a frame
  when it has been painted since the last one, and a still map would otherwise
  become one frame of enormous duration rather than a video. The frames are pushed
  from the render loop rather than pulled by a loop of the recorder's own, since
  the redraw there is synchronous and that is the one moment both canvases are
  certainly showing the frame just built.

  The plops are in it. `audio/plops.ts` hands over a stream of its own, built on
  the first recording rather than up front — a destination node keeps the audio
  context awake whether or not anything is reading it, and most sessions never
  record — and its track joins the picture's in one file. With the sound setting
  off the recording is video only, rather than a track of silence: that is a meter
  that never moves and bitrate spent on nothing.

  Two things are deliberately not in it. **The chrome**: the bar, the panels and
  the chips are DOM and the settings sheet is a `<dialog>` in the top layer, so
  none of them can appear in a canvas capture — the recording is the map and only
  the map, which is exactly what `PedestrianPanel` drew. **Anything past two
  minutes**: a recorder holds its bytes in memory, and an unattended recording is a
  tab that eventually falls over, so it stops itself and says so. It also stops if
  the tab goes to the background, where the browser hands out no animation frames
  and iOS may take the recorder away outright, and it refuses to start there at
  all — the visibility handler catches going away, not being away already.
- **The debug readout reports the frame rate.** `drawInformationString` had no
  such line, because Swing repainted on a timer and the number would have been the
  timer's. Here it is measured where a frame is actually painted, over the last
  second, so it is the loop's rate while the crowd walks and whatever the repaints
  came to while it is paused. Turn it on with **Debug info** in Settings.

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

Every shape is in a group, including a shape touching nothing, so every shape has
an outline; a freehand trace shapes the hull of whatever it touches like any other
member. None of this is what navigation runs on — obstacles come from the convex
*decomposition* of each polygon, and the whole-wall hull is only the broad-phase
reject in front of the parts.

### Deliberate divergences

- **No fake 3D.** The original's "shadow" was `draw3DEffect`, a perspective
  extrusion away from the viewport centre. Walls are flat 2D fills.
- **No OpenStreetMap import, and no trees.** The import is out of scope for this
  version, and trees came with it: in the original they only ever arrived as
  `natural=tree` nodes, never drawn by hand. Without the import they were a tool
  with no button on the toolbar, placing decorations that nothing could walk into
  — the navigation graph is built from walls alone, so a tree was never an
  obstacle, only a picture. They are gone. The wall model is still a plain list of
  polygons, so a converter can be added without touching the simulation.
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
across the whole map. In that one case the strip moves: the same glass capsules
become a row floating over the bottom of it, in the shape and for the reason iOS
puts navigation there. The pattern, the glass recipe included, is lifted from the
tab bar in [pandermatt/bern-hackt-2026](https://github.com/pandermatt/bern-hackt-2026).

What moves is the *placement*, and only that. The capsules, the cells and the
tint under the armed tool are the same object on a laptop as on a phone. They
used not to be — the strip was a grey Swing box in a browser and glass when
installed, which was two toolbars to keep in step and was never a decision
anybody made; the phone one came later and the first was simply left where it
was. The one thing that still follows the device is the tap target, 40px for a
pointer and 44px for a thumb, because that is a fact about the hand and not about
the look.

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

The armed tool wears a tinted circle, and a press dims the cell rather than
filling it: iOS acknowledges a touch by dimming, and these icons are artwork that
cannot be tinted, so the cell does it on their behalf. It used to be an outlined
blue box in a browser and a tinted circle when installed; it is the circle in
both now, in Walky's orange rather than the system blue it was borrowed at.

One capsule per group, and the groups are the three separators ToolboxPanel
already had: run, tools, view. They wrap, so the layout follows the screen
instead of being told about it — portrait puts the seven tools on their own row
nearest the thumb with the six others above, landscape fits all three side by
side, and no breakpoint decides it. The bar's height *is* measured, and
published as a custom property, because the panels and the update chip have to
clear whatever it came out to. Between the capsules the bar is not there at all:
only they take a tap, or the map would go dead across a band it is still visible
through.

One deliberate difference from the bar this borrows from: the cells carry icons
and no labels. Walky's toolbar has never had words in it, and the original 2016
icons are the vocabulary the desktop strip already teaches.

### And settings is one sheet

Settings is a modal: a large **Settings** hard against the left edge with a
tinted **Done** opposite it, then grey groups on white, separators that start at
the text rather than the block's edge, switches instead of checkboxes, and
sliders with a knob big enough to catch.

Three deliberate departures from the iOS grouped list it started as. The title
is large and left-aligned rather than 17px and centred in a 44px bar — that bar
is what iOS does to a title when it has a navigation stack to fit around it, and
this sheet has no stack, so it was borrowed furniture; a large left-aligned
title reads as the name of the place you are in rather than as a label above it.
The grouping is inverted: white cells on a grey ground make the *ground* the
subject and the cells float on it, whereas grey blocks on white make the groups
the subject and the sheet merely the paper they are printed on, which is what it
is. And the corner is 20px rather than 10, because at that radius a block stops
reading as a rectangle with its corners taken off and starts reading as one
shape.

The groups sit 12px apart rather than 35. The old gap had to carry the
separation by itself — two white cards on grey are told apart by the space
between them — while two grey blocks on white are told apart by being grey.

It is flat, and that is a decision rather than an absence. No shadow under the
sheet, since the backdrop is already dimming everything behind it and a drop
shadow would be depth drawn twice; no rule under the title and no blur behind
it, since the head and the body are the same white ground; and the knob on a
switch or a slider carries just enough shadow to read as a knob. The colours are
Walky's; see the accent above.

The shape follows the device, and nothing else does: a centred card where there
is room around it, the screen itself where there is not. There used to be two
surfaces here — a 232px card floating in a corner of a browser, and a full-screen
page when installed — and neither of them was a modal, which is why two things
could be open at once and why closing it was never quite reliable.

It is a `<dialog>` opened with `showModal()`, and that one call is doing most of
the work. The dimmed backdrop, the focus trap, Escape, and everything behind it
going inert all come with it, so "never two open at once" stops being something
the app tries to arrange and becomes something it cannot violate: while the sheet
is up the toolbar is untappable, which is also what retires the race described
below. The top layer means it is no longer in the panel column at all, so there
is no longer a `z-index` to lose.

It arrives and leaves as a sheet does, sliding from the bottom when installed and
settling into place in a browser, on iOS's own curve. Arriving is
`@starting-style` and a `display` transition under `allow-discrete`. Leaving
needed more care: a dialog drops out of the top layer the instant `close()` runs,
which cuts the exit dead, and the `overlay` property that would hold it there is
Chromium's alone. So the sheet is never closed while it is still moving — it
animates out under its own `[open]` attribute and closes at the end of that. Same
exit on every engine, and installed iOS, the shape where the slide-out actually
reads, keeps it. `prefers-reduced-motion` turns the whole thing off outright.

Opening it also pushes a history entry, installed: there is no browser chrome and
no back button, and the edge-swipe gesture is the way out people reach for. It
needs an entry to pop. Done pops the same one, so leaving by either route costs
the same and the history does not grow a step per visit. The URL never changes —
there is one page here, and going back from settings lands where you already are.

A shared map is the one thing that ever writes to it, and it writes once: the
fragment is read at startup and immediately replaced away, before the sheet can
push anything of its own. `replaceState` fires no `popstate`, so the token below
never hears about it.

What that entry is tracked *by* changed, though. `history.back()` is a request the
browser answers later, and a flag saying "we pushed one" could not tell our own
answer from the user's gesture: re-opening before the answer arrived hid the
sheet that had just opened and left an entry orphaned on the stack, and the next
back gesture then walked out of the app. The entry carries a token now, and a
`popstate` is read for which entry it landed on rather than merely counted — so
the question "is our entry still the current one" has an answer instead of a
guess.

The name is at the foot of it, where iOS puts one. Walky has more reason than
most to say what you are looking at: it is a rewrite, and the people whose
project this was belong on the last line of it. The version comes from
`package.json` through Vite's `define`, so the number on screen cannot drift from
the one that shipped.

The contextual panel stays a panel, and deliberately not a modal. It is an
inspector on the thing already in your hand: it has no way out of its own because
leaving it is picking up a different tool, and taking the map away would be
exactly the leaving it exists to avoid. It needs no coordination with the sheet
either — `showModal()` inerts the whole document outside the sheet, so while
settings is up the panel is untabbable and untouchable without containing a
single line that knows sheets exist.

Where it *sits* follows the device, though, for the same reason the strip does.
In a browser it is the corner beside the toolbar. Installed on a phone the
toolbar is a bar across the bottom, and a panel holding the settings that belong
to the button you have just pressed is no use at the far end of the screen from
the hand that pressed it — that reach is exactly what moving the bar was for, and
leaving the panel behind would have put a tool at one end of the phone and its
controls at the other. So it moves with it and sits directly above the capsules,
centred on them. As with the strip, what moves is the placement and only that:
the same 232px capsule with the same sliders in it.

The update chip keeps its corner and stacks above whichever of the two is there,
which is why the panel column now publishes a measured height alongside the
bar's. Neither is a number that can be written down — the bar's depends on how
its capsules wrapped and the panel's on how many sliders the tool in hand asks
for — and with no panel showing the column is not there at all, so the chip sits
where it always did.

### One button, four places

Every button in the app is one of four roles — an icon cell in a bar, a tinted
text button, the heavier one a title bar carries, and a row across a grouped card
— and all four are defined once, in `ui/theme.ts`, on top of a set of custom
properties.

They were not. Three stylesheets defined eight button looks between them, and two
of those looks were the same idea transcribed three times each: the Swing-grey
cell with padding that had drifted to `5px`, `7px 10px` and `5px 10px`, and the
tinted text button whose metrics had drifted the same way. The press dimmed to
`.4` in the toolbar and `.3` in the other three places. None of that was a
decision; it was four transcriptions of one, and the drift is what transcription
does.

The stylesheets are plain strings, which means the things that would otherwise
only be visible in a browser are checkable without one:
`src/__tests__/theme.test.ts` asserts that the retired colours have not crept
back, that every `var(--wk-…)` in any of them resolves to a property that is
actually declared — a misspelt custom property fails silently in CSS — and that
every `:active` opacity comes from the one token.

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
  headers are needed) is the next step and would stop it blocking the frame.
- The table predates the scored step rule described under **Crowd behaviour**,
  and was measured on hardware not to hand since. Rather than restate it from a
  slower machine, the two rules were run interleaved on one box to cancel drift:
  at 2,000 agents the new rule lands within a few percent of the old on p50 and
  about 8% above it on p95, so the guidance above still holds. The legality check
  used to be the remaining hot spot and is no longer — a step makes one
  spatial-hash query where it used to make about seven.

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

## The share image

The Open Graph image at `public/images/og.png` is a real simulation frame, not a
mock-up. `tools/ogImage.ts` builds a scenario with the same model helpers the app
uses, steps it with the same `Agents.step`, and draws it from the same state the
renderer reads — `nav.shells`, `nav.obstacles`, `nav.pathFromNode`,
`agents.x/y/color`. The walls are colours the palette rule allows, the black
pedestrians are black because they arrived, and the routes are whatever Dijkstra
returned. It takes the paused branch of `goalPaths`, because a still is a paused
frame.

```bash
npx vite-node tools/ogImage.ts
```

It writes the PNG through `rsvg-convert` and is deliberately not part of
`npm run build`: the image is committed, so regenerating it is a decision, and a
diff on the PNG means the render changed. That only holds because the frame is
reproducible — the wall colours are named constants rather than
`randomBrightColor()` draws, and `Math.random` is seeded in the script, since
`Behaviour` leans on it for tie-breaks.

Two things in the image differ from what the app draws, both because a link
preview is looked at small rather than panned around: strokes are 1.6× wider, and
22 routes are drawn rather than the app's cap of 1500. Colours, geometry and the
9-on-9-off dash rhythm are untouched.

The starting crowd is jittered off its lattice. A block placed on an exact grid
and walked unobstructed keeps that grid exactly, so the tail of the queue reaches
the bottleneck in machine-straight rows and the picture reads as a rendering
artefact rather than as a crowd.

`tools/` and `bench/` are type-checked with `src` rather than left out of it. The
image script broke silently once when `makeWall` grew an options argument — it
kept running and quietly rendered every wall in a random colour, because nothing
was checking it.

## Credits

Google Sans Flex by **David Berlow**, under the SIL Open Font License 1.1 —
the licence travels with the font at `public/fonts/OFL.txt`, which is what the
OFL asks of anyone redistributing it, a self-hosted web font included. No
Reserved Font Name is declared, so the subset served here keeps the family's
own name.

Original Walky (2016): **Pascal Andermatt** and **Jan Huber** —
<https://github.com/pandermatt/walky>. The Dijkstra implementation there credits a
StackOverflow answer by Luke; the convex hull adapted code by Alexander Hristov;
the zoom and pan listener came from Sam Lazarus' BuffonsNeedle.
