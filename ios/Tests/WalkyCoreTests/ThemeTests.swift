import Foundation
import Testing

@testable import WalkyCore

/// The ground is resolved rather than stored, so the rule that resolves it is
/// the thing worth pinning: one setting drives both the chrome and the map, and
/// an outright choice has to survive the setting that would otherwise move it.
@MainActor
@Suite("Ground follows appearance")
struct ThemeTests {
  /// A Settings that cannot touch the simulator's own store.
  private func settings() -> Settings {
    let s = Settings()
    s.defaults = nil
    return s
  }

  @Test("Automatic takes the ground from the appearance")
  func automatic() {
    let s = settings()
    #expect(s.groundId == Grounds.automatic)

    s.appearance = .light
    #expect(s.ground == Grounds.paper)

    s.appearance = .dark
    #expect(s.ground == Grounds.classic)
  }

  @Test("On System it takes the ground from the system")
  func system() {
    let s = settings()
    s.appearance = .system

    s.systemIsDark = true
    #expect(s.ground == Grounds.classic)

    s.systemIsDark = false
    #expect(s.ground == Grounds.paper)
  }

  @Test("A ground picked outright overrides every appearance")
  func explicitWins() {
    let s = settings()
    s.groundId = Grounds.blueprint.id

    for appearance in Appearance.allCases {
      s.appearance = appearance
      for dark in [true, false] {
        s.systemIsDark = dark
        #expect(s.ground == Grounds.blueprint)
      }
    }
  }

  /// `systemIsDark` is only meaningful while the app states no scheme of its
  /// own -- otherwise what the view layer reads back is the app's own
  /// statement. Nothing may consult it outside that window.
  @Test("The system's scheme is consulted only when the app defers to it")
  func followsSystem() {
    let s = settings()
    #expect(s.appearance == .dark)
    #expect(s.followsSystem == false)

    s.appearance = .system
    #expect(s.followsSystem)

    s.groundId = Grounds.paper.id
    #expect(s.followsSystem == false)

    s.groundId = Grounds.automatic
    #expect(s.followsSystem)
  }

  @Test("Automatic survives a round trip through the store")
  func restoresAutomatic() {
    let suite = "walky.tests.\(UUID().uuidString)"
    let store = UserDefaults(suiteName: suite)!
    defer { store.removePersistentDomain(forName: suite) }

    let written = settings()
    written.defaults = store
    written.groundId = Grounds.automatic
    written.appearance = .system

    let read = Settings()
    read.defaults = store
    read.restore()
    #expect(read.groundId == Grounds.automatic)
    #expect(read.appearance == .system)
  }

  /// Automatic is not a `Ground`, so a lookup that only knew about grounds
  /// would quietly turn it into Classic -- which is exactly what the fallback
  /// for a removed ground is meant to do, and exactly wrong here.
  @Test("A ground that no longer exists still falls back to Classic")
  func restoresUnknown() {
    let suite = "walky.tests.\(UUID().uuidString)"
    let store = UserDefaults(suiteName: suite)!
    defer { store.removePersistentDomain(forName: suite) }
    store.set("chartreuse", forKey: "walky.ground")

    let read = Settings()
    read.defaults = store
    read.restore()
    #expect(read.groundId == Grounds.classic.id)
  }
}
