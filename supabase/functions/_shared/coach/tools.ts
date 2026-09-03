// ══════════════════════════════════════════════════════════════════════════════════════════════
// CINDY'S ACTIONS — the tool surface, and the reason it is safe.
//
// 🔒 THE CENTRAL DESIGN DECISION: **the server never executes an action.**
//
// The model proposes; the *client* performs, through the exact same functions the UI already
// calls (startLockInSession, createMilestone, equipCosmetic, ...), under the user's own JWT. So:
//
//   · Every RLS policy applies to Cindy identically to a tap.
//   · Every economy rule and firewall applies — createMilestone still pays zero because it is
//     the same createMilestone, not a coach-flavoured copy of it.
//   · There is no privileged "coach acts" path to audit, because there is no such path. Cindy is
//     strictly less capable than the user, never more.
//
// A service-role executor would have been fewer lines and would have quietly handed an LLM write
// access to the economy. This shape makes the firewall structural instead of a promise.
//
// The `effect` field decides what the client does with a proposal:
//   'auto'    — perform immediately and show a receipt chip (mock 115 frame 2's "▶ started").
//   'confirm' — render a confirm button; nothing happens until the user taps it.
// ══════════════════════════════════════════════════════════════════════════════════════════════

export type ToolEffect = 'auto' | 'confirm';

export type CoachToolSpec = {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
  effect: ToolEffect;
};

// The lock-in goal types, straight from GoalType in src/types/database.ts. Kept as a literal
// union in the schema so the model cannot invent a type the RPC would reject.
const GOAL_TYPES = ['study', 'gym', 'run', 'read', 'job_applications', 'social_media', 'custom'];

// PROFILE_SPEC §G's milestone kinds — same check constraint as the milestones table.
const MILESTONE_KINDS = ['grade', 'offer', 'certification', 'fitness_pr', 'project', 'custom'];

// ChallengeType / ChallengePeriod from src/types/database.ts. Deliberately NOT the same set as
// GOAL_TYPES: a challenge measures a METRIC (study_hours, run_distance) while a lock-in has a
// KIND (study, run). Letting the model pass a goal type here would produce rows the challenges
// table rejects, so the two vocabularies stay separate and explicit.
const CHALLENGE_TYPES = [
  'study_hours',
  'gym_visits',
  'run_distance',
  'ride_distance',
  'workout_minutes',
  'steps',
  'sleep_hours',
  'strain',
  'custom',
];

export const COACH_TOOLS: CoachToolSpec[] = [
  {
    name: 'start_session',
    // Safe and immediate per CINDY_SPEC ("starting a session is safe"): it costs nothing, earns
    // nothing until it ends, and is one tap to stop. Requiring a confirm here would make the
    // single most common request feel bureaucratic.
    effect: 'auto',
    description:
      "Start a lock-in session for the user. Use when they ask to start, or agree to start, working on " +
      "something. Set goal_detail to what they're actually working on (a course code, a lift, a project) " +
      "so it shows on the session and their done screen. If one of their active challenges obviously " +
      'matches, pass its id as challenge_id so the time counts toward it, and say so.',
    input_schema: {
      type: 'object',
      properties: {
        goal_type: { type: 'string', enum: GOAL_TYPES, description: 'Which kind of lock-in this is.' },
        goal_detail: {
          type: 'string',
          description: 'What they are working on, e.g. "BU111" or "Chest day". Short — it is a label.',
        },
        challenge_id: {
          type: 'string',
          description: 'Optional id of an active challenge from the context that this session should count toward.',
        },
      },
      required: ['goal_type'],
      additionalProperties: false,
    },
  },
  {
    name: 'stop_session',
    // Confirmed: ending a session is destructive-ish (it banks the time and closes the timer),
    // and a misheard voice command that ends someone's session mid-study is a real harm.
    effect: 'confirm',
    description:
      'End the running lock-in session and bank the time. Only when they clearly want to stop now.',
    input_schema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'add_milestone',
    // 🔒 Confirmed even though mock 115 frame 5 shows it posting straight away. A milestone is a
    // POST — it lands in other people's feeds — and the mock's immediacy was drawn for a typed
    // request, not for a voice turn that might have misheard the grade. The confirm renders as an
    // inline chip rather than a modal, so it still reads like the mock rather than like paperwork.
    effect: 'confirm',
    description:
      'Post a milestone to their journal — a grade, an offer, a certification, a PR, a project. ' +
      'The app attaches their effort receipts (hours, streak, lock-ins) automatically. ' +
      'This earns NO XP and NO embers by design; say so warmly when you post one.',
    input_schema: {
      type: 'object',
      properties: {
        kind: { type: 'string', enum: MILESTONE_KINDS },
        headline: {
          type: 'string',
          description: 'The achievement itself, under 90 characters, e.g. "85% · BU111".',
        },
        note: { type: 'string', description: 'Optional one-line context, under 280 characters.' },
        visibility: {
          type: 'string',
          enum: ['friends', 'campus', 'public'],
          description: 'Defaults to friends. Grades are sensitive — do not widen it unless they ask.',
        },
      },
      required: ['kind', 'headline'],
      additionalProperties: false,
    },
  },
  {
    name: 'create_challenge',
    effect: 'confirm',
    description:
      'Turn a goal or an intention into a tracked challenge with a target. Use when they want to ' +
      'commit to something measurable ("I want to do 20 hours of Orgo this month").',
    input_schema: {
      type: 'object',
      properties: {
        type: {
          type: 'string',
          enum: CHALLENGE_TYPES,
          description: 'Which metric it measures. Use "custom" for anything the built-ins do not cover.',
        },
        label: { type: 'string', description: 'What the challenge is called, e.g. "Pass BU111".' },
        target: { type: 'number', description: 'The numeric target.' },
        unit: {
          type: 'string',
          // 🔴 A goal named "Cold plunges" reached a real user's tab reading "0 / 1 bath", because
          // this said only "e.g. hours, sessions, km" and a plausible-sounding noun satisfied it.
          // The unit is rendered directly into "<progress> / <target> <unit>", so it has to be the
          // PLURAL NOUN OF THE THING THE LABEL COUNTS and nothing else.
          //
          // Ignored entirely for a built-in type — the client and migration 0157 both overwrite it
          // with the metric's own unit — so it matters only for `custom`, which is exactly the case
          // that went wrong.
          description:
            'The plural noun the target counts, taken from the goal itself. It is rendered as ' +
            '"0 / <target> <unit>", so it must read correctly there: "Cold plunges" counts ' +
            '"plunges", not "bath"; "Push-ups" counts "push-ups"; "Read Dune" counts "pages". ' +
            'Never invent a container or a synonym for the activity. Ignored for non-custom types, ' +
            'which take their unit from the metric.',
        },
        period: {
          type: 'string',
          enum: ['day', 'week', 'once'],
          // Three windows. 'once' (migration 0155) is the non-recurring one: a single target that
          // never resets and stays done once it is hit.
          description:
            'The window it resets on. "day" resets at their local midnight, "week" every Sunday, ' +
            'and "once" never resets — use "once" for a single target like "run a half marathon" ' +
            'or "1000 push-ups", where resetting the counter would destroy the goal. There is no ' +
            'monthly period; a month-long recurring target is a weekly one.',
        },
        count_mode: {
          type: 'string',
          enum: ['manual', 'lockin_time'],
          description:
            'Use "lockin_time" on a custom challenge to accrue minutes automatically from lock-ins ' +
            'whose detail matches the label — that is what auto-ties sessions to it. Otherwise "manual".',
        },
        // 🐛 THESE TWO WERE OUTSIDE `properties`. The brace that now closes the object sat here,
        // above `difficulty_tier`, so both fields were keys of `input_schema` itself rather than
        // declared properties. With `strict: true` and `additionalProperties: false` the model
        // could not emit either one — so every scoped tier was silently unreachable, the executor's
        // `typeof tier === 'string'` check never passed, set_goal_scope was never called, and the
        // create chip's reward tease never rendered. The whole of 0159-0161 was inert from the
        // client side. One brace.
        difficulty_tier: {
          type: 'string',
          enum: ['common', 'uncommon', 'rare', 'epic', 'legendary', 'mythic'],
          // 🔒 A PROPOSAL, NOT A GRANT. The client hands this to set_goal_scope (migration 0160),
          // which validates it is one of these six and — the part that matters — DERIVES the
          // verifiability itself from the goal's own metric. `auto` is the only route to the top
          // three boxes, and no value here can claim it. So the worst a wrong tier does on a
          // hand-counted goal is land on the same Furnace an honest Epic lands on.
          description:
            'How hard the described feat is for a median 18-20 year old with average starting ' +
            'fitness — see the scoping rules in your instructions. Omit it if the goal is vague or ' +
            'unmeasurable; ask a clarifying question instead. Never state what it pays.',
        },
        scope_rationale: {
          type: 'string',
          description:
            'One sentence grounding the tier in the effort estimate — how long it takes and how ' +
            'many people ever get there — like "Standing backflips take a median beginner 3-9 ' +
            'months and the wall is the fear of flipping backward." Shown to the user verbatim.',
        },
      },
      required: ['type', 'label', 'target', 'unit', 'period'],
      additionalProperties: false,
    },
  },
  {
    name: 'host_campfire_challenge',
    // 🔒 Confirmed, and it is the most confirm-worthy action on this list: it pushes a
    // notification to every member of a campfire and posts a card into their chat. A misheard
    // voice turn that did that silently would be a message sent in the user's name to forty
    // people.
    effect: 'confirm',
    description:
      'Host a counted challenge for a WHOLE CAMPFIRE — "set a 1000 pushup challenge for Goat". Use ' +
      'this instead of create_challenge whenever they name a campfire; create_challenge makes a ' +
      'private goal only they can see. Pass the campfire id from the `campfires` list in their ' +
      "context — match the name they said against it. If two campfires could match, or none does, " +
      'ASK which one; never guess, and never use an id that is not in their own list. Hosting is ' +
      'admin-only and the server checks that itself: if they are not an owner or admin of that ' +
      'campfire the action is refused, and you relay the refusal plainly without apologising for ' +
      'the rule or offering a way around it.',
    input_schema: {
      type: 'object',
      properties: {
        circle_id: {
          type: 'string',
          description:
            "The campfire's id, copied exactly from the `campfires` array in their context " +
            'document. Never a name, never an id you did not read there.',
        },
        metric: {
          type: 'string',
          // Same rule, same reason, as create_challenge's `unit` — it is rendered straight into
          // "<progress> / <target> <metric>" on every participant's goal, and it becomes the name
          // of the lock-in type that gets added to their menu.
          description:
            'The plural noun being counted, and nothing else: "pushups", "plunges", "pages". It ' +
            'is rendered as "0 / <target> <metric>" and becomes the name of the lock-in type each ' +
            'participant gets, so it must read correctly as both.',
        },
        target: { type: 'number', description: 'How many. "1000 pushups" is 1000.' },
        label: {
          type: 'string',
          description: 'What the challenge is called, e.g. "1000 pushups". Under 60 characters.',
        },
        shape: {
          type: 'string',
          // 'most_by_deadline' is deliberately absent: a ranked race carries no target, so it is
          // not a counted challenge and the RPC refuses it. Leaving it out of the enum means the
          // model cannot propose an action that can only fail.
          enum: ['everyone_hits_target', 'first_to'],
          description:
            'How it is won. "everyone_hits_target" — everyone who reaches the number succeeds, no ' +
            'single winner. "first_to" — first person there wins. Default to everyone_hits_target.',
        },
        window_hours: {
          type: 'number',
          description: 'How long they get, in hours. A week is 168, a day is 24. Default 168.',
        },
        difficulty_tier: {
          type: 'string',
          enum: ['common', 'uncommon', 'rare', 'epic', 'legendary', 'mythic'],
          // Same firewall as create_challenge's: a proposal the server validates, and whose
          // verifiability it derives rather than accepts. A hand-counted campfire challenge is
          // 'honor' by derivation and capped at The Furnace however high this claims to be.
          description:
            'How hard the described feat is — see the scoping rules in your instructions. Scope ' +
            'the whole ask ("1000 pushups in a week"), not one rep. Never state what it pays.',
        },
        scope_rationale: {
          type: 'string',
          description:
            'One sentence grounding the tier in the effort estimate — how long it takes and how ' +
            'many people ever get there. Shown to the user verbatim.',
        },
      },
      required: ['circle_id', 'metric', 'target', 'label'],
      additionalProperties: false,
    },
  },
  {
    name: 'equip_cosmetic',
    // Auto: fully reversible, costs nothing, and it is literally changing how Cindy looks — the
    // most natural thing in the world for her to just do when asked.
    effect: 'auto',
    description:
      'Equip a cosmetic the user already owns — this is how you change your own appearance when ' +
      'it is a flame. Only use ids present in the context owned_cosmetics list.',
    input_schema: {
      type: 'object',
      properties: {
        cosmetic_key: { type: 'string', description: 'The catalog id, e.g. "flame-molten-copper".' },
      },
      required: ['cosmetic_key'],
      additionalProperties: false,
    },
  },
  {
    name: 'mark_notifications_read',
    effect: 'auto',
    description: 'Clear the unread badge on their notification bell.',
    input_schema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'open_support',
    // Deliberately 'auto' and deliberately last-resort-free: when the safety rules say surface
    // real help, nothing should stand between the user and that screen — least of all a confirm
    // button asking whether they are sure they want support.
    effect: 'auto',
    description:
      'Open the in-app "Talk to someone" screen — a friend, campus wellness, a crisis line. Use when ' +
      'the safety rules call for pointing at real support. Always pair it with a warm, brief message.',
    input_schema: { type: 'object', properties: {}, additionalProperties: false },
  },
];

/** The Anthropic tool payload — `effect` is ours and must not be sent to the API. */
export function anthropicTools() {
  return COACH_TOOLS.map(({ name, description, input_schema }) => ({
    name,
    description,
    input_schema,
    // Guarantees `input` validates against the schema, so the client never has to defend against
    // a missing `goal_type` on an action it is about to execute for real.
    strict: true,
  }));
}

export function effectFor(toolName: string): ToolEffect {
  return COACH_TOOLS.find((t) => t.name === toolName)?.effect ?? 'confirm';
}

/**
 * Human-readable receipt line for an action, e.g. "BU111 · Study · started".
 *
 * Server-side so the chat transcript stores the same string the chip renders — a receipt that
 * said one thing on screen and another in history would be worse than no receipt.
 */
export function summarizeAction(tool: string, input: Record<string, unknown>): string {
  switch (tool) {
    case 'start_session': {
      const detail = typeof input.goal_detail === 'string' ? input.goal_detail : null;
      const type = String(input.goal_type ?? 'session');
      return detail ? `${detail} · ${type}` : type;
    }
    case 'stop_session':
      return 'End this session';
    case 'add_milestone':
      return `Post “${String(input.headline ?? 'milestone')}”`;
    case 'create_challenge':
      return `${String(input.label ?? 'Challenge')} · ${input.target} ${input.unit} a ${input.period}`;
    case 'host_campfire_challenge':
      // No campfire NAME here on purpose: the server has the ids, this file has only what the
      // model passed, and a name the model wrote is exactly the thing that could be wrong. The
      // client fills the campfire in from its own context — see summarizeHostedChallenge.
      return `${String(input.label ?? 'Challenge')} · ${input.target} ${String(input.metric ?? '')}`;
    case 'equip_cosmetic':
      return `Equip ${String(input.cosmetic_key ?? '')}`;
    case 'mark_notifications_read':
      return 'Mark notifications read';
    case 'open_support':
      return 'Talk to someone';
    default:
      return tool;
  }
}
