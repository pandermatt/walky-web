import SwiftUI
import UIKit
import WalkyCore

/// One of the icons the app can wear.
///
/// The three alternates are all the same drawing: `icon.png` from the 2016 Java
/// app, a walking figure over three receding crosswalk stripes, which was
/// Walky's first icon and is the only artwork that survived the rewrite. It is
/// a silhouette, so what changes between them is the ground behind it -- and
/// the three grounds are the app's own colours rather than new ones. See
/// `Icons/generate.sh`.
struct AppIcon: Identifiable, Equatable {
  /// What `setAlternateIconName` wants; nil is the icon the app ships with.
  let name: String?
  let label: String
  let note: String
  /// The bundle image for the row's thumbnail. The primary's is the PNG actool
  /// writes out of `Walky.icon` -- which is why it is not called AltIcon-.
  let preview: String

  var id: String { name ?? "primary" }

  static let all: [AppIcon] = [
    AppIcon(name: nil, label: "Walky", note: "Three walkers", preview: "Walky60x60"),
    AppIcon(name: "Classic", label: "Classic", note: "2016, on paper", preview: "AltIcon-Classic"),
    AppIcon(name: "Night", label: "Night", note: "2016, on the ground", preview: "AltIcon-Night"),
    AppIcon(name: "Amber", label: "Amber", note: "2016, on orange", preview: "AltIcon-Amber"),
  ]
}

/// The Settings section that changes it.
///
/// Nothing here is persisted by us: iOS remembers the choice across launches
/// and `alternateIconName` is the truth, so storing a copy could only ever go
/// out of sync with the home screen.
struct AppIconSection: View {
  /// The tick's colour, so it follows the accent like the ground rows do.
  let accent: RGB

  @State private var current: String? = UIApplication.shared.alternateIconName
  @State private var failure: String?

  var body: some View {
    // Absent rather than disabled where it cannot work -- notably a Mac
    // running this as a "Designed for iPad" app, where the icon is the Mac's.
    if UIApplication.shared.supportsAlternateIcons {
      Section {
        ForEach(AppIcon.all) { row($0) }
      } header: {
        Text("App icon")
      } footer: {
        Text(failure ?? Self.footer)
      }
    }
  }

  private func row(_ icon: AppIcon) -> some View {
    let chosen = current == icon.name
    return Button {
      choose(icon)
    } label: {
      HStack(spacing: 12) {
        thumbnail(icon)
        VStack(alignment: .leading, spacing: 1) {
          Text(icon.label).foregroundStyle(.primary)
          Text(icon.note).font(.caption).foregroundStyle(.secondary)
        }
        Spacer()
        if chosen {
          Image(systemName: "checkmark")
            .font(.body.weight(.semibold))
            .foregroundStyle(MapRenderer.color(accent))
        }
      }
      // A `.plain` Button hit-tests against its label's drawn content, and a
      // row that is mostly Spacer has almost none.
      .contentShape(Rectangle())
    }
    .buttonStyle(.plain)
  }

  private func thumbnail(_ icon: AppIcon) -> some View {
    let art = UIImage(named: icon.preview)
    return Group {
      if let art { Image(uiImage: art).resizable() } else { Color.secondary.opacity(0.2) }
    }
    .frame(width: 42, height: 42)
    .clipShape(RoundedRectangle(cornerRadius: 9.5, style: .continuous))
    .overlay(RoundedRectangle(cornerRadius: 9.5, style: .continuous)
      .strokeBorder(.primary.opacity(0.15)))
  }

  /// The async form on purpose: the completion-handler one calls back on no
  /// particular queue, and `current` belongs to the main actor.
  private func choose(_ icon: AppIcon) {
    guard current != icon.name else { return }
    Task {
      do {
        try await UIApplication.shared.setAlternateIconName(icon.name)
        current = icon.name
        failure = nil
      } catch {
        failure = error.localizedDescription
      }
    }
  }

  private static let footer: String =
    "All three alternates are the 2016 app's own icon, on three of the colours "
    + "this one already uses. iOS says so itself when you switch."
}
