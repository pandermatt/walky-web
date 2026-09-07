/// Renders the alternate app icons, and the previews the picker draws.
///
///     swift run walky-icons
///
/// Committed output, run by hand: regenerating an app icon is a decision, the
/// same way `tools/appIcons.ts` is not part of `npm run build`.
///
/// `Icons/walky-2016.png` is `src/main/resources/images/icon.png` from the
/// archived Java app, copied here rather than reached for across repositories:
/// that repo is not a dependency of this one and a clone has to be able to
/// build. It is 209x277 of black-on-transparent grayscale -- a walking figure
/// over three receding crosswalk stripes -- and it is the app's own first icon.
/// What varies between the sixteen alternates is only the pair of colours it is
/// painted with; `AppIcons.all` is that table and it derives every value from
/// `Grounds` and `Accents`.
///
/// Why `.icon` documents rather than the loose PNGs at the bundle root that
/// every guide to alternate icons describes: a flat image cannot be Liquid
/// Glass. Handed a `.icon`, the system composites the layers itself and gives
/// them specular highlights, parallax, and the dark and tinted variants. actool
/// takes one for `--alternate-app-icon` as readily as for `--app-icon` -- it
/// writes `CFBundleAlternateIcons` entries carrying `CFBundleIconName` and no
/// `CFBundleIconFiles`, because the art is in Assets.car -- which is why
/// project.yml declares no icon dictionaries of its own.
///
/// Two layers rather than one, and the split is exact rather than a guessed
/// crop: the silhouette is five connected components, and the three lowest are
/// the crossing. Stripes behind and figure in front is what gives them parallax
/// against each other under glass.
///
/// Needs ImageMagick (`magick`) and, for the primary's SVG layers, librsvg
/// (`rsvg-convert`) -- the same two the web app's icon tools already want.
import Foundation
import WalkyCore

// MARK: - Where things are

/// Beside the package rather than in a bundle: this runs under plain SwiftPM.
let ios = URL(fileURLWithPath: #filePath)
  .deletingLastPathComponent()   // WalkyIcons
  .deletingLastPathComponent()   // Sources
  .deletingLastPathComponent()   // ios
let source = ios.appending(path: "Icons/walky-2016.png")
let app = ios.appending(path: "App")
let previewDir = app.appending(path: "IconPreviews")

/// Icon Composer works on a 1024 canvas.
let canvas = 1024
/// The figure's height on it. The same 68% inset the flat icons used, and close
/// to the 704 the three walkers of `Walky.icon` span, so the alternates are the
/// same size of object as the icon they sit beside.
let art = 700

// MARK: - Shelling out

@discardableResult
func run(_ tool: String, _ args: [String]) -> String {
  let task = Process()
  task.executableURL = URL(fileURLWithPath: "/usr/bin/env")
  task.arguments = [tool] + args
  let pipe = Pipe()
  task.standardOutput = pipe
  do { try task.run() } catch {
    fail("cannot run \(tool): \(error.localizedDescription)")
  }
  let out = pipe.fileHandleForReading.readDataToEndOfFile()
  task.waitUntilExit()
  guard task.terminationStatus == 0 else {
    fail("\(tool) \(args.joined(separator: " ")) exited \(task.terminationStatus)")
  }
  return String(decoding: out, as: UTF8.self)
}

/// The same, when what comes back is pixels rather than text.
func runData(_ tool: String, _ args: [String]) -> Data {
  let task = Process()
  task.executableURL = URL(fileURLWithPath: "/usr/bin/env")
  task.arguments = [tool] + args
  let pipe = Pipe()
  task.standardOutput = pipe
  do { try task.run() } catch {
    fail("cannot run \(tool): \(error.localizedDescription)")
  }
  let out = pipe.fileHandleForReading.readDataToEndOfFile()
  task.waitUntilExit()
  guard task.terminationStatus == 0 else {
    fail("\(tool) \(args.joined(separator: " ")) exited \(task.terminationStatus)")
  }
  return out
}

func fail(_ message: String) -> Never {
  FileHandle.standardError.write(Data("walky-icons: \(message)\n".utf8))
  exit(1)
}

func hex(_ c: RGB) -> String { toHex(c) }

func write(_ text: String, to file: URL, what: String) {
  do { try text.write(to: file, atomically: true, encoding: .utf8) } catch {
    fail("cannot write \(what)/\(file.lastPathComponent): \(error.localizedDescription)")
  }
}

// MARK: - Splitting the drawing

/// One blob of the silhouette: its label, and where its bounding box starts.
struct Blob {
  let id: Int
  let top: Int
}

/// A box in canvas coordinates, which is where the dots have to be placed.
struct Box {
  let minX: Double, minY: Double, maxX: Double, maxY: Double
  var midX: Double { (minX + maxX) / 2 }
  var midY: Double { (minY + maxY) / 2 }
  var width: Double { maxX - minX }
  var height: Double { maxY - minY }
}

/// The five shapes, found rather than assumed.
///
/// `-connected-components` labels them and prints a bounding box apiece; the
/// three stripes sit far below the figure, so sorting by top edge separates
/// them and the gap between the second and the third is the check that it did.
func blobs() -> (figure: [Int], stripes: [Int]) {
  let report = run("magick", [source.path,
    "-alpha", "extract", "-threshold", "50%",
    "-define", "connected-components:verbose=true",
    "-define", "connected-components:area-threshold=20",
    "-connected-components", "8", "null:"])

  var found: [Blob] = []
  for line in report.split(separator: "\n") {
    // "  2: 136x187+35+47 95.6,129.8 11262 gray(255)" -- gray(0) is the ground.
    let parts = line.split(separator: " ").map(String.init)
    guard parts.count >= 5, parts.last == "gray(255)",
          let id = Int(parts[0].dropLast()) else { continue }
    // "136x187+35+47" -- only the top edge matters, and only for sorting.
    guard let top = Int(parts[1].split(separator: "+").last ?? "") else { continue }
    found.append(Blob(id: id, top: top))
  }

  let sorted = found.sorted { $0.top < $1.top }
  guard sorted.count == 5 else {
    fail("expected 5 shapes in \(source.lastPathComponent), found \(sorted.count)")
  }
  // Head at 2, body at 47, then the stripes at 186. Anything less than a clear
  // gap means the drawing changed and this split is no longer the right one.
  let gap = sorted[2].top - sorted[1].top
  guard gap > 100 else {
    fail("figure and stripes are only \(gap)px apart -- the split is a guess now")
  }
  return (sorted.prefix(2).map(\.id), sorted.suffix(3).map(\.id))
}

// MARK: - Drawing a layer

/// The named shapes, in one colour, on a transparent 1024 canvas.
///
/// Both layers are resized from the full 209x277 frame rather than from their
/// own trimmed bounds, which is what keeps the figure standing on the stripes
/// instead of beside them.
func layer(_ ids: [Int], _ ink: RGB, to file: URL) {
  run("magick", [source.path,
    "-alpha", "extract", "-threshold", "50%",
    "-define", "connected-components:keep=\(ids.map(String.init).joined(separator: ","))",
    "-connected-components", "8",
    // The labelled output paints object *ids*, so every shape is all but black
    // until this makes it a mask again.
    "-threshold", "0",
    "-colorspace", "sRGB", "-filter", "Lanczos", "-resize", "x\(art)",
    // The source is a raster and stays one -- tracing it would make the
    // provenance above untrue -- so the edge is left antialiased rather than
    // re-thresholded after the 2.5x upscale.
    "-alpha", "copy", "-channel", "RGB", "-fill", hex(ink), "-colorize", "100", "+channel",
    "-background", "none", "-gravity", "center", "-extent", "\(canvas)x\(canvas)",
    file.path])
}

// MARK: - Repairing the crossing

let sourceWidth = 209, sourceHeight = 277

/// Each stripe as a convex polygon, in source pixels.
///
/// The three stripes in `walky-2016.png` are bitten into: the figure's feet are
/// knocked out of the outer two, which is right while the figure is standing
/// there and wrong the moment it is replaced by dots. Every stripe is a
/// trapezoid, so its convex hull *is* the stripe as it was drawn before the
/// feet were taken out of it -- and the hull is `monotoneChainHull`, the one
/// the simulation already wraps walls with.
func stripeHulls(_ ids: [Int]) -> [[Point]] {
  ids.map { id in
    let raw = runData("magick", [source.path,
      "-alpha", "extract", "-threshold", "50%",
      "-define", "connected-components:keep=\(id)", "-connected-components", "8",
      "-threshold", "0", "-depth", "8", "gray:-"])
    guard raw.count == sourceWidth * sourceHeight else {
      fail("expected \(sourceWidth * sourceHeight) pixels for stripe \(id), got \(raw.count)")
    }
    var points: [Point] = []
    for (i, value) in raw.enumerated() where value > 0 {
      // The far corner of the pixel as well as its origin, so the hull covers
      // the pixel rather than stopping at its centre.
      let x = Double(i % sourceWidth), y = Double(i / sourceWidth)
      points.append(Point(x, y))
      points.append(Point(x + 1, y + 1))
    }
    let hull = monotoneChainHull(points)
    guard hull.count >= 3 else { fail("stripe \(id) hulled to \(hull.count) points") }
    return hull
  }
}

/// A stripe as the clean trapezoid it is, continued until it leaves the canvas.
///
/// The crossing in `walky-2016.png` runs out of its own frame: the stripes stop
/// 2px from the bottom edge, which is how a drawing says a road carries on
/// toward you. Reframed into open space that flush end stops reading as
/// perspective and starts reading as a cut, so the sides are continued the way
/// they were going. Top and bottom width give the taper; everything past the
/// frame is the line the artist was already drawing.
func trapezoid(_ hull: [Point], downTo target: Double) -> [Point] {
  let top = hull.map(\.y).min() ?? 0, bottom = hull.map(\.y).max() ?? 1
  func edges(near y: Double) -> (left: Double, right: Double) {
    let row = hull.filter { abs($0.y - y) < 1.5 }.map(\.x)
    return (row.min() ?? 0, row.max() ?? 0)
  }
  let up = edges(near: top), down = edges(near: bottom)
  // How far the target is past the bottom, as a fraction of the stripe's own
  // height -- so each side keeps its own slope.
  let beyond = (target - bottom) / (bottom - top)
  return [
    Point(up.left, top), Point(up.right, top),
    Point(down.right + (down.right - up.right) * beyond, target),
    Point(down.left + (down.left - up.left) * beyond, target),
  ]
}

/// Maps source pixels onto the 1024 canvas.
///
/// The crossing family reframes rather than reusing the silhouette's placement:
/// with the figure gone, the stripes are a small object low in an empty tile,
/// so they are scaled to most of the width and set below centre with the dots
/// standing on them.
struct Frame {
  let scale: Double, dx: Double, dy: Double

  /// Fit the crossing to a width and stand it on a line.
  ///
  /// Anchored by its bottom rather than centred: a crossing is ground, and
  /// ground belongs at the bottom of the tile with the far end receding up it.
  init(fitting boxes: [[Point]], toWidth width: Double, bottom: Double) {
    let xs = boxes.flatMap { $0.map(\.x) }, ys = boxes.flatMap { $0.map(\.y) }
    let minX = xs.min() ?? 0, maxX = xs.max() ?? 1
    let maxY = ys.max() ?? 1
    scale = width / (maxX - minX)
    dx = Double(canvas) / 2 - (minX + maxX) / 2 * scale
    dy = bottom - maxY * scale
  }

  func map(_ p: Point) -> Point { Point(p.x * scale + dx, p.y * scale + dy) }
  /// The source y that lands on a given canvas y -- how far the stripes have to
  /// be continued to leave the tile.
  func sourceY(of y: Double) -> Double { (y - dy) / scale }
  func box(_ hulls: [[Point]]) -> Box {
    let pts = hulls.flatMap { $0.map(map) }
    return Box(minX: pts.map(\.x).min() ?? 0, minY: pts.map(\.y).min() ?? 0,
               maxX: pts.map(\.x).max() ?? 0, maxY: pts.map(\.y).max() ?? 0)
  }
}

/// The crossing itself, as polygons rather than pixels -- crisp at 1024, and
/// the same material as the dots that stand on it.
func stripesSVG(_ hulls: [[Point]], ink: RGB, through frame: Frame) -> String {
  let polygons = hulls.map { hull in
    let points = hull.map(frame.map).map { "\(f($0.x)),\(f($0.y))" }.joined(separator: " ")
    return "  <polygon points=\"\(points)\" fill=\"rgb(\(ink.r),\(ink.g),\(ink.b))\"/>"
  }
  return svg(polygons.joined(separator: "\n"))
}

func svg(_ body: String) -> String {
  let open = "<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"\(canvas)\""
    + " height=\"\(canvas)\" viewBox=\"0 0 \(canvas) \(canvas)\">"
  return """
  \(open)
  \(body)
  </svg>

  """
}

// MARK: - Drawing the dots

/// One pedestrian, as `Walky.icon` draws one: a goal-coloured disc with a ring
/// round it, the ring in the ground's `ink` rather than white -- which is what
/// `MapRenderer` does, and for the same reason: a white ring disappears on the
/// Paper ground.
///
/// Opaque, where `Walky.icon`'s three walkers are at 0.78. That translucency is
/// right there and wrong here: it lets #1E1E1E through, which is what makes a
/// walker read as an object *in* the glass rather than a sticker on it. These
/// dots stand on white paint, and the system's own translucency is already
/// working on them, so a second helping of it left four coloured walkers
/// looking like four pale smudges on the home screen.
func dot(x: Double, y: Double, r: Double, fill: RGB, ink: RGB) -> String {
  // Walky.icon's own proportion: a 26.40 ring on a 171.11 radius.
  let ring = r * (26.40 / 171.11)
  return """
      <circle cx="\(f(x))" cy="\(f(y))" r="\(f(r))"
              fill="rgb(\(fill.r),\(fill.g),\(fill.b))"
              stroke="rgb(\(ink.r),\(ink.g),\(ink.b))" stroke-width="\(f(ring))"/>
  """
}

func f(_ v: Double) -> String { String(format: "%.2f", v) }

/// The dots, in file across the crossing.
///
/// They are laid against the stripes' own measured box, so they walk on the
/// crossing at whatever size it is: spread over most of its width, sitting on
/// its middle, and sized so four of them nearly touch -- which is the packing
/// `crowd()` uses in `tools/appIcons.ts`, where pedestrians crowd until they
/// meet. One alone is drawn larger, having nothing to crowd against.
func crossingSVG(dots: [RGB], ink: RGB, on band: Box) -> String {
  // Measured across the tile rather than across the band: the crossing runs off
  // both sides, so its own width is no longer something you can walk across.
  let spread = Double(canvas) * 0.62
  // They overlap, and that is the packing rather than a mistake: `crowd()` in
  // tools/appIcons.ts sets the three walkers close enough that their rings
  // cross, because pedestrians in the app crowd until they touch. Four spaced
  // apart read as beads on a wire at 60pt; four overlapping read as a group.
  // One alone has nothing to crowd against and is drawn to about a stripe wide.
  let r = dots.count == 1 ? spread * 0.26 : spread / Double(2 * (dots.count - 1)) * 1.28
  let step = dots.count == 1 ? 0 : spread / Double(dots.count - 1)
  let first = Double(canvas) / 2 - spread / 2
  // Centred on the crossing's far edge -- the one horizontal line the drawing
  // has, since the stripes recede and every other edge of them is slanted.
  // Sitting on it puts half of each walker over the paint and half over the
  // ground, which is where a line of people crossing a road actually is.
  let y = band.minY

  let circles = dots.enumerated().map { i, colour in
    dot(x: dots.count == 1 ? Double(canvas) / 2 : first + Double(i) * step,
        y: y, r: r, fill: colour, ink: ink)
  }
  return svg(circles.joined(separator: "\n"))
}

// MARK: - The bundle

/// Icon Composer's own schema, as `Walky.icon` states it: `extended-srgb`
/// components 0-1, one group per layer, `is-glass` on each.
func iconJSON(_ paint: IconPaint, layers: [(file: String, translucent: Bool)]) -> String {
  func component(_ v: Int) -> String { String(format: "%.5f", Double(v) / 255) }
  let fill = "extended-srgb:"
    + [paint.ground.r, paint.ground.g, paint.ground.b].map(component).joined(separator: ",")
    + ",1.00000"

  // Glass is per-layer; so is how much of the ground shows through it. The
  // crossing's dots turn translucency off: they sit on white paint, and letting
  // the tile through as well left them as pale smudges at 60pt.
  func group(_ layer: (file: String, translucent: Bool)) -> String {
    """
        {
          "layers": [
            {
              "image-name": "\(layer.file)",
              "name": "\(layer.file.split(separator: ".").first ?? "")",
              "is-glass": true
            }
          ],
          "shadow": {
            "kind": "neutral",
            "opacity": 0.5
          },
          "translucency": {
            "enabled": \(layer.translucent),
            "value": 0.5
          }
        }
    """
  }

  // Behind first, as Walky.icon lists the two trailing walkers before the lead.
  return """
  {
    "fill": {
      "automatic-gradient": "\(fill)"
    },
    "groups": [
  \(layers.map(group).joined(separator: ",\n"))
    ],
    "supported-platforms": {
      "circles": [
        "watchOS"
      ],
      "squares": [
        "iOS"
      ]
    }
  }

  """
}

// MARK: - Previews

/// A flat PNG of one bundle, drawn from that bundle's own layers over its own
/// fill, so the picker cannot show something the icon is not. Reads SVG layers
/// as happily as PNG ones, which is how the primary gets a preview too.
func preview(of bundle: URL, to file: URL) {
  struct Document: Decodable {
    struct Colour: Decodable {
      let gradient: String
      enum CodingKeys: String, CodingKey { case gradient = "automatic-gradient" }
    }
    struct Layer: Decodable {
      let image: String
      enum CodingKeys: String, CodingKey { case image = "image-name" }
    }
    struct Group: Decodable { let layers: [Layer] }
    let fill: Colour
    let groups: [Group]
  }
  guard let data = try? Data(contentsOf: bundle.appending(path: "icon.json")),
        let icon = try? JSONDecoder().decode(Document.self, from: data) else {
    fail("cannot read \(bundle.lastPathComponent)/icon.json")
  }

  // "extended-srgb:0.11765,0.11765,0.11765,1.00000"
  let numbers = icon.fill.gradient
    .split(separator: ":").last?
    .split(separator: ",").compactMap { Double($0) } ?? []
  guard numbers.count >= 3 else { fail("cannot read the fill of \(bundle.lastPathComponent)") }
  let ground = String(format: "#%02X%02X%02X",
                      Int((numbers[0] * 255).rounded()),
                      Int((numbers[1] * 255).rounded()),
                      Int((numbers[2] * 255).rounded()))

  // `-background none` before every layer, and it has to be before rather than
  // after: ImageMagick hands an SVG to its delegate on an opaque white ground
  // unless told otherwise, which paints out everything already composited.
  var args = ["-size", "\(canvas)x\(canvas)", "xc:\(ground)"]
  for group in icon.groups {
    for layer in group.layers {
      args += ["-background", "none",
               bundle.appending(path: "Assets/\(layer.image)").path,
               "-compose", "over", "-composite"]
    }
  }
  args += ["-resize", "192x192", file.path]
  run("magick", args)
}

// MARK: - Run

let (figure, stripes) = blobs()
let hulls = stripeHulls(stripes)
/// Most of the width, set below centre so the dots standing on the crossing
/// have somewhere to be.
/// Wider than the tile and standing just past its foot, so the crossing bleeds
/// off three edges and reads as ground rather than as an object placed on some.
let crossingFrame = Frame(fitting: hulls, toWidth: Double(canvas) * 1.20,
                          bottom: Double(canvas))
/// Past the bottom rather than at it, so the parallax the glass gives this
/// layer cannot slide the cut back into view.
let crossing = hulls.map { trapezoid($0, downTo: crossingFrame.sourceY(of: Double(canvas) * 1.06)) }
let fm = FileManager.default
try? fm.createDirectory(at: previewDir, withIntermediateDirectories: true)

for icon in AppIcons.alternates {
  guard let name = icon.name, let paint = icon.paint else { continue }
  let bundle = app.appending(path: "\(name).icon")
  let assets = bundle.appending(path: "Assets")
  try? fm.createDirectory(at: assets, withIntermediateDirectories: true)

  // The crossing goes behind whatever walks on it, and both families put it
  // there -- but only the silhouette wants it as pixels.
  var files: [(file: String, translucent: Bool)]

  switch icon.drawing {
  case .walky:
    continue
  case .silhouette:
    layer(stripes, paint.ink, to: assets.appending(path: "stripes.png"))
    layer(figure, paint.ink, to: assets.appending(path: "walker.png"))
    files = [("stripes.png", true), ("walker.png", true)]
  case .crossing(let dots):
    // Vector, not the raster stripes: this family reframes the crossing and
    // repairs the bites the figure's feet left in it.
    let band = crossingFrame.box(hulls)
    write(stripesSVG(crossing, ink: paint.ink, through: crossingFrame),
          to: assets.appending(path: "stripes.svg"), what: name)
    write(crossingSVG(dots: dots, ink: paint.ink, on: band),
          to: assets.appending(path: "walkers.svg"), what: name)
    files = [("stripes.svg", true), ("walkers.svg", false)]
  }

  write(iconJSON(paint, layers: files), to: bundle.appending(path: "icon.json"), what: name)
}

for icon in AppIcons.all {
  let bundle = app.appending(path: "\(icon.name ?? "Walky").icon")
  preview(of: bundle, to: previewDir.appending(path: "\(icon.preview).png"))
  let paint = icon.paint
  let ratio = paint.map { String(format: "%5.1f : 1", contrastRatio($0.ink, $0.ground)) }
  print("  \(icon.id.padding(toLength: 18, withPad: " ", startingAt: 0))"
        + "\(paint.map { hex($0.ink) } ?? "       ") on \(paint.map { hex($0.ground) } ?? "       ")"
        + "   \(ratio ?? "")")
}
print("\n\(AppIcons.alternates.count) alternates + the primary, previews in App/IconPreviews")
