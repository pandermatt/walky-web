import SwiftUI
import WalkyCore

/// The map.
///
/// `redraw.version` is read in `body`, not inside the renderer closure: reading
/// it here registers the observation inside a tracked scope, where the closure
/// may run outside one. It is also why this view must be a *sibling* of the
/// toolbar rather than a child of anything that reads the toolbar's state --
/// otherwise arming a tool would repaint the whole map.
struct MapCanvas: View {
  let world: WalkyWorld
  let redraw: Redraw
  let basemap: Basemap
  let stats: () -> DebugStats
  @State private var cache = RenderCache()

  var body: some View {
    let version = redraw.version
    // Read here, not in the closure: a renderer closure is not a tracked scope.
    let sheet = basemap.sheet
    Canvas(opaque: true, colorMode: .nonLinear, rendersAsynchronously: false) { ctx, size in
      _ = version
      // `Canvas` renders on the main actor -- `rendersAsynchronously: false`
      // says so -- but its closure is not typed as isolated. Asserting what is
      // true beats making the world non-isolated or lying with
      // `@unchecked Sendable`: if SwiftUI ever renders this off the main
      // thread, this traps loudly instead of racing the simulation quietly.
      MainActor.assumeIsolated {
        MapRenderer.draw(world, cache, stats(), basemap: sheet, into: &ctx, size: size)
      }
    }
    .ignoresSafeArea()
  }
}
