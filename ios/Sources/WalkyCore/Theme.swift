import Foundation

/// How the chrome is lit: the settings sheet, the menus, the toolbar's glass.
///
/// The map is not included, and that is the point of the split. Its ground is a
/// separate choice below, because `#1E1E1E` is not a preference -- palette.ts
/// derives it from `Color.DARK_GRAY.darker().darker()`, the 2016 original's own
/// arithmetic -- so "light mode" cannot simply mean "invert everything".
public enum Appearance: String, CaseIterable, Identifiable, Sendable {
  case system, light, dark
  public var id: String { rawValue }
  public var label: String {
    switch self {
    case .system: "System"
    case .light: "Light"
    case .dark: "Dark"
    }
  }
}

/// What the crowd walks on.
///
/// The original had a `Theme` class (media/Theme.java) carrying a name and a
/// background colour, so a picker of named grounds is the 2016 idea rather than
/// a new one. What it did not have to worry about is what a pale ground does to
/// everything drawn on it.
///
/// Two colours, not one. A pedestrian is a goal-coloured dot inside a **white
/// ring** (`PedestrianPanel.drawPedestrian`), and the previews, hulls and
/// pending outlines are white too -- all of which disappear on a light ground.
/// So a ground carries its own `ink`, and the renderer asks the theme rather
/// than reaching for `WHITE`. On the classic ground the ink *is* white, so
/// nothing about the original changes.
public struct Ground: Identifiable, Sendable, Equatable {
  public let id: String
  public let label: String
  /// What the map is painted on.
  public let background: RGB
  /// The ring round a pedestrian, and every outline drawn over the map.
  public let ink: RGB
  /// Whether the ground is light enough that chrome should read as light on it.
  public let isLight: Bool

  public static func == (a: Ground, b: Ground) -> Bool { a.id == b.id }
}

public enum Grounds {
  /// Not a ground: the id meaning "whatever Appearance says". It is the
  /// default, so the one visible control lights the map as well as the chrome
  /// and a new install has nothing to reconcile.
  public static let automatic = "automatic"

  /// The original's, and the default. `shadowOf` twice over Java's DARK_GRAY,
  /// which is where #1E1E1E comes from -- derived here as it is in palette.ts,
  /// so it cannot drift from the thing it is a port of.
  public static let classic = Ground(
    id: "classic", label: "Classic", background: BACKGROUND, ink: WHITE, isLight: false)

  /// The same idea taken all the way down. Chosen so the Dynamic Island and the
  /// map become one surface on an iPhone, which they cannot at #1E1E1E.
  public static let midnight = Ground(
    id: "midnight", label: "Midnight", background: (0, 0, 0), ink: WHITE, isLight: false)

  /// A pale ground, for a map that is going to be screenshotted into something
  /// printed. The ink is `shadowOf(shadowOf(WHITE))`'s opposite number -- the
  /// darkest thing the palette already makes -- rather than pure black, so a
  /// wall's own shadow still reads against it.
  public static let paper = Ground(
    id: "paper", label: "Paper", background: (242, 240, 235), ink: (28, 28, 30), isLight: true)

  /// Blueprint: the drawing-board reading of the same map.
  public static let blueprint = Ground(
    id: "blueprint", label: "Blueprint", background: (11, 34, 64), ink: (198, 222, 255),
    isLight: false)

  public static let all: [Ground] = [classic, midnight, paper, blueprint]

  public static func named(_ id: String) -> Ground {
    all.first { $0.id == id } ?? classic
  }
}


/// The colour behind the armed tool in the toolbar.
///
/// The bar itself stays untinted on purpose: Liquid Glass takes its colour from
/// whatever the map puts behind it, and that adaptation is what makes it read
/// as the system's own bar rather than as a coloured strip. What is worth
/// colouring is the one cell that means something -- the tool you are holding.
///
/// Orange is the default and is not arbitrary. It is the colour the path to a
/// goal is drawn in, straight from the 2016 palette, which is the argument
/// `ui/theme.ts` makes for it being the app's accent at all: the tint has to be
/// the app's own colour, and this is the only colour the app already owns.
///
/// The rest are the project's own -- the same values as `tools/brand.ts`, which
/// picked them so every one is legal under `randomBrightColor`'s rule (at least
/// one channel in 150-255). A wall could genuinely come out any of these, so
/// the armed cell never wears a colour the map could not.
public struct Accent: Identifiable, Sendable, Equatable {
  public let id: String
  public let label: String
  public let color: RGB
  /// Whether the colour is pale enough that a label on top of it has to be
  /// dark. The same question `Ground.isLight` answers, asked of the tint under
  /// a filled button.
  ///
  /// Rec. 601 luma rather than a guess: Amber, Lime and Teal come out light and
  /// take a black label, Sky, Rust and Magenta take white. White on Amber
  /// (255, 200, 0) is a smear, which is what this exists to prevent.
  public var isLight: Bool {
    (0.299 * Double(color.0) + 0.587 * Double(color.1) + 0.114 * Double(color.2)) / 255 > 0.6
  }

  public static func == (a: Accent, b: Accent) -> Bool { a.id == b.id }
}

public enum Accents {
  public static let orange = Accent(id: "orange", label: "Orange", color: ORANGE)
  public static let teal = Accent(id: "teal", label: "Teal", color: (41, 214, 168))
  public static let lime = Accent(id: "lime", label: "Lime", color: (168, 214, 66))
  public static let magenta = Accent(id: "magenta", label: "Magenta", color: (196, 25, 192))
  public static let sky = Accent(id: "sky", label: "Sky", color: (66, 158, 214))
  public static let rust = Accent(id: "rust", label: "Rust", color: (214, 66, 39))

  public static let all: [Accent] = [orange, teal, lime, magenta, sky, rust]
  public static func named(_ id: String) -> Accent { all.first { $0.id == id } ?? orange }
}
