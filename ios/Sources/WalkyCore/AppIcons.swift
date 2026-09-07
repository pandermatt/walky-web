import Foundation

/// The icons the app can wear.
///
/// The project owns exactly two drawings, and every alternate is one of them.
///
/// `Icons/walky-2016.png` is the first: the icon of the archived Java app, a
/// walking figure over three receding crosswalk stripes, and the only artwork
/// that survived the rewrite. `Walky.icon` is the second: the app's own
/// pedestrian, a goal-coloured circle inside a ring, which is what
/// `PedestrianPanel.drawPedestrian` has always drawn. No colour here is new
/// either -- every value comes from `Grounds` or `Accents` in `Theme.swift`.
///
/// Three families, which is three ways of varying one of those two:
///
/// - **Crossing.** The 2016 stripes, walked by the app's own dots. One, and
///   four abreast -- which on a zebra crossing is a photograph everybody
///   already knows. The only family that is neither drawing alone.
/// - **Ground.** One 2016 figure over ten grounds: the four the map itself
///   offers, each wearing the `ink` its own `Ground` already defines, and the
///   six accents pressed into service as grounds.
/// - **Walker.** Six 2016 figures over one ground: the accent is the figure and
///   it stands on `#1E1E1E`, which is what a pedestrian *is* here -- a
///   goal-coloured shape on the ground the crowd walks.
///
/// This table is the single source for both the generator that renders the
/// `.icon` bundles (`swift run walky-icons`) and the picker that offers them,
/// so the settings sheet cannot list an icon that was never drawn.
public struct AppIcon: Identifiable, Sendable, Equatable {
  /// What `setAlternateIconName` wants, and the base name of the `.icon`
  /// document it is compiled from. Nil is the icon the app ships with.
  public let name: String?
  public let label: String
  public let family: AppIconFamily
  /// What is painted on it and in it. Nil for the primary, which this
  /// generator does not draw.
  public let paint: IconPaint?
  /// What is drawn. Ground and ink stopped being enough to say once the
  /// crossing family arrived.
  public let drawing: IconDrawing

  public var id: String { name ?? "primary" }

  /// The flattened PNG the picker draws. A compiled `.icon` is not reachable as
  /// an image at runtime, so the previews are rendered beside the bundles --
  /// from the bundles' own layers, so a preview cannot show something the icon
  /// is not.
  public var preview: String { "Preview-\(name ?? "Walky")" }

  public static func == (a: AppIcon, b: AppIcon) -> Bool { a.id == b.id }
}

/// Which way the pair varies. The picker groups by this.
public enum AppIconFamily: String, CaseIterable, Sendable {
  case walky, crossing, ground, walker

  public var label: String {
    switch self {
    case .walky: "Walky"
    case .crossing: "Crossing"
    case .ground: "Ground"
    case .walker: "Walker"
    }
  }
}

public struct IconPaint: Sendable {
  public let ground: RGB
  public let ink: RGB
}

/// Which drawing an icon is.
public enum IconDrawing: Sendable {
  /// The three walkers the app ships with. Hand-authored, not rendered here.
  case walky
  /// The 2016 figure over its own three stripes.
  case silhouette
  /// Those stripes, walked by this many pedestrians in these colours.
  case crossing(dots: [RGB])
}

public enum AppIcons {
  /// The palette owns exactly two inks -- the two ends of the Paper ground, the
  /// darkest and the palest things the theme makes -- and an accent used as a
  /// ground has to take one of them.
  static let inks: [RGB] = [Grounds.paper.ink, Grounds.paper.background]

  /// Measured, not chosen. The dark ink wins on orange, lime, teal and sky; on
  /// magenta and rust it scores 3.4 and 3.7 and the pale one wins instead. An
  /// eye would have got magenta wrong.
  static func ink(on ground: RGB) -> RGB {
    inks.max { contrastRatio($0, ground) < contrastRatio($1, ground) }!
  }

  /// Three pedestrians in glass. Not the 2016 drawing, and not generated here.
  public static let primary = AppIcon(
    name: nil, label: "Walky", family: .walky, paint: nil, drawing: .walky)

  /// The app's own mark, standing on the 2016 art's own crossing.
  ///
  /// One is the mark at the size the browser tab gets it -- `tools/appIcons.ts`
  /// draws a lone pedestrian there because a cluster silts up small. Four is
  /// the crowd version, and four abreast on a zebra crossing is a photograph
  /// everybody already knows; they wear the first four accents in order.
  public static let crossings: [AppIcon] = [
    AppIcon(name: "Cross-One", label: "One", family: .crossing,
            paint: IconPaint(ground: Grounds.classic.background,
                             ink: Grounds.classic.ink),
            drawing: .crossing(dots: [Accents.magenta.color])),
    AppIcon(name: "Cross-Four", label: "Four", family: .crossing,
            paint: IconPaint(ground: Grounds.classic.background,
                             ink: Grounds.classic.ink),
            drawing: .crossing(dots: Accents.all.prefix(4).map(\.color))),
  ]

  public static let grounds: [AppIcon] =
    Grounds.all.map {
      AppIcon(name: "Ground-\($0.label)", label: $0.label, family: .ground,
              paint: IconPaint(ground: $0.background, ink: $0.ink),
              drawing: .silhouette)
    }
    + Accents.all.map {
      AppIcon(name: "Ground-\($0.label)", label: $0.label, family: .ground,
              paint: IconPaint(ground: $0.color, ink: ink(on: $0.color)),
              drawing: .silhouette)
    }

  public static let walkers: [AppIcon] = Accents.all.map {
    AppIcon(name: "Walker-\($0.label)", label: $0.label, family: .walker,
            paint: IconPaint(ground: Grounds.classic.background, ink: $0.color),
            drawing: .silhouette)
  }

  /// What `--alternate-app-icon` is given, and what the generator draws.
  public static let alternates: [AppIcon] = crossings + grounds + walkers

  /// What the picker offers, the shipping icon first.
  public static let all: [AppIcon] = [primary] + alternates

  public static func named(_ name: String?) -> AppIcon {
    all.first { $0.name == name } ?? primary
  }
}
