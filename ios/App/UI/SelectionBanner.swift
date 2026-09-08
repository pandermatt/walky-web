import SwiftUI
import WalkyCore

/// Who the next goal will apply to, and a way out of having chosen them.
///
/// **Its own `View`, which is the entire point of the type** -- see
/// `CrowdBanner`, whose comment is the argument in full. A count read in
/// `RootView.body` re-initialises `MapCanvas`, `TouchCanvas` *and*
/// `ToolbarView`, which is what made play/pause miss every second or third
/// press. The selection changes on a gesture, so it walks straight into that.
///
/// System colours rather than the accent, and not `CrowdBanner`'s orange
/// either. Orange is that banner's warning voice and this is a state you put
/// the app into on purpose; the accent is unreadable at the two pale end of its
/// range -- Amber is (255, 200, 0), which is the smear `WelcomeSheetView`
/// already refuses to put a label on. The colour that means "selected" is on
/// the map, on the pedestrians themselves.
///
/// It says what to do next because with the goal tool still armed the answer is
/// one tap away, and without the sentence a ring of yellow circles is a
/// mystery.
struct SelectionBanner: View {
  let selection: Selection
  let onClear: () -> Void

  var body: some View {
    let showing = selection.count > 0
    return Group {
      if showing {
        HStack(spacing: 8) {
          Label("\(selection.count.formatted()) selected — tap a wall to send them there",
                systemImage: "lasso")
            .font(.footnote)
            .foregroundStyle(.primary)
          Button(action: onClear) {
            Image(systemName: "xmark.circle.fill")
              .font(.footnote)
              .foregroundStyle(.secondary)
              // A hit box, not just a glyph: the same lesson `ToolbarView.icon`
              // records, where a thin symbol left most of its cell falling
              // through to the canvas underneath.
              .frame(width: 30, height: 30)
              .contentShape(Rectangle())
          }
          .buttonStyle(.plain)
          .accessibilityLabel("Clear selection")
        }
        .padding(.leading, 14)
        .padding(.trailing, 2)
        .padding(.vertical, 2)
        .background(.ultraThinMaterial, in: Capsule())
        .transition(.move(edge: .top).combined(with: .opacity))
      }
    }
    // Keyed on whether it is shown, not on the count: growing a selection
    // should update the number in place, not slide the capsule in again.
    .animation(.snappy(duration: 0.2), value: showing)
  }
}
