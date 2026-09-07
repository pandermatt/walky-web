import SwiftUI
import WalkyCore

/// The strip, in three capsules: what the simulation is doing, what you draw it
/// with, and where you are looking from. Ports the `GROUPS` table of
/// `ui/toolbar.ts`; the separators of `gui/ToolboxPanel` are these groups.
///
/// The icons are the original 2016 PNGs, unmodified. The strip is light because
/// they were drawn for Swing's light toolbar -- `border.png` in particular is a
/// black outline that would vanish on a dark one -- which is also why the web
/// app's phone bar is light glass. Keeping them is what makes the original art
/// read as drawn.
struct ToolbarItem: Identifiable {
  enum Kind { case tool(ToolId), action(ToolbarAction) }
  let icon: String
  let title: String
  let kind: Kind
  var id: String { icon }
}

let TOOLBAR_GROUPS: [[ToolbarItem]] = [
  [
    ToolbarItem(icon: "start", title: "Start / pause", kind: .action(.start)),
    ToolbarItem(icon: "reset_pedestrians", title: "Reset pedestrians", kind: .action(.resetPedestrians)),
    ToolbarItem(icon: "undo", title: "Undo", kind: .action(.undo)),
    ToolbarItem(icon: "clear", title: "Clear", kind: .action(.clear)),
  ],
  [
    ToolbarItem(icon: "addWall", title: "Wall", kind: .tool(.wall)),
    ToolbarItem(icon: "addWallSquare", title: "Rectangle", kind: .tool(.rectangle)),
    ToolbarItem(icon: "border", title: "Border", kind: .tool(.border)),
    ToolbarItem(icon: "pedestrian", title: "Pedestrians", kind: .tool(.pedestrian)),
    ToolbarItem(icon: "goal", title: "Mark goal", kind: .tool(.goal)),
  ],
  [
    ToolbarItem(icon: "reset_zoom", title: "Reset zoom", kind: .action(.resetZoom)),
    ToolbarItem(icon: "settings", title: "Settings", kind: .action(.settings)),
  ],
]

struct ToolbarView: View {
  let state: ToolbarState
  let onTool: (ToolId) -> Void
  let onAction: (ToolbarAction) -> Void

  /// 44pt where the web uses 40 for a pointer: that is a fact about the hand
  /// rather than about the look.
  private let tap: CGFloat = 44

  var body: some View {
    // Wrapping rather than a fixed row: portrait puts the tools on their own
    // line nearest the thumb, landscape fits all three capsules side by side,
    // and no breakpoint decides it.
    ViewThatFits(in: .horizontal) {
      HStack(spacing: 10) { capsules }
      VStack(spacing: 10) { capsules }
    }
    .padding(.horizontal, 12)
    .padding(.bottom, 8)
  }

  @ViewBuilder private var capsules: some View {
    ForEach(Array(TOOLBAR_GROUPS.enumerated()), id: \.offset) { _, group in
      HStack(spacing: 2) {
        ForEach(group) { item in cell(item) }
      }
      .padding(4)
      .background(.ultraThinMaterial, in: Capsule())
      .overlay(Capsule().strokeBorder(.white.opacity(0.35), lineWidth: 0.5))
    }
  }

  private func cell(_ item: ToolbarItem) -> some View {
    let armed: Bool = {
      switch item.kind {
      case .tool(let id): return state.selected == id
      case .action(.start): return state.running
      default: return false
        }
    }()
    let enabled: Bool = {
      if case .action(.undo) = item.kind { return state.canUndo }
      return true
    }()
    // Start is the one cell whose art changes with what it does.
    let icon = { if case .action(.start) = item.kind, state.running { return "pause" }
                 return item.icon }()

    return Button {
      switch item.kind {
      case .tool(let id): onTool(id)
      case .action(let a): onAction(a)
      }
    } label: {
      Image(icon)
        .resizable().scaledToFit()
        .frame(width: tap * 0.55, height: tap * 0.55)
        .frame(width: tap, height: tap)
        .background {
          // The armed tool wears a tinted circle, and a press dims the cell
          // rather than filling it: iOS acknowledges a touch by dimming, and
          // these icons are artwork that cannot be tinted, so the cell does it
          // on their behalf.
          if armed { Circle().fill(MapRenderer.color(ORANGE).opacity(0.85)) }
        }
        .opacity(enabled ? 1 : 0.35)
    }
    .buttonStyle(.plain)
    .disabled(!enabled)
    .accessibilityLabel(item.title)
  }
}
