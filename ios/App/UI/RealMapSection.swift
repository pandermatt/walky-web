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
        if !importer.isBusy {
          Button("Import", action: run)
            .disabled(importer.query.trimmingCharacters(in: .whitespaces).isEmpty)
        }
      }

      if importer.isBusy {
        // Determinate where the work can be counted, indeterminate where it
        // cannot -- `MapImporter.fraction` says which is which, and the nil it
        // returns for the rebuild is this initialiser's own indeterminate form.
        ProgressView(value: importer.progress, total: 1)
          .progressViewStyle(.linear)
      }

      LabeledContent("Area") {
        Text("\(Int(importer.sideMetres)) m across")
          .foregroundStyle(.secondary)
      }
      Slider(value: $importer.sideMetres, in: 120...600, step: 20)
        // Dragging it mid-import changed the basemap's crop without changing
        // the buildings under it.
        .disabled(importer.isBusy)

      switch importer.phase {
      case .idle:
        EmptyView()
      case .searching:
        Text("Finding the place…").font(.footnote).foregroundStyle(.secondary)
      case .fetching:
        Text("Asking OpenStreetMap for its buildings…")
          .font(.footnote).foregroundStyle(.secondary)
      case .merging:
        Text("Merging what overlaps…").font(.footnote).foregroundStyle(.secondary)
      case .placing:
        Text("Placing the buildings…").font(.footnote).foregroundStyle(.secondary)
      case .routing:
        Text("Building the navigation graph…").font(.footnote).foregroundStyle(.secondary)
      case .done(let what):
        Text(what).font(.footnote).foregroundStyle(.secondary)
      case .failed(let why):
        Text(why).font(.footnote).foregroundStyle(.red)
      case .refused(let why, let ready):
        // Not `.failed`: the buildings are already here. Overpass is a free
        // service on a fair-use policy, so the one thing this must not do is
        // ask it again for an answer it has already given.
        Text(why).font(.footnote).foregroundStyle(.red)
        Button("Import \(ready.corners) corners anyway") {
          importer.importAnyway(ready, into: world, basemap: basemap, dark: dark)
        }
        .font(.footnote)
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
