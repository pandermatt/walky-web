import Foundation
@_exported import WalkySim

/// The two colour rules that define Walky's look, ported from the 2016 original.
/// Ports `src/palette.ts`.
///
/// Sources:
///   math/RandomGenerator.java:41   randomBrightColor()
///   java.awt.Color.darker()        the shadow
///   gui/PedestrianPanel.java:258   the background

/// Java's `Color.darker()`: multiply each channel by 0.7 and truncate toward zero.
public func javaDarker(_ c: RGB) -> RGB {
  (Int(jsMax(0, (Double(c.r) * 0.7).rounded(.towardZero))),
   Int(jsMax(0, (Double(c.g) * 0.7).rounded(.towardZero))),
   Int(jsMax(0, (Double(c.b) * 0.7).rounded(.towardZero))))
}

/// The wall shadow colour: `darker()` applied twice.
public func shadowOf(_ c: RGB) -> RGB { javaDarker(javaDarker(c)) }

/// `Color.DARK_GRAY.darker().darker()` = (64,64,64) -> (44,44,44) -> (30,30,30).
///
/// Derived rather than written down, so it cannot drift from the operation that
/// produced it. The background is #1E1E1E, not #1F1F1F, and this is why.
public let BACKGROUND: RGB = shadowOf((64, 64, 64))

/// Fixed palette entries the original used by name.
public let WHITE: RGB = (255, 255, 255)
public let BLUE: RGB = (0, 0, 255)
public let YELLOW: RGB = (255, 255, 0)
public let ORANGE: RGB = (255, 200, 0)
public let RED: RGB = (255, 0, 0)

/// `ThreadLocalRandom.nextInt(from, to + 1)` -- inclusive at both ends.
private func randomNumber(_ from: Int, _ to: Int) -> Int {
  from + Int.random(in: 0...(to - from))
}

/// A colour that is never dark: one channel picked at random is forced to
/// 150-255, the other two range freely over 0-255.
///
/// The original's javadoc claims "at least 1 RGB-Value is > 150" but the code
/// says randomNumber(150, 255), so 150 itself is reachable. Kept as the code has it.
///
/// This is the one genuinely non-deterministic thing in the whole port, and it
/// is deliberately confined here: `Agents.add` and `resetPositions` take a
/// colour rather than reaching for this, so nothing in `WalkySim` can pick up
/// randomness by accident.
public func randomBrightColor() -> RGB {
  let bright = randomNumber(1, 3)
  return (bright == 1 ? randomNumber(150, 255) : randomNumber(0, 255),
          bright == 2 ? randomNumber(150, 255) : randomNumber(0, 255),
          bright == 3 ? randomNumber(150, 255) : randomNumber(0, 255))
}

public func toHex(_ c: RGB) -> String {
  String(format: "#%02X%02X%02X", c.r, c.g, c.b)
}

/// WCAG relative luminance.
public func relativeLuminance(_ c: RGB) -> Double {
  func channel(_ v: Int) -> Double {
    let s = Double(v) / 255
    return s <= 0.04045 ? s / 12.92 : jsPow((s + 0.055) / 1.055, 2.4)
  }
  return 0.2126 * channel(c.r) + 0.7152 * channel(c.g) + 0.0722 * channel(c.b)
}

/// WCAG contrast ratio, 1 to 21.
///
/// Here so that the claim "the accent is readable" is a thing the tests check
/// rather than a thing a comment asserts: the accent is derived by an operation
/// (see `shadowOf`), and an operation's output has to be measured, not trusted.
public func contrastRatio(_ a: RGB, _ b: RGB) -> Double {
  let la = relativeLuminance(a)
  let lb = relativeLuminance(b)
  return (jsMax(la, lb) + 0.05) / (jsMin(la, lb) + 0.05)
}
