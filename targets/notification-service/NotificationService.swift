import UserNotifications

/// Attaches the subject's image to an incoming push (§F2, NOTIFICATIONS_SPEC "Rich notifications").
///
/// The class name is NOT arbitrary: apple-targets writes `$(PRODUCT_MODULE_NAME).NotificationService`
/// as the extension's NSExtensionPrincipalClass, so renaming this class produces an extension that
/// builds fine and is never invoked.
///
/// PAYLOAD SHAPE. Expo's push service nests our `richContent` under the message body and prefixes
/// it with an underscore, so the image lands at:
///
///     userInfo["body"]["_richContent"]["image"]
///
/// That underscore is easy to get wrong and fails silently — the push still arrives, just without
/// the picture — so it is read exactly as Expo's own reference extension does (expo/expo#36202).
///
/// The system only runs this extension when the payload carries `mutable-content: 1`, which Expo
/// sets when a message includes richContent. A push without it is delivered untouched and never
/// reaches this code.
class NotificationService: UNNotificationServiceExtension {
  private var contentHandler: ((UNNotificationContent) -> Void)?
  private var bestAttemptContent: UNMutableNotificationContent?
  private var downloadTask: URLSessionDownloadTask?

  override func didReceive(
    _ request: UNNotificationRequest,
    withContentHandler contentHandler: @escaping (UNNotificationContent) -> Void
  ) {
    self.contentHandler = contentHandler
    let mutableContent = request.content.mutableCopy() as? UNMutableNotificationContent
    bestAttemptContent = mutableContent

    guard let content = mutableContent else {
      // Nothing to modify — hand back the original rather than dropping the notification.
      contentHandler(request.content)
      return
    }

    guard
      let body = request.content.userInfo["body"] as? [String: Any],
      let richContent = body["_richContent"] as? [String: Any],
      let imageURLString = richContent["image"] as? String,
      let imageURL = URL(string: imageURLString)
    else {
      // No image on this one. Every notification still gets here (mutable-content is per-message,
      // but a mis-set flag is possible), so falling through to the plain content is the norm, not
      // an error worth logging.
      contentHandler(content)
      return
    }

    downloadAndAttach(imageURL, to: content, then: contentHandler)
  }

  /// Called when the OS is about to give up on us — roughly 30 seconds, often much less under
  /// memory pressure. Delivering the un-decorated notification here is what stops a slow image
  /// from costing the user the notification entirely.
  override func serviceExtensionTimeWillExpire() {
    downloadTask?.cancel()
    if let contentHandler = contentHandler, let bestAttemptContent = bestAttemptContent {
      contentHandler(bestAttemptContent)
    }
  }

  private func downloadAndAttach(
    _ url: URL,
    to content: UNMutableNotificationContent,
    then contentHandler: @escaping (UNNotificationContent) -> Void
  ) {
    // A shorter ceiling than the extension's own budget, so a hung request loses the image rather
    // than the notification.
    let configuration = URLSessionConfiguration.default
    configuration.timeoutIntervalForRequest = 10

    downloadTask = URLSession(configuration: configuration).downloadTask(with: url) { location, response, _ in
      defer { contentHandler(content) }

      guard let location = location else { return }

      // UNNotificationAttachment infers the type from the file EXTENSION, and the download lands
      // at a temp path with none — so an unsuffixed file is rejected as an unsupported type even
      // when the bytes are a perfectly good JPEG. Copy it to a suffixed name first.
      //
      // The suffix comes from the URL where possible; a remote image served from a path without
      // one (a signed storage URL, an avatar CDN) falls back to .jpg, which is what the vast
      // majority of these are.
      let suggested = response?.suggestedFilename ?? url.lastPathComponent
      let ext = (suggested as NSString).pathExtension
      let filename = ext.isEmpty ? "philoi-push.jpg" : "philoi-push.\(ext)"

      let destination = URL(fileURLWithPath: NSTemporaryDirectory()).appendingPathComponent(filename)

      do {
        // The extension can be invoked repeatedly and NSTemporaryDirectory is not cleared between
        // runs, so a leftover file from a previous push would make moveItem throw.
        try? FileManager.default.removeItem(at: destination)
        try FileManager.default.moveItem(at: location, to: destination)

        let attachment = try UNNotificationAttachment(identifier: "image", url: destination, options: nil)
        content.attachments = [attachment]
      } catch {
        // Deliberately silent. The deferred contentHandler above still delivers the notification
        // with its text intact — a missing picture is not worth losing the message over.
      }
    }

    downloadTask?.resume()
  }
}
