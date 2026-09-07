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
  let onTool: (ToolId) -> Void
  let onAction: (ToolbarAction) -> Void

  /// 44pt, where the web uses 40 for a pointer: a fact about the hand rather
  /// than about the look.
  private let tap: CGFloat = 44

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
    .padding(5)
    .glassBar()
    .padding(.horizontal, 12)
    .padding(.bottom, 6)
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
      icon(iconName).armed(armed)
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
      Divider()
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
  }
}

private extension View {
  /// The bar's own material.
  @ViewBuilder func glassBar() -> some View {
    if #available(iOS 26.0, *) {
      // Untinted, so it adapts to whatever the map puts behind it -- dark over
      // the #1E1E1E ground, and picking up the colour of a wall that passes
      // beneath. An opaque pane or a heavy tint would leave the effect nothing
      // to sample and render as a flat capsule; adaptive is the point.
      glassEffect(.regular.interactive(), in: .capsule)
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
  @ViewBuilder func armed(_ on: Bool) -> some View {
    if #available(iOS 26.0, *) {
      // Only the armed tool gets a shape. Giving every cell a `.tint(.clear)`
      // glass circle still draws a circle -- seven of them, which reads as
      // noise. A tab bar shapes the selected item and leaves the rest bare,
      // and that is the whole reason the armed one is legible at a glance.
      if on {
        glassEffect(.regular.tint(WalkyOrange.color).interactive(), in: .circle)
      } else {
        self
      }
    } else {
      background { if on { Circle().fill(WalkyOrange.color.opacity(0.85)) } }
    }
  }
}

/// `ORANGE` is the path-to-goal colour, and the app's accent by derivation --
/// see the palette note in `Palette.swift`.
enum WalkyOrange {
  /// Written out rather than routed through `MapRenderer.color`, which is
  /// main-actor isolated for the renderer's sake and cannot be read from a
  /// `ViewBuilder` extension.
  static let color = Color(red: 255 / 255, green: 200 / 255, blue: 0 / 255)
}
