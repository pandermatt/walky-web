import SwiftUI
import WalkyCore

/// How big the crowd is, while it is big enough to matter and you are still
/// building the map.
///
/// **Its own `View`, which is the entire point of the type.** SwiftUI
/// re-evaluates a whole body when anything it read changes, and `RootView.body`
/// builds `MapCanvas`, `TouchCanvas` and `ToolbarView`. A count read up there
/// would re-initialise the toolbar on every brush point -- dozens of times a
/// second, under the very finger doing the painting. That is the bug
/// `AppModel.tick` documents: a tap spanning two frames landing on a button that
/// no longer existed, which made play/pause miss every second or third press.
/// Reading `crowd.count` down here confines the invalidation to this capsule,
/// the way `MapCanvas` confines `redraw.version`.
struct CrowdBanner: View {
  let crowd: Crowd
  let toolbar: ToolbarState

  var body: some View {
    // Guidance for building a map, so it steps out of the way of the thing you
    // pressed play to watch. Pausing brings it back rather than requiring
    // another pedestrian first: the crowd is still that size, and the warning
    // is about size.
    let showing = crowd.count >= CROWD_WARN_AT && !toolbar.running
    return Group {
      if showing {
        Label("\(crowd.count.formatted()) pedestrians — the simulation will slow down",
              systemImage: "exclamationmark.triangle.fill")
          .font(.footnote)
          .foregroundStyle(.orange)
          .padding(.horizontal, 14)
          .padding(.vertical, 8)
          .background(.ultraThinMaterial, in: Capsule())
          .transition(.move(edge: .top).combined(with: .opacity))
      }
    }
    // Keyed on whether it is shown, not on the count: the number changing should
    // update in place, not slide the capsule in again on every brush point.
    .animation(.snappy(duration: 0.2), value: showing)
  }
}
