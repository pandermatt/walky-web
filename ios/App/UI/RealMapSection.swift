import SwiftUI
import WalkyCore
import WalkyGeo

/// Put the crowd somewhere real.
///
/// One explicit import rather than a layer that follows the camera: the
/// navigation graph is rebuilt from scratch whenever the walls change, and it
/// is superquadratic in their corners, so footprints streaming in on every pan
/// would be a rebuild on every pan. This asks once.
struct RealMapSection: View {
  let world: WalkyWorld
  let basemap: Basemap
  @Bindable var importer: MapImporter
  let dark: Bool

  var body: some View {
    Section {
      HStack {
        TextField("Place or address", text: $importer.query)
          .textInputAutocapitalization(.words)
          .autocorrectionDisabled()
          .submitLabel(.go)
          .onSubmit(run)
        if importer.isBusy {
          ProgressView()
        } else {
          Button("Import", action: run)
            .disabled(importer.query.trimmingCharacters(in: .whitespaces).isEmpty)
        }
      }

      LabeledContent("Area") {
        Text("\(Int(importer.sideMetres)) m across")
          .foregroundStyle(.secondary)
      }
      Slider(value: $importer.sideMetres, in: 120...600, step: 20)

      switch importer.phase {
      case .idle:
        EmptyView()
      case .searching:
        Text("Finding the place…").font(.footnote).foregroundStyle(.secondary)
      case .fetching:
        Text("Asking OpenStreetMap for its buildings…")
          .font(.footnote).foregroundStyle(.secondary)
      case .done(let what):
        Text(what).font(.footnote).foregroundStyle(.secondary)
      case .failed(let why):
        Text(why).font(.footnote).foregroundStyle(.red)
      }
    } header: {
      Text("Real map")
    } footer: {
      // Say where each half comes from. Apple has no building outline to give
      // -- no MapKit or Maps Server API returns one -- so the ground is
      // Apple's and the walls are OpenStreetMap's, and both want crediting.
      //
      // Two lines like every other footer in this sheet, but shortened around
      // the credit rather than through it: "© OpenStreetMap contributors" is
      // the wording the ODbL guidelines ask for, so it got more canonical on
      // the way down, not less.
      Text("© OpenStreetMap contributors (ODbL); ground by Apple. Importing "
         + "replaces your map.")
    }
  }

  private func run() {
    importer.importPlace(into: world, basemap: basemap, dark: dark)
  }
}
