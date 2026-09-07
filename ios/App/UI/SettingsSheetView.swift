import SwiftUI
import UIKit
import WalkyCore

/// Built from `NumericSetting`, which is the same table `Settings.clamp()` uses
/// on a map arriving from a link. 601 lines of DOM in the web app; the one
/// place the port gets smaller.
struct SettingsSheetView: View {
  @Bindable var settings: Settings
  let onChange: () -> Void
  @Environment(\.dismiss) private var dismiss

  var body: some View {
    NavigationStack {
      Form {
        Section("Pedestrians") {
          slider(.speed, format: "%.2f m/s")
          slider(.pedestrianRadius)
          slider(.personalSpace)
          slider(.brushSize)
        }
        Section("Drawing") {
          slider(.borderThickness)
        }
        Section("Appearance") {
          Picker("Appearance", selection: $settings.appearance) {
            ForEach(Appearance.allCases) { Text($0.label).tag($0) }
          }
          .pickerStyle(.segmented)
          .labelsHidden()
        }

        groundSection
        accentSection
        AppIconSection(accent: settings.accent.color)

        Section("Show") {
          Toggle("Convex hulls", isOn: $settings.showConvexHull)
          Toggle("Route to goal", isOn: $settings.showLineToTarget)
          Toggle("Personal space", isOn: $settings.showPersonalSpace)
          Toggle("Debug info", isOn: $settings.showDebug)
        }
        Section {
          Text(Self.about)
            .font(.footnote).foregroundStyle(.secondary)
        } header: { Text("Walky") }
      }
      .navigationTitle("Settings")
      .navigationBarTitleDisplayMode(.inline)
      .toolbar {
        ToolbarItemGroup(placement: .confirmationAction) {
          Button("Done") { dismiss() }
        }
      }
      .onChange(of: settings.pedestrianRadius) { _, _ in onChange() }
      .onChange(of: settings.personalSpace) { _, _ in onChange() }
      .onChange(of: settings.showConvexHull) { _, _ in onChange() }
      .onChange(of: settings.showPersonalSpace) { _, _ in onChange() }
      .onChange(of: settings.showDebug) { _, _ in onChange() }
      .onChange(of: settings.groundId) { _, _ in onChange() }
      // Appearance moves the ground now, not just the chrome.
      .onChange(of: settings.appearance) { _, _ in onChange() }
    }
  }

  /// Rows rather than a Picker. Four grounds with a colour swatch each is a
  /// thing to look at, not a value to pick from a popup -- and the menu style
  /// hid all four behind a tap that showed the answer only after you had
  /// already chosen.
  ///
  /// The ground is a separate choice from the appearance on purpose. #1E1E1E is
  /// not a preference -- `palette.ts` derives it from the 2016 original's
  /// `Color.DARK_GRAY.darker().darker()` -- so "light mode" cannot simply mean
  /// inverting the map. Picking a ground is picking what the crowd walks on;
  /// picking an appearance lights the chrome around it.
  ///
  /// Out of `body` because the type checker gave up on the Form once both this
  /// and the accent section were inline: "unable to type-check this expression
  /// in reasonable time".
  @ViewBuilder private var groundSection: some View {
    Section {
      automaticRow
      ForEach(Grounds.all) { ground in groundRow(ground) }
    } header: { Text("Ground") } footer: {
      Text(Self.groundFooter)
    }
  }


  /// The row that defers to Appearance, and the default.
  ///
  /// A row rather than a hidden state, because "automatic until you touch it"
  /// with no way back is a trap: once a ground is picked outright there has to
  /// be something to pick to undo it.
  private var automaticRow: some View {
    let chosen = settings.groundId == Grounds.automatic
    return Button {
      settings.groundId = Grounds.automatic
    } label: {
      HStack(spacing: 12) {
        // The swatch shows what it currently resolves to, so the row says
        // which ground rather than only that something decides.
        groundSwatch(settings.ground)
        VStack(alignment: .leading, spacing: 1) {
          Text("Automatic").foregroundStyle(.primary)
          Text("Follows Appearance").font(.caption).foregroundStyle(.secondary)
        }
        Spacer()
        if chosen {
          Image(systemName: "checkmark")
            .font(.body.weight(.semibold))
            .foregroundStyle(MapRenderer.color(settings.accent.color))
        }
      }
      .contentShape(Rectangle())
    }
    .buttonStyle(.plain)
  }

  /// One ground row. Its own function because the nested overlays are what
  /// pushed the Form past the type checker's budget.
  private func groundRow(_ ground: Ground) -> some View {
    let chosen = settings.groundId == ground.id
    return Button {
      settings.groundId = ground.id
    } label: {
      HStack(spacing: 12) {
        groundSwatch(ground)
        Text(ground.label).foregroundStyle(.primary)
        Spacer()
        if chosen {
          Image(systemName: "checkmark")
            .font(.body.weight(.semibold))
            .foregroundStyle(MapRenderer.color(settings.accent.color))
        }
      }
      // The same trap as the toolbar cells: a `.plain` Button is hit-tested
      // against its label's *drawn* content, and a row that is mostly Spacer
      // has almost none -- so the tap landed on nothing. The frame is a layout
      // box; this is the hit box.
      .contentShape(Rectangle())
    }
    .buttonStyle(.plain)
  }

  /// A pedestrian at the size it would be on that ground: the swatch shows what
  /// the ink does, not just the paint.
  private func groundSwatch(_ ground: Ground) -> some View {
    let dot = Circle()
      .fill(MapRenderer.color(ORANGE))
      .overlay(Circle().strokeBorder(MapRenderer.color(ground.ink), lineWidth: 1.5))
      .frame(width: 13, height: 13)
    return RoundedRectangle(cornerRadius: 5)
      .fill(MapRenderer.color(ground.background))
      .overlay(dot)
      .overlay(RoundedRectangle(cornerRadius: 5)
        .strokeBorder(.primary.opacity(0.18), lineWidth: 1))
      .frame(width: 40, height: 28)
  }

  /// A palette Picker, not a row of tappable circles.
  ///
  /// The hand-built row looked exactly right and set nothing: inside a Form row
  /// a bare `.onTapGesture` never fired, and neither `.plain` nor `.borderless`
  /// Buttons did either -- the row swallows the tap. Only reading the app's own
  /// preferences plist showed the key was never being written at all.
  /// `.palette` is the system control for exactly this -- a handful of choices
  /// small enough to be shown rather than named -- so hit-testing stops being
  /// ours to get wrong.
  @ViewBuilder private var accentSection: some View {
    Section {
      Picker("Accent", selection: $settings.accentId) {
        ForEach(Accents.all) { accent in
          // A drawn dot rather than `Image(systemName: "circle.fill")`. A
          // palette Picker colours its labels itself and ignores both `.tint`
          // and `.foregroundStyle` on them, so every swatch came out white --
          // six identical circles and no way to tell which colour was which.
          // An `.alwaysOriginal` image is not template art, so nothing recolours
          // it.
          Image(uiImage: Self.dot(accent.color))
            .accessibilityLabel(accent.label)
            .tag(accent.id)
        }
      }
      .pickerStyle(.palette)
      .paletteSelectionEffect(.automatic)
      .labelsHidden()
    } header: { Text("Accent") } footer: {
      Text(Self.accentFooter)
    }
  }



  /// The swatch art, drawn once per colour and kept -- a Picker rebuilds its
  /// labels on every selection change.
  private static let dots: [String: UIImage] = Accents.all.reduce(into: [:]) {
    $0[$1.id] = render($1.color)
  }
  private static func dot(_ rgb: RGB) -> UIImage { dots[Accents.all.first { $0.color == rgb }?.id ?? ""] ?? render(rgb) }

  private static func render(_ rgb: RGB) -> UIImage {
    let side: CGFloat = 22
    let image = UIGraphicsImageRenderer(size: CGSize(width: side, height: side)).image { ctx in
      UIColor(red: CGFloat(rgb.0) / 255, green: CGFloat(rgb.1) / 255,
              blue: CGFloat(rgb.2) / 255, alpha: 1).setFill()
      ctx.cgContext.fillEllipse(in: CGRect(x: 0, y: 0, width: side, height: side))
    }
    return image.withRenderingMode(.alwaysOriginal)
  }

  private static let groundFooter: String =
    "What the crowd walks on. Automatic takes it from Appearance -- Light is "
    + "Paper, Dark is Classic -- and picking one here overrides that until you "
    + "come back. Classic is the 2016 original's own background, and the "
    + "pedestrians' rings follow the ground so they stay visible on a pale one."

  private static let accentFooter: String =
    "The colour behind the tool you are holding, and the tick beside the "
    + "ground above. The bar itself stays untinted so its glass keeps taking "
    + "colour from the map behind it. Orange is the colour the route to a goal "
    + "is drawn in, which is where the app's accent came from in the first "
    + "place."

  private static let about: String =
    "A pedestrian simulator. Draw walls, mark a goal, paint a crowd, and "
    + "watch it find its way."

  private func slider(_ setting: NumericSetting, format: String = "%.0f") -> some View {
    let r = setting.range
    return VStack(alignment: .leading, spacing: 2) {
      HStack {
        Text(setting.label)
        Spacer()
        Text(String(format: format, settings[keyPath: setting.keyPath]))
          .foregroundStyle(.secondary).monospacedDigit()
      }
      Slider(value: Binding(get: { settings[keyPath: setting.keyPath] },
                            set: { settings[keyPath: setting.keyPath] = $0 }),
             in: r.min...r.max, step: r.step)
    }
  }
}
