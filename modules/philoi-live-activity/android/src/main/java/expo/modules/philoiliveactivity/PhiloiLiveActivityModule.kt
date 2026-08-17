package expo.modules.philoiliveactivity

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.os.Build
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import expo.modules.kotlin.records.Field
import expo.modules.kotlin.records.Record

// The Android half of the lock-in live surface (#87): an ongoing notification carrying a
// self-ticking chronometer and the rank bar.
//
// PATH A, deliberately (NATIVE_BUILD_CONFIG.md). There is no foreground service here. Android
// ticks a chronometer notification itself from a `when` timestamp, so keeping our process alive
// buys nothing — and skipping the service skips the Android 14 foregroundServiceType declaration
// and the Play Console special-use justification that come with it.
//
// NOT Notifee, which the original prompt assumed: its last release is 9.1.8 (December 2024), its
// Android module still targets compileSdk 34 against this app's 36, and it has no Live Updates
// support at all. Everything it would have given us — chronometer, determinate progress, ongoing
// behaviour — is four calls on NotificationCompat, so an unmaintained native dependency in a fresh
// EAS build is a poor trade.

private const val CHANNEL_ID = "lockin-session"
private const val CHANNEL_NAME = "Lock-in sessions"
// One id, reused. start = notify with it, update = notify again with it, end = cancel it — the
// same three verbs as ActivityKit, so both platforms behave identically from JS.
private const val NOTIFICATION_ID = 8701

class LiveActivityStateRecord : Record {
  @Field var sessionName: String = ""
  @Field var startedAtMs: Double = 0.0
  @Field var rankRatio: Double = 0.0
  @Field var rankLabel: String = ""
  @Field var projection: String? = null
}

class PhiloiLiveActivityModule : Module() {
  private val context: Context
    get() = appContext.reactContext ?: throw IllegalStateException("No react context")

  override fun definition() = ModuleDefinition {
    Name("PhiloiLiveActivity")

    // Mirrors the iOS check. Covers the user switching Philoi's notifications off in system
    // settings after granting them, which POST_NOTIFICATIONS alone wouldn't tell us.
    Function("isAvailable") {
      NotificationManagerCompat.from(context).areNotificationsEnabled()
    }

    AsyncFunction("start") { state: LiveActivityStateRecord ->
      ensureChannel()
      NotificationManagerCompat.from(context).notify(NOTIFICATION_ID, build(state))
      NOTIFICATION_ID.toString()
    }

    AsyncFunction("update") { state: LiveActivityStateRecord ->
      // Re-notifying under the same id replaces in place without re-alerting, because the channel
      // has already alerted once and setOnlyAlertOnce holds the rest.
      ensureChannel()
      NotificationManagerCompat.from(context).notify(NOTIFICATION_ID, build(state))
    }

    AsyncFunction("end") {
      NotificationManagerCompat.from(context).cancel(NOTIFICATION_ID)
    }
  }

  private fun ensureChannel() {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
    val manager = context.getSystemService(NotificationManager::class.java) ?: return
    // DEFAULT rather than LOW: Android 16 will not promote a low-importance notification to the
    // status-bar Live Update chip, and the chip is the whole point of the surface. Sound and
    // vibration are stripped below so DEFAULT still doesn't buzz — the session start already has
    // its own ignite cue in-app (PHILOI_UI_SPEC.md §22).
    val channel = NotificationChannel(CHANNEL_ID, CHANNEL_NAME, NotificationManager.IMPORTANCE_DEFAULT).apply {
      description = "Shows your live timer while you're locked in."
      setSound(null, null)
      enableVibration(false)
      setShowBadge(false)
    }
    manager.createNotificationChannel(channel)
  }

  private fun build(state: LiveActivityStateRecord): android.app.Notification {
    val title = if (state.sessionName.isEmpty()) "PHILOI" else "PHILOI · ${state.sessionName}"
    val percent = (state.rankRatio.coerceIn(0.0, 1.0) * 100).toInt()
    // "~2h to Gold III" when there's a projection, else the plain percentage. Static text — no
    // pulse is possible in notification chrome, which is why the in-app bar owns the animation.
    val rankLine = when {
      state.rankLabel.isEmpty() -> null
      state.projection != null -> "${state.projection} to ${state.rankLabel}"
      else -> "$percent% to ${state.rankLabel}"
    }

    val builder = NotificationCompat.Builder(context, CHANNEL_ID)
      .setSmallIcon(smallIcon())
      .setContentTitle(title)
      .setOngoing(true)
      .setOnlyAlertOnce(true)
      .setSilent(true)
      .setShowWhen(true)
      // The three lines that make the timer free: anchor `when` to the session start, tell the OS
      // to render it as a chronometer, and count up rather than down. Android advances it on its
      // own from here — we never post an update just because a second passed.
      .setWhen(state.startedAtMs.toLong())
      .setUsesChronometer(true)
      // Visible on the lock screen. Without this the card is hidden behind "sensitive content"
      // on a locked device, which is exactly where it's meant to be glanceable.
      .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
      .setCategory(NotificationCompat.CATEGORY_STOPWATCH)
      .setContentIntent(openAppIntent())

    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) {
      builder.setChronometerCountDown(false)
    }

    rankLine?.let { builder.setContentText(it) }

    // Determinate rank bar. Hidden at the apex (ratio 1, nothing left to fill) rather than shown
    // pinned full, which would read as a stuck progress bar.
    if (percent in 0..99 && state.rankLabel.isNotEmpty()) {
      builder.setProgress(100, percent, false)
    }

    // Android 16 (API 36) Live Updates — promotes this to the status-bar chip, where the
    // chronometer keeps ticking. Requires POST_PROMOTED_NOTIFICATIONS (declared in app.config.ts),
    // an ongoing notification, and a contentTitle; all three hold above. Below 36 the call doesn't
    // exist and the plain ongoing notification is the fallback, which is the same surface minus
    // the chip.
    if (Build.VERSION.SDK_INT >= 36) {
      builder.setRequestPromotedOngoing(true)
    }

    return builder.build()
  }

  /**
   * A small icon must be a resource in the APK, and this module has no drawables of its own.
   * expo-notifications' config plugin generates `notification_icon` from app.config.ts's
   * `expo-notifications` icon, so prefer that and fall back to the launcher icon — passing 0 would
   * make notify() throw and take the session start down with it.
   */
  private fun smallIcon(): Int {
    val generated = context.resources.getIdentifier("notification_icon", "drawable", context.packageName)
    return if (generated != 0) generated else context.applicationInfo.icon
  }

  /**
   * Tapping the notification opens the app. No deep link is built here: the root layout already
   * routes an active session to the lock-in screen, so a hardcoded route would be a second place
   * that has to know about that rule.
   */
  private fun openAppIntent(): PendingIntent? {
    val intent = context.packageManager.getLaunchIntentForPackage(context.packageName) ?: return null
    return PendingIntent.getActivity(
      context,
      0,
      intent,
      PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
    )
  }
}
