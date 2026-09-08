import SwiftUI
import WalkyCore

/// The strip, as one bar.
///
/// The web app wears three capsules -- run, tools, view -- which are the three
/// separators `gui/ToolboxPanel` already had. On a phone that reads as three
/// things to aim at, and the two outer ones are mostly one-shot actions you
/// touch rarely. So the bar collapses to a single capsule: play, the five
/// tools as a selector, and everything else behind one menu. What you hold is
/// in the bar; what you do occasionally is in the menu.
///
/// Liquid Glass where it exists (iOS 26+), `.ultraThinMaterial` below it. The
/// glass is the point rather than decoration -- `GlassEffectContainer` lets the
/// armed tool's tinted circle merge with the bar's own material instead of
/// sitting on top of it as a separate disc.
struct ToolbarView: View {
  let state: ToolbarState
  let tint: Accent
  let onTool: (ToolId) -> Void
  let onAction: (ToolbarAction) -> Void

  /// 44pt, where the web uses 40 for a pointer: a fact about the hand rather
  /// than about the look.
  private let tap: CGFloat = 44

  /// The namespace the armed pill travels in.
  ///
  /// This is what separates a system tab bar from a row of buttons on glass.
  /// The selection indicator carries *one* `glassEffectID` wherever it is, so
  /// when it moves from one cell to another Liquid Glass does not fade one out
  /// and another in -- it flows the shape across, the way the pill under a tab
  /// in Music or TV does. Without it the tint simply pops between cells, which
  /// looks like a highlight rather than like a material.
  @Namespace private var glass

  /// SF Symbols rather than the 2016 PNGs.
  ///
  /// The originals are kept in the web app for good reason -- they are the
  /// artwork this project is a revival of -- but they force one thing here: two
  /// of them (border.png, a black outline; goal.png, a thin dark ring) were
  /// drawn for Swing's *light* toolbar and vanish on anything dark, which is
  /// why both this bar and the web app's phone bar had to be tinted light.
  /// A light bar over a #1E1E1E map cannot be adaptive glass, and adaptive is
  /// the whole of what makes Liquid Glass look like the system's own.
  ///
  /// Symbols are template art: they tint themselves, so the bar is free to be
  /// dark over a dark map and light over a pale wall, the way a tab bar is.
  /// The mapping keeps the originals' sense -- a scribble for the freehand
  /// wall, a filled block against a hollow frame, a target for the goal.
  private let tools: [(ToolId, String, String)] = [
    (.wall, "scribble", "Wall"),
    (.rectangle, "rectangle.fill", "Rectangle"),
    (.border, "square", "Border"),
    (.pedestrian, "person.3.fill", "Pedestrians"),
    (.goal, "target", "Mark goal"),
  ]

  var body: some View {
    if #available(iOS 26.0, *) {
      GlassEffectContainer(spacing: 6) {
        bar
      }
    } else {
      bar
    }
  }

  private var bar: some View {
    HStack(spacing: 2) {
      runCell
      Divider().frame(height: tap * 0.45).opacity(0.35)
      ForEach(tools, id: \.0) { id, icon, title in
        toolCell(id: id, icon: icon, title: title)
      }
      Divider().frame(height: tap * 0.45).opacity(0.35)
      menuCell
    }
    .padding(6)
    .glassBar(tint)
    // Floating clear of the edges, as a system tab bar does, rather than
    // spanning the full width like a docked toolbar.
    .padding(.horizontal, 16)
    .padding(.bottom, 10)
    // The pill travels rather than jumps.
    .animation(.snappy(duration: 0.32, extraBounce: 0.08), value: state.selected)
    .animation(.snappy(duration: 0.25), value: state.running)
  }

  // MARK: - Cells

  private var runCell: some View {
    Button { onAction(.start) } label: {
      // The one cell whose art changes with what it does.
      icon(state.running ? "pause.fill" : "play.fill")
    }
    .buttonStyle(.plain)
    .accessibilityLabel(state.running ? "Pause" : "Start")
  }

  private func toolCell(id: ToolId, icon iconName: String, title: String) -> some View {
    let armed = state.selected == id
    return Button { onTool(id) } label: {
      icon(iconName).armed(armed, tint.color, in: glass)
    }
    .buttonStyle(.plain)
    .accessibilityLabel(title)
    .accessibilityAddTraits(armed ? [.isSelected] : [])
  }

  /// Everything you reach for occasionally, in one place.
  private var menuCell: some View {
    Menu {
      Button { onAction(.undo) } label: { Label("Undo", systemImage: "arrow.uturn.backward") }
        .disabled(!state.canUndo)
      Button { onAction(.resetPedestrians) } label: {
        Label("Reset pedestrians", systemImage: "arrow.counterclockwise")
      }
      Button { onAction(.resetZoom) } label: {
        Label("Reset zoom", systemImage: "scope")
      }
      // With the other immediate actions rather than beside Settings, which is
      // where the switch that shares this flag lives. The grouping is about
      // what an item *does*: these three change the view now, the next two
      // raise a sheet. Reaching it here is two taps against Settings' four,
      // which for something you flip before a screenshot and back after is the
      // difference between using it and not.
      Button { onAction(.hideControls) } label: {
        Label("Hide controls", systemImage: "eye.slash")
      }
      Divider()
      // The one modal tool with no cell in the bar -- eight 44pt cells do not
      // fit a 375pt phone. The armed state is carried by the icon swapping to a
      // checkmark, because without it this would be the only mode you cannot
      // see is armed. (A `Toggle` here draws nothing at all in a Menu on iOS 26,
      // which is how this started as one.)
      // Beside Measure, and in the menu for the same reason: eight 44pt cells do
      // not fit a 375pt phone. Like Measure it carries its armed state in the
      // icon, since it has no cell to light up.
      Button { onTool(.generator) } label: {
        Label(state.selected == .generator ? "Marking a generator" : "Generator",
              systemImage: state.selected == .generator ? "checkmark" : "door.left.hand.open")
      }
      Button { onTool(.measure) } label: {
        Label(state.selected == .measure ? "Measuring" : "Measure detour",
              systemImage: state.selected == .measure ? "checkmark" : "ruler")
      }
      if state.hasMeasurement {
        Button { onAction(.clearMeasurement) } label: {
          Label("Clear measurement", systemImage: "ruler.fill")
        }
      }
      Divider()
      // Above Settings, in the group that is about the app rather than about
      // the map, and well clear of the destructive item at the bottom.
      Button { onAction(.welcome) } label: {
        Label("Getting started", systemImage: "lightbulb")
      }
      Button { onAction(.settings) } label: { Label("Settings", systemImage: "gearshape") }
      // Destructive last and marked as such, so the one irreversible item in
      // the menu does not sit next to Undo looking like its neighbour.
      Button(role: .destructive) { onAction(.clear) } label: {
        Label("Clear map", systemImage: "trash")
      }
    } label: {
      icon("ellipsis")
    }
    .accessibilityLabel("More")
  }

  private func icon(_ name: String) -> some View {
    Image(systemName: name)
      .font(.system(size: 19, weight: .medium))
      .foregroundStyle(.primary)
      .frame(width: tap, height: tap)
      // Without this the button is only pressable on the glyph itself. A
      // `.frame` is a layout box, not a hit box: SwiftUI hit-tests a Button
      // against its label's drawn content, so the transparent space around a
      // thin SF Symbol -- most of a 44pt cell -- was falling through to the
      // canvas underneath, where it read as a drag on the map.
      .contentShape(Rectangle())
  }
}

private extension View {
  /// The bar's own material.
  @ViewBuilder func glassBar(_ tint: Accent) -> some View {
    if #available(iOS 26.0, *) {
      // Untinted, so it adapts to whatever the map puts behind it -- dark over
      // the #1E1E1E ground, and picking up the colour of a wall that passes
      // beneath. An opaque pane or a heavy tint would leave the effect nothing
      // to sample and render as a flat capsule; adaptive is the point.
      //
      // Deliberately *not* `.interactive()` here. Interactive glass responds to
      // touch, and on the container that means the bar itself reacts to a drag
      // that was meant for a button inside it. It belongs on the armed pill,
      // which is a control, not on the surface the controls sit on.
      // Untinted on purpose -- see Accent. The colour goes on the armed cell.
      glassEffect(.regular, in: .capsule)
        // A near-miss between two cells should do nothing, rather than reach
        // the map and start drawing on it.
        .contentShape(Capsule())
    } else {
      background(.ultraThinMaterial, in: Capsule())
        .overlay(Capsule().strokeBorder(.white.opacity(0.35), lineWidth: 0.5))
    }
  }

  /// The armed tool wears a tinted circle, and a press dims the cell rather
  /// than filling it: iOS acknowledges a touch by dimming, and these icons are
  /// artwork that cannot be tinted, so the cell does it on their behalf.
  ///
  /// Under Liquid Glass the circle is a tinted glass shape *inside the bar's
  /// container*, so it merges with the bar rather than floating over it -- the
  /// thing the container exists for.
  @ViewBuilder func armed(_ on: Bool, _ tint: RGB, in namespace: Namespace.ID) -> some View {
    if #available(iOS 26.0, *) {
      // Only the armed tool gets a shape. Giving every cell a `.tint(.clear)`
      // glass circle still draws a circle -- seven of them, which reads as
      // noise. A tab bar shapes the selected item and leaves the rest bare.
      //
      // The id is the same string on every cell on purpose: whichever one is
      // armed claims it, so moving the selection is one shape changing place
      // rather than two shapes crossfading, and Liquid Glass flows it across.
      if on {
        glassEffect(.regular.tint(MapRenderer.color(tint)).interactive(), in: .circle)
          .glassEffectID("armed", in: namespace)
      } else {
        self
      }
    } else {
      background { if on { Circle().fill(MapRenderer.color(tint).opacity(0.85)) } }
    }
  }
}
