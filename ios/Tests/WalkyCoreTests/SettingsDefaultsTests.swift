import Foundation
import Testing

@testable import WalkyCore

/// What a brand-new install starts as.
///
/// The whole toggle set is pinned rather than only the two that changed. That
/// is the point of the file: it is the answer to "which of these agree with the
/// web app", and a future edit to any of them has to come here and say so.
@MainActor
@Suite("Settings defaults")
struct SettingsDefaultsTests {
  /// A Settings that cannot reach the simulator's own store.
  private func settings() -> Settings {
    let s = Settings()
    s.defaults = nil
    return s
  }

  /// Mirrors `DEFAULT_SETTINGS` at `web/src/state/model.ts:102`, which was
  /// changed in the same commit so the two ports agree. The two diagnostics are
  /// off because on an empty map they are the only thing drawn.
  @Test("Every toggle starts where the web app's DEFAULT_SETTINGS starts")
  func togglesMatchTheWeb() {
    let s = settings()
    #expect(s.showVisibleLines == false)
    #expect(s.showLineToTarget == false)
    #expect(s.showConvexHull == false)
    #expect(s.showConvexParts == false)
    #expect(s.showPersonalSpace == false)
    #expect(s.showDebug == false)
    #expect(s.sound)
  }

  /// The one that matters most for the welcome sheet: an empty store must not
  /// read as "seen", or the sheet never shows to anybody.
  @Test("A fresh install has not seen the welcome sheet")
  func unseenOnAFreshInstall() {
    let suite = "walky.tests.\(UUID().uuidString)"
    let store = UserDefaults(suiteName: suite)!
    defer { store.removePersistentDomain(forName: suite) }

    let read = Settings()
    read.defaults = store
    read.restore()
    #expect(read.hasSeenWelcome == false)
  }

  @Test("Having seen it survives a round trip through the store")
  func seenSurvivesARoundTrip() {
    let suite = "walky.tests.\(UUID().uuidString)"
    let store = UserDefaults(suiteName: suite)!
    defer { store.removePersistentDomain(forName: suite) }

    let written = settings()
    written.defaults = store
    written.hasSeenWelcome = true

    let read = Settings()
    read.defaults = store
    read.restore()
    #expect(read.hasSeenWelcome)
  }

  /// A Settings with no store must not write its own default back out through
  /// `didSet` while restoring -- that would make "never asked" indistinguishable
  /// from "answered no".
  @Test("Restoring without a store leaves the flag alone")
  func restoreWithoutAStore() {
    let s = settings()
    s.hasSeenWelcome = true
    s.restore()
    #expect(s.hasSeenWelcome)
  }
}
