import Foundation
import Testing

@testable import WalkyCore

/// The icon table is read by three things that cannot see each other: the
/// generator that draws the bundles, the picker that offers them, and a build
/// setting in `project.yml` that decides which the system will accept at all.
/// These are the joins.
@Suite("App icons")
struct AppIconTests {
  private var ios: URL {
    URL(fileURLWithPath: #filePath)
      .deletingLastPathComponent()   // WalkyCoreTests
      .deletingLastPathComponent()   // Tests
      .deletingLastPathComponent()   // ios
  }

  /// The claim the ink column makes. `AppIcons.ink(on:)` picks between the
  /// palette's two inks by measurement, and this is what "picks the readable
  /// one" is worth: magenta and rust are the tight pair at about 4:1, and an
  /// eye would have given both of them the dark ink and been wrong.
  @Test("Every icon's ink reads against its ground")
  func inkReads() {
    for icon in AppIcons.alternates {
      let paint = try! #require(icon.paint)
      let ratio = contrastRatio(paint.ink, paint.ground)
      #expect(ratio >= 3.0, "\(icon.id) is \(String(format: "%.1f", ratio)) : 1")
    }
  }

  /// An accent used as a ground takes whichever ink measures better, so no
  /// other choice may beat the one made.
  @Test("The ink chosen is the better of the two")
  func inkIsTheBest() {
    for accent in Accents.all {
      let picked = AppIcons.ink(on: accent.color)
      for other in AppIcons.inks {
        #expect(contrastRatio(picked, accent.color) >= contrastRatio(other, accent.color))
      }
    }
  }

  @Test("Names are unique, and only the primary has none")
  func names() {
    #expect(AppIcons.primary.name == nil)
    #expect(AppIcons.alternates.allSatisfy { $0.name != nil })
    #expect(Set(AppIcons.all.map(\.id)).count == AppIcons.all.count)
  }

  /// Every alternate is a bundle on disk. A name in the table with nothing
  /// drawn for it is a tile that renders blank and an icon that cannot be set.
  @Test("Every alternate has a bundle and a preview")
  func drawn() {
    for icon in AppIcons.all {
      let bundle = ios.appending(path: "App/\(icon.name ?? "Walky").icon")
      #expect(FileManager.default.fileExists(atPath: bundle.appending(path: "icon.json").path),
              "missing \(bundle.lastPathComponent) -- run: swift run walky-icons")
      let preview = ios.appending(path: "App/IconPreviews/\(icon.preview).png")
      #expect(FileManager.default.fileExists(atPath: preview.path),
              "missing \(icon.preview).png -- run: swift run walky-icons")
    }
  }

  /// The one join nothing else can catch. `setAlternateIconName` only accepts a
  /// name actool was told to compile, so an icon left out of this build setting
  /// is drawn, listed, tappable -- and silently refused.
  @Test("project.yml offers exactly the alternates this table has")
  func projectListsThem() throws {
    let yaml = try String(contentsOf: ios.appending(path: "project.yml"), encoding: .utf8)
    let key = "ASSETCATALOG_COMPILER_ALTERNATE_APPICON_NAMES:"
    let after = try #require(yaml.range(of: key)).upperBound

    // Everything from the line after the key until the block stops being items.
    var listed: Set<String> = []
    for line in yaml[after...].split(separator: "\n", omittingEmptySubsequences: false).dropFirst() {
      let trimmed = line.trimmingCharacters(in: .whitespaces)
      guard trimmed.hasPrefix("- ") else { break }
      listed.insert(String(trimmed.dropFirst(2)))
    }
    #expect(listed == Set(AppIcons.alternates.compactMap(\.name)))
  }
}
