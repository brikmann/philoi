// ══════════════════════════════════════════════════════════════════════════════════════════════
// THE AI COACH SERVICE — one brain, three surfaces.
//
// This is the shared service CINDY_SPEC, APP_BLOCKER_SPEC §C/§C2 and GCAL_INTEGRATION_SPEC all
// point at: **context assembly + the Sonnet call + the safety system prompt**, in one place.
//
//   · Cindy's home bubble + chat  → surface 'home' / 'chat'   (warm)
//   · The Focus Nudge intercept    → surface 'intercept'       (protective)
//   · Re-engagement pushes         → surface 'reengagement'    (warm, may stay silent)
//
// The Focus Nudge build consumes this module — it should NOT stand up a second coach. Call
// runCoach({ surface: 'intercept', ... }) at lock-in start, cache the returned text to the shared
// app-group container, and let the shield render it synchronously from there.
//
// Model: claude-sonnet-5 — CINDY_SPEC names Sonnet explicitly and repeatedly ("Sonnet as the
// brain", "same Sonnet backend"), so this is the spec's model choice, not a cost downgrade.
// ══════════════════════════════════════════════════════════════════════════════════════════════

import Anthropic from 'npm:@anthropic-ai/sdk@0.71.0';
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';

import { calendarPromptBlock, fetchCalendarWindow } from './gcal.ts';
import { buildSystemPrompt, type CoachSurface } from './prompt.ts';
import { anthropicTools, effectFor, summarizeAction, type ToolEffect } from './tools.ts';

// ai-coach imports the surface type from here, not from prompt.ts.
export type { CoachSurface };

const MODEL = 'claude-sonnet-5';

/**
 * Output ceilings. Low on purpose, not to save money: every surface here produces one to three
 * sentences, and a generous ceiling on a chat coach just invites an essay where a text was asked
 * for. Chat gets more room because it may narrate an action alongside its reply.
 */
const MAX_TOKENS: Record<CoachSurface, number> = {
  chat: 2000,
  home: 400,
  intercept: 400,
  reengagement: 400,
};

/**
 * The ceiling for a SPOKEN turn, which is a different constraint than a typed one.
 *
 * Every token past this one is paid for TWICE — once generating it, once synthesising it — and the
 * user sits in silence through both halves. 300 tokens is comfortably more than the one-or-two
 * sentences SPOKEN_BREVITY asks for, so this is the runaway guard rather than the shape.
 */
const MAX_TOKENS_SPOKEN = 300;

/**
 * Appended to the VOLATILE tail of the user turn, never to the system prompt.
 *
 * buildSystemPrompt() is one cacheable prefix shared by every user on a surface, and voice runs on
 * surface='chat' — the same prefix typed chat uses. Putting this in there would either split that
 * cache in two or make every TYPED reply terse as well. Here it costs a few uncached tokens on
 * voice turns only, and the typed path stays byte-identical.
 */
const SPOKEN_BREVITY =
  'This reply will be READ ALOUD, not printed. Keep it to one or two short spoken sentences, under ' +
  '300 characters. No lists, no headings, no markdown, no emoji — say it the way you would say it ' +
  'out loud. Say the one thing that matters and stop.';

/**
 * Reasoning effort. Chat runs higher because the rank math ("XP to Hero ÷ their XP/hour") is real
 * arithmetic over a ladder table, and that is exactly where a rushed answer invents a number.
 * The one-line surfaces are pure copywriting and run cheap.
 */
const EFFORT: Record<CoachSurface, 'low' | 'medium'> = {
  chat: 'medium',
  home: 'low',
  intercept: 'low',
  reengagement: 'low',
};

export type CoachAction = {
  tool: string;
  input: Record<string, unknown>;
  /** 'auto' = the client performs it straight away; 'confirm' = the client must ask first. */
  effect: ToolEffect;
  summary: string;
};

export type CoachTurn = { role: 'user' | 'assistant'; content: string };

export type CoachResult = {
  text: string;
  action: CoachAction | null;
  /** Set on the non-chat surfaces so the caller can route/skip on it. */
  intent: string | null;
  usage: { input: number; output: number; cacheRead: number };
};

export type RunCoachInput = {
  surface: CoachSurface;
  userId: string;
  /** The user's own client — RLS-scoped, used for get_coach_context(). Never a service client. */
  userClient: SupabaseClient;
  /** Service client, used only for the calendar token read and usage metering. */
  admin: SupabaseClient;
  /** The user's message on 'chat'. Omit on the generated surfaces. */
  message?: string;
  /** Prior turns, oldest first. Chat only. */
  history?: CoachTurn[];
  /** Extra situational facts the DB does not know — e.g. which app triggered the intercept. */
  situation?: Record<string, unknown>;
  /**
   * This turn is going to be SPOKEN (ai-coach-voice), not printed.
   *
   * A flag on the call rather than a fifth CoachSurface, deliberately: voice and typed chat are the
   * same surface and the same transcript on purpose — asking aloud and following up by text has to
   * carry the thread — and a separate surface would fork the persona, the routing block and the
   * tool set for what is only a difference in LENGTH.
   *
   * Both effects are latency. A spoken reply is generated and then synthesised, so every character
   * is paid for twice with the user listening to nothing; the fastest fix available to the brain is
   * to produce fewer of them.
   */
  spoken?: boolean;
};

/**
 * Assemble context, call Sonnet, return the message and at most one proposed action.
 *
 * 🔒 Context comes from get_coach_context() called with the USER'S client, so auth.uid() is the
 * user and it is structurally impossible to read anyone else's data — even if this function were
 * called with the wrong userId, the RPC would still return the JWT owner's rows.
 */
export async function runCoach(input: RunCoachInput): Promise<CoachResult> {
  const { surface, userId, userClient, admin, message, history = [], situation, spoken = false } = input;

  const apiKey = Deno.env.get('ANTHROPIC_API_KEY');
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY is not set on this project.');

  const { data: context, error: contextError } = await userClient.rpc('get_coach_context');
  if (contextError) throw new Error(`Could not read coach context: ${contextError.message}`);

  // ── THE MEMBER'S COURSES (0182's user_courses) ─────────────────────────────────────────────
  //
  // "Scope me a 90% in every class" is unanswerable without this list, and before it existed Cindy
  // had to ask the user to name courses the database already knew — which is the difference between
  // an assistant and a form.
  //
  // 🔒 READ WITH THE USER'S OWN CLIENT, so RLS ("own courses readable") is what scopes it. Same
  // guarantee get_coach_context has: it is structurally impossible to read anyone else's rows here,
  // rather than merely intended.
  //
  // ⚠️ A SEPARATE READ RATHER THAN A COLUMN ON get_coach_context, deliberately. That function is a
  // 12KB jsonb_build_object with no addressable interior — adding a key means restating the WHOLE
  // body in a migration, which is the exact operation that has silently reverted a sibling
  // session's work in this repo before. A table read with its own RLS policy costs one round trip
  // and cannot clobber anything.
  //
  // Best-effort: an error here means Cindy asks which courses they mean, which is how she behaved
  // before this existed. It must never take the whole turn down.
  const { data: courses } = await userClient
    .from('user_courses')
    .select('id, code, title')
    .is('archived_at', null)
    .order('code', { ascending: true });

  // Read at the moment we write to the member, exactly as the consent dialog promises — never on
  // a sync job, never stored. Best-effort: a window with connected:false is the normal, expected
  // shape for every failure, and the prompt block says so in words the model can act on.
  const calendar = await fetchCalendarWindow(admin, userId);

  const client = new Anthropic({ apiKey });

  const contextBlock = [
    '<user_context>',
    // Merged into the one context document rather than shipped as a second block: every other fact
    // about the user is in there, and a model that has to look in two places for "what do I know
    // about them" will eventually look in one.
    JSON.stringify({ ...(context ?? {}), courses: courses ?? [] }),
    '</user_context>',
    calendarPromptBlock(calendar),
    situation ? `<situation>${JSON.stringify(situation)}</situation>` : '',
  ]
    .filter(Boolean)
    .join('\n');

  // Volatile content goes LAST. The system prompt above is byte-identical for every user on this
  // surface and sits behind the cache breakpoint; the context document changes every single call,
  // so putting it in the system prompt would invalidate the cache on every request and make the
  // whole prefix worthless.
  const messages: Anthropic.MessageParam[] = [
    ...history.map((t) => ({ role: t.role, content: t.content }) as Anthropic.MessageParam),
    {
      role: 'user',
      // The brevity note goes AFTER the user's own words — a trailing instruction is the one the
      // model is still holding when it starts writing. The context block stays first because that
      // is where every other fact about them already is.
      content: [contextBlock, message || generationRequest(surface), ...(spoken ? [SPOKEN_BREVITY] : [])].join(
        '\n\n'
      ),
    },
  ];

  // ⚠️ The cast at the end is TYPES ONLY. The pinned SDK (0.71.0) has no type for adaptive thinking,
  // output_config or strict tools, and the API accepts all three. Bumping the SDK to get the types
  // would change the shipped bundle to fix a type error.
  const response = await client.messages.create({
    model: MODEL,
    max_tokens: spoken ? MAX_TOKENS_SPOKEN : MAX_TOKENS[surface],
    // Adaptive is the only on-mode on Sonnet 5 (budget_tokens is removed and returns a 400).
    thinking: { type: 'adaptive' },
    output_config: { effort: EFFORT[surface] },
    system: [
      {
        type: 'text',
        text: buildSystemPrompt(surface),
        // The prompt is large (persona + safety + economy + unlock conditions) and identical
        // across every user, so this one breakpoint is served from cache for the whole fleet
        // after the first call on each surface.
        cache_control: { type: 'ephemeral' },
      },
    ],
    // Tools only where a confirmation can actually be rendered. An intercept shield or a push
    // notification has no UI to confirm against, so those surfaces are copy-only by construction.
    ...(surface === 'chat' ? { tools: anthropicTools() } : {}),
    messages,
  } as unknown as Anthropic.MessageCreateParamsNonStreaming);

  // A safety classifier can decline with HTTP 200 — check before reading content, or the reply
  // silently comes back empty.
  if (response.stop_reason === 'refusal') {
    return {
      text: "I'm not sure how to answer that one — want to try asking it a different way?",
      action: null,
      intent: null,
      usage: usageOf(response),
    };
  }

  let text = '';
  let action: CoachAction | null = null;

  for (const block of response.content) {
    if (block.type === 'text') {
      text += block.text;
    } else if (block.type === 'tool_use' && !action) {
      // At most one action per turn — the prompt asks for one, and taking a second would mean
      // acting on something the user never saw a receipt for.
      const toolInput = block.input as Record<string, unknown>;
      action = {
        tool: block.name,
        input: toolInput,
        effect: effectFor(block.name),
        summary: summarizeAction(block.name, toolInput),
      };
    }
  }

  return {
    text: text.trim(),
    action,
    intent: extractIntent(text, surface),
    usage: usageOf(response),
  };
}

/**
 * What to ask for on the surfaces with no user message. Each one asks for a bare line of copy —
 * the routing block in the system prompt has already established the voice and the constraints.
 */
function generationRequest(surface: CoachSurface): string {
  switch (surface) {
    case 'home':
      return (
        'Write the home-screen bubble for this user right now. Start the line with one of ' +
        '[celebrate], [reengage], [checkin] or [rest] to tag the intent, then the message itself.'
      );
    case 'intercept':
      return (
        'They just opened a distracting app during their live session. Write the intercept message. ' +
        'Start the line with one of [reinforce], [wellbeing] or [support] to tag the intent, then the message. ' +
        // Last on purpose: the <situation> block just above carries minutesIntoSession, and the
        // instruction the model reads last is the one that beats a number sitting in front of it.
        'It is shown later, not now, so say no minutes-into-session figure and no countdown to an event.'
      );
    case 'reengagement':
      return (
        'Decide whether to send a re-engagement push right now. If they should be left alone, reply with ' +
        'exactly [skip] and nothing else. Otherwise start with [nudge] and then the push text.'
      );
    default:
      return 'Reply to the user.';
  }
}

/**
 * Pull the `[intent]` tag off the generated surfaces.
 *
 * A tag rather than structured output because these responses are a single short string: adding
 * an output schema would cost a JSON wrapper around one sentence, and the tag is trivially
 * strippable. The tag is removed from the text in stripIntent below so it never reaches a user.
 */
function extractIntent(text: string, surface: CoachSurface): string | null {
  if (surface === 'chat') return null;
  const match = text.trim().match(/^\[([a-z]+)\]/i);
  return match ? match[1].toLowerCase() : null;
}

/** The message with its intent tag removed — what actually gets shown. */
export function stripIntent(text: string): string {
  return text.replace(/^\s*\[[a-z]+\]\s*/i, '').trim();
}

function usageOf(response: Anthropic.Message) {
  return {
    input: response.usage.input_tokens,
    output: response.usage.output_tokens,
    cacheRead: response.usage.cache_read_input_tokens ?? 0,
  };
}
