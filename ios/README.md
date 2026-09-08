# Walky for iOS

A native Swift port of the simulation in `../web/src/sim` and `../web/src/state`,
and
(from Phase 3) a SwiftUI + Metal app around it.

## Why this is a package and not just an app target

`WalkySim` has no UIKit, no Metal and no Foundation-UI, so it builds and its
conformance runner *runs* under plain SwiftPM. That matters: the risky part of
this port is the simulation, and this arrangement lets it be verified without
Xcode, a simulator or a device.

## Building the app

```bash
xcodegen generate                       # after changing project.yml or adding a file
xcodebuild build -project Walky.xcodeproj -scheme Walky -sdk iphonesimulator \
  -destination 'platform=iOS Simulator,name=iPhone 17 Pro'
```

This needs an iOS simulator **runtime** (Xcode ▸ Settings ▸ Components, ~8 GB).
Installing one requires an admin account, and the download hangs at "Preparing
to download…" with no error message behind iCloud Private Relay or on some
university networks — if it stalls, try another network before assuming Xcode is
broken.

Without a runtime the app can still be *compiled*; see the comment at the top of
`project.yml` for the flags that takes and why each is needed.

## The sticker pack

`Walky.app` embeds `WalkyStickers.appex`, an iMessage pack of eighteen stickers.
It has no code: its only build phase is Resources, the executable in the `.appex`
is a stub Xcode links for it, and everything it ships is one compiled asset
catalogue.

Nothing in `Stickers/` is edited by hand. `../web/tools/stickers.ts` writes the
whole `.xcstickers` — the PNGs, every `Contents.json`, and the twelve sizes of
the Messages drawer icon — and the output is committed. Regenerating is a
decision, the way regenerating the icons is:

```bash
cd ../web && npx vite-node tools/stickers.ts
```

The stickers themselves are characters, cut out of three drawn contact sheets in
`web/tools/sheets/`, and they are the one place the brand is not derived from the
model — the drawer icon over them still is. `web/README.md` has that argument in
full, and what is in the pack. Two things about the target are worth knowing
here:

- **Its Info.plist is generated like the app's**, from `info:` in `project.yml`.
  iOS refuses to install an app whose embedded extension carries a different
  `CFBundleShortVersionString`, and two plists written by the same generator
  agree on that by construction where two written by hand agree until somebody
  edits one.
- **`NSStickerSharingLevel` is a plist key here, not a build setting.**
  `INFOPLIST_KEY_NSStickerSharingLevel` is only read on the
  `GENERATE_INFOPLIST_FILE` path; set alongside a generated plist it is silently
  inert and the built `.appex` simply does not have the key — which costs
  nothing at build time and quietly stops a recipient without Walky from keeping
  a sticker, the only way a pack ever travels further than the app does.

To see it: build and run, then open Messages, open the sticker browser from the
compose bar, and the pack is a tab in it under the Walky mark.

## Running the package

Set `DEVELOPER_DIR` — `xcode-select` points at CommandLineTools on this machine,
which has no `XCTest.framework` and cannot resolve swift-testing's `Testing`
module. No sudo needed.

```bash
export DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer
swift test                    # the unit suites
swift run walky-conform math  # this port vs V8, bit for bit
```

## The arithmetic

ECMAScript and Swift both leave `exp`, `log`, `sin`, `cos`, `atan2`, `acos` and
`pow` implementation-approximated, and V8 and Darwin's libm are both correct and
disagree. Measured over the ranges this model actually uses:

| | atan2 | acos | exp | cos | log | sin | pow |
|---|---|---|---|---|---|---|---|
| V8 vs Darwin libm | 19.0% | 15.1% | 10.6% | 5.4% | 4.2% | 3.6% | 0% |

Walky's determinism is exact rather than approximate — every fidget, trait and
tie-break is a positional hash — so a last-bit disagreement is not a small
error. It is a different run a few hundred ticks later. `acos` is the sharpest
case: it ranks ear candidates in `convexDecompose`, so it changes how a wall is
split, which changes the visibility graph, which changes where everybody walks.

So `CWalkyMath` carries fdlibm, which is what V8 carries. **With one exception**:
`pow`. V8 does not use fdlibm for it — Darwin's `pow` agrees with V8 on every
sample while the fdlibm routine is one ULP out on 10.7% of them. `walky_pow`
stays in the C target, uncalled, as the evidence for why it is not called.

`Math.hypot` is a third case again: not approximated by a library but computed
by V8 as `max * sqrt(1 + (min/max)^2)`, which the naive `sqrt(a*a + b*b)`
differs from on 39% of inputs. `jsHypot` reproduces V8's form, where every
operation is IEEE-correctly-rounded and so matches by construction.

None of this is guesswork. `tools/mathProbe.ts` writes what V8 computes and
`walky-conform math` checks this port against it, 20,000 samples per function,
comparing bit patterns rather than values.

**The web app is deliberately untouched.** The port is the newcomer, so the port
carries the whole compatibility burden.

## The app icons

Nineteen of them, and eighteen are generated:

```bash
swift run walky-icons        # needs ImageMagick and librsvg
```

The project owns two drawings and every icon is one of them. `Walky.icon` is the
app's own pedestrian -- a goal-coloured circle inside a ring, which is what
`PedestrianPanel.drawPedestrian` has always drawn -- three of them in a triangle.
`Icons/walky-2016.png` is the icon of the archived Java app, a walking figure
over three receding crosswalk stripes, and the only artwork that survived the
rewrite. Three families follow from that:

| | |
|---|---|
| **Crossing** | The 2016 stripes, walked by the app's own dots. One, and four abreast. |
| **Ground** | The 2016 figure over ten grounds -- the map's four wearing the `ink` their own `Ground` defines, and the six accents pressed into service as grounds. |
| **Walker** | The 2016 figure in each of the six accents, on `#1E1E1E`. |

No colour is invented: `Sources/WalkyCore/AppIcons.swift` reads `Grounds` and
`Accents` straight out of `Theme.swift`, and where an accent is used as a ground
the ink is picked by `contrastRatio` rather than by eye -- which is how magenta
and rust ended up with the pale ink and everything else with the dark one.

Two things about that source drawing are worth knowing, because both are fixed
in code rather than in a paint program. Its outer stripes have the figure's feet
knocked out of them, which is right while the figure is standing there and wrong
the moment dots replace it, so each stripe is passed through
`monotoneChainHull` -- the hull the simulation wraps walls with -- and comes back
the trapezoid it was drawn as. And the crossing runs out of the bottom of its own
frame, which reads as perspective there and as an amputation once reframed, so
its sides are continued past the tile.

**They are `.icon` documents, not the loose PNGs at the bundle root that every
guide to alternate icons describes.** A flat PNG cannot be Liquid Glass. `actool`
turns out to take an Icon Composer document for `--alternate-app-icon` exactly as
it does for `--app-icon`: it compiles each into `Assets.car` and writes a
`CFBundleAlternateIcons` entry carrying `CFBundleIconName` and no
`CFBundleIconFiles`, so `project.yml` declares no icon dictionary of its own and
the alternates get specular highlights, parallax and the dark and tinted variants
like the primary. What it costs is that a compiled icon is not loadable as an
image, so the picker draws flat previews rendered alongside the bundles.

`AppIconTests` checks the join nothing else can: an icon missing from
`ASSETCATALOG_COMPILER_ALTERNATE_APPICON_NAMES` is drawn, listed and tappable,
and silently refused at runtime.

## Importing a real map

The walls come from OpenStreetMap and the ground from Apple, because no Apple API
returns a building outline and reading one out of the tiles would break the
licence.

What limits an import is not area but **corners**. The visibility sweep is about
`n^2.5` in them, so a box twice as wide is thirty times the work, and building
density varies by a factor of two between an old town and a campus -- a box that
is comfortable in one is a five-second freeze in the other. `ImportBudget`
therefore counts corners and refuses past 1,000.

### What a building actually looks like

Measured over three 400m extracts, at `radius 13`, medians of three runs:

| extract | rings | corners | mean | median | p90 | p99 | max |
|---|---|---|---|---|---|---|---|
| Winterthur, Technikumstrasse | 182 | 1,589 | 8.7 | 8 | 14 | 33 | 45 |
| Winterthur Altstadt | 280 | 2,523 | 9.0 | 8 | 14 | 36 | 50 |
| Zurich, Kreis 1 | 299 | 2,655 | 8.9 | 8 | 14 | 35 | 37 |

A surveyed building is **eight or nine corners**, not four -- chamfers, bays and
extensions -- and the distribution has a tail: rings over twelve corners are
about 13% of buildings but carry **28-29% of all corners**. That tail is traced
curves, churches and stations, and it is the only part worth simplifying.
`SIMPLIFY_ABOVE` is set from those three rows.

### What merging buys

`mergeFootprints` drops rings drawn inside other rings (`building:part` detail
that describes a building already described), then hulls clusters of touching
rings *only where the hull barely grows the area* -- so a terrace collapses and a
courtyard does not.

| extract | walls | corners | rebuild ms |
|---|---|---|---|
| Technikumstrasse raw | 182 | 1,589 | 218 |
| Technikumstrasse merged | 175 | 1,454 | 241 |
| Altstadt raw | 280 | 2,523 | 525 |
| **Altstadt merged** | **158** | **1,459** | **229** |
| Zurich raw | 299 | 2,655 | 783 |
| Zurich merged | 225 | 1,947 | 387 |

**It pays where buildings share walls and not otherwise.** An old town loses 42%
of its corners and rebuilds 2.3x faster -- and crosses the budget, so an import
that was refused now simply works. A campus of detached buildings loses 8%,
almost all of it from simplifying the tail, and the rebuild does not improve;
the 218 -> 241 there is within the noise of three runs, but it is not a
speed-up and should not be reported as one.

Past the budget the import is refused with what merging achieved and an **Import
anyway** button, which places the polygons already fetched. It never re-queries
Overpass: that is a free service on a fair-use policy which already answered.

The extracts are not committed -- three of them are 6MB, and this repository
already refused to carry 15MB of regenerable fixtures once. Fetch the exact
three above and re-measure:

```bash
base=https://api.openstreetmap.org/api/0.6/map
curl -o technikum.osm "$base?bbox=8.7260,47.4950,8.7310,47.4984"
curl -o altstadt.osm  "$base?bbox=8.7245,47.4985,8.7295,47.5019"
curl -o zurich.osm    "$base?bbox=8.5390,47.3720,8.5440,47.3754"
TILES=1 swift run -c release walky-geobench *.osm   # omit TILES for the 1x/2x/3x sweep
```

## Layout

```
Sources/CWalkyMath    fdlibm, as V8 carries it
Sources/WalkySim      the simulation: no UIKit, no Metal
Sources/WalkyGeo      OpenStreetMap footprints as walls, and the projection
Sources/WalkyConform  replays fixtures, reports the first divergence
Sources/WalkyIcons    renders the alternate app icons, from the theme's colours
Sources/WalkyGeoBench what a real neighbourhood costs the rebuild
Fixtures/             generated by ../web/tools, committed
App/*.icon            Icon Composer documents; App/IconPreviews are the picker's
```
