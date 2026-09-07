# Walky

A pedestrian simulator. Draw walls, mark a goal, paint a crowd, and watch it
find its way.

Two ports of one model, kept in one repository on purpose.

| | |
|---|---|
| [`web/`](web) | The TypeScript app that runs at [walky.ch](https://walky.ch). A rewrite of [pandermatt/walky](https://github.com/pandermatt/walky), the 2016 Java/Swing original by **Pascal Andermatt** and **Jan Huber**. |
| [`ios/`](ios) | A native iOS app: Swift for the model, SwiftUI for the chrome. |

## Why one repository

The Swift port is not a reimplementation that happens to look similar — it is
checked against the TypeScript **bit for bit**. `web/tools/goldenTrace.ts`
records the crowd tick by tick into `ios/Fixtures`, and
`swift run walky-conform all` replays those fixtures through the Swift model and
compares bit patterns, not values.

That only works while the generator and its consumer can change in one commit.
Split across two repositories they would drift the first time somebody tuned a
weight in `behaviour.ts`, and nobody would notice until the two apps disagreed
about where a crowd went. `web/src/__tests__/goldenTrace.test.ts` is the ratchet
that makes the coupling enforceable: change the model and the web test suite
fails until the fixtures are regenerated and the Swift side is brought along.

## Getting started

```bash
cd web && npm install && npm run dev
```

```bash
cd ios && swift test && swift run walky-conform all
```

Each folder has its own README: [`web/README.md`](web/README.md) for the model,
the look, and where both come from; [`ios/README.md`](ios/README.md) for the
port, the arithmetic it has to match, and how to build the app.
