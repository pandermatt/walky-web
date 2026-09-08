import SwiftUI
import UIKit
import WalkyCore

/// A map on its way out through the share sheet.
///
/// A file rather than raw data, and that is the whole reason this type exists:
/// `UIActivityViewController` names what it shares after the file it is given,
/// so sharing a `Data` would offer "1 item" and arrive as `Untitled`, while
/// sharing a URL arrives as `4 walls.walky` -- openable at the far end by the
/// app that declared the type, which is the point of having one.
///
/// The file is written into a directory of its own so it can be deleted whole
/// when the sheet closes. Temporary files that nobody removes are how an app
/// quietly fills a phone with copies of itself.
struct SharedMap: Identifiable {
  let id = UUID()
  let url: URL

  /// The map as a file in a throwaway directory, or nil if it could not be
  /// written -- which is a reason not to open a share sheet, not a reason to
  /// crash.
  init?(_ core: ScenarioCore, named name: String) {
    let folder = FileManager.default.temporaryDirectory
      .appendingPathComponent("share-\(UUID().uuidString)", isDirectory: true)
    let file = folder.appendingPathComponent(name)
      .appendingPathExtension(MapFile.fileExtension)
    do {
      try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
      try MapFile.data(core).write(to: file, options: .atomic)
    } catch {
      return nil
    }
    url = file
  }

  /// Removes every share directory left in `tmp`.
  ///
  /// A sweep rather than a matching `discard()` on the way out, because the
  /// obvious version of that does not work: `.sheet(item:)` clears its binding
  /// *before* calling `onDismiss`, so a closure reading the state to find the
  /// file it should delete finds nil and silently deletes nothing. That is what
  /// the first version did, and the folder sat in `tmp` afterwards.
  ///
  /// Sweeping needs no such bookkeeping and heals whatever an earlier run left
  /// behind -- a share sheet the app was killed behind, say. Called before
  /// writing a new one and when the app leaves the foreground, so at most one
  /// map is ever on disk here, and only while it is being shared.
  static func sweep() {
    let tmp = FileManager.default.temporaryDirectory
    guard let entries = try? FileManager.default.contentsOfDirectory(atPath: tmp.path)
    else { return }
    for entry in entries where entry.hasPrefix("share-") {
      try? FileManager.default.removeItem(at: tmp.appendingPathComponent(entry))
    }
  }
}

/// The system share sheet, which SwiftUI's `ShareLink` cannot quite do here.
///
/// `ShareLink` is a *view*, so it captures what it shares when the row is
/// built rather than when it is tapped -- and this row is built when the
/// settings sheet appears. With the simulation running that would share the
/// map as it stood when you opened Settings, not the one you chose to send.
/// The same reason `RootView.startSave` takes its snapshot at the tap.
struct MapShareSheet: UIViewControllerRepresentable {
  let url: URL

  func makeUIViewController(context: Context) -> UIActivityViewController {
    UIActivityViewController(activityItems: [url], applicationActivities: nil)
  }

  func updateUIViewController(_ controller: UIActivityViewController, context: Context) {}
}
