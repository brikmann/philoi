package expo.modules.philoifocusnudge

import android.content.Context
import android.content.SharedPreferences
import org.json.JSONArray
import org.json.JSONObject

// ══════════════════════════════════════════════════════════════════════════════════════════════
// FOCUS NUDGE (ANDROID) — THE SHARED-PREFERENCES CONTRACT
//
// The Android counterpart of FocusNudgeShared.swift, and it exists for the same reason: the thing
// that draws the nudge cannot ask the network what to say.
//
// On iOS that is a hard platform fact — a ShieldConfiguration extension is asked for its UI
// synchronously in a system process. On Android the constraint is softer but the requirement is
// identical and stricter in one way: the overlay must appear in the SAME FRAME the guarded app
// comes forward. A network call there would not merely be slow, it would reintroduce the exact
// glimpse of the feed that this whole feature exists to prevent. So JS pre-fetches Cindy's line
// while the app is open and writes it HERE; the AccessibilityService and the overlay only READ.
// Nothing in this file, the service, or the overlay opens a socket.
//
// 🔴 ONE CROSS-LANGUAGE CONTRACT: the payload JSON below. It is authored in ONE place —
// buildNudgePayload() in src/lib/focus-nudge.ts — and parsed by both FocusNudgePayload.load() in
// FocusNudgeShared.swift and FocusNudgePayload.load() here. Keep the three in step; a renamed key
// produces no build error on either platform, just a nudge that says the generic thing forever.
//
// Unlike iOS there is no App Group and no mirrored-file problem: the service, the overlay and the
// Expo module are all one Android library in one process, so this is the only copy.
// ══════════════════════════════════════════════════════════════════════════════════════════════

/**
 * Ordinary MODE_PRIVATE preferences, not an App Group.
 *
 * The AccessibilityService runs in this app's own process (it declares no `android:process`), so
 * it reads the same file the Expo module writes with no IPC and no cross-process staleness — the
 * `CFPreferencesAppSynchronize` dance the iOS shield needs has no analogue here.
 *
 * The process itself may well be a FRESH one: the system can bind the accessibility service long
 * after the user has swiped Philoi away, with no React context ever created. Everything the
 * service needs in order to decide whether and what to draw is therefore on disk, never in memory.
 */
internal fun focusNudgePrefs(context: Context): SharedPreferences =
  context.getSharedPreferences("philoi_focus_nudge", Context.MODE_PRIVATE)

internal object FocusNudgeKey {
  /** The nudge copy JS pre-fetched. JSON, stored as a String. Same shape as the iOS payload. */
  const val PAYLOAD = "focusNudge.payload"

  /**
   * The packages the user chose to guard, newline-separated.
   *
   * Plain package names — the Android analogue of iOS's opaque FamilyActivitySelection tokens, and
   * the one place the two platforms genuinely differ in what the app can know. Android has no
   * privacy-preserving picker, so Philoi does see these strings. They never leave the device and
   * are never sent to analytics: src/app/focus-nudge.tsx reports only the COUNT, exactly as iOS
   * does, so both platforms tell the server the same thing.
   */
  const val GUARDED = "focusNudge.guarded"

  /** Epoch-ms timestamps of recent nudge presentations. Drives the safety escalation. */
  const val RETREATS = "focusNudge.retreats"

  /** Epoch ms until which the nudge stays down after a "continue anyway". 0 = not deferred. */
  const val DEFERRED_UNTIL_MS = "focusNudge.deferredUntilMs"

  /** Epoch ms the current lock-in armed at. 0 = nothing armed, and the service does nothing. */
  const val ARMED_AT_MS = "focusNudge.armedAtMs"

  /** What a "continue anyway" buys, in ms. Written by arm() from the JS DEFER_MS. */
  const val DEFER_MS = "focusNudge.deferMs"
}

// ───────────────────────────── the payload ─────────────────────────────

/** One nudge's worth of copy. Mirrors FocusNudgeCard in FocusNudgeShared.swift. */
internal data class FocusNudgeCard(
  /** reinforce | wellbeing | support — the coach's own intent (see _shared/coach/prompt.ts). */
  val intent: String,
  val title: String,
  val body: String,
  val primaryLabel: String,
  /** Deep link the primary button opens — philoi://lock-in or philoi://support. */
  val primaryUrl: String,
  val secondaryLabel: String,
) {
  companion object {
    fun from(json: JSONObject?): FocusNudgeCard? {
      if (json == null) return null
      val title = json.optString("title").ifEmpty { return null }
      val body = json.optString("body").ifEmpty { return null }
      val primaryLabel = json.optString("primaryLabel").ifEmpty { return null }
      val primaryUrl = json.optString("primaryURL").ifEmpty { return null }
      val secondaryLabel = json.optString("secondaryLabel").ifEmpty { return null }
      return FocusNudgeCard(
        intent = json.optString("intent", "reinforce"),
        title = title,
        body = body,
        primaryLabel = primaryLabel,
        primaryUrl = primaryUrl,
        secondaryLabel = secondaryLabel,
      )
    }
  }
}

internal data class FocusNudgePayload(
  val base: FocusNudgeCard,
  /**
   * The safety escalation, shown once they have retreated [escalateAfter] times inside
   * [escalateWindowMs]. Cached alongside `base` precisely so the escalation still happens with no
   * network — care must never depend on connectivity.
   */
  val escalated: FocusNudgeCard,
  val escalateAfter: Int,
  val escalateWindowMs: Double,
  /** How long "continue anyway" holds the nudge down — a tap on the shoulder, not nagging. */
  val deferMs: Double,
) {
  /**
   * Which card to draw right now.
   *
   * Escalation is ONE-WAY, identical to the iOS rule: a payload the coach already marked wellbeing
   * or support is never downgraded back to a productivity push by a low retreat count. Once the
   * data says care, it stays care.
   */
  fun card(retreats: Int): FocusNudgeCard {
    if (base.intent == "wellbeing" || base.intent == "support") return base
    return if (retreats >= escalateAfter) escalated else base
  }

  companion object {
    /**
     * The last-resort copy, used when nothing has ever been cached — a fresh install that guarded
     * before the first fetch landed, or a payload we could not parse.
     *
     * 🔴 Biased to CARE, not to productivity ("whenever it's uncertain, care and connection over
     * productivity"). We do not know why they are here, so we do not push hard. Byte-for-byte the
     * same words as FocusNudgePayload.fallback in FocusNudgeShared.swift — the generic nudge should
     * not be a different nudge depending on which phone you own.
     */
    val fallback = FocusNudgePayload(
      base = FocusNudgeCard(
        intent = "reinforce",
        title = "You're still locked in.",
        body = "Whatever pulled you here will keep. Come back to it — or take a real break, properly.",
        primaryLabel = "Back to my session",
        primaryUrl = "philoi://lock-in?from=shield",
        secondaryLabel = "Continue anyway",
      ),
      escalated = FocusNudgeCard(
        intent = "wellbeing",
        title = "Hey — just checking on you.",
        body = "No judgment. But the feed won't fix whatever's sitting heavy. Step outside for a sec, or text someone who gets it.",
        primaryLabel = "Talk to someone",
        primaryUrl = "philoi://support?from=shield",
        secondaryLabel = "I'm okay — continue",
      ),
      escalateAfter = 3,
      escalateWindowMs = 60 * 60 * 1000.0,
      deferMs = 10 * 60 * 1000.0,
    )

    fun load(context: Context): FocusNudgePayload {
      val raw = focusNudgePrefs(context).getString(FocusNudgeKey.PAYLOAD, null) ?: return fallback
      val json = try {
        JSONObject(raw)
      } catch (e: Exception) {
        return fallback
      }
      val base = FocusNudgeCard.from(json.optJSONObject("base")) ?: return fallback
      return FocusNudgePayload(
        base = base,
        // A payload missing its escalation still escalates — to the built-in wellbeing card rather
        // than to nothing. Falling back to `base` here would answer repeated retreat with another
        // productivity push, which is the one outcome the safety rules rule out.
        escalated = FocusNudgeCard.from(json.optJSONObject("escalated")) ?: fallback.escalated,
        escalateAfter = json.optInt("escalateAfter", fallback.escalateAfter),
        escalateWindowMs = json.optDouble("escalateWindowMs", fallback.escalateWindowMs),
        deferMs = json.optDouble("deferMs", fallback.deferMs),
      )
    }
  }
}

// ───────────────────────────── state ─────────────────────────────

/**
 * Everything the service consults before it draws, and everything the overlay writes back.
 *
 * All of it goes through SharedPreferences rather than a singleton's fields, for the reason in the
 * header: the process that shows the nudge is very often not the process that armed it.
 */
internal object FocusNudgeState {
  fun armedAtMs(context: Context): Long =
    focusNudgePrefs(context).getLong(FocusNudgeKey.ARMED_AT_MS, 0L)

  fun isArmed(context: Context): Boolean = armedAtMs(context) > 0L

  fun guardedPackages(context: Context): Set<String> {
    val raw = focusNudgePrefs(context).getString(FocusNudgeKey.GUARDED, null) ?: return emptySet()
    return raw.split("\n").filter { it.isNotBlank() }.toSet()
  }

  fun setGuardedPackages(context: Context, packages: List<String>) {
    focusNudgePrefs(context).edit()
      .putString(FocusNudgeKey.GUARDED, packages.filter { it.isNotBlank() }.joinToString("\n"))
      .apply()
  }

  fun deferMs(context: Context): Long =
    focusNudgePrefs(context).getLong(FocusNudgeKey.DEFER_MS, 10 * 60 * 1000L)

  fun isDeferred(context: Context): Boolean =
    System.currentTimeMillis() <
      focusNudgePrefs(context).getLong(FocusNudgeKey.DEFERRED_UNTIL_MS, 0L)

  /**
   * "Continue anyway." Buys exactly [deferMs] and nothing else — no penalty, no streak loss,
   * nothing recorded against them.
   *
   * commit(), not apply(): the very next thing that happens is the overlay coming down and the user
   * landing back in the guarded app, which fires another window-state change that reads this value.
   * apply() writes asynchronously, and losing that race means nudging them again half a second
   * after they asked not to be — the single most annoying bug this feature could have.
   */
  fun defer(context: Context) {
    val until = System.currentTimeMillis() + deferMs(context)
    focusNudgePrefs(context).edit().putLong(FocusNudgeKey.DEFERRED_UNTIL_MS, until).commit()
  }

  fun clearDefer(context: Context) {
    focusNudgePrefs(context).edit().putLong(FocusNudgeKey.DEFERRED_UNTIL_MS, 0L).apply()
  }

  /** Presentation timestamps inside [windowMs], oldest first. */
  fun retreats(context: Context, windowMs: Double): List<Long> {
    val raw = focusNudgePrefs(context).getString(FocusNudgeKey.RETREATS, null) ?: return emptyList()
    val cutoff = System.currentTimeMillis() - windowMs.toLong()
    return try {
      val array = JSONArray(raw)
      (0 until array.length()).map { array.optLong(it) }.filter { it >= cutoff }.sorted()
    } catch (e: Exception) {
      emptyList()
    }
  }

  /**
   * Record one presentation, debounced by 30s.
   *
   * The debounce matches the iOS shield's. Without it a single drift can register as three
   * retreats — Android re-fires TYPE_WINDOW_STATE_CHANGED for dialogs, IME windows and an app's own
   * internal transitions — and the escalation would then fire on the first drift of the session,
   * answering someone who has not actually drifted repeatedly with "that's a few times now".
   * Escalating early is a kinder failure than escalating late, but a wrong one is still wrong.
   */
  fun recordRetreat(context: Context, windowMs: Double) {
    val now = System.currentTimeMillis()
    val existing = retreats(context, windowMs)
    if (existing.isNotEmpty() && now - existing.last() < 30_000L) return
    val array = JSONArray()
    // Cap the stored history. Only the count inside the window is ever read, so an unbounded list
    // is pure growth in a file the accessibility service parses on a latency-critical path.
    (existing + now).takeLast(32).forEach { array.put(it) }
    focusNudgePrefs(context).edit().putString(FocusNudgeKey.RETREATS, array.toString()).apply()
  }

  fun clearRetreats(context: Context) {
    focusNudgePrefs(context).edit().remove(FocusNudgeKey.RETREATS).apply()
  }

  /** Start of a lock-in. A new session starts clean — the same reset as the iOS module's arm(). */
  fun arm(context: Context, deferMs: Long) {
    focusNudgePrefs(context).edit()
      .putLong(FocusNudgeKey.ARMED_AT_MS, System.currentTimeMillis())
      .putLong(FocusNudgeKey.DEFER_MS, deferMs)
      .putLong(FocusNudgeKey.DEFERRED_UNTIL_MS, 0L)
      .remove(FocusNudgeKey.RETREATS)
      .commit()
  }

  /** End of session. Unconditional and idempotent. */
  fun disarm(context: Context) {
    focusNudgePrefs(context).edit()
      .putLong(FocusNudgeKey.ARMED_AT_MS, 0L)
      .putLong(FocusNudgeKey.DEFERRED_UNTIL_MS, 0L)
      .remove(FocusNudgeKey.RETREATS)
      .commit()
  }
}
