import SwiftUI
import WalkyCore

/// The four things you have to do, in the order you have to do them.
///
/// Walky opens on empty ground with a bar of symbols and no words. Three of the
/// four steps are guessable and one is not: a goal *is a wall*, so a tap on bare
/// ground marks nothing at all. `GoalTool` does say so -- but only after the tap
/// has already missed, and that one fact is most of why a first launch earns an
/// interruption.
///
/// The web app never had to solve this. Its icon strip explains itself through
/// hover tooltips, and `ui/tooltip.ts` says outright that they never appear on a
/// touch device, so the phone has always been the surface with no explanation.
///
/// Shaped as the system's own welcome sheet -- stacked title, a column of
/// symbol/headline/line rows, one filled button at the bottom -- because that
/// shape already reads as "here is what this app is". The symbols are the
/// toolbar's own, so each row is a picture of the button to press rather than an
/// illustration of an idea.
struct WelcomeSheetView: View {
  /// The accent, not a fixed colour: this is the first screen of the app and it
  /// should look like the app it is about to open. The armed tool and the
  /// ground's checkmark already wear this.
  let accent: Accent

  @Environment(\.dismiss) private var dismiss

  /// The symbol gutter. A fixed 46pt keeps four glyphs of different optical
  /// width on one left edge at the default type size and shoves the headlines
  /// off the screen at the accessibility ones. Scaling it keeps both.
  @ScaledMetric(relativeTo: .title2) private var gutter: CGFloat = 46

  var body: some View {
    ScrollView {
      VStack(alignment: .leading, spacing: 30) {
        title
        steps
      }
      // A measured column rather than the sheet's full width: on an iPad, and on
      // a phone held sideways, a line of body text run the whole way across is a
      // paragraph nobody finishes.
      .frame(maxWidth: 440, alignment: .leading)
      .frame(maxWidth: .infinity)
      .padding(.horizontal, 28)
      .padding(.top, 40)
      .padding(.bottom, 16)
    }
    // Outside the scroll on purpose. In landscape on a phone this sheet is
    // barely two rows tall, and a button you have to go looking for is a dead
    // end for anyone who does not think to scroll.
    .safeAreaInset(edge: .bottom) { continueButton }
  }

  private var title: some View {
    VStack(alignment: .leading, spacing: 2) {
      Text("Welcome to")
      Text("Walky").foregroundStyle(MapRenderer.color(accent.color))
    }
    .font(.largeTitle.weight(.bold))
    .accessibilityElement(children: .combine)
  }

  private var steps: some View {
    VStack(alignment: .leading, spacing: 24) {
      ForEach(Self.loop) { row($0) }
    }
  }

  private func row(_ step: Step) -> some View {
    HStack(alignment: .top, spacing: 16) {
      Image(systemName: step.symbol)
        .font(.title2)
        .foregroundStyle(MapRenderer.color(accent.color))
        .frame(width: gutter)
        // Nothing here a screen reader needs: the headline beside it says the
        // same thing in words, and the combined element below reads both.
        .accessibilityHidden(true)
      VStack(alignment: .leading, spacing: 3) {
        Text(step.title).font(.headline)
        Text(step.detail)
          .font(.subheadline)
          .foregroundStyle(.secondary)
          // A row in a short sheet can be offered a height it cannot wrap into,
          // and a truncated instruction is worse than no instruction.
          .fixedSize(horizontal: false, vertical: true)
      }
    }
    .accessibilityElement(children: .combine)
  }

  /// Filled and tinted, as the one thing on the screen to press.
  ///
  /// No `#available(iOS 26.0, *)` here, unlike the toolbar's glass: a bar has to
  /// opt into a material and carry its own fallback, while `.borderedProminent`
  /// is a *system style* and draws itself as whatever the running OS draws
  /// buttons as. The label colour is asked of the accent rather than fixed
  /// white, because white on Amber is a smear -- see `Accent.isLight`.
  private var continueButton: some View {
    Button { dismiss() } label: {
      Text("Continue")
        .font(.headline)
        .foregroundStyle(accent.isLight ? Color.black : Color.white)
        .frame(maxWidth: .infinity, minHeight: 30)
    }
    .buttonStyle(.borderedProminent)
    .controlSize(.large)
    .tint(MapRenderer.color(accent.color))
    .frame(maxWidth: 440)
    .frame(maxWidth: .infinity)
    .padding(.horizontal, 28)
    .padding(.vertical, 14)
    // So the last row scrolls *under* the button rather than through it.
    .background(.bar)
  }

  private struct Step: Identifiable {
    let symbol: String
    let title: String
    let detail: String
    var id: String { symbol }
  }

  /// The loop, in the order it has to happen in: nothing to walk around until
  /// there are walls, nowhere to walk to until one of them is the goal, nobody
  /// to walk until a crowd is painted.
  ///
  /// A `static let` outside any view builder, which is also what keeps the type
  /// checker's opinion of `body` short. `SettingsSheetView` twice hit "unable to
  /// type-check this expression in reasonable time" by holding too much view in
  /// one expression, and both fixes were exactly this.
  private static let loop: [Step] = [
    Step(symbol: "scribble", title: "Draw walls",
         detail: "Trace with a finger. The line closes into a shape the crowd cannot cross."),
    Step(symbol: "target", title: "Mark a goal",
         detail: "Tap a wall to make it the goal — it has to be a wall, not open ground."),
    Step(symbol: "person.3.fill", title: "Paint a crowd",
         detail: "Brush pedestrians onto open ground. They wear the colour of the goal they want."),
    Step(symbol: "play.fill", title: "Press play",
         detail: "Everyone finds their own way around what you drew, and rethinks it as you draw more."),
  ]
}
