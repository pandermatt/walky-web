import SwiftUI
import WalkyCore
import WalkyGeo
import WalkySim

/// Your own room, as a map.
///
/// A `Section` like `RealMapSection` rather than a screen of its own, for the
/// same reason and with the same shape: this is a way of getting walls, and the
/// walls all arrive the same way once they are here.
///
/// The scan step is offered only where it can work -- `RoomCaptureSession`
/// needs LiDAR -- and **absent rather than disabled** where it cannot, which is
/// the line `SettingsSheetView.mapSection` already draws: on a phone that
/// cannot scan there is nothing to enable. The sample room stays on every
/// device, because it is also how this was built and how it is demonstrated.
struct RoomScanSection: View {
  let world: WalkyWorld
  @Bindable var scanner: RoomScanner
  /// Raises the capture sheet, which `RootView` owns.
  let onScan: () -> Void

  var body: some View {
    Section {
      if scanner.canScan {
        Button("Scan a room", systemImage: "camera.viewfinder") {
          scanner.startScan()
          onScan()
        }
        .disabled(scanner.isBusy)
      }

      Button("Use the sample room", systemImage: "square.split.bottomrightquarter") {
        scanner.loadSample()
      }
      .disabled(scanner.isBusy)

      if scanner.hasSaved {
        Button("Load the last scan", systemImage: "clock.arrow.circlepath") {
          scanner.loadSaved()
        }
        .disabled(scanner.isBusy)
      }

      if scanner.isBusy {
        ProgressView(value: scanner.progress, total: 1)
          .progressViewStyle(.linear)
      }

      Toggle("Furniture as obstacles", isOn: $scanner.includeFurniture)
        .onChange(of: scanner.includeFurniture) { scanner.furnitureChanged() }
        .disabled(scanner.isBusy)

      if case .ready = scanner.phase {
        doorwayRoles
        Button("Place this room") { scanner.place(into: world) }
      }

      status
    } header: {
      Text("Your room")
    } footer: {
      Text(Self.footer)
    }
  }

  /// One row per doorway, because the roles are the whole of the decision here.
  ///
  /// A room with three doors should not have three doors' worth of people
  /// pouring in and nowhere to go, so the widest is the way out by default and
  /// the rest are ways in. Changing that is a picker rather than a
  /// re-scan, which is why the roles are settled before the room is placed.
  @ViewBuilder private var doorwayRoles: some View {
    if scanner.doorways.isEmpty {
      Label("No doorways in that scan — paint a crowd and mark a wall yourself.",
            systemImage: "info.circle")
        .font(.footnote).foregroundStyle(.secondary)
    } else {
      ForEach(Array(scanner.doorways.enumerated()), id: \.offset) { i, doorway in
        VStack(alignment: .leading, spacing: 4) {
          LabeledContent(doorway.kind == .opening ? "Opening" : "Door") {
            Text("\(String(format: "%.2f", doorway.metres)) m").foregroundStyle(.secondary)
          }
          Picker("Role", selection: role(i)) {
            ForEach(RoomScanner.Role.allCases) { Text($0.label).tag($0) }
          }
          .pickerStyle(.segmented)
          .labelsHidden()
        }
      }

      let narrow = scanner.tooNarrow(world.settings.pedestrianRadius)
      if !narrow.isEmpty {
        // Worth saying rather than leaving to be discovered: the crowd will
        // simply never use a gap this size, and it looks like a routing bug.
        Label("\(narrow.count) too narrow for a \(body(world))m body — nobody will "
            + "use them. Make pedestrians smaller in Pedestrians above.",
              systemImage: "exclamationmark.triangle.fill")
          .font(.footnote).foregroundStyle(.orange)
      }
    }
  }

  @ViewBuilder private var status: some View {
    switch scanner.phase {
    case .idle, .ready:
      EmptyView()
    case .unsupported:
      Text(Self.noLidar).font(.footnote).foregroundStyle(.secondary)
    case .scanning:
      Text("Walk round the room, then press Done.")
        .font(.footnote).foregroundStyle(.secondary)
    case .processing:
      Text("Building the floor plan…").font(.footnote).foregroundStyle(.secondary)
    case .placing:
      Text("Placing the room…").font(.footnote).foregroundStyle(.secondary)
    case .routing:
      Text("Building the navigation graph…").font(.footnote).foregroundStyle(.secondary)
    case .done(let what):
      Text(what).font(.footnote).foregroundStyle(.secondary)
    case .failed(let why):
      Text(why).font(.footnote).foregroundStyle(.red)
    }
  }

  private func role(_ index: Int) -> Binding<RoomScanner.Role> {
    Binding(get: { scanner.roles[index] ?? .open },
            set: { scanner.setRole($0, at: index) })
  }

  /// A pedestrian's width in real metres, for the warning.
  private func body(_ world: WalkyWorld) -> String {
    String(format: "%.2f", 2 * world.settings.pedestrianRadius / PX_PER_METRE)
  }

  // Two lines each on the narrowest phone, as every other footer in this sheet.
  private static let footer =
    "Scanning needs a LiDAR camera. Placed at life size, so a door takes one "
    + "person at a time. Importing replaces your map."
  private static let noLidar =
    "This device has no LiDAR camera, so it cannot scan. The sample room works "
    + "everywhere."
}
