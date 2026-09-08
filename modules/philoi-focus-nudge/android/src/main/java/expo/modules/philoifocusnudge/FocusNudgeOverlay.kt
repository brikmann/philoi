package expo.modules.philoifocusnudge

import android.content.Context
import android.content.Intent
import android.graphics.PixelFormat
import android.net.Uri
import android.os.Handler
import android.os.Looper
import android.provider.Settings
import android.util.Log
import android.view.Gravity
import android.view.KeyEvent
import android.view.View
import android.view.WindowManager
import android.widget.FrameLayout

// The nudge itself — Android's answer to the iOS ShieldConfiguration extension.
//
// THE WINDOW, not the picture. What this screen LOOKS like is FocusNudgeShieldView — the
// full-bleed flame, rays and ember ground of design-mocks/182. This file owns attaching the
// window, the back key, and what a tap means, and it is the half that must not change when the
// design does.
//
// The two platforms diverge here, and honestly: iOS can only hand Apple a ShieldConfiguration
// (a background, one icon, two labels, two buttons — the whole API) and let the system draw it,
// so mock 182 is Android-only and mock 183 is the iOS ceiling. Same payload, same copy, same
// escalation on both; only the render differs.
//
// A WindowManager overlay, NOT an Activity. That is the entire reason this feature is worth an
// extended Play review: an Activity launch is a window transition with an animation, and the app
// underneath is visible for the whole of it. A view attached straight from the accessibility
// service's event dispatch appears in the same frame, so there is no glimpse of the feed at all.
//
// It draws whatever src/lib/focus-nudge.ts wrote into SharedPreferences before the session started,
// and it draws it offline. Nothing here fetches; see the header of FocusNudgeShared.kt.
//
// TWO BUTTONS, the same two as iOS: a way back in, and a way through with no penalty. Mock 109
// frame 2 shows three (the third being "Say hi in your campfire"), and the campfire affordance is
// the one that folds on both platforms — it is the only one that is not load-bearing, and the
// campfire is one tap away once Philoi is open.

internal object FocusNudgeOverlay {

  private const val TAG = "PhiloiFocusNudge"

  /**
   * The attached view, or null. Single-threaded by construction: every path in and out of here
   * originates on the main thread — the accessibility service's event dispatch, a click listener,
   * or an Expo module call, all of which the platform already delivers there.
   */
  private var view: View? = null

  val isShowing: Boolean
    get() = view != null

  fun show(context: Context) {
    if (view != null) return

    // Revocable at any time in system Settings, independently of the accessibility grant. Without
    // this check addView throws BadTokenException and takes the accessibility service's process
    // with it — which would leave the user with the guard silently dead until they rebooted.
    if (!Settings.canDrawOverlays(context)) {
      Log.w(TAG, "overlay permission not granted; nudge suppressed")
      return
    }

    val app = context.applicationContext
    val payload = FocusNudgePayload.load(app)
    // Recorded BEFORE the card is chosen, so the third presentation inside the hour is itself the
    // one that turns caring rather than the fourth.
    FocusNudgeState.recordRetreat(app, payload.escalateWindowMs)
    val card = payload.card(FocusNudgeState.retreats(app, payload.escalateWindowMs).size)

    val windowManager = app.getSystemService(Context.WINDOW_SERVICE) as WindowManager
    val root = buildView(app, card)

    val params = WindowManager.LayoutParams(
      WindowManager.LayoutParams.MATCH_PARENT,
      WindowManager.LayoutParams.MATCH_PARENT,
      // API 26+ only, which is this app's minSdk (app.config.ts, expo-build-properties). The
      // pre-26 TYPE_SYSTEM_ALERT branch every app-blocker tutorial carries is dead code here.
      WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY,
      // Deliberately NOT FLAG_NOT_FOCUSABLE: the nudge takes focus so it can answer the back key
      // (see below) and so touches cannot fall through to the app underneath.
      WindowManager.LayoutParams.FLAG_LAYOUT_IN_SCREEN or
        WindowManager.LayoutParams.FLAG_LAYOUT_NO_LIMITS or
        WindowManager.LayoutParams.FLAG_HARDWARE_ACCELERATED,
      PixelFormat.TRANSLUCENT,
    )
    params.gravity = Gravity.TOP or Gravity.START
    // No enter animation, and this survives the mock-182 redesign unchanged. A fade-in would be a
    // fade-in OF the feed showing through — the one thing the whole event-driven design exists to
    // prevent. The flicker and the rays inside FocusNudgeShieldView start only AFTER the window is
    // already opaque on screen, so nothing about the new look costs us the instant appearance.
    params.windowAnimations = 0

    try {
      windowManager.addView(root, params)
      view = root
      root.requestFocus()
    } catch (e: Exception) {
      // OEM overlay restrictions (Xiaomi's own "display pop-up windows" toggle is separate from
      // Android's) land here. Swallowed: a nudge that could not be drawn is a missed nudge, never
      // a crash in the accessibility service.
      Log.w(TAG, "could not attach the nudge overlay", e)
    }
  }

  /**
   * Idempotent, and safe to call from anywhere.
   *
   * The accessibility service and the click listeners are already on the main thread; the Expo
   * module's disarm() is not — Expo runs module functions on its own queue — and detaching a view
   * off the main thread throws. Hopping here rather than at each call site means no future caller
   * has to remember which side of that line they are on.
   */
  fun hide(context: Context) {
    if (Looper.myLooper() != Looper.getMainLooper()) {
      Handler(Looper.getMainLooper()).post { hide(context) }
      return
    }
    val attached = view ?: return
    view = null
    try {
      val windowManager =
        context.applicationContext.getSystemService(Context.WINDOW_SERVICE) as WindowManager
      windowManager.removeView(attached)
    } catch (e: Exception) {
      // Already detached — the window can be reaped from under us on a configuration change or when
      // the service is unbound. Nothing to do; the field is already cleared.
      Log.w(TAG, "could not detach the nudge overlay", e)
    }
  }

  // ───────────────────────────── the view ─────────────────────────────

  private fun buildView(context: Context, card: FocusNudgeCard): View {
    val root = object : FrameLayout(context) {
      /**
       * Back is a way OUT, not a way through.
       *
       * Dismissing in place would drop them straight into the guarded app with no deferral
       * recorded — a silent bypass that costs nothing, next to a "Continue anyway" that costs an
       * explicit tap. So back does what it looks like it does: it leaves. Home screen, overlay
       * down, and opening the app again nudges again.
       */
      override fun dispatchKeyEvent(event: KeyEvent): Boolean {
        if (event.keyCode == KeyEvent.KEYCODE_BACK && event.action == KeyEvent.ACTION_UP) {
          goHome(context)
          hide(context)
          return true
        }
        return super.dispatchKeyEvent(event)
      }
    }
    root.isClickable = true // swallow every stray tap rather than letting it reach the app below
    root.isFocusable = true
    root.isFocusableInTouchMode = true

    // The look lives next door in FocusNudgeShieldView (mock 182) — the full-bleed flame, the
    // rays, the ember ground. THIS file stays what it always was: the window, the key handling,
    // and what a tap means. The split is deliberate; a redesign should never have to reason about
    // WindowManager tokens, and the window should never have to reason about a shader.
    FocusNudgeShieldView.build(
      context = context,
      card = card,
      root = root,
      onPrimary = {
        // philoi://lock-in on a reinforce card, philoi://support on wellbeing/support — the
        // routing decision is made in JS (BUTTONS in src/lib/focus-nudge.ts) and travels in the
        // payload, so it ships over OTA rather than needing a native build. This side just opens
        // what it is given.
        openLink(context, card.primaryUrl)
        hide(context)
      },
      onSecondary = {
        // The pass-through, and it really does pass through: the overlay comes down onto the app
        // they were already opening, so unlike iOS — where the shield's dismissal costs one extra
        // tap because ShieldActionResponse has no "let them straight through" — Android continues
        // in one. No penalty, no streak loss, nothing recorded.
        FocusNudgeState.defer(context.applicationContext)
        hide(context)
      },
    )

    return root
  }

  // ───────────────────────────── leaving ─────────────────────────────

  private fun openLink(context: Context, url: String) {
    val app = context.applicationContext
    try {
      app.startActivity(
        Intent(Intent.ACTION_VIEW, Uri.parse(url)).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
      )
    } catch (e: Exception) {
      // A deep link the running binary has no route for (an older build, a payload from a newer
      // one). Opening Philoi at all is a far better outcome than the primary button doing nothing.
      Log.w(TAG, "deep link $url did not resolve; opening Philoi instead", e)
      val launch = app.packageManager.getLaunchIntentForPackage(app.packageName)
      if (launch != null) app.startActivity(launch.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
    }
  }

  private fun goHome(context: Context) {
    try {
      context.applicationContext.startActivity(
        Intent(Intent.ACTION_MAIN)
          .addCategory(Intent.CATEGORY_HOME)
          .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
      )
    } catch (e: Exception) {
      Log.w(TAG, "could not go home", e)
    }
  }
}
