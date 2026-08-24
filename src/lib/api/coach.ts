// ══════════════════════════════════════════════════════════════════════════════════════════════
// CINDY — the client half of the AI coach (CINDY_SPEC.md, mock 115).
//
// 🔒 THIS FILE IS THE FIREWALL. The server decides WHAT Cindy wants to do; this file is the only
// thing that can actually do it, and it does so by calling the very same functions the UI calls
// on a tap — startLockInSession, createMilestone, equipCosmetic — under the user's own session.
//
// The consequence is the point: Cindy cannot do anything the user could not do themselves, and
// every economy rule holds automatically rather than by the server remembering to re-check it. A
// milestone she posts pays zero XP because it is the SAME createMilestone, not a coach copy of it.
//
// Adding a privileged server-side executor would undo this in one commit. Don't.
// ══════════════════════════════════════════════════════════════════════════════════════════════

import { track } from '@/lib/analytics';
import { createChallenge } from '@/lib/api/challenges';
import { stopLockInSession } from '@/lib/api/lock-ins';
import { createMilestone } from '@/lib/api/milestones';
import { markNotificationsRead } from '@/lib/api/notifications';
import { equipCosmetic } from '@/lib/api/inventory';
import { getItem } from '@/lib/economy/catalog';
import { supabase } from '@/lib/supabase';
import type { ChallengePeriod, ChallengeType, GoalType, MilestoneKind, MilestoneVisibility } from '@/types/database';

/** How the app should treat a proposed action — see supabase/functions/_shared/coach/tools.ts. */
export type CoachActionEffect = 'auto' | 'confirm';

export type CoachAction = {
  tool: string;
  input: Record<string, unknown>;
  effect: CoachActionEffect;
  summary: string;
  /** Set once the action has been resolved on device. */
  status?: 'proposed' | 'done' | 'declined' | 'failed';
  /** Marks a model-facing receipt row, which the transcript filters out. See fetchCindyHistory. */
  receipt?: boolean;
};

export type CoachReply = { text: string; action: CoachAction | null };

export type CoachMessage = {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  action: CoachAction | null;
  modality: 'text' | 'voice';
  created_at: string;
};

/** The warm intents. The protective ones can't reach home — see the routing note in prompt.ts. */
export type BubbleIntent = 'celebrate' | 'reengage' | 'checkin' | 'rest';
export type CoachBubble = { message: string; intent: BubbleIntent; cached: boolean };

/** Thrown with a stable `code` so screens can branch without matching on message strings. */
export class CoachError extends Error {
  constructor(
    public code: 'not_consented' | 'rate_limited' | 'voice_unavailable' | 'no_speech' | 'unknown',
    message: string
  ) {
    super(message);
    this.name = 'CoachError';
  }
}

async function invoke<T>(fn: 'ai-coach' | 'ai-coach-voice', body: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke(fn, { body });

  // supabase-js surfaces a non-2xx as a thrown FunctionsHttpError whose body holds our real code,
  // so the payload has to be read back off the response rather than off the error message.
  if (error) {
    const payload = await readErrorPayload(error);
    throw toCoachError(payload);
  }
  if (data && typeof data === 'object' && 'error' in data) throw toCoachError(data as { error?: string });

  return data as T;
}

async function readErrorPayload(error: unknown): Promise<{ error?: string }> {
  const context = (error as { context?: Response }).context;
  if (context && typeof context.json === 'function') {
    try {
      return await context.json();
    } catch {
      // Non-JSON body (a gateway timeout page, say) — fall through to the generic code.
    }
  }
  return {};
}

function toCoachError(payload: { error?: string }): CoachError {
  switch (payload.error) {
    case 'coach_not_consented':
      return new CoachError('not_consented', 'Cindy is turned off.');
    case 'coach_rate_limited':
    case 'voice_rate_limited':
      return new CoachError('rate_limited', "You've hit today's limit with Cindy — she'll be back tomorrow.");
    case 'voice_unavailable':
    case 'voice_disabled':
      return new CoachError('voice_unavailable', 'Voice is not available.');
    case 'no_speech':
      return new CoachError('no_speech', "I didn't catch that.");
    default:
      return new CoachError('unknown', payload.error ?? 'Cindy is having a moment. Try again?');
  }
}

// ───────────────────────────── consent ─────────────────────────────

export type CoachSettings = {
  enabled: boolean;
  consented_at: string | null;
  home_bubble_enabled: boolean;
  voice_enabled: boolean;
};

export async function fetchCoachSettings(): Promise<CoachSettings | null> {
  const { data, error } = await supabase
    .from('coach_settings')
    .select('enabled, consented_at, home_bubble_enabled, voice_enabled')
    .maybeSingle();
  if (error) throw error;
  return (data as CoachSettings) ?? null;
}

/** Grant or withdraw consent. Withdrawing also wipes the transcript, server-side. */
export async function setCoachConsent(granted: boolean): Promise<void> {
  await invoke('ai-coach', { op: 'consent', granted });
  track('cindy_consent', { granted });
}

export async function setCoachPreference(
  patch: Partial<Pick<CoachSettings, 'home_bubble_enabled' | 'voice_enabled'>>
): Promise<void> {
  const userId = await currentUserId();
  const { error } = await supabase.from('coach_settings').update(patch).eq('user_id', userId);
  if (error) throw error;
}

/**
 * The signed-in user's id, read from the locally cached session.
 *
 * PostgREST refuses an unfiltered UPDATE, so the coach tables need an explicit `user_id` even
 * though RLS would already restrict the statement to this one row. Read from getSession() rather
 * than getUser() — the former is local, the latter is a network round trip for a fact the client
 * already holds.
 */
async function currentUserId(): Promise<string> {
  const { data } = await supabase.auth.getSession();
  const id = data.session?.user.id;
  if (!id) throw new CoachError('unknown', 'Not signed in.');
  return id;
}

// ───────────────────────────── chat ─────────────────────────────

export async function sendToCindy(message: string): Promise<CoachReply> {
  const reply = await invoke<CoachReply>('ai-coach', { op: 'chat', message });
  track('cindy_message_sent', { has_action: reply.action !== null, tool: reply.action?.tool ?? null });
  return reply;
}

/**
 * The transcript. Read straight from the table rather than through the function — RLS already
 * scopes it to the owner, so a round trip through an edge function would add latency and buy
 * nothing.
 */
export async function fetchCindyHistory(limit = 50): Promise<CoachMessage[]> {
  const { data, error } = await supabase
    .from('coach_messages')
    .select('id, role, content, action, modality, created_at')
    .eq('surface', 'chat')
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) throw error;

  // Receipt rows exist for the MODEL — they are how the next turn knows the session really
  // started. The user already sees that as the resolved chip on the message that proposed it,
  // so showing the receipt row too would say the same thing twice.
  return ((data ?? []) as CoachMessage[]).filter((m) => !m.action?.receipt).reverse();
}

export async function clearCindyHistory(): Promise<void> {
  const { error } = await supabase.from('coach_messages').delete().eq('surface', 'chat');
  if (error) throw error;
}

// ───────────────────────────── the home bubble ─────────────────────────────

/**
 * Cheap staleness key over exactly the facts that would change the message.
 *
 * Sent to the server so a cached bubble is reused while the world is unchanged, but a user who
 * has just finished a session gets a fresh line instead of the greeting from two hours ago.
 */
export function bubbleDigest(input: {
  streak: number;
  todayCount: number;
  inSession: boolean;
  hourBucket: number;
}): string {
  return `${input.streak}:${input.todayCount}:${input.inSession ? 1 : 0}:${input.hourBucket}`;
}

/**
 * The staleness key for a MID-SESSION line (CINDY_SPEC "Entry points — Lock-in", mock 117 §C).
 *
 * The proactive lock-in line rides the same `home_bubble` op as the home bubble, because that is
 * the one generated surface a client can reach without a server deploy — and it needs no extra
 * facts to do its job: get_coach_context() already hands the model `active_session` (goal type,
 * detail, minutes_so_far) alongside the streak, so a call made mid-session is lock-in aware on
 * its own. What it would otherwise return is the CACHED home greeting, and that is exactly what
 * this digest defeats: one unique key per session per milestone, so each milestone spends one
 * generation and a re-mount inside the same milestone spends none.
 *
 * A dedicated `lockin` CoachSurface would buy tuned TONE, not new facts — see CINDY_SPEC's build
 * dependency. It is a functions-deploy refinement, and deliberately not required here.
 */
export function lockInDigest(sessionId: string, cue: string): string {
  return `lockin:${sessionId}:${cue}`;
}

export async function fetchCindyBubble(digest: string, force = false): Promise<CoachBubble | null> {
  const data = await invoke<{ bubble: CoachBubble | null }>('ai-coach', {
    op: 'home_bubble',
    digest,
    force,
  });
  return data.bubble;
}

export async function dismissCindyBubble(): Promise<void> {
  const userId = await currentUserId();
  const { error } = await supabase
    .from('coach_home_bubble')
    .update({ dismissed_at: new Date().toISOString() })
    .eq('user_id', userId);
  if (error) throw error;
}

// ───────────────────────────── voice ─────────────────────────────

export type VoiceTurn = {
  transcript: string;
  text: string;
  action: CoachAction | null;
  /** base64 mp3 of Cindy's spoken reply, or null once the day's synthesis budget is spent. */
  audio: string | null;
  voice_capped: boolean;
};

/**
 * One spoken turn.
 *
 * Takes the TRANSCRIPT, not audio: speech-to-text runs on-device with the platform recognizer
 * (CINDY_SPEC "STT-only architecture"), so it is free and no microphone audio ever leaves the
 * phone. The server pays only for Sonnet — which it would pay for a typed message anyway — and
 * for synthesising the reply.
 */
export async function speakToCindy(transcript: string): Promise<VoiceTurn> {
  const turn = await invoke<VoiceTurn>('ai-coach-voice', { transcript });
  track('cindy_voice_turn', { capped: turn.voice_capped });
  return turn;
}

/**
 * Is voice wired up on this project at all?
 *
 * Voice ships dark: without ELEVENLABS_API_KEY the function reports voice_unavailable, and the
 * mic must not be shown at all rather than shown-and-broken. Probed once and cached for the
 * session — the answer is a deployment fact, it does not change while the app is open.
 */
let voiceAvailable: boolean | null = null;
export async function isVoiceAvailable(): Promise<boolean> {
  if (voiceAvailable !== null) return voiceAvailable;
  try {
    // A deliberately empty payload: the function checks its secrets and consent before it looks
    // at the transcript, so this comes back voice_unavailable (dark) or no_speech (wired) without
    // ever reaching ElevenLabs or spending a credit.
    await invoke('ai-coach-voice', {});
    voiceAvailable = true;
  } catch (e) {
    voiceAvailable = !(e instanceof CoachError && e.code === 'voice_unavailable');
  }
  return voiceAvailable;
}

// ══════════════════════════════════════════════════════════════════════════════════════════════
// PERFORMING AN ACTION — the only place a coach proposal turns into a real write.
// ══════════════════════════════════════════════════════════════════════════════════════════════

export type ActionOutcome = {
  status: 'done' | 'declined' | 'failed';
  /** For start_session: the id of the session that began, so the caller can route into it. */
  sessionId?: string;
  /** A route the app should navigate to as a result, e.g. the support screen. */
  route?: string;
  error?: string;
};

export type ActionContext = {
  userId: string;
  /** The live session, needed to stop one. */
  activeSession: { id: string; goalType: GoalType } | null;
  /**
   * ActiveSessionProvider's own start/clear.
   *
   * Passed in rather than importing startLockInSession here, because that context is the single
   * source of truth for "is a lock-in running" (the mini-map, Home and the session screen all
   * read it). Calling the RPC directly would start a real session the rest of the app could not
   * see until its next refresh — Cindy's session has to be the app's session.
   */
  startSession: (goalType: GoalType, goalDetail?: string | null, circleId?: string | null) => Promise<{ id: string }>;
  clearSession: () => void;
};

/**
 * Execute an action Cindy proposed.
 *
 * Every branch delegates to the app's own API module. Nothing here writes to a table directly,
 * and nothing here touches XP, embers, or rank — there is no code path from a coach action to the
 * economy, which is the firewall stated as an invariant rather than as a comment.
 */
export async function performCoachAction(action: CoachAction, ctx: ActionContext): Promise<ActionOutcome> {
  try {
    switch (action.tool) {
      case 'start_session': {
        const session = await ctx.startSession(
          (action.input.goal_type as GoalType) ?? 'study',
          typeof action.input.goal_detail === 'string' ? action.input.goal_detail : null,
          null
        );
        // Auto-tying is not a second write: a custom challenge with count_mode 'lockin_time'
        // accrues from any lock-in whose detail matches its label (migration 0061), so naming
        // the session correctly IS the tie. Cindy passes challenge_id only to explain herself.
        return { status: 'done', sessionId: session.id };
      }

      case 'stop_session': {
        if (!ctx.activeSession) return { status: 'failed', error: 'No session is running.' };
        await stopLockInSession({
          sessionId: ctx.activeSession.id,
          userId: ctx.userId,
          goalType: ctx.activeSession.goalType,
        });
        // The session is done server-side, so every consumer should reflect that immediately
        // rather than waiting for the next refresh.
        ctx.clearSession();
        return { status: 'done' };
      }

      case 'add_milestone': {
        // 🔒 The real path (PROFILE_SPEC §G): effort receipts are stamped server-side from the
        // user's actual history, and the post earns nothing. Cindy cannot inflate the receipts —
        // she only chooses WHICH to keep, exactly like the composer.
        await createMilestone({
          kind: (action.input.kind as MilestoneKind) ?? 'custom',
          headline: String(action.input.headline ?? '').slice(0, 90),
          note: typeof action.input.note === 'string' ? action.input.note.slice(0, 280) : null,
          visibility: (action.input.visibility as MilestoneVisibility) ?? 'friends',
        });
        return { status: 'done' };
      }

      case 'create_challenge': {
        await createChallenge({
          userId: ctx.userId,
          type: (action.input.type as ChallengeType) ?? 'custom',
          label: typeof action.input.label === 'string' ? action.input.label : null,
          target: Number(action.input.target ?? 0),
          unit: String(action.input.unit ?? 'hours'),
          period: (action.input.period as ChallengePeriod) ?? 'week',
          countMode: action.input.count_mode === 'lockin_time' ? 'lockin_time' : 'manual',
        });
        return { status: 'done' };
      }

      case 'equip_cosmetic': {
        const item = getItem(String(action.input.cosmetic_key ?? ''));
        if (!item) return { status: 'failed', error: "I couldn't find that one." };
        // equip_cosmetic is security-definer and checks ownership itself, so a hallucinated id
        // fails at the database rather than dressing someone in something they don't own.
        await equipCosmetic(item);
        return { status: 'done' };
      }

      case 'mark_notifications_read':
        await markNotificationsRead();
        return { status: 'done' };

      case 'open_support':
        return { status: 'done', route: '/support' };

      default:
        return { status: 'failed', error: 'Unknown action.' };
    }
  } catch (e) {
    return { status: 'failed', error: e instanceof Error ? e.message : 'That did not go through.' };
  }
}

/** Tell the server what the device did, so the next turn reads a true transcript. */
export async function recordCoachAction(action: CoachAction, status: ActionOutcome['status']): Promise<void> {
  try {
    await invoke('ai-coach', {
      op: 'record_action',
      tool: action.tool,
      summary: action.summary,
      status,
    });
  } catch {
    // A missing receipt costs continuity on the next turn, never correctness of the action that
    // already happened — so it must not surface as a failure to the user.
  }
  track('cindy_action', { tool: action.tool, status });
}
