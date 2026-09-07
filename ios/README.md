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

`Walky.app` embeds `WalkyStickers.appex`, an iMessage pack of thirteen stickers.
It has no code: its only build phase is Resources, the executable in the `.appex`
is a stub Xcode links for it, and everything it ships is one compiled asset
catalogue.

Nothing in `Stickers/` is drawn by hand. `../web/tools/stickers.ts` writes the
whole `.xcstickers` — the PNGs, every `Contents.json`, and the twelve sizes of
the Messages drawer icon — out of the same primitives as the app icon, and the
output is committed. Regenerating is a decision, the way regenerating the icons
is:

```bash
cd ../web && npx vite-node tools/stickers.ts
```

`web/README.md` has what is in the pack and why the marks are drawn the way they
are. Two things about the target are worth knowing here:

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

## Layout

```
Sources/CWalkyMath    fdlibm, as V8 carries it
Sources/WalkySim      the simulation: no UIKit, no Metal
Sources/WalkyConform  replays fixtures, reports the first divergence
Fixtures/             generated by ../web/tools, committed
```
