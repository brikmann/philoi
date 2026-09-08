package expo.modules.philoifocusnudge

import android.animation.ValueAnimator
import android.content.Context
import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.LinearGradient
import android.graphics.Matrix
import android.graphics.Paint
import android.graphics.PorterDuff
import android.graphics.PorterDuffXfermode
import android.graphics.RadialGradient
import android.graphics.RectF
import android.graphics.Shader
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.os.Build
import android.provider.Settings
import android.util.TypedValue
import android.view.Gravity
import android.view.View
import android.view.WindowInsets
import android.view.animation.LinearInterpolator
import android.widget.FrameLayout
import android.widget.LinearLayout
import android.widget.TextView

// The Focus Nudge shield, as Android draws it — design-mocks/182-focus-nudge-shield.html.
//
// FULL-BLEED, not a card. Cindy's flame owns the upper third with a living glow and slow rays
// behind it, the copy is centred beneath, and the two actions anchor the bottom. This is the one
// place the two platforms genuinely diverge: iOS hands Apple a ShieldConfiguration and gets a
// system-drawn card back (see targets/shield-configuration — a background, one icon, two labels
// and two buttons is the entire API). Android's overlay is our own window, so mock 182 is
// actually reachable here.
//
// 🔴 THIS IS THE RENDER, NOT THE DATA. Every string still comes from the FocusNudgeCard that
// src/lib/focus-nudge.ts cached before the session started, and nothing below reads anything else
// — no network, no disk beyond the SharedPreferences the payload already came from. The nudge has
// to work in airplane mode, and drawing it more beautifully must not be the thing that breaks
// that.
//
// NO RESOURCES, NO DEPENDENCIES, same as the rest of this module (see build.gradle): the flame is
// geometry from the generated FocusNudgeFlame, the gradients are Shaders, and the whole screen is
// built in code. Nothing here can be linked to something that opens a socket.

internal object FocusNudgeShieldView {

  // ───────────────────────────── palette ─────────────────────────────

  /**
   * Two tones, the same two the iOS shield carries (ShieldConfigurationExtension.ShieldPalette).
   *
   * The warm one is the reinforce card. The cool one is what mock 116 calls "the flame cools" —
   * the §C-safety turn, shown once repeated retreat has said this is not really about focus. The
   * ember language would be wrong there: it reads as the app pushing harder at exactly the moment
   * it is supposed to stop pushing.
   */
  private class Tone(
    val groundInner: Int,
    val groundMid: Int,
    val groundOuter: Int,
    val rays: Int,
    val eyebrow: Int,
    val glow: Int,
    val flameBase: Int,
    val flameMid: Int,
    val flameTip: Int,
    val primaryFrom: Int,
    val primaryTo: Int,
    val onPrimary: Int,
  )

  private val WARM = Tone(
    groundInner = 0xFF26173A.toInt(), // mock 182's radial ground, 0%
    groundMid = 0xFF150F24.toInt(), //   45%
    groundOuter = 0xFF0E0A19.toInt(), // 75% and out
    rays = 0xFFF5A623.toInt(),
    eyebrow = 0xFFF5A623.toInt(),
    glow = 0xFFF58C32.toInt(),
    // The ember ramp from FlameSvg's own gradient (flame-logo.tsx), bottom to top. Same three
    // stops, so the flame on the shield is the flame in the app, lit the same way.
    flameBase = 0xFFE0612C.toInt(),
    flameMid = 0xFFF2A33C.toInt(),
    flameTip = 0xFFFFD27A.toInt(),
    primaryFrom = 0xFFFF8C42.toInt(), // mock 182 --ember, 135deg
    primaryTo = 0xFFF5A623.toInt(),
    onPrimary = 0xFF2A1400.toInt(),
  )

  private val CARE = Tone(
    groundInner = 0xFF1B2340.toInt(),
    groundMid = 0xFF12162A.toInt(), // the iOS shield's careBackground
    groundOuter = 0xFF0B0F1E.toInt(),
    rays = 0xFF6F9BFF.toInt(),
    eyebrow = 0xFF6F9BFF.toInt(),
    glow = 0xFF5C86E8.toInt(),
    flameBase = 0xFF4A6FD0.toInt(),
    flameMid = 0xFF6F9BFF.toInt(),
    flameTip = 0xFFBFD4FF.toInt(),
    primaryFrom = 0xFF8AAEFF.toInt(),
    primaryTo = 0xFF6F9BFF.toInt(),
    onPrimary = 0xFF0A1330.toInt(),
  )

  private const val INK = 0xFFFFFFFF.toInt()
  private const val BODY = 0xFFC9BFE0.toInt() // mock 182 .p
  private const val MUTED = 0xFFA99CBD.toInt() // Colors.muted — the secondary action

  private fun toneFor(card: FocusNudgeCard): Tone =
    if (card.intent == "wellbeing" || card.intent == "support") CARE else WARM

  // ───────────────────────────── motion ─────────────────────────────

  /**
   * Android's "Remove animations" accessibility toggle zeroes the animator duration scale, and
   * that is the signal to honour here: a flicker and a slow rotation are exactly the kind of
   * ambient motion it exists to stop. The shield still draws in full — flame, glow, rays — it
   * simply holds still.
   *
   * Read once, at build time, rather than observed: this view lives for a few seconds inside
   * someone else's app, and a settings observer would outlive it.
   */
  private fun motionAllowed(context: Context): Boolean =
    try {
      Settings.Global.getFloat(
        context.contentResolver,
        Settings.Global.ANIMATOR_DURATION_SCALE,
        1f,
      ) != 0f
    } catch (e: Exception) {
      // Motion is the safe default here — a shield that sits still on a device that wanted
      // movement is a far smaller failure than one that does not draw.
      true
    }

  // ───────────────────────────── the screen ─────────────────────────────

  /**
   * Builds the full-bleed nudge into [root]. [onPrimary] and [onSecondary] are the overlay's own
   * handlers — this file draws, FocusNudgeOverlay decides what a tap means.
   */
  fun build(
    context: Context,
    card: FocusNudgeCard,
    root: FrameLayout,
    onPrimary: () -> Unit,
    onSecondary: () -> Unit,
  ) {
    val tone = toneFor(card)
    val animate = motionAllowed(context)
    val metrics = context.resources.displayMetrics

    // The flame's own box, and the anchor everything else is placed against. Mock 182 puts a 120px
    // glyph near the top of a 770px phone; proportional rather than fixed so it keeps its share of
    // a tablet and does not swallow a short screen, capped so it cannot become absurd.
    val flameHeight = minOf((metrics.heightPixels * 0.155f).toInt(), dp(context, 148))
    val flameTop = (metrics.heightPixels * 0.135f).toInt()

    root.setBackgroundColor(tone.groundOuter)
    // The primary button's ember glow is a real elevation shadow, and a shadow is clipped by the
    // parent unless both of these say otherwise — silently, with no warning and no visible cause.
    root.clipChildren = false

    // ── the backdrop: ember ground + rays, behind everything ──
    val backdrop = BackdropView(context, tone, flameTop + flameHeight / 2f, animate)
    root.addView(
      backdrop,
      FrameLayout.LayoutParams(
        FrameLayout.LayoutParams.MATCH_PARENT,
        FrameLayout.LayoutParams.MATCH_PARENT,
      ),
    )

    // ── the content column ──
    val column = LinearLayout(context)
    column.orientation = LinearLayout.VERTICAL
    column.gravity = Gravity.CENTER_HORIZONTAL
    column.clipChildren = false
    column.clipToPadding = false

    // The flame with its glow. Sized by height; the width follows the glyph's own aspect so it is
    // never stretched, and the box is larger than the glyph to leave the glow somewhere to fall.
    val flame = FlameView(context, tone, animate)
    val flameParams = LinearLayout.LayoutParams(
      (flameHeight * FocusNudgeFlame.ASPECT * 2.6f).toInt(),
      (flameHeight * 1.6f).toInt(),
    )
    flameParams.topMargin = flameTop - (flameHeight * 0.3f).toInt()
    flameParams.gravity = Gravity.CENTER_HORIZONTAL
    column.addView(flame, flameParams)

    val eyebrow = TextView(context)
    // Spaced in the string as well as by letterSpacing, exactly as mock 182 writes it. TalkBack
    // reads the contentDescription instead, so the spelling-out never reaches a screen reader as
    // "P. H. I. L. O. I.".
    eyebrow.text = "P H I L O I"
    eyebrow.contentDescription = "Philoi"
    eyebrow.setTextColor(tone.eyebrow)
    eyebrow.setTextSize(TypedValue.COMPLEX_UNIT_SP, 13f)
    eyebrow.typeface = Typeface.create("sans-serif-black", Typeface.NORMAL)
    eyebrow.letterSpacing = 0.34f
    eyebrow.gravity = Gravity.CENTER_HORIZONTAL
    column.addView(eyebrow, stack(context, top = 6))

    val title = TextView(context)
    title.text = card.title
    title.setTextColor(INK)
    title.setTextSize(TypedValue.COMPLEX_UNIT_SP, 29f)
    title.typeface = Typeface.create("sans-serif", Typeface.BOLD)
    title.gravity = Gravity.CENTER_HORIZONTAL
    title.setLineSpacing(0f, 1.15f)
    column.addView(title, stack(context, top = 24, side = 26))

    val body = TextView(context)
    body.text = card.body
    body.setTextColor(BODY)
    body.setTextSize(TypedValue.COMPLEX_UNIT_SP, 16f)
    body.setLineSpacing(0f, 1.4f)
    body.gravity = Gravity.CENTER_HORIZONTAL
    column.addView(body, stack(context, top = 16, side = 30))

    // Takes whatever is left, which is what anchors the actions to the bottom — and collapses to
    // nothing first when the copy is long or the font scale is large, so the buttons are the last
    // thing squeezed rather than the first.
    val filler = View(context)
    val fillerParams = LinearLayout.LayoutParams(1, 0)
    fillerParams.weight = 1f
    column.addView(filler, fillerParams)

    val primary = TextView(context)
    primary.text = card.primaryLabel
    primary.setTextColor(tone.onPrimary)
    primary.setTextSize(TypedValue.COMPLEX_UNIT_SP, 17f)
    primary.typeface = Typeface.create("sans-serif-black", Typeface.NORMAL)
    primary.gravity = Gravity.CENTER
    primary.setPadding(dp(context, 20), dp(context, 18), dp(context, 20), dp(context, 18))
    primary.background = GradientDrawable(
      GradientDrawable.Orientation.TL_BR,
      intArrayOf(tone.primaryFrom, tone.primaryTo),
    ).apply { cornerRadius = dp(context, 18).toFloat() }
    primary.isClickable = true
    primary.isFocusable = true
    primary.contentDescription = card.primaryLabel
    // Mock 182 sets a coloured ember glow under the primary. A tinted spot shadow off a real
    // elevation is the only honest way to get one; below API 28 it degrades to a plain shadow.
    primary.elevation = dp(context, 10).toFloat()
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
      primary.outlineSpotShadowColor = tone.primaryFrom
      primary.outlineAmbientShadowColor = tone.primaryFrom
    }
    primary.setOnClickListener { onPrimary() }
    column.addView(primary, stack(context, top = 0, side = 22))

    val secondary = TextView(context)
    secondary.text = card.secondaryLabel
    secondary.setTextColor(MUTED)
    secondary.setTextSize(TypedValue.COMPLEX_UNIT_SP, 16f)
    secondary.typeface = Typeface.create("sans-serif-medium", Typeface.NORMAL)
    secondary.gravity = Gravity.CENTER
    // Padded out to a full touch target rather than sized to the text. It is the quiet action,
    // never a hard one to hit — "continue anyway is always available and silent" (§C).
    secondary.setPadding(dp(context, 20), dp(context, 15), dp(context, 20), dp(context, 15))
    secondary.isClickable = true
    secondary.isFocusable = true
    secondary.contentDescription = card.secondaryLabel
    secondary.setOnClickListener { onSecondary() }
    column.addView(secondary, stack(context, top = 8, side = 22))

    root.addView(
      column,
      FrameLayout.LayoutParams(
        FrameLayout.LayoutParams.MATCH_PARENT,
        FrameLayout.LayoutParams.MATCH_PARENT,
      ),
    )

    // Full-bleed means the window runs under the status bar and the gesture pill (the overlay is
    // FLAG_LAYOUT_NO_LIMITS). The GROUND should go all the way; the copy and the buttons must not.
    // The default stands in until insets are dispatched, and remains if they never are.
    column.setPadding(0, 0, 0, dp(context, 34))
    root.setOnApplyWindowInsetsListener { _, insets ->
      val (top, bottom) = systemBars(insets)
      // The column moves down by the status bar; the backdrop does not, so the rays are told to
      // follow. Relative, because insets can be dispatched more than once.
      val previousTop = column.paddingTop
      column.setPadding(0, top, 0, bottom + dp(context, 34))
      backdrop.shiftCenter((top - previousTop).toFloat())
      insets
    }
  }

  // ───────────────────────────── backdrop ─────────────────────────────

  /**
   * The ember ground, and the rays turning slowly behind the flame.
   *
   * The rays are rendered ONCE into a small bitmap and then merely rotated each frame. Building
   * thirty masked wedges per frame, full-screen, in a window sitting on top of whatever the user
   * just opened, is the kind of cost that shows up as jank on exactly the devices this feature
   * matters most on.
   */
  private class BackdropView(
    context: Context,
    private val tone: Tone,
    private var centerYPx: Float,
    private val animate: Boolean,
  ) : View(context) {

    private val paint = Paint(Paint.ANTI_ALIAS_FLAG)
    private val rayPaint = Paint(Paint.ANTI_ALIAS_FLAG or Paint.FILTER_BITMAP_FLAG)
    private val rays: Bitmap? = buildRays(tone.rays)
    private var spin: ValueAnimator? = null
    private var angle = 0f

    /**
     * The content column is padded down by the status bar inset once insets arrive; the backdrop is
     * not (its ground runs edge to edge). Without this the rays stay put while the flame moves, and
     * the glow ends up sitting a status bar above the thing it is meant to be radiating from.
     */
    fun shiftCenter(dy: Float) {
      if (dy == 0f) return
      centerYPx += dy
      if (width > 0 && height > 0) buildGround(width, height)
      invalidate()
    }

    override fun onSizeChanged(w: Int, h: Int, oldw: Int, oldh: Int) {
      super.onSizeChanged(w, h, oldw, oldh)
      if (w <= 0 || h <= 0) return
      buildGround(w, h)
    }

    private fun buildGround(w: Int, h: Int) {
      // Mock 182's `radial-gradient(90% 55% at 50% 30%, ...)` is elliptical, which a RadialGradient
      // is not — so the shader is built round and squashed by its own local matrix.
      val cx = w / 2f
      val rx = w * 0.9f
      val ry = h * 0.55f
      val shader = RadialGradient(
        cx, centerYPx, rx,
        intArrayOf(tone.groundInner, tone.groundMid, tone.groundOuter, tone.groundOuter),
        floatArrayOf(0f, 0.45f, 0.75f, 1f),
        Shader.TileMode.CLAMP,
      )
      shader.setLocalMatrix(Matrix().apply { setScale(1f, ry / rx, cx, centerYPx) })
      paint.shader = shader
    }

    override fun onAttachedToWindow() {
      super.onAttachedToWindow()
      if (!animate) return
      // 40s a revolution, as the mock. Slow enough to read as light rather than as a spinner.
      spin = ValueAnimator.ofFloat(0f, 360f).apply {
        duration = 40_000L
        repeatCount = ValueAnimator.INFINITE
        interpolator = LinearInterpolator()
        addUpdateListener {
          val next = it.animatedValue as Float
          // ~0.3° is about a pixel at the rays' outer edge; anything finer is a full-screen
          // invalidate that changes nothing anyone can see.
          if (kotlin.math.abs(next - angle) >= 0.3f) {
            angle = next
            invalidate()
          }
        }
        start()
      }
    }

    override fun onDetachedFromWindow() {
      spin?.cancel()
      spin = null
      super.onDetachedFromWindow()
    }

    override fun onDraw(canvas: Canvas) {
      canvas.drawPaint(paint)
      val bitmap = rays ?: return
      val r = width * 0.663f // mock 182: a 520px ray box on a 392px-wide phone
      val cx = width / 2f
      canvas.save()
      canvas.rotate(angle, cx, centerYPx)
      canvas.drawBitmap(bitmap, null, RectF(cx - r, centerYPx - r, cx + r, centerYPx + r), rayPaint)
      canvas.restore()
    }

    /**
     * Thirty spokes every 12°, each 2.6° wide, masked to an annulus so they emerge from behind the
     * flame rather than out of its middle, and fade before they reach the copy. That mask is the
     * whole reason this reads as light and not as a pinwheel.
     *
     * 512px because the rays are soft gradients with nothing in them a larger bitmap would carry;
     * at full screen resolution this would be several megabytes for the same picture.
     */
    private fun buildRays(color: Int): Bitmap? =
      try {
        val size = 512
        val bitmap = Bitmap.createBitmap(size, size, Bitmap.Config.ARGB_8888)
        val canvas = Canvas(bitmap)
        val box = RectF(0f, 0f, size.toFloat(), size.toFloat())
        val spoke = Paint(Paint.ANTI_ALIAS_FLAG).apply {
          this.color = Color.argb(41, Color.red(color), Color.green(color), Color.blue(color))
        }
        var i = 0
        while (i < 30) {
          canvas.drawArc(box, i * 12f, 2.6f, true, spoke)
          i += 1
        }
        val mask = Paint(Paint.ANTI_ALIAS_FLAG).apply {
          shader = RadialGradient(
            size / 2f, size / 2f, size / 2f,
            intArrayOf(Color.TRANSPARENT, Color.TRANSPARENT, Color.BLACK, Color.TRANSPARENT),
            floatArrayOf(0f, 0.231f, 0.577f, 0.846f),
            Shader.TileMode.CLAMP,
          )
          xfermode = PorterDuffXfermode(PorterDuff.Mode.DST_IN)
        }
        canvas.drawRect(box, mask)
        bitmap
      } catch (e: OutOfMemoryError) {
        // The rays are decoration. Losing them costs the screen some depth; failing to draw the
        // nudge costs the person the nudge.
        null
      }
  }

  // ───────────────────────────── the flame ─────────────────────────────

  /**
   * Cindy's flame and its glow, breathing.
   *
   * The glyph is FocusNudgeFlame — generated from the one FLAME_PATH in flame-logo.tsx and ALREADY
   * MIRRORED (CINDY_SPEC rendering rule 1). Nothing here flips it again; two flips cancel and the
   * shield would quietly show the retired orientation.
   */
  private class FlameView(
    context: Context,
    private val tone: Tone,
    private val animate: Boolean,
  ) : View(context) {

    private val glowPaint = Paint(Paint.ANTI_ALIAS_FLAG)
    private val flamePaint = Paint(Paint.ANTI_ALIAS_FLAG)
    private var pulse: ValueAnimator? = null

    /**
     * 0..1, the flicker's position. Parked mid-breath when motion is off, so a still shield is the
     * flame at rest rather than caught at the bottom of a pulse it will never finish.
     */
    private var phase = if (animate) 0f else 0.5f

    override fun onSizeChanged(w: Int, h: Int, oldw: Int, oldh: Int) {
      super.onSizeChanged(w, h, oldw, oldh)
      if (w <= 0 || h <= 0) return
      val glyphH = h / 1.6f
      val glyphW = glyphH * FocusNudgeFlame.ASPECT
      val top = (h - glyphH) / 2f
      flamePaint.shader = LinearGradient(
        0f, top, 0f, top + glyphH,
        intArrayOf(tone.flameTip, tone.flameMid, tone.flameBase),
        floatArrayOf(0f, 0.45f, 1f),
        Shader.TileMode.CLAMP,
      )
      glowPaint.shader = RadialGradient(
        w / 2f, h / 2f, maxOf(glyphW, glyphH) * 1.25f,
        intArrayOf(
          Color.argb(150, Color.red(tone.glow), Color.green(tone.glow), Color.blue(tone.glow)),
          Color.argb(70, Color.red(tone.glow), Color.green(tone.glow), Color.blue(tone.glow)),
          Color.TRANSPARENT,
        ),
        floatArrayOf(0f, 0.45f, 1f),
        Shader.TileMode.CLAMP,
      )
    }

    override fun onAttachedToWindow() {
      super.onAttachedToWindow()
      if (!animate) return
      // 2.4s round trip — mock 182's `flick`. A breath, not a strobe.
      pulse = ValueAnimator.ofFloat(0f, 1f).apply {
        duration = 1_200L
        repeatCount = ValueAnimator.INFINITE
        repeatMode = ValueAnimator.REVERSE
        addUpdateListener {
          phase = it.animatedValue as Float
          invalidate()
        }
        start()
      }
    }

    override fun onDetachedFromWindow() {
      pulse?.cancel()
      pulse = null
      super.onDetachedFromWindow()
    }

    override fun onDraw(canvas: Canvas) {
      val w = width.toFloat()
      val h = height.toFloat()
      if (w <= 0f || h <= 0f) return

      val scale = 1f + 0.05f * phase
      val tilt = -1f + 2f * phase

      // The glow swells with the flame and is drawn UNDER it, so the glyph never sits on a disc
      // brighter than the light it is supposedly casting.
      glowPaint.alpha = (255 * (0.7f + 0.3f * phase)).toInt()
      canvas.save()
      canvas.scale(scale, scale, w / 2f, h / 2f)
      canvas.drawCircle(w / 2f, h / 2f, maxOf(w, h) / 2f, glowPaint)
      canvas.restore()

      val glyphH = h / 1.6f
      val glyphW = glyphH * FocusNudgeFlame.ASPECT
      canvas.save()
      canvas.rotate(tilt, w / 2f, h / 2f)
      canvas.scale(scale, scale, w / 2f, h / 2f)
      canvas.drawPath(
        FocusNudgeFlame.path((w - glyphW) / 2f, (h - glyphH) / 2f, glyphW, glyphH),
        flamePaint,
      )
      canvas.restore()
    }
  }

  // ───────────────────────────── plumbing ─────────────────────────────

  /** The status-bar and navigation-bar insets, as (top, bottom). */
  @Suppress("DEPRECATION") // the pre-R accessors, still the only ones on API 26..29
  private fun systemBars(insets: WindowInsets): Pair<Int, Int> =
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
      val bars = insets.getInsets(WindowInsets.Type.systemBars())
      Pair(bars.top, bars.bottom)
    } else {
      Pair(insets.systemWindowInsetTop, insets.systemWindowInsetBottom)
    }

  private fun dp(context: Context, value: Int): Int =
    (value * context.resources.displayMetrics.density).toInt()

  private fun stack(context: Context, top: Int, side: Int = 0): LinearLayout.LayoutParams {
    val params = LinearLayout.LayoutParams(
      LinearLayout.LayoutParams.MATCH_PARENT,
      LinearLayout.LayoutParams.WRAP_CONTENT,
    )
    params.topMargin = dp(context, top)
    params.leftMargin = dp(context, side)
    params.rightMargin = dp(context, side)
    return params
  }
}
