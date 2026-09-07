import SwiftUI
import WalkyCore

/// The whole app.
///
/// A flat `ZStack` on purpose: the canvas reads only `redraw.version`, the
/// toolbar only `toolbar.*`, and neither is inside the other. Nesting them
/// would make arming a tool repaint the map and stepping the crowd re-evaluate
/// the toolbar.
struct RootView: View {
  @State private var model = AppModel()
  @State private var router: PointerRouter?
  @State private var showingSettings = false
  @Environment(\.scenePhase) private var scenePhase

  private var colorScheme: ColorScheme? {
    switch model.world.settings.appearance {
    case .system: nil
    case .light: .light
    case .dark: .dark
    }
  }

  var body: some View {
    ZStack {
      MapCanvas(world: model.world, redraw: model.redraw,
                stats: { DebugStats(fps: model.fps, tps: model.tps) })

      if let router {
        TouchCanvas(router: router).ignoresSafeArea()
      }

      VStack {
        if let notice = model.notice {
          Text(notice)
            .font(.footnote)
            .padding(.horizontal, 14).padding(.vertical, 8)
            .background(.ultraThinMaterial, in: Capsule())
            .transition(.move(edge: .top).combined(with: .opacity))
        }
        Spacer()
        ToolbarView(state: model.toolbar,
                    tint: model.world.settings.accent,
                    onTool: { model.world.setTool(model.toolbar.selected == $0 ? nil : $0) },
                    onAction: { action in
                      if case .settings = action { showingSettings = true }
                      else { model.act(action) }
                    })
      }
      .animation(.snappy(duration: 0.2), value: model.notice)
    }
    .background(MapRenderer.color(model.world.settings.ground.background))
    // The root follows the **ground**, not the appearance setting, and the
    // status bar is why. It sits over the map, so on a pale ground it has to
    // be dark content -- Paper with a dark scheme put a white clock on an
    // almost-white background. Appearance governs the chrome instead, and is
    // applied to the sheet below.
    .preferredColorScheme(model.world.settings.ground.isLight ? .light : .dark)
    .statusBarHidden(false)
    .sheet(isPresented: $showingSettings) {
      SettingsSheetView(settings: model.world.settings) { model.world.requestRender() }
        // The chrome's own lighting. Declared rather than inherited: on a Mac
        // the window chrome follows this, which is why an undeclared style gave
        // Walky a light title bar over a dark map.
        .preferredColorScheme(colorScheme)
    }
    .onChange(of: showingSettings) { _, open in model.isCovered = open }
    .onAppear {
      if router == nil { router = PointerRouter(host: model.world) }
      model.start()
    }
    .onDisappear { model.stop() }
    .onChange(of: scenePhase) { _, phase in
      // The port of the web's visibilitychange handler: time spent in the
      // background is not owed, and resuming must not open on a burst of
      // catch-up steps.
      if phase == .active { model.start() } else { model.stop() }
    }
  }
}
