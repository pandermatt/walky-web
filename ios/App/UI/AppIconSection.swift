import SwiftUI
import UIKit
import WalkyCore

/// The Settings section that changes which icon the app wears.
///
/// What there is to choose from is `AppIcons.all` in WalkyCore, which is also
/// what `swift run walky-icons` renders -- one table, so this cannot offer an
/// icon that was never drawn. Nineteen of them, which is why they are tiles in
/// a grid rather than rows in a list: at that length you pick an icon by
/// looking at it, and a list of nineteen is a scroll with the answer somewhere
/// in it.
///
/// Nothing here is persisted by us: iOS remembers the choice across launches
/// and `alternateIconName` is the truth, so storing a copy could only ever go
/// out of sync with the home screen.
struct AppIconSection: View {
  /// The tick's colour, so it follows the accent like the ground rows do.
  let accent: RGB

  @State private var current: String? = UIApplication.shared.alternateIconName
  @State private var failure: String?

  /// Wide enough for a 64pt tile and its name, and it is `.adaptive` so the
  /// row count follows the sheet rather than a number typed in here -- four
  /// across on a phone, more on an iPad.
  private let columns = [GridItem(.adaptive(minimum: 68), spacing: 10)]

  var body: some View {
    // Absent rather than disabled where it cannot work -- notably a Mac
    // running this as a "Designed for iPad" app, where the icon is the Mac's.
    if UIApplication.shared.supportsAlternateIcons {
      Section {
        ForEach(AppIconFamily.allCases, id: \.self) { family in
          let icons = AppIcons.all.filter { $0.family == family }
          if !icons.isEmpty {
            VStack(alignment: .leading, spacing: 8) {
              Text(family.label)
                .font(.caption).fontWeight(.semibold)
                .foregroundStyle(.secondary)
              LazyVGrid(columns: columns, spacing: 12) {
                ForEach(icons) { tile($0) }
              }
            }
            .padding(.vertical, 4)
          }
        }
      } header: {
        Text("App icon")
      } footer: {
        Text(failure ?? Self.footer)
      }
    }
  }

  private func tile(_ icon: AppIcon) -> some View {
    let chosen = current == icon.name
    return Button {
      choose(icon)
    } label: {
      VStack(spacing: 5) {
        thumbnail(icon, chosen: chosen)
        Text(icon.label)
          .font(.caption2)
          .foregroundStyle(chosen ? .primary : .secondary)
          .lineLimit(1)
      }
      // A `.plain` Button hit-tests against its label's drawn content, and a
      // tile is mostly padding.
      .contentShape(Rectangle())
    }
    .buttonStyle(.plain)
  }

  private func thumbnail(_ icon: AppIcon, chosen: Bool) -> some View {
    let art = UIImage(named: icon.preview)
    let shape = RoundedRectangle(cornerRadius: 14, style: .continuous)
    return Group {
      if let art { Image(uiImage: art).resizable() } else { Color.secondary.opacity(0.2) }
    }
    .frame(width: 64, height: 64)
    .clipShape(shape)
    .overlay(shape.strokeBorder(.primary.opacity(0.15)))
    // The tick sits on the icon rather than beside it: in a grid there is no
    // "beside", and the corner is the one place no artwork reaches.
    .overlay(alignment: .bottomTrailing) {
      if chosen {
        Image(systemName: "checkmark.circle.fill")
          .font(.body)
          .symbolRenderingMode(.palette)
          .foregroundStyle(.white, MapRenderer.color(accent))
          .padding(2)
      }
    }
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
    "Crossing uses the 2016 icon's crosswalk; Ground and Walker, its walking "
    + "figure."
}
