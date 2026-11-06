import ExpoModulesCore
import Foundation

// The app's half of "Share → Philoi" (mock 324). targets/share-intake/ShareViewController.swift
// leaves the shared file + pending.json (or, for a link / text share, pending.json alone — 0294)
// in <group>/share-intake/ and opens philoi://share-intake;
// src/app/share-intake.tsx then calls consumePendingShare(), which MOVES the file into this app's
// own caches (so the App Group never holds a clip longer than one hand-off) and returns it.
//
// The group is `group.` + this app's bundle id — the same derivation as the extension and as
// withFocusNudgeEntitlements, so the dev variant (com.philoi.app.dev) lines up on its own group.
public class PhiloiShareIntakeModule: Module {
  /// A share older than this was abandoned (the app never opened); it's dropped, not resurrected.
  private static let maxAge: TimeInterval = 60 * 60

  public func definition() -> ModuleDefinition {
    Name("PhiloiShareIntake")

    // Android-only; declared so the JS can subscribe on both platforms without a branch.
    Events("onShareReceived")

    Function("hasPendingShare") { () -> Bool in
      guard let dir = Self.intakeURL() else { return false }
      return FileManager.default.fileExists(atPath: dir.appendingPathComponent("pending.json").path)
    }

    AsyncFunction("consumePendingShare") { () -> [String: Any]? in
      guard let dir = Self.intakeURL() else { return nil }
      let fm = FileManager.default
      defer { try? fm.removeItem(at: dir) }

      guard
        let data = fm.contents(atPath: dir.appendingPathComponent("pending.json").path),
        let manifest = try? JSONSerialization.jsonObject(with: data) as? [String: Any]
      else { return nil }

      let createdAt = manifest["createdAt"] as? Double ?? 0
      if Date().timeIntervalSince1970 - createdAt > Self.maxAge { return nil }

      // 0294 · a LINK or TEXT share (an Instagram Reel arrives as its URL) carries no file — the
      // manifest is the whole share.
      guard let file = manifest["file"] as? String, let mimeType = manifest["mimeType"] as? String else {
        var share: [String: Any] = [:]
        if let url = manifest["url"] as? String { share["url"] = url }
        if let text = manifest["text"] as? String { share["text"] = text }
        return share.isEmpty ? nil : share
      }

      let source = dir.appendingPathComponent(file)
      guard
        fm.fileExists(atPath: source.path),
        let caches = fm.urls(for: .cachesDirectory, in: .userDomainMask).first
      else { return nil }

      let target = caches.appendingPathComponent("share-intake", isDirectory: true)
      try? fm.createDirectory(at: target, withIntermediateDirectories: true)
      let dest = target.appendingPathComponent(file)
      try? fm.removeItem(at: dest)
      try fm.moveItem(at: source, to: dest)
      return ["uri": dest.absoluteString, "mimeType": mimeType]
    }
  }

  private static func intakeURL() -> URL? {
    guard let bundleId = Bundle.main.bundleIdentifier else { return nil }
    return FileManager.default
      .containerURL(forSecurityApplicationGroupIdentifier: "group.\(bundleId)")?
      .appendingPathComponent("share-intake", isDirectory: true)
  }
}
