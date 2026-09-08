import SwiftUI
import UniformTypeIdentifiers
import WalkyCore

extension UTType {
  /// The type declared in `project.yml`. Looked up by identifier rather than
  /// constructed with `exportedAs:`, so the app and the plist cannot describe
  /// two different types: if the declaration is ever dropped, this is nil and
  /// the exporter fails loudly rather than writing a file nothing can open.
  static var walkyMap: UTType {
    UTType(MapFile.contentType) ?? .data
  }
}

/// A map on its way to a file, or back from one.
///
/// `FileDocument` rather than a document-based app on purpose. Walky's content
/// is a live canvas you draw on and run, not a document you file: a document
/// browser would open the app on a list instead of a map you can immediately
/// scribble on, and document autosave means writing to disk while a crowd walks
/// at 60Hz. So this is the Preview shape rather than the Keynote shape -- the
/// system export and import sheets, iCloud Drive and On My iPhone included --
/// and `CFBundleDocumentTypes` is what makes a `.walky` in Files or Mail open
/// here.
///
/// It carries bytes rather than a `ScenarioCore`, and that is deliberate: the
/// decode has to happen where somebody can be told it failed, which is the view
/// that presents the sheet, not the initialiser SwiftUI calls on a background
/// queue.
struct WalkyMapDocument: FileDocument {
  static var readableContentTypes: [UTType] { [.walkyMap] }

  var bytes: Data

  init(bytes: Data) { self.bytes = bytes }

  init(configuration: ReadConfiguration) throws {
    guard let data = configuration.file.regularFileContents else {
      throw CocoaError(.fileReadCorruptFile)
    }
    bytes = data
  }

  func fileWrapper(configuration: WriteConfiguration) throws -> FileWrapper {
    FileWrapper(regularFileWithContents: bytes)
  }
}
