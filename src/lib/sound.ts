import type { AudioPlayer } from 'expo-audio';

// Semantic reward moments (PHILOI_UI_SPEC.md §22), not generic intensity tiers — each name is
// the specific beat it's tied to, not a "how loud" label. Real fire recordings (0.3-2.2s,
// peak-normalized to -1dBFS, mono 44.1k), replacing the earlier placeholder spark/bloom/surge
// set.
export type RewardCue =
  | 'ignite'
  | 'whoosh'
  | 'settle'
  | 'rankup'
  | 'spark'
  | 'rankup-bronze'
  | 'rankup-silver'
  | 'rankup-gold'
  | 'rankup-platinum'
  | 'rankup-diamond'
  // The four legend tiers finally have their own recordings — until now Hero/Titan/Immortal fell
  // back to the generic hit and Olympian borrowed Diamond's sparkle.
  | 'rankup-hero'
  | 'rankup-titan'
  | 'rankup-olympian'
  | 'rankup-immortal'
  | 'rankup-primordial'
  // Titan's own recording is a sub-heavy rumble — real on a good speaker, INAUDIBLE through a
  // phone (RANKUP_SPEC §9). This is the audible transient blended on top of it so the colossal
  // slam actually reads; it's the anvil-slam asset, given its own cue (and therefore its own
  // player) so a user with the anvil SFX cosmetic equipped doesn't have one playback restart
  // the other mid-hit.
  | 'rankup-titan-boom'
  // Immortal's "laughter of the damned" (RANKUP_SPEC §3/§9) — a second layer UNDER the tier hit,
  // not a replacement for it, so Immortal reads as haunted rather than just another chime.
  | 'rankup-immortal-souls'
  // The two band crossings ONLY (RANKUP_SPEC §9) — the first transcension (Diamond I → Hero III)
  // and the apex (Immortal I → Primordial). Each is a FULL anthem that plays once, uncut: it IS
  // the build, which is why there's no riser anywhere in the moment any more.
  | 'ascension-hero'
  | 'ascension-primordial'
  // Equipped SFX cosmetics (21f/21i). The cue name IS the catalog item id, so equippedSfxCue()
  // is an identity lookup and a new SFX item needs no mapping table entry — just its file.
  //
  // These are the START and END stings of a lock-in (PUNCHLIST_12), not rank-up sounds. There is
  // deliberately no 'sfx-victory-anthem' here any more: an 83-second anthem cannot punctuate a
  // session, and the same recording already serves as the Hero band-crossing anthem above.
  | 'sfx-heavy-anvil-slam'
  | 'sfx-sub-bass-drop'
  | 'sfx-jet-engine-ignition'
  | 'sfx-olympian-foghorn'
  // Forge Pass S1's tier-50 mythic. Last of the SFX set to get a file (AUDIO_TO_SOURCE.md); the
  // asset landed before the map did, so equipping it was silent even once the mp3 shipped.
  | 'sfx-emberfall-strike'
  // The two starter stings from the seeded loadout (#88). Same id-is-the-cue rule as the four
  // above, but they re-point at one-shots the app already ships rather than adding assets — a
  // starter set has no business shipping bespoke audio.
  | 'sfx-campfire-spark'
  | 'sfx-ember-settle'
  // Loot-box opening (PUNCHLIST_14 §2). `box-open` is the per-box crack in the ×N cascade and is
  // deliberately the quietest thing here — it fires up to ten times in about two seconds, so
  // anything with a tail would stack into mush. The six `reveal-*` cues are the escalating
  // common→mythic ladder and fire exactly ONCE per open, for the best pull.
  | 'box-open'
  | 'reveal-common'
  | 'reveal-uncommon'
  | 'reveal-rare'
  | 'reveal-epic'
  | 'reveal-legendary'
  | 'reveal-mythic';

// The two band-crossing anthems (RANKUP_SPEC §9) — both mixed and in-repo now, so these are
// plain requires rather than the old "uncomment when the mix lands" placeholders.
//
// Each plays in FULL, exactly once, and is never looped or trimmed: ascension-hero is the
// diamond-shatter break-through into the ~83s Champions Anthem, transcension-primordial the
// uncut ~3.5min Atum track for the apex. They start in the crossing's pre-beat and build across
// the whole sequence, which is why nothing else needs a riser under it.
//
// Kept in their own map (rather than folded into SOURCES) because `players` stays Partial over
// these: hasRewardSound() is what lets fireRankUp fall back to an ordinary tier hit if an anthem
// is ever pulled, instead of leaving the biggest moment in the app silent.
const ASCENSION_SOURCES: Partial<Record<RewardCue, number>> = {
  'ascension-hero': require('../../assets/audio/rank/ascension-hero.mp3'),
  // transcension-primordial.mp3, NOT the old ascension-primordial.mp3 — that one was the
  // unmixed Atum stand-in and has been deleted from the repo.
  'ascension-primordial': require('../../assets/audio/rank/transcension-primordial.mp3'),
};

const SOURCES: Omit<Record<RewardCue, number>, 'ascension-hero' | 'ascension-primordial'> = {
  ignite: require('../../assets/sounds/ignite.wav'), // Lock-in tap
  whoosh: require('../../assets/sounds/whoosh.wav'), // XP-bar fill on the done screen
  settle: require('../../assets/sounds/settle.wav'), // Done / Post
  rankup: require('../../assets/sounds/rankup.wav'), // generic rank-up fallback (platinum's crossing)
  spark: require('../../assets/sounds/spark.wav'), // per-ember landing tick (fire-complete celebration)
  // Per-tier-crossing cues (PHILOI_UI_SPEC.md §11/§22, selected by the NEW tier type).
  'rankup-bronze': require('../../assets/sounds/rankup-bronze.wav'), // blacksmith hammer strike
  'rankup-silver': require('../../assets/sounds/rankup-silver.wav'), // cash-register ka-ching
  'rankup-gold': require('../../assets/sounds/rankup-gold.wav'), // bright ching
  'rankup-platinum': require('../../assets/sounds/rankup-platinum.mp3'), // platinum's own hit — was the generic 'rankup'
  'rankup-diamond': require('../../assets/sounds/rankup-diamond.wav'), // angelic choir swell
  // The four legend tiers now have bespoke recordings. Olympian no longer borrows
  // rankup-diamond-sparkle.wav, which is consequently unreferenced (kept on disk as a spare).
  'rankup-hero': require('../../assets/sounds/rankup-hero.mp3'), // sword-slash + shield (Hero's DIVISION bumps; the band crossing gets the anthem)
  'rankup-titan': require('../../assets/sounds/rankup-titan.mp3'), // sub-heavy rumble — always blended with rankup-titan-boom
  'rankup-olympian': require('../../assets/sounds/rankup-olympian.mp3'), // choir + held foghorn notes + sub-bass
  'rankup-immortal': require('../../assets/sounds/rankup-immortal.mp3'),
  // The apex keeps its original molten recording — the asset was renamed alongside the tier so
  // nothing in the tree still carries the old name.
  'rankup-primordial': require('../../assets/sounds/rankup-primordial.wav'), // mean guitar riff
  // Titan's audible transient (see the cue's declaration) — same file the anvil SFX cosmetic
  // uses, deliberately a separate cue so the two get separate players.
  'rankup-titan-boom': require('../../assets/audio/cosmetic/sfx-heavy-anvil-slam.mp3'),
  // Immortal's spectral layer — plays UNDER the rankup-immortal hit, not instead of it.
  'rankup-immortal-souls': require('../../assets/sounds/rankup-immortal-souls.mp3'),

  // Equipped SFX cosmetics. Preloaded like every other one-shot so an equipped sting fires on the
  // same tick as the ignite tap — the start sting can't wait on a file read. Named by catalog id.
  'sfx-heavy-anvil-slam': require('../../assets/audio/cosmetic/sfx-heavy-anvil-slam.mp3'),
  'sfx-sub-bass-drop': require('../../assets/audio/cosmetic/sfx-sub-bass-drop.mp3'),
  'sfx-jet-engine-ignition': require('../../assets/audio/cosmetic/sfx-jet-engine-ignition.mp3'),
  'sfx-olympian-foghorn': require('../../assets/audio/cosmetic/sfx-olympian-foghorn.mp3'),
  'sfx-emberfall-strike': require('../../assets/audio/cosmetic/sfx-emberfall-strike.mp3'),

  // Starter stings (#88) — deliberately the existing spark/settle one-shots. They already sound
  // like a fire catching and a fire banking down, which is exactly what the two slots mean, and
  // reusing them keeps the seeded loadout from adding a byte to the bundle.
  'sfx-campfire-spark': require('../../assets/sounds/spark.wav'),
  'sfx-ember-settle': require('../../assets/sounds/settle.wav'),

  // The box-open ladder (PUNCHLIST_14 §2), built to the six-tier framework. Preloaded with
  // everything else: the crack cue has to land on the same frame as the box breaking, and a file
  // read there would put the sound behind the animation.
  'box-open': require('../../assets/sounds/reveal/box-open.mp3'), // crack/whoosh, fires per box
  'reveal-common': require('../../assets/sounds/reveal/reveal-common.mp3'), // cardboard flip, dead dry
  'reveal-uncommon': require('../../assets/sounds/reveal/reveal-uncommon.mp3'), // leather + metal snap + wood chime
  'reveal-rare': require('../../assets/sounds/reveal/reveal-rare.mp3'), // brass unlock + crystal chord
  'reveal-epic': require('../../assets/sounds/reveal/reveal-epic.mp3'), // arc crackle + synth-gong swell
  'reveal-legendary': require('../../assets/sounds/reveal/reveal-legendary.mp3'), // vault slam + brass fanfare
  'reveal-mythic': require('../../assets/sounds/reveal/reveal-mythic.mp3'), // implosion + war-horn, 5s aura tail
};

// Partial: the ascension cues only get a player once their asset lands (see ASCENSION_SOURCES).
let players: Partial<Record<RewardCue, AudioPlayer>> | null = null;

// Preloads all four reward sounds once at app start (see _layout.tsx) so the very first
// check-in has zero playback latency, and configures the audio session to play THROUGH the
// iOS ringer switch (punchlist 15.1).
//
// `playsInSilentMode: true` — expo-audio's default, and the fix for "equipped audio never
// plays". This flag was previously false "to respect silent mode", which sounds right and is
// wrong: most phones live on silent, so it muted every cosmetic sound at the audio-session
// level regardless of volume — the equipped ambient loops the user paid for AND the reward
// SFX. These are deliberate, opt-in media (you equip an environment; you keep the in-app
// sound toggle), so they behave like a music or meditation app, not like a notification
// chime. The real controls stay the in-app `sound` preference and the device volume.
//
// `interruptionMode` — the other half of that trade, and the fix for the complaint it created
// (COSMETIC_UI_FIXES §6). The default playback session is exclusive: the instant Philoi created a
// player it STOPPED whatever the user was listening to. People lock in at the gym with their own
// music on, so an app that silences Spotify to play a bonfire crackle over the top of nothing is
// an app they close. Mixing lets both play; the ambient loop already sits at 0.35 volume, so it
// lands under their track rather than against it. The `session_audio_enabled` preference
// (equipped-audio.ts) is the off switch for people who want none of it.
//
// Which of the two modes is now the "Duck to my music" switch rather than a constant — see
// applyAudioInterruptionMode below.
//
// expo-audio resolves its native binding at import time (AudioModule.js does a top-level
// `requireNativeModule('ExpoAudio')`, unlike expo-haptics which soft-checks lazily on each
// call) — so a dev-client build that predates this dependency crashes the instant anything
// `require`s the package, before any try/catch in our own code could run. Keeping the import
// out of this file's top level and only `require`-ing it inside this function means that
// crash, if it happens, happens *inside* the try/catch below instead of during bundle
// bootstrap. Reward sound is a nice-to-have; it must never take down app startup.
export async function preloadRewardSounds(duckToMusic: boolean): Promise<void> {
  try {
    const { createAudioPlayer } = require('expo-audio') as typeof import('expo-audio');
    await applyAudioInterruptionMode(duckToMusic);
    if (players) return;
    // Built by iterating SOURCES rather than listing each cue by hand — the old literal had to be
    // edited in lockstep with SOURCES, and a cue added to one but not the other silently never
    // played. Adding a file to SOURCES is now the only step.
    players = {};
    for (const [cue, source] of Object.entries(SOURCES)) {
      players[cue as RewardCue] = createAudioPlayer(source as number);
    }
    // Any ascension mix that has actually been dropped in. Absent = that cue stays silent.
    // loop is set explicitly rather than left to the default: these are the only multi-minute
    // one-shots in the set, so a stray repeat would be a 3.5-minute one (RANKUP_SPEC §9's "plays
    // entirely ONCE — never looped, never trimmed").
    for (const [cue, source] of Object.entries(ASCENSION_SOURCES)) {
      if (source === undefined) continue;
      const player = createAudioPlayer(source);
      player.loop = false;
      players[cue as RewardCue] = player;
    }
  } catch (e) {
    console.warn('[sound] expo-audio unavailable — reward sounds disabled this session:', e);
  }
}

/**
 * Put the audio session into the mode the "Duck to my music" switch asks for.
 *
 * The switch reads "Lower the ambient when your music is playing, instead of stopping it", so:
 *
 *   ON  → 'mixWithOthers'. Their track keeps playing at full volume and our ambient sits under it
 *         at its own 0.35. Nothing is ducked in the iOS sense; the ambient is simply quiet, which
 *         is what the row promises and what everybody wants at the gym. This is the default.
 *   OFF → 'doNotMix'. The exclusive session — Philoi takes the output and their music stops. That
 *         is the "instead of stopping it" the copy names as the alternative, and it is the right
 *         answer for someone using an environment loop as the thing they are listening TO.
 *
 * Deliberately not 'duckOthers', which is the option whose NAME matches the row and whose BEHAVIOUR
 * is backwards: it ducks the OTHER app under ours. Turning on a switch called "duck to my music"
 * and having it quieten your music is precisely the wrong way round.
 *
 * Exported because the preference is live — reward-settings calls this on every write, so the
 * switch takes effect on the session that is already running rather than at the next cold start.
 * Sound is a nice-to-have, so a failure here warns and leaves the previous mode standing.
 */
export async function applyAudioInterruptionMode(duckToMusic: boolean): Promise<void> {
  try {
    const { setAudioModeAsync } = require('expo-audio') as typeof import('expo-audio');
    await setAudioModeAsync({
      playsInSilentMode: true,
      interruptionMode: duckToMusic ? 'mixWithOthers' : 'doNotMix',
      // #147 — the session survives the app going to the background, so a locked phone on a desk
      // keeps the ambient loop running through a study session instead of falling silent at the
      // exact moment it was doing its job. Paired with UIBackgroundModes:['audio'] on iOS and the
      // media-playback foreground service on Android; without those this flag is inert, which is
      // why it ships in the same native build.
      //
      // The property is `shouldPlayInBackground`. expo-av called it `staysActiveInBackground` and
      // expo-audio renamed it — the old name is not an error, it is silently ignored.
      shouldPlayInBackground: true,
    });
  } catch (e) {
    console.warn('[sound] could not set audio interruption mode:', e);
  }
}

// Fire-and-forget by design — RewardBurst.fire() calls this without awaiting so sound,
// haptic, and animation all kick off on the same synchronous tick. The players are
// preloaded and idle between plays, so seekTo(0) resolves near-instantly; only needed
// because these are shared long-lived players replayed many times, unlike a fresh
// one-shot player that's already at position 0.
/** Whether a cue actually has a loaded player. Lets a caller pick a different arrangement when an
 * optional asset (the ascension mixes) hasn't been dropped in yet, instead of silently playing
 * nothing — see fireRankUp's anthem branch. */
export function hasRewardSound(cue: RewardCue): boolean {
  return Boolean(players?.[cue]);
}

// ───────────────────────── looping ambient layer (Audio environments, 21f) ─────────────────────
//
// Structurally different from every cue above: those are short one-shots on preloaded, long-lived
// players. An ambient environment is a long loop that only exists while a lock-in is running, so
// it gets its own single player, created on start and torn down on stop rather than preloaded —
// preloading seven multi-minute loops for the one a user has equipped would be pure waste.
//
// Keyed by CATALOG ID so the equipped item maps straight to its file with no lookup table. Unlike
// the one-shots above these are NOT preloaded: seven multi-minute loops to play the one a user has
// equipped would be pure waste, so the player is built on session start and torn down on stop.
const AMBIENT_SOURCES: Record<string, number> = {
  // The free starter environment every account already owns (seed_default_loadout, 0073), and so
  // by far the most likely Audio item to be equipped — the other six are box-pool cosmetics. It
  // shipped with no file at all, so equipping it played silence with no explanation.
  'audio-base-hearth-hum': require('../../assets/audio/cosmetic/audio-base-hearth-hum.mp3'),
  'audio-heavy-bonfire-crackle': require('../../assets/audio/cosmetic/audio-heavy-bonfire-crackle.mp3'),
  'audio-edm-pulse': require('../../assets/audio/cosmetic/audio-edm-pulse.mp3'),
  'audio-midnight-thunder': require('../../assets/audio/cosmetic/audio-midnight-thunder.mp3'),
  'audio-monastery-drone': require('../../assets/audio/cosmetic/audio-monastery-drone.mp3'),
  'audio-lofi-lullaby': require('../../assets/audio/cosmetic/audio-lofi-lullaby.mp3'),
  'audio-deep-space-sub-bass': require('../../assets/audio/cosmetic/audio-deep-space-sub-bass.mp3'),
};

let ambient: AudioPlayer | null = null;
let ambientKey: string | null = null;

/** Whether an Audio environment's loop file has actually shipped. */
export function hasAmbientLoop(itemId: string): boolean {
  return AMBIENT_SOURCES[itemId] !== undefined;
}

/** Which ambient environments this build can actually play. The per-session picker filters the
 *  user's owned Audio items through this, so an item granted by a newer server than the installed
 *  app is never offered as a choice that would silently do nothing. */
export function shippedAmbientIds(): string[] {
  return Object.keys(AMBIENT_SOURCES);
}

/** The environment currently looping, or null. Lets the lock-in UI show what is actually playing
 *  rather than what is merely equipped — the two diverge the moment a session picks its own. */
export function currentAmbientId(): string | null {
  return ambientKey;
}

/**
 * Start (or swap to) an ambient loop. Idempotent for the same item, so a lock-in screen that
 * re-renders doesn't restart the audio. Volume sits low by default — this plays UNDER a work
 * session and must never become the thing you notice.
 */
export function startAmbientLoop(itemId: string, volume = 0.35): void {
  if (ambientKey === itemId && ambient) return;
  const source = AMBIENT_SOURCES[itemId];
  if (source === undefined) {
    // Equipped, but unmixed. Leave whatever is playing alone rather than cutting to silence.
    return;
  }
  try {
    const { createAudioPlayer } = require('expo-audio') as typeof import('expo-audio');
    stopAmbientLoop();
    const player = createAudioPlayer(source);
    player.loop = true;
    player.volume = volume;
    player.play();
    ambient = player;
    ambientKey = itemId;
  } catch (e) {
    console.warn('[sound] ambient loop unavailable:', e);
  }
}

export function playRewardSound(cue: RewardCue, volume = 1): void {
  const player = players?.[cue];
  if (!player) return;
  player.volume = volume;
  player.seekTo(0).finally(() => player.play());
}

// Stops a long/still-playing cue mid-flight and rewinds it so the next play starts clean from the
// top — used to cut the rank-up riser at the flare. Safe to call when nothing is playing (pause on
// an idle shared player is a no-op).
export function stopAmbientLoop(): void {
  ambient?.pause();
  ambient = null;
  ambientKey = null;
}

export function stopRewardSound(cue: RewardCue): void {
  const player = players?.[cue];
  if (!player) return;
  // Cancel any fade still stepping this cue's volume down — otherwise a fade started before the
  // stop keeps writing volume onto the (now rewound) player and the NEXT play starts part-faded.
  clearFade(cue);
  player.pause();
  player.seekTo(0).catch(() => {});
}

// ───────────────────────────── volume fades (Immortal's souls layer) ───────────────────────────
//
// Only one cue needs this today — Immortal's "laughter of the damned" has to sit PROMINENT (§9)
// and then fade out slowly rather than cutting off, so the voices die away on the same beat the
// chime does instead of vanishing mid-laugh. Stepped on a timer because expo-audio exposes a
// plain `volume` setter with no ramp of its own.
const fades = new Map<RewardCue, ReturnType<typeof setInterval>>();

function clearFade(cue: RewardCue): void {
  const timer = fades.get(cue);
  if (timer) {
    clearInterval(timer);
    fades.delete(cue);
  }
}

const FADE_STEP_MS = 60;

/** Ramp a playing cue from its current volume to silence over `durationMs`, then stop it. Safe to
 * call on a cue that isn't playing (no player = no-op) and idempotent (a second call restarts the
 * ramp rather than running two). */
export function fadeOutRewardSound(cue: RewardCue, durationMs: number): void {
  const player = players?.[cue];
  if (!player) return;
  clearFade(cue);
  const from = player.volume;
  const steps = Math.max(1, Math.round(durationMs / FADE_STEP_MS));
  let step = 0;
  const timer = setInterval(() => {
    step += 1;
    if (step >= steps) {
      clearFade(cue);
      // Rewind for the next play and restore the volume, so the fade can't leak into it.
      stopRewardSound(cue);
      player.volume = from;
      return;
    }
    player.volume = from * (1 - step / steps);
  }, FADE_STEP_MS);
  fades.set(cue, timer);
}

/** Length of a preloaded cue in ms, or null while it's still loading (expo-audio reports 0 until
 * the asset's metadata is read). Used to time a fade against the clip it's fading. */
export function getRewardSoundDurationMs(cue: RewardCue): number | null {
  const seconds = players?.[cue]?.duration;
  return seconds && seconds > 0 ? seconds * 1000 : null;
}

/** Silence every cue the rank-up moment can have in flight. The tier hits deliberately ring out
 * long (§9) and the two anthems run for minutes, so dismissing the celebration has to actually
 * stop them — otherwise the Champions Anthem follows you back to the home tab. */
export function stopRewardSounds(cues: RewardCue[]): void {
  cues.forEach(stopRewardSound);
}

// ───────────────────────────── audition previews (PUNCHLIST_11) ────────────────────────────────
//
// A third playback system, deliberately separate from both of the above. The one-shots are
// preloaded shared players replayed forever; the ambient loop is one long-lived looping player.
// A preview is neither: it's a ~12s clip built on demand, played exactly once, and thrown away.
//
// Sharing the one-shot players would have been worse than it looks — 'sfx-heavy-anvil-slam' is
// also Titan's audible transient, so auditioning the anvil in the shop would seek and restart the
// very player a rank-up might be mid-way through.

const PREVIEW_SOURCES: Record<string, number> = {
  'audio-base-hearth-hum': require('../../assets/audio/cosmetic/preview/audio-base-hearth-hum-preview.mp3'),
  'audio-heavy-bonfire-crackle': require('../../assets/audio/cosmetic/preview/audio-heavy-bonfire-crackle-preview.mp3'),
  'audio-edm-pulse': require('../../assets/audio/cosmetic/preview/audio-edm-pulse-preview.mp3'),
  'audio-midnight-thunder': require('../../assets/audio/cosmetic/preview/audio-midnight-thunder-preview.mp3'),
  'audio-monastery-drone': require('../../assets/audio/cosmetic/preview/audio-monastery-drone-preview.mp3'),
  'audio-lofi-lullaby': require('../../assets/audio/cosmetic/preview/audio-lofi-lullaby-preview.mp3'),
  'audio-deep-space-sub-bass': require('../../assets/audio/cosmetic/preview/audio-deep-space-sub-bass-preview.mp3'),
  'sfx-heavy-anvil-slam': require('../../assets/audio/cosmetic/preview/sfx-heavy-anvil-slam-preview.mp3'),
  'sfx-sub-bass-drop': require('../../assets/audio/cosmetic/preview/sfx-sub-bass-drop-preview.mp3'),
  'sfx-jet-engine-ignition': require('../../assets/audio/cosmetic/preview/sfx-jet-engine-ignition-preview.mp3'),
  'sfx-olympian-foghorn': require('../../assets/audio/cosmetic/preview/sfx-olympian-foghorn-preview.mp3'),
  'sfx-emberfall-strike': require('../../assets/audio/cosmetic/preview/sfx-emberfall-strike-preview.mp3'),
};

const PREVIEW_VOLUME = 0.9;

let preview: AudioPlayer | null = null;
let previewKey: string | null = null;
/** Cleared alongside the player — expo-audio has no "off" for a listener we can call blind. */
let previewWatchdog: ReturnType<typeof setTimeout> | null = null;

const previewListeners = new Set<() => void>();

function emitPreview(): void {
  for (const l of previewListeners) l();
}

/** Subscribe to preview start/stop. Lets every ▶ badge on screen reflect one shared player. */
export function subscribePreview(listener: () => void): () => void {
  previewListeners.add(listener);
  return () => previewListeners.delete(listener);
}

export function hasPreview(itemId: string): boolean {
  return PREVIEW_SOURCES[itemId] !== undefined;
}

/** Which id is auditioning right now, for button state. Null when nothing is playing. */
export function previewingId(): string | null {
  return previewKey;
}

export function stopPreview(): void {
  if (previewWatchdog) {
    clearTimeout(previewWatchdog);
    previewWatchdog = null;
  }
  const player = preview;
  preview = null;
  previewKey = null;
  if (player) {
    // release() rather than just pause(): these players are built per audition and never reused,
    // so pausing would leak one native player per tap through a shop-browsing session.
    try {
      player.pause();
      player.release();
    } catch {
      // Already released or the native module went away — nothing left to clean up either way.
    }
    emitPreview();
  }
}

/**
 * Audition one cosmetic. Starting a preview always stops whatever was playing, so only one is ever
 * audible — which is the whole point when the trigger is a row of ▶ badges a thumb can run down.
 */
export function playPreview(itemId: string): void {
  const source = PREVIEW_SOURCES[itemId];
  if (source === undefined) return;
  try {
    const { createAudioPlayer } = require('expo-audio') as typeof import('expo-audio');
    stopPreview();
    const player = createAudioPlayer(source);
    player.loop = false;
    player.volume = PREVIEW_VOLUME;

    // Reset the button when the clip runs out on its own, so a preview that finishes naturally
    // looks the same as one that was stopped. playbackStatusUpdate is the event expo-audio gives
    // us; the timeout below is the backstop for when duration metadata never arrives.
    player.addListener('playbackStatusUpdate', (status: { didJustFinish?: boolean }) => {
      if (status.didJustFinish && previewKey === itemId) stopPreview();
    });

    player.play();
    preview = player;
    previewKey = itemId;

    // Hard ceiling. The previews are ~12s at most, so a player still alive well past that means
    // the finish event never fired — better to reset the UI than leave a ▶ stuck on pause forever.
    previewWatchdog = setTimeout(() => {
      if (previewKey === itemId) stopPreview();
    }, 20_000);

    emitPreview();
  } catch (e) {
    console.warn('[sound] preview unavailable:', e);
    stopPreview();
  }
}

/** Convenience for the UI: tapping the thing that's already playing stops it. */
export function togglePreview(itemId: string): void {
  if (previewKey === itemId) stopPreview();
  else playPreview(itemId);
}
