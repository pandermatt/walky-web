import SwiftUI
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
        Section("Show") {
          Toggle("Convex hulls", isOn: $settings.showConvexHull)
          Toggle("Route to goal", isOn: $settings.showLineToTarget)
          Toggle("Personal space", isOn: $settings.showPersonalSpace)
          Toggle("Debug info", isOn: $settings.showDebug)
        }
        Section {
          Text("A pedestrian simulator. Draw walls, mark a goal, paint a crowd, "
               + "and watch it find its way.")
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
    }
  }

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
