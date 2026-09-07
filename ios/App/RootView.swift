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
                    onTool: { model.world.setTool(model.toolbar.selected == $0 ? nil : $0) },
                    onAction: { action in
                      if case .settings = action { showingSettings = true }
                      else { model.act(action) }
                    })
      }
      .animation(.snappy(duration: 0.2), value: model.notice)
    }
    .background(MapRenderer.color(BACKGROUND))
    .statusBarHidden(false)
    .sheet(isPresented: $showingSettings) {
      SettingsSheetView(settings: model.world.settings) { model.world.requestRender() }
    }
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
