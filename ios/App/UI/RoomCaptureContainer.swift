import RoomPlan
import SwiftUI
import UIKit

/// Apple's own scanning UI, in a sheet.
///
/// The project's second `UIViewRepresentable` after `TouchCanvas`, and shaped
/// like it: nothing in here but translation. `RoomCaptureView` brings its own
/// coaching overlay and its own live floor plan, which is a much better scanning
/// experience than anything worth building, and the only decisions left are when
/// to start, when to stop, and what to do with the answer.
///
/// A sheet rather than a `fullScreenCover`, deliberately: `RootView` keys
/// `model.isCovered` on its one `.sheet(item:)`, and that flag is what stops the
/// map redrawing at 60Hz behind something nobody can see through. A capture view
/// is the last thing that should be competing with the crowd for a main thread.
struct RoomCaptureContainer: View {
  let scanner: RoomScanner
  @Environment(\.dismiss) private var dismiss

  /// Set once the walk is done and RoomPlan is thinking, so the button cannot
  /// be pressed twice.
  @State private var finishing = false

  var body: some View {
    NavigationStack {
      RoomCaptureViewBridge(scanner: scanner, finishing: $finishing)
      .ignoresSafeArea(edges: .bottom)
      // The sheet closes because the scan finished, which is a fact about the
      // scanner rather than a callback the delegate has to carry back through
      // two isolation domains. `.ready` is a room in hand; `.failed` has
      // already put the reason in the settings section behind this.
      .onChange(of: scanner.phase) { _, now in
        switch now {
        case .ready, .failed: dismiss()
        default: break
        }
      }
      .navigationTitle(finishing ? "Building the plan…" : "Scan the room")
      .navigationBarTitleDisplayMode(.inline)
      .toolbar {
        ToolbarItem(placement: .cancellationAction) {
          Button("Cancel") {
            scanner.cancelScan()
            dismiss()
          }
          .disabled(finishing)
        }
        ToolbarItem(placement: .confirmationAction) {
          Button("Done") { finishing = true }
            .disabled(finishing)
        }
      }
      .interactiveDismissDisabled(finishing)
    }
  }
}

struct RoomCaptureViewBridge: UIViewRepresentable {
  let scanner: RoomScanner
  @Binding var finishing: Bool

  func makeUIView(context: Context) -> RoomCaptureView {
    let view = RoomCaptureView(frame: .zero)
    view.delegate = context.coordinator
    view.captureSession.run(configuration: RoomCaptureSession.Configuration())
    return view
  }

  func updateUIView(_ view: RoomCaptureView, context: Context) {
    // The one piece of state that has to cross: pressing Done stops the
    // session, and the answer arrives at the delegate a moment later.
    if finishing && !context.coordinator.stopped {
      context.coordinator.stopped = true
      view.captureSession.stop()
    }
  }

  func makeCoordinator() -> RoomCaptureCoordinator {
    RoomCaptureCoordinator(scanner: scanner)
  }
}

/// Two methods, and the second is the one that matters: `didPresent` carries the
/// finished `CapturedRoom`, which is the whole point of using `RoomCaptureView`
/// rather than driving `RoomBuilder` by hand.
///
/// Top-level rather than nested inside the representable, which is where a
/// SwiftUI coordinator usually goes: `RoomCaptureViewDelegate` inherits
/// `NSCoding`, so this is an archivable Objective-C class, and a nested one has
/// no stable name to archive under. It is never archived -- the two `NSCoding`
/// members below are the honest statement of that -- but the compiler is right
/// to insist the name be a name.
final class RoomCaptureCoordinator: NSObject, RoomCaptureViewDelegate {
  private let scanner: RoomScanner
  var stopped = false

  init(scanner: RoomScanner) { self.scanner = scanner }

  func captureView(shouldPresent data: CapturedRoomData, error: Error?) -> Bool {
    // Yes: let it show the plan it just built while the room is handed over.
    error == nil
  }

  func captureView(didPresent room: CapturedRoom, error: Error?) {
    // `RoomCaptureView` is a `UIView` and calls its delegate on the main
    // thread; the protocol simply is not typed as isolated. Asserting what is
    // true, as `MapCanvas` does for the same reason: hopping through a `Task`
    // instead would dismiss the sheet a frame before the room arrived, and
    // lying with `@unchecked Sendable` would hide it if RoomPlan ever changed
    // its mind.
    // Lifted out of the closure so what crosses is the scanner -- a
    // `@MainActor` class, and so `Sendable` -- rather than this delegate.
    let scanner = self.scanner
    MainActor.assumeIsolated {
      if let error {
        scanner.captureFailed(error.localizedDescription)
      } else {
        scanner.captured(room)
      }
    }
  }

  // A delegate is not a document. It exists for the life of one sheet and holds
  // a SwiftUI view, neither of which survives an archive.
  func encode(with coder: NSCoder) {}
  init?(coder: NSCoder) { nil }
}
