package expo.modules.philoistoryshare

import android.content.Context
import android.content.Intent
import android.net.Uri
import androidx.core.content.FileProvider
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.io.File

/**
 * A FileProvider of our own, subclassed rather than declared as androidx.core.content.FileProvider:
 * expo-sharing, expo-image-picker and friends each declare that same class name in their manifests,
 * and two <provider> entries with one android:name fail the manifest merge. The subclass is a
 * distinct component with its own authority and its own paths file.
 */
class StoryShareFileProvider : FileProvider()

// The Instagram Stories sticker hand-off (CODE_PROMPT story-share sticker). Instagram's documented
// Android contract: an ADD_TO_STORY intent carrying the sticker as `interactive_asset_uri` (a
// content:// URI Instagram has been granted read on) and our Facebook App ID as
// `source_application`. Instagram opens the Stories composer with the sticker placed over a
// background the person picks.
class PhiloiStoryShareModule : Module() {
  private val context: Context
    get() = appContext.reactContext ?: throw IllegalStateException("No react context")

  override fun definition() = ModuleDefinition {
    Name("PhiloiStoryShare")

    Function("isInstagramAvailable") {
      storiesIntent("").resolveActivity(context.packageManager) != null
    }

    AsyncFunction("shareStickerToInstagram") { fileUri: String, appId: String, topColor: String, bottomColor: String ->
      val activity = appContext.currentActivity ?: return@AsyncFunction false
      val source = File(Uri.parse(fileUri).path ?: return@AsyncFunction false)
      if (!source.exists()) return@AsyncFunction false

      // Copied into the one directory story_share_paths.xml exposes, so the provider never has to
      // expose the whole cache dir that view-shot happens to write into.
      val dir = File(context.cacheDir, "story-share").apply { mkdirs() }
      val sticker = File(dir, "sticker.png")
      source.copyTo(sticker, overwrite = true)
      val uri = FileProvider.getUriForFile(context, "${context.packageName}.philoistoryshare", sticker)

      val intent = storiesIntent(appId).apply {
        putExtra("interactive_asset_uri", uri)
        putExtra("top_background_color", topColor)
        putExtra("bottom_background_color", bottomColor)
      }
      if (intent.resolveActivity(activity.packageManager) == null) return@AsyncFunction false
      activity.grantUriPermission(INSTAGRAM_PACKAGE, uri, Intent.FLAG_GRANT_READ_URI_PERMISSION)
      activity.startActivity(intent)
      true
    }
  }

  private fun storiesIntent(appId: String) = Intent("com.instagram.share.ADD_TO_STORY").apply {
    setType("image/png")
    setPackage(INSTAGRAM_PACKAGE)
    putExtra("source_application", appId)
    addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
  }

  private companion object {
    const val INSTAGRAM_PACKAGE = "com.instagram.android"
  }
}
