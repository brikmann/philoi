# The Agora — Scoping
_The town square. A running feed where accomplishments surface to a wide audience and people gather to cheer and talk. Mock 160._

## The idea
In ancient Greece the **Agora** was the gathering place — marketplace, forum, cultural heart. In Philoi it's a **running social feed** with filters (Friends · your uni · all) where students' wins show up and people react and discuss. The core value: an accomplishment isn't just a private notification to a few friends — it gets **reach and validation** in front of a real audience, which is the strongest motivator there is.

## What it does
- **Auto-populates accomplishments.** When you earn a relic, rank up, win a challenge, hit a PR, or cross a streak/lock-in milestone, it posts to the Agora automatically (reuses the existing **milestones** system, 0093). No extra effort — you grind, it shows up.
- **Optional posts.** You can also post your own — a short note, a photo, or share a milestone with a caption ("finally hit Hero, took all semester 😤").
- **Cheer + discuss.** Each item takes **cheers** (the positive reaction — reuses `milestone_cheers`) and **comments** for actual conversation. This is the "gather and talk" part.
- **Complements notifications.** Your friends still get the direct "Noah earned a relic" ping; the Agora adds the *broad* audience on top — dozens of people seeing it, not just your circle.

## Filters (the reach dials)
- **Friends** — just your people. Intimate, always relevant.
- **Your university** (Laurier / Waterloo) — campus-wide. This is where reach + a bit of school pride live; you see people you don't know grinding, which drives FOMO-in-a-good-way.
- **All** — everything across campuses. Firehose, opt-in.
- (Optional later) **Campfires** — activity from the campfires you're in.

## Keep it healthy (important)
The Agora is **celebration, not comparison-dunking.** By design:
- It surfaces **accomplishments and posts**, not raw leaderboards or "you're behind X" framing. (Leaderboards stay their own screen.)
- The only quick reaction is a **cheer** (positive) — no downvote. Comments are moderated with report/hide + block, same as DMs/campfires.
- Respects the wellbeing rules: it should feel like a room full of people rooting for each other, never a flex-war. Copy stays encouraging.

## Privacy
Respects existing **milestone visibility** (`can_see_milestone`, 0093): a milestone posts to the Agora at the audience the user set (friends / campus / public), and any milestone can be opted out of the feed. Default is friends+campus; the user controls it.

## Where it lives
A destination in the side menu, in the **Social** group next to Campfires and Friends (fits the Greek-place theme — Campfires, the Agora, relics all belong together). Could also be surfaced as the default filter on a broader "Feed."

## Build notes (mostly reuse)
- **Read surface, not new plumbing:** milestones already get created on accomplishments (0093) and already carry visibility. The Agora is a **feed query** over milestones + user posts with the three filters (friends = friend graph; university = `profiles.university` match; all = public), newest-first, paginated.
- New: `agora_posts` (user_id, body, image_url, ref milestone/challenge, created_at) for freeform posts; `agora_comments` (post_id/milestone_id, user_id, body); reuse `milestone_cheers` for cheers.
- Auto-post = the milestone insert already happening; the Agora just reads them at the chosen visibility scope.
- Feed item routes to the underlying thing (relic → inventory, challenge → board, etc.).
