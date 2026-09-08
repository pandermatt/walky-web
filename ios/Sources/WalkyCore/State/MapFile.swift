import Foundation

/// A map as a file: the `.walky` document.
///
/// The same bytes a share link carries, without the base64 a URL forces on
/// them: `[magic, version, flags]` and then the body, deflated when that comes
/// out smaller. So a file and a link are the same format at heart, and both go
/// through `Codec` -- which is what makes a `.walky` file openable by the web
/// app, whose codec is the one this was ported from.
///
/// Base64 is the only thing a link adds. It costs a third of the size and buys
/// nothing on disk, so `ShareLink` is now this plus that.
public enum MapFile {
  public static let fileExtension = "walky"
  /// The uniform type identifier declared in `project.yml`. Exported rather
  /// than imported: this app is where the type comes from.
  public static let contentType = "ch.pandermatt.walky.map"

  /// The same ceiling `ShareLink` holds a link to, and for the same reason: a
  /// deflate stream is the one step that can turn a small input into a large
  /// output, so a cap on counts is worth nothing without a cap on the bytes
  /// those counts are read from.
  public static let maxBodyBytes = ShareLink.maxBodyBytes

  /// A map, ready to write.
  public static func bytes(_ core: ScenarioCore) -> [UInt8] {
    let raw = Codec.encode(core)
    let body = Codec.encodeBody(core)
    guard let deflated = ShareLink.deflate(body), deflated.count + 3 < raw.count else {
      // Compression is an optimisation, and failing at it is not a reason to
      // fail at saving.
      return raw
    }
    return Codec.header(flags: Codec.FLAG_DEFLATED | Codec.bodyFlags(core)) + deflated
  }

  public static func data(_ core: ScenarioCore) -> Data {
    Data(bytes(core))
  }

  /// A file back into a map.
  ///
  /// Every failure is a thrown `ScenarioLinkError` carrying a sentence fit to
  /// show somebody: a file picked out of Files is untrusted input in exactly
  /// the way a pasted link is, and "not a Walky map" and "saved by a newer
  /// Walky" are different things to be told.
  public static func read(_ bytes: [UInt8]) throws -> ScenarioCore {
    let (flags, body) = try Codec.readHeader(bytes)
    if flags & Codec.FLAG_DEFLATED == 0 {
      guard body.count <= maxBodyBytes else {
        throw ScenarioLinkError("that map is larger than Walky can hold")
      }
      return try Codec.decodeBody(body, flags: flags)
    }
    guard let inflated = ShareLink.inflate(body, limit: maxBodyBytes) else {
      throw ScenarioLinkError.truncated
    }
    return try Codec.decodeBody(inflated, flags: flags)
  }

  public static func read(_ data: Data) throws -> ScenarioCore {
    try read([UInt8](data))
  }

  /// What to call the file, from what is on the map.
  ///
  /// A name rather than a timestamp: the save sheet puts this in an editable
  /// field, so it should be the thing somebody would have typed, and "Walky
  /// map" is what they would have to delete first.
  public static func suggestedName(walls: Int, pedestrians: Int) -> String {
    if walls == 0 && pedestrians == 0 { return "Empty map" }
    let shapes = "\(walls) \(walls == 1 ? "wall" : "walls")"
    if pedestrians == 0 { return shapes }
    return "\(shapes), \(pedestrians) \(pedestrians == 1 ? "pedestrian" : "pedestrians")"
  }
}
