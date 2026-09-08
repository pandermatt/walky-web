import SwiftUI
import WalkyCore

/// The map as a file.
///
/// Here rather than in the overflow menu, beside the other two ways a map
/// arrives: importing a real place and scanning a room. All three answer the
/// same question -- where does the map come from, and where does it go -- and
/// splitting them across two surfaces would mean remembering which lives where.
/// The menu keeps what acts on the map you are already looking at.
///
/// Both buttons only raise a sheet; `RootView` owns them, because the system
/// exporter and importer are presentation and this is a `Section`.
struct MapFileSection: View {
  let onOpen: () -> Void
  let onSave: () -> Void

  var body: some View {
    Section {
      Button("Open…", systemImage: "folder", action: onOpen)
      Button("Save to Files…", systemImage: "square.and.arrow.down", action: onSave)
    } header: {
      Text("Map file")
    } footer: {
      // Two lines, as every other footer in this sheet. The extension is worth
      // naming because it is the thing somebody will look for in Files, and the
      // sentence about the web is a promise the format actually keeps: a
      // `.walky` file is the bytes a share link carries.
      Text(Self.footer)
    }
  }

  private static let footer =
    "A .walky file holds the whole map: walls, crowd and settings. Saving does "
    + "not stop the simulation."
}
