package expo.modules.philoifocusnudge

import android.graphics.Path

// ══════════════════════════════════════════════════════════════════════════════════════════════
// GENERATED FILE — DO NOT EDIT BY HAND.
//
//   node scripts/gen-flame-assets.js
//
// The Cindy flame, as geometry, for the Focus Nudge overlay (FocusNudgeShieldView). Written from
// the ONE glyph in src/components/ui/flame-logo.tsx, already mirrored by
// FLAME_MIRROR_TRANSFORM (CINDY_SPEC rendering rule 1) — so do NOT flip it again here or at the
// call site. Two flips cancel and the overlay silently renders the retired orientation.
//
// Points are the outline decimated to 0.0006 of the glyph's height and normalised to its
// INK bounding box: x and y both run 0..1, with ASPECT carrying the real width:height so the
// caller can size it without stretching.
// ══════════════════════════════════════════════════════════════════════════════════════════════

internal object FocusNudgeFlame {

  /** width / height of the inked glyph. */
  const val ASPECT = 0.727273f

  /** Closed outline, x,y interleaved, both normalised 0..1 over the ink box. */
  private val POINTS = floatArrayOf(
    0.50000f, 0.00000f, 0.48084f, 0.03700f, 0.45877f, 0.07149f, 0.43417f, 0.10374f,
    0.39812f, 0.14375f, 0.36914f, 0.17188f, 0.32864f, 0.20741f, 0.28687f, 0.24130f,
    0.19292f, 0.31500f, 0.15330f, 0.34815f, 0.12524f, 0.37376f, 0.10755f, 0.39134f,
    0.07508f, 0.42810f, 0.05375f, 0.45739f, 0.04118f, 0.47790f, 0.03006f, 0.49929f,
    0.02051f, 0.52164f, 0.00937f, 0.55715f, 0.00424f, 0.58228f, 0.00108f, 0.60865f,
    0.00000f, 0.63636f, 0.00060f, 0.65421f, 0.00241f, 0.67201f, 0.00961f, 0.70731f,
    0.02153f, 0.74192f, 0.03806f, 0.77552f, 0.05904f, 0.80778f, 0.08427f, 0.83839f,
    0.11349f, 0.86705f, 0.14645f, 0.89349f, 0.18280f, 0.91746f, 0.22221f, 0.93872f,
    0.26430f, 0.95706f, 0.30866f, 0.97232f, 0.35486f, 0.98434f, 0.40245f, 0.99301f,
    0.45099f, 0.99825f, 0.50000f, 1.00000f, 0.54901f, 0.99825f, 0.59755f, 0.99301f,
    0.64514f, 0.98434f, 0.69134f, 0.97232f, 0.73570f, 0.95706f, 0.77779f, 0.93872f,
    0.81720f, 0.91746f, 0.85355f, 0.89349f, 0.88651f, 0.86705f, 0.91573f, 0.83839f,
    0.94096f, 0.80778f, 0.96194f, 0.77552f, 0.97847f, 0.74192f, 0.99039f, 0.70731f,
    0.99759f, 0.67201f, 0.99940f, 0.65421f, 1.00000f, 0.63636f, 0.99946f, 0.61545f,
    0.99707f, 0.58877f, 0.99287f, 0.56339f, 0.98691f, 0.53927f, 0.98134f, 0.52196f,
    0.97249f, 0.49987f, 0.96209f, 0.47887f, 0.95022f, 0.45888f, 0.93694f, 0.43984f,
    0.92233f, 0.42170f, 0.90647f, 0.40438f, 0.88941f, 0.38783f, 0.87125f, 0.37199f,
    0.84710f, 0.35309f, 0.80000f, 0.32121f, 0.79935f, 0.34119f, 0.79654f, 0.36633f,
    0.79306f, 0.38407f, 0.78669f, 0.40623f, 0.77849f, 0.42668f, 0.76861f, 0.44543f,
    0.75719f, 0.46248f, 0.74438f, 0.47782f, 0.73033f, 0.49145f, 0.71517f, 0.50339f,
    0.69906f, 0.51361f, 0.67781f, 0.52400f, 0.66010f, 0.53039f, 0.64191f, 0.53508f,
    0.62339f, 0.53806f, 0.60000f, 0.53939f, 0.59446f, 0.52465f, 0.58864f, 0.50263f,
    0.58545f, 0.48067f, 0.58448f, 0.45870f, 0.58533f, 0.43665f, 0.58761f, 0.41446f,
    0.60410f, 0.31518f, 0.60862f, 0.27490f, 0.60928f, 0.23299f, 0.60705f, 0.20695f,
    0.60421f, 0.18917f, 0.59766f, 0.16184f, 0.59157f, 0.14314f, 0.57957f, 0.11434f,
    0.56948f, 0.09461f, 0.55093f, 0.06417f, 0.53610f, 0.04328f, 0.51916f, 0.02190f,
    0.50000f, 0.00000f,
  )

  /** The flame as a Path filling [width] x [height], offset to ([left], [top]). */
  fun path(left: Float, top: Float, width: Float, height: Float): Path {
    val path = Path()
    var i = 0
    while (i < POINTS.size) {
      val x = left + POINTS[i] * width
      val y = top + POINTS[i + 1] * height
      if (i == 0) path.moveTo(x, y) else path.lineTo(x, y)
      i += 2
    }
    path.close()
    return path
  }
}
