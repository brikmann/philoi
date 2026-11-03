import UIKit
import UniformTypeIdentifiers

// "Share → Philoi" (mock 324). Copies the one shared photo or clip into the App Group, then opens
// the app at <scheme>://share-intake, where modules/philoi-share-intake picks it up and the import
// composer takes over. Nothing is uploaded from here — the extension has no network of its own and
// no reason for one (App Review: "no background network beyond upload", and the upload is the app's).
//
// The hand-off is two files in <group>/share-intake/:
//   <uuid>.<ext>    the media, copied out of the share's temporary location
//   pending.json    {"file": "<uuid>.<ext>", "mimeType": "...", "createdAt": <unix s>}
// A second share before the app reads the first replaces it — one post at a time.

private let intakeDir = "share-intake"

final class ShareViewController: UIViewController {
  private let status = UILabel()

  override func viewDidLoad() {
    super.viewDidLoad()
    view.backgroundColor = UIColor(red: 0.055, green: 0.039, blue: 0.11, alpha: 1)
    status.text = "Opening Philoi…"
    status.textColor = UIColor(red: 0.96, green: 0.94, blue: 1, alpha: 1)
    status.font = .systemFont(ofSize: 15, weight: .semibold)
    status.textAlignment = .center
    status.numberOfLines = 0
    status.translatesAutoresizingMaskIntoConstraints = false
    view.addSubview(status)
    NSLayoutConstraint.activate([
      status.centerXAnchor.constraint(equalTo: view.centerXAnchor),
      status.centerYAnchor.constraint(equalTo: view.centerYAnchor),
      status.leadingAnchor.constraint(greaterThanOrEqualTo: view.leadingAnchor, constant: 24),
    ])
  }

  override func viewDidAppear(_ animated: Bool) {
    super.viewDidAppear(animated)
    guard let provider = firstAttachment() else {
      fail("Philoi can take one photo or one video.")
      return
    }
    let isMovie = provider.hasItemConformingToTypeIdentifier(UTType.movie.identifier)
    let type = isMovie ? UTType.movie : UTType.image
    provider.loadFileRepresentation(forTypeIdentifier: type.identifier) { [weak self] url, _ in
      guard let self else { return }
      let stored = url.flatMap { self.store(file: $0, isMovie: isMovie) }
      DispatchQueue.main.async {
        guard stored == true else {
          self.fail("Couldn’t hand this to Philoi. Try sharing it again.")
          return
        }
        self.openApp()
      }
    }
  }

  /// The first movie, else the first image, across everything shared.
  private func firstAttachment() -> NSItemProvider? {
    let providers = (extensionContext?.inputItems as? [NSExtensionItem] ?? []).flatMap { $0.attachments ?? [] }
    return providers.first { $0.hasItemConformingToTypeIdentifier(UTType.movie.identifier) }
      ?? providers.first { $0.hasItemConformingToTypeIdentifier(UTType.image.identifier) }
  }

  /// Runs on the provider's queue, while `file` still exists — it's deleted when the callback returns.
  private func store(file: URL, isMovie: Bool) -> Bool {
    guard let dir = Self.intakeURL() else { return false }
    let fm = FileManager.default
    do {
      // Whatever an earlier, never-opened share left behind goes first.
      if fm.fileExists(atPath: dir.path) { try fm.removeItem(at: dir) }
      try fm.createDirectory(at: dir, withIntermediateDirectories: true)

      let ext = file.pathExtension.isEmpty ? (isMovie ? "mov" : "jpg") : file.pathExtension.lowercased()
      let name = "\(UUID().uuidString).\(ext)"
      try fm.copyItem(at: file, to: dir.appendingPathComponent(name))

      let mime = UTType(filenameExtension: ext)?.preferredMIMEType ?? (isMovie ? "video/quicktime" : "image/jpeg")
      let manifest: [String: Any] = ["file": name, "mimeType": mime, "createdAt": Date().timeIntervalSince1970]
      let data = try JSONSerialization.data(withJSONObject: manifest)
      try data.write(to: dir.appendingPathComponent("pending.json"), options: .atomic)
      return true
    } catch {
      return false
    }
  }

  /// Extensions can't call UIApplication.shared, so this walks the responder chain to the host
  /// application — the documented-in-practice route every share-to-app extension uses, and the one
  /// that still works on iOS 18 (the old `openURL:` selector silently does nothing there).
  private func openApp() {
    guard let url = URL(string: "\(Self.appScheme())://share-intake") else { return finish() }
    var responder: UIResponder? = self
    while let r = responder {
      if let app = r as? UIApplication {
        app.open(url, options: [:], completionHandler: nil)
        break
      }
      responder = r.next
    }
    finish()
  }

  private func finish() {
    extensionContext?.completeRequest(returningItems: nil, completionHandler: nil)
  }

  private func fail(_ message: String) {
    status.text = message
    DispatchQueue.main.asyncAfter(deadline: .now() + 1.6) { [weak self] in
      self?.extensionContext?.cancelRequest(withError: NSError(domain: "PhiloiShareIntake", code: 1))
    }
  }

  /// This extension is `<main app id>.ShareIntake`; drop the last component to land on the app.
  private static func mainAppBundleId() -> String {
    let id = Bundle.main.bundleIdentifier ?? "com.philoi.app.ShareIntake"
    return id.split(separator: ".").dropLast().joined(separator: ".")
  }

  /// The side-by-side dev app (APP_VARIANT=dev, com.philoi.app.dev) answers to philoi-dev://.
  private static func appScheme() -> String {
    mainAppBundleId().hasSuffix(".dev") ? "philoi-dev" : "philoi"
  }

  static func intakeURL() -> URL? {
    FileManager.default
      .containerURL(forSecurityApplicationGroupIdentifier: "group.\(mainAppBundleId())")?
      .appendingPathComponent(intakeDir, isDirectory: true)
  }
}
