package expo.modules.philoishareintake

import android.content.Context
import android.content.Intent
import android.net.Uri
import android.webkit.MimeTypeMap
import androidx.core.content.IntentCompat
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.io.File
import java.util.UUID

// The Android half of "Share → Philoi" (mock 324). MainActivity carries a SEND filter for image/*,
// video/* and text/plain (app.config.ts; text is 0294's link share — an Instagram Reel arrives as
// its URL), so Philoi shows up in the system share sheet. A share arrives as:
//   * the LAUNCH intent, when Philoi wasn't running — read from currentActivity.intent;
//   * onNewIntent, when it was (MainActivity is singleTask) — kept here, and "onShareReceived" fires
//     so the JS can route to the composer without waiting for a cold start.
// consumePendingShare() copies the content:// stream into this app's cache (the grant on the
// sender's URI lasts only as long as the activity) and forgets the intent, so a rotation or a
// recreate doesn't import the same clip twice.
class PhiloiShareIntakeModule : Module() {
  private val context: Context
    get() = appContext.reactContext ?: throw IllegalStateException("No react context")

  /** The newest share not yet consumed. Null once consumed. */
  private var pending: Intent? = null
  private var launchChecked = false

  override fun definition() = ModuleDefinition {
    Name("PhiloiShareIntake")

    Events("onShareReceived")

    OnNewIntent { intent ->
      if (isShare(intent)) {
        pending = intent
        sendEvent("onShareReceived", emptyMap<String, Any>())
      }
    }

    Function("hasPendingShare") {
      current() != null
    }

    AsyncFunction("consumePendingShare") {
      val intent = current() ?: return@AsyncFunction null
      pending = null
      // Replaced rather than mutated — the activity re-reads getIntent() on recreate.
      appContext.currentActivity?.intent = Intent(Intent.ACTION_MAIN)

      // 0294 · a LINK / TEXT share. Instagram shares a Reel as its URL in EXTRA_TEXT — never the
      // video — so this is the Reel path. The JS pulls the URL out of the text.
      if (intent.type?.startsWith("text/") == true) {
        val text = intent.getCharSequenceExtra(Intent.EXTRA_TEXT)?.toString()?.trim()?.take(4000)
        return@AsyncFunction if (text.isNullOrEmpty()) null else mapOf("text" to text)
      }

      val uri = IntentCompat.getParcelableExtra(intent, Intent.EXTRA_STREAM, Uri::class.java)
        ?: return@AsyncFunction null
      val mime = context.contentResolver.getType(uri) ?: intent.type ?: return@AsyncFunction null
      if (!mime.startsWith("image/") && !mime.startsWith("video/")) return@AsyncFunction null

      val ext = MimeTypeMap.getSingleton().getExtensionFromMimeType(mime)
        ?: if (mime.startsWith("video/")) "mp4" else "jpg"
      val dir = File(context.cacheDir, "share-intake").apply {
        deleteRecursively()
        mkdirs()
      }
      val dest = File(dir, "${UUID.randomUUID()}.$ext")
      context.contentResolver.openInputStream(uri)?.use { input ->
        dest.outputStream().use { output -> input.copyTo(output) }
      } ?: return@AsyncFunction null

      mapOf("uri" to Uri.fromFile(dest).toString(), "mimeType" to mime)
    }
  }

  /** The unconsumed share: a newer onNewIntent one wins, else the launch intent, read once. */
  private fun current(): Intent? {
    pending?.let { return it }
    if (launchChecked) return null
    val launch = appContext.currentActivity?.intent ?: return null
    launchChecked = true
    return if (isShare(launch)) launch.also { pending = it } else null
  }

  private fun isShare(intent: Intent?): Boolean {
    if (intent?.action != Intent.ACTION_SEND) return false
    val type = intent.type ?: return false
    return type.startsWith("image/") || type.startsWith("video/") || type == "text/plain"
  }
}
