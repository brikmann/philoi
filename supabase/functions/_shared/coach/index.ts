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

import { fetchCalendarWindow } from './gcal.ts';
import { buildSystemPrompt, type CoachSurface } from './prompt.ts';
import { anthropicTools, effectFor, summarizeAction, type ToolEffect } from './tools.ts';

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
};

/**
 * Assemble context, call Sonnet, return the message and at most one proposed action.
 *
 * 🔒 Context comes from get_coach_context() called with the USER'S client, so auth.uid() is the
 * user and it is structurally impossible to read anyone else's data — even if this function were
 * called with the wrong userId, the RPC would still return the JWT owner's rows.
 */
export async function runCoach(input: RunCoachInput): Promise<CoachResult> {
  const { surface, userId, userClient, admin, message, history = [], situation } = input;

  const apiKey = Deno.env.get('ANTHROPIC_API_KEY');
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY is not set on this project.');

  const { data: context, error: contextError } = await userClient.rpc('get_coach_context');
  if (contextError) throw new Error(`Could not read coach context: ${contextError.message}`);

  // Optional and best-effort — null when GCal is not connected or the integration is not built.
  const calendar = await fetchCalendarWindow(admin, userId);

  const client = new Anthropic({ apiKey });

  const contextBlock = [
    '<user_context>',
    JSON.stringify(context),
    '</user_context>',
    calendar
      ? `<calendar note="Read-only upcoming window from their Google Calendar. Interpret the titles yourself — infer exams, deadlines, classes and free windows.">\n${JSON.stringify(calendar)}\n</calendar>`
      : '<calendar connected="false">Not connected — reason without deadline data, and do not invent any.</calendar>',
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
      content: message ? `${contextBlock}\n\n${message}` : `${contextBlock}\n\n${generationRequest(surface)}`,
    },
  ];

  const response = await client.messages.create({
    model: MODEL,
    max_tokens: MAX_TOKENS[surface],
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
  });

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
        'Start the line with one of [reinforce], [wellbeing] or [support] to tag the intent, then the message.'
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
