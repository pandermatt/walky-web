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
  /// Only the system's own scheme while `followsSystem` -- otherwise it is the
  /// scheme this view itself stated, arriving back down the environment.
  @Environment(\.colorScheme) private var scheme

  /// What the chrome states. Nil hands the decision back to the system, which
  /// is both what "System" means and what makes `scheme` above readable.
  private var chromeScheme: ColorScheme? {
    switch model.world.settings.appearance {
    case .system: nil
    case .light: .light
    case .dark: .dark
    }
  }

  /// What the window states.
  ///
  /// The ground rather than the appearance, and the status bar is why: it sits
  /// over the map, so on a pale ground it has to be dark content -- Paper under
  /// a dark scheme put a white clock on an almost-white background. The two
  /// only diverge when a ground has been picked outright; on Automatic the
  /// ground already follows the appearance, so they agree by construction.
  private var windowScheme: ColorScheme? {
    let settings = model.world.settings
    guard !settings.followsSystem else { return nil }
    return settings.ground.isLight ? .light : .dark
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
    .preferredColorScheme(windowScheme)
    .statusBarHidden(false)
    .sheet(isPresented: $showingSettings) {
      SettingsSheetView(settings: model.world.settings) { model.world.requestRender() }
        // The chrome's own lighting. Declared rather than inherited: on a Mac
        // the window chrome follows this, which is why an undeclared style gave
        // Walky a light title bar over a dark map.
        .preferredColorScheme(chromeScheme)
    }
    .onChange(of: showingSettings) { _, open in model.isCovered = open }
    // Kept current only while it can be, which is also the only time anything
    // reads it. Writing it unconditionally would feed this view's own stated
    // scheme back into the setting that decides that scheme.
    .onChange(of: scheme) { _, now in noteSystemScheme(now) }
    .onChange(of: model.world.settings.followsSystem) { _, _ in noteSystemScheme(scheme) }
    .onAppear {
      noteSystemScheme(scheme)
      if router == nil { router = PointerRouter(host: model.world) }
      model.start()
    }
    .onDisappear { model.stop() }
    .onChange(of: model.world.settings.appearance) { _, _ in model.world.requestRender() }
    .onChange(of: scenePhase) { _, phase in
      // The port of the web's visibilitychange handler: time spent in the
      // background is not owed, and resuming must not open on a burst of
      // catch-up steps.
      if phase == .active { model.start() } else { model.stop() }
    }
  }

  private func noteSystemScheme(_ now: ColorScheme) {
    let settings = model.world.settings
    guard settings.followsSystem else { return }
    let dark = now == .dark
    // @Observable fires on every set, not every change, and this one feeds the
    // ground that feeds the map.
    if settings.systemIsDark != dark {
      settings.systemIsDark = dark
      model.world.requestRender()
    }
  }
}
