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
  @State private var sheet: Sheet?
  /// The two file sheets are the system's, not ours, so they are `Bool`s beside
  /// `sheet` rather than cases in it -- and `isCovered` is set from them too,
  /// because a map behind a save sheet is as covered as one behind Settings.
  @State private var saving = false
  @State private var opening = false
  /// Held while the exporter is up: it asks for the document, and asking the
  /// world for it again mid-presentation would save whatever the crowd had
  /// walked to by then rather than what was on screen when Save was tapped.
  @State private var outgoing: WalkyMapDocument?
  @State private var outgoingName = "Walky map"
  /// The map written to a throwaway file, while the share sheet is up.
  @State private var shared: SharedMap?
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
      MapCanvas(world: model.world, redraw: model.redraw, basemap: model.basemap,
                stats: { DebugStats(fps: model.fps, tps: model.tps) })

      if let router {
        TouchCanvas(router: router).ignoresSafeArea()
      }

      // Everything the app draws over the map, gone in one place for a clean
      // capture -- the notice and both banners as well as the bar, since a
      // screenshot with a capsule floating in it is not a clean screenshot.
      // Pinch and pan keep working while it is hidden, so the shot can still be
      // framed; a tap on the map brings it all back.
      if !model.chrome.hidden {
        VStack {
          if let notice = model.notice.message {
            Text(notice)
              .font(.footnote)
              .padding(.horizontal, 14).padding(.vertical, 8)
              .background(.ultraThinMaterial, in: Capsule())
              .transition(.move(edge: .top).combined(with: .opacity))
          }
          // Child views on purpose -- see CrowdBanner. Neither count may be read
          // in this body, which also builds the toolbar.
          SelectionBanner(selection: model.selection) { model.world.clearSelection() }
          CrowdBanner(crowd: model.crowd, toolbar: model.toolbar)
          Spacer()
          ToolbarView(state: model.toolbar,
                      tint: model.world.settings.accent,
                      onTool: { model.world.setTool(model.toolbar.selected == $0 ? nil : $0) },
                      onAction: { action in
                        switch action {
                        // The two that raise a sheet, which the view owns.
                        case .settings: sheet = .settings
                        case .welcome: sheet = .welcome
                        default: model.act(action)
                        }
                      })
        }
        .animation(.snappy(duration: 0.2), value: model.notice.message)
        .transition(.opacity)
      }
    }
    .animation(.snappy(duration: 0.25), value: model.chrome.hidden)
    .background(MapRenderer.color(model.world.settings.ground.background))
    .preferredColorScheme(windowScheme)
    .statusBarHidden(model.chrome.hidden)
    .sheet(item: $sheet) { which in
      // The chrome's own lighting, declared rather than inherited -- on a Mac
      // the window chrome follows this, which is why an undeclared style gave
      // Walky a light title bar over a dark map. Stated once here rather than
      // once per sheet, which is the second dividend of `.sheet(item:)`.
      content(of: which).preferredColorScheme(chromeScheme)
    }
    .fileExporter(isPresented: $saving,
                  document: outgoing,
                  contentType: .walkyMap,
                  defaultFilename: outgoingName) { result in
      if case .failure(let error) = result { model.show(error.localizedDescription) }
      outgoing = nil
    }
    .fileImporter(isPresented: $opening,
                  allowedContentTypes: [.walkyMap]) { result in
      switch result {
      case .success(let url): open(url)
      case .failure(let error): model.show(error.localizedDescription)
      }
    }
    .sheet(item: $shared) { map in
      MapShareSheet(url: map.url)
    }
    // A `.walky` tapped in Files, Mail or AirDrop. The same path as the
    // importer, so a map arrives the same way however it got here.
    .onOpenURL { open($0) }
    // Hiding the chrome puts the app in a viewing mode, and disarming is what
    // makes that true rather than merely tidy. It is also the only thing
    // guaranteeing a way back: the tap that restores the controls is delivered
    // to the *tool* when one is armed, so hiding with the brush in hand would
    // paint pedestrians instead of bringing the bar back, and nothing else on
    // screen could undo it. Keyed on the flag rather than done at the two call
    // sites, so the menu item and the Settings switch cannot drift apart.
    .onChange(of: model.chrome.hidden) { _, hidden in
      if hidden { model.world.setTool(nil) }
    }
    .onChange(of: saving) { _, up in model.isCovered = up || opening || sheet != nil }
    .onChange(of: opening) { _, up in model.isCovered = up || saving || sheet != nil }
    .onChange(of: shared?.id) { _, _ in
      model.isCovered = shared != nil || saving || opening || sheet != nil
    }
    .onChange(of: sheet) { was, now in
      // One handler, because the map does not care which sheet is over it.
      model.isCovered = now != nil || saving || opening
      // Dismissed by any route -- Continue, a swipe, anything later -- counts as
      // having seen it. Recording it when the sheet *opens* would mark a thing
      // that had not happened yet; recording it only on Continue would bring it
      // back at the next launch for anyone who swiped it away, which reads as a
      // bug. Being wrong here costs two taps in the menu.
      if was == .welcome { model.world.settings.hasSeenWelcome = true }
    }
    // Kept current only while it can be, which is also the only time anything
    // reads it. Writing it unconditionally would feed this view's own stated
    // scheme back into the setting that decides that scheme.
    .onChange(of: scheme) { _, now in noteSystemScheme(now) }
    .onChange(of: model.world.settings.followsSystem) { _, _ in noteSystemScheme(scheme) }
    .onAppear {
      noteSystemScheme(scheme)
      if router == nil { router = PointerRouter(host: model.world) }
      model.start()
      // `WalkyWorld.init` restores the settings, and `model` is a `@State`
      // initial value, so the flag is already correct by the time this runs.
      if !model.world.settings.hasSeenWelcome { sheet = .welcome }
    }
    .onDisappear { model.stop() }
    .onChange(of: model.world.settings.appearance) { _, _ in model.world.requestRender() }
    .onChange(of: scenePhase) { _, phase in
      // The port of the web's visibilitychange handler: time spent in the
      // background is not owed, and resuming must not open on a burst of
      // catch-up steps.
      if phase == .active {
        model.start()
      } else {
        model.stop()
        // Nothing shared should outlive the app being put away.
        SharedMap.sweep()
      }
    }
  }

  @ViewBuilder private func content(of which: Sheet) -> some View {
    switch which {
    case .welcome:
      WelcomeSheetView(accent: model.world.settings.accent)
    case .settings:
      SettingsSheetView(settings: model.world.settings,
                        chrome: model.chrome,
                        onChange: { model.world.requestRender() },
                        mapSection: AnyView(
                          RealMapSection(world: model.world, basemap: model.basemap,
                                         importer: model.importer,
                                         dark: (windowScheme ?? scheme) == .dark)),
                        roomSection: AnyView(
                          RoomScanSection(world: model.world, scanner: model.scanner,
                                          // Swapping the item on the one sheet
                                          // rather than presenting from inside
                                          // it: `isCovered` stays one fact.
                                          onScan: { sheet = .roomScan })),
                        // Dismissing Settings first, because the exporter and
                        // the importer are sheets too and iOS will not stack a
                        // second one over the first: without this the file
                        // sheet opens on nothing.
                        fileSection: AnyView(
                          MapFileSection(onOpen: { sheet = nil; opening = true },
                                         onSave: { sheet = nil; startSave() },
                                         onShare: { sheet = nil; startShare() })))
    case .roomScan:
      RoomCaptureContainer(scanner: model.scanner)
    }
  }

  /// The map as it stands, handed to the exporter.
  ///
  /// Taken here rather than in the `document:` argument because that is
  /// evaluated while the sheet is up: with the simulation running, the file
  /// would hold wherever the crowd had walked to by the time somebody picked a
  /// folder, rather than the map they chose to save.
  private func startSave() {
    let core = model.world.captureScenario()
    outgoing = WalkyMapDocument(bytes: MapFile.data(core))
    outgoingName = MapFile.suggestedName(walls: model.world.walls.count,
                                         pedestrians: model.world.agents.count)
    saving = true
  }

  /// The map as a file somebody can be sent.
  ///
  /// Snapshotted at the tap, as saving is, and written to disk here rather than
  /// in the sheet: the share sheet wants a URL, and a name on that URL is what
  /// makes the map arrive as `4 walls.walky` at the other end instead of as an
  /// untitled blob.
  private func startShare() {
    // Whatever the last share left behind, before this one adds to it.
    SharedMap.sweep()
    let core = model.world.captureScenario()
    let name = MapFile.suggestedName(walls: model.world.walls.count,
                                     pedestrians: model.world.agents.count)
    guard let map = SharedMap(core, named: name) else {
      model.show("Could not write the map to share.")
      return
    }
    shared = map
  }

  /// A file, from either sheet or from Files itself.
  ///
  /// The security-scoped dance is not optional: a URL out of the importer or
  /// `onOpenURL` is somebody else's file, and reading it without the access
  /// call works in the Simulator and fails on a device, which is the worst
  /// possible way for it to fail.
  private func open(_ url: URL) {
    let scoped = url.startAccessingSecurityScopedResource()
    defer { if scoped { url.stopAccessingSecurityScopedResource() } }
    do {
      let core = try MapFile.read(try Data(contentsOf: url))
      model.world.apply(core)
      model.show("Opened \(url.deletingPathExtension().lastPathComponent).")
    } catch let error as ScenarioLinkError {
      // The codec's own sentence, which is written to be shown: "not a Walky
      // map", "saved by a newer Walky", "larger than Walky can hold".
      model.show(error.message)
    } catch {
      model.show(error.localizedDescription)
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

/// The one thing that can cover the map.
///
/// A single `.sheet(item:)` over this rather than a `.sheet(isPresented:)` per
/// Bool. Two of those do both work on iOS 17 -- the old bug where the second
/// one silently lost is long fixed -- but `model.isCovered` is a fact about the
/// *map* being covered and not about any one sheet, and with two Bools it has
/// to be maintained by two handlers that must never disagree. With one optional
/// it is `now != nil`, once.
private enum Sheet: String, Identifiable {
  case welcome, settings, roomScan
  var id: String { rawValue }
}
