import ExpoModulesCore
import UIKit

// The Instagram Stories sticker hand-off (CODE_PROMPT story-share sticker, the Strava mechanic).
//
// Instagram's documented contract: put the sticker PNG on the general pasteboard under
// `com.instagram.sharedSticker.stickerImage`, then open `instagram-stories://share` with our
// Facebook App ID as `source_application`. Instagram reads the pasteboard, opens the Stories
// composer and drops the sticker in, draggable and resizable over whatever the person picks as the
// background. Without a registered App ID Instagram rejects the hand-off, which is why the JS side
// never calls this when the ID is unset.
//
// The two background colours are what the composer shows before a photo is chosen. They are the
// brand's deep purple rather than Instagram's default gradient, so the sticker reads as ours even
// on the frame where nothing else has been picked yet.
public class PhiloiStoryShareModule: Module {
  private static let storiesScheme = "instagram-stories://share"

  public func definition() -> ModuleDefinition {
    Name("PhiloiStoryShare")

    // Needs `instagram-stories` in LSApplicationQueriesSchemes (app.config.ts), or this is always
    // false — canOpenURL answers no for any scheme the app has not declared it will ask about.
    Function("isInstagramAvailable") { () -> Bool in
      guard let url = URL(string: Self.storiesScheme) else { return false }
      return UIApplication.shared.canOpenURL(url)
    }

    AsyncFunction("shareStickerToInstagram") { (fileUri: String, appId: String, topColor: String, bottomColor: String, promise: Promise) in
      let path = fileUri.hasPrefix("file://") ? String(fileUri.dropFirst("file://".count)) : fileUri
      guard let data = FileManager.default.contents(atPath: path) else {
        promise.resolve(false)
        return
      }
      guard
        let url = URL(string: "\(Self.storiesScheme)?source_application=\(appId)"),
        UIApplication.shared.canOpenURL(url)
      else {
        promise.resolve(false)
        return
      }
      let items: [[String: Any]] = [[
        "com.instagram.sharedSticker.stickerImage": data,
        "com.instagram.sharedSticker.backgroundTopColor": topColor,
        "com.instagram.sharedSticker.backgroundBottomColor": bottomColor,
      ]]
      // Five minutes, then the sticker leaves the person's clipboard on its own — it is a hand-off
      // to one app, not something that should still be pasteable into a chat tomorrow.
      UIPasteboard.general.setItems(items, options: [.expirationDate: Date().addingTimeInterval(300)])
      UIApplication.shared.open(url, options: [:]) { opened in
        promise.resolve(opened)
      }
    }.runOnQueue(.main)
  }
}
