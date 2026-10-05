import { useEffect, useState, type ReactNode } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { BurningName } from '@/components/burning-name';
import { EMBER, EmberfallSeal, EmberfallSky, FallingEmbers } from '@/components/pass/emberfall-art';
import {
  MiniBanner,
  MiniBubble,
  MiniButton,
  MiniChip,
  MiniHeader,
  MiniMuted,
  MiniRow,
  MiniScreen,
  MiniTabs,
  MiniToggle,
} from '@/components/tutorial/mini-ui';
import {
  CosmeticHero,
  CrateShelf,
  FaceDownTile,
  FlameGlyph,
  ForgeAfter,
  ForgeBefore,
  HaulPreview,
  ItemGrid,
  ItemHero,
  RankLadder,
  RelicTile,
  TourCrateOpen,
  TourFlame,
  cosmeticRarity,
  type CosmeticKind,
} from '@/components/tutorial/tour-art';
import { Colors, Fonts } from '@/constants/theme';
import { useReduceMotion } from '@/hooks/use-reduce-motion';
import { getItem } from '@/lib/economy/catalog';
import { RELIC_LADDERS, RUNG_GLYPH } from '@/lib/economy/relic-ladders';
import { RARITY_COLOR } from '@/lib/economy/rarity';

// ══════════════════════════════════════════════════════════════════════════════════════════════
// THE TOUR — design-mocks/187-tutorial.html, CODE_PROMPT_tutorial.md. THIS IS THE LAUNCH GATE.
//
// Noah's roommate, verbatim: "there's a lot going on here". A feature-dense app with no guided
// intro loses people at the front door, and the App Store is not the place to find that out.
//
// ─────────────────────────── THE COVERAGE RULE ───────────────────────────
//
// 🔴 EVERY MAIN-MENU DESTINATION GETS A CARD. Home/flame, ranks, Emberfall, profile + relics,
// campfires, campfire chat, challenges, personal goals, Cindy, leaderboard, the Agora, sharing,
// cosmetics, the shop, opening crates, inventory, the Forge, settings, and the Flame Pass last. The three
// that were missing from earlier drafts and are explicitly not to be dropped again are the Agora,
// the Inventory and the Forge.
//
// ─────────────────────────── WHY THE RAIL IS THE PROGRESS UI ───────────────────────────
//
// Not dots. The rail lists EVERY section at once, grouped into four acts, so the first thing the
// user sees is the entire scope of the app — which is closure rather than anxiety. Dots say "there
// are more of these and you don't know how many", which is the feeling the tutorial exists to fix.
//
// ─────────────────────────── REAL ART, NOT EMOJI (mock 239 v3) ───────────────────────────
//
// The miniatures are still the FRAME; the SUBJECT of each card — the flame, a ring, a crate cracking,
// a fuse, a rank emblem — is the shipped renderer from tour-art.tsx. Emoji survive only as copy
// (Cindy's bubbles) and as row icons, never as the thing a card is showing off.
//
// ─────────────────────────── PLAYABLE, NOT A SLIDESHOW ───────────────────────────
//
// A card with `steps.length > 1` advances when the preview is TAPPED, and says so with a pulsing
// hint. Learning the ＋ menu by pressing ＋ is what makes it stick; watching a screenshot of ＋ is
// not. Concept cards — Welcome, Ranks, Emberfall, Profile, Agora, Flame Pass — stay single-state,
// because there is nothing to do on them and a tap hint that leads nowhere teaches the user to
// ignore tap hints.
// ══════════════════════════════════════════════════════════════════════════════════════════════

export type TutorialSection = 'Core' | 'Social' | 'Cosmetic' | 'Setup' | 'Season' | 'Flame Pass';

export type TutorialCard = {
  key: string;
  /** Rail label. */
  title: string;
  /** Starts a new rail group above this item. */
  section?: TutorialSection;
  /** Cindy's line, one per step. Index is clamped, so a 3-step card may carry a single line. */
  cindy: string[];
  /** One preview per step. A single entry is a concept card. */
  steps: ReactNode[];
  /** Footer primary label. Defaults to "Next". */
  next?: string;
  /** The quiet opt-out under the primary — only the Flame Pass card has one. */
  secondary?: string;
  /** The primary routes to the paywall instead of advancing. */
  buy?: boolean;
};

/** The tour. Order is the order of the rail and the order of the cards. */
export function tutorialCards(displayName: string | null, handle: string | null): TutorialCard[] {
  const you = displayName?.split(' ')[0]?.trim() || 'friend';
  const at = handle ? `@${handle}` : '@you';

  return [
    // ─────────────────────────── WELCOME ───────────────────────────
    {
      key: 'welcome',
      title: 'Welcome',
      cindy: [
        `You're in, ${you}! I'm Cindy 🔥 — give me two minutes and you'll know every corner of this app. That list on the left is everything in it.`,
      ],
      next: "Let's go →",
      // THE IGNITION (mock 239 "Bridge"): the first thing after the last setup step is the real
      // flame lighting with their name under it — same background, same spine, one continuous run.
      steps: [
        <MiniScreen center key="w">
          <TourFlame height={120} />
          <Text style={styles.welcome}>Welcome, {you}</Text>
        </MiniScreen>,
      ],
    },

    // ─────────────────────────── CORE ───────────────────────────
    {
      key: 'flame',
      title: 'Your flame',
      section: 'Core',
      // 🔴 FOUR STEPS, NOT THREE, because the picker is now TWO TAPS
      // (CODE_PROMPT_lockin_taxonomy_two_tap.md, mock 194). The old middle frame showed one flat
      // list — Study / Gym / Run — and taught a screen that no longer exists. The top level is
      // Studying · Deep Work · Fitness (Deep Work restored ON PURPOSE in 0186 — do not drop it from
      // this frame; Meditate stays gone), and the thing that makes the picker worth showing off is
      // that the second tap is a COURSE. A tour whose whole promise is "here is what the app looks
      // like" cannot be the one screenshot that lies.
      cindy: [
        'This is your flame — it *is* you. See the orange ⏱ Lock in button? Tap it.',
        "Two taps, that's it. First: what are you doing? 📚 Studying is for a course, 📐 Deep Work is a project. Tap Studying.",
        'Then which one — your course, or Custom for anything else. (Fitness goes Cardio or Strength.)',
        "And you're locked in. Embers and XP are already stacking, and your streak is alive. 🔥",
      ],
      steps: [
        <MiniScreen key="f0">
          <MiniHeader icon={<FlameGlyph />} title="Home" right="🔥 1,240" />
          <View style={styles.flameWrap}>
            <TourFlame height={96} />
            <MiniMuted>4-day streak</MiniMuted>
          </View>
          <MiniButton label="⏱ Lock in" />
        </MiniScreen>,
        <MiniScreen key="f1">
          <MiniHeader icon={<FlameGlyph />} title="Lock in for…" />
          {/* All three real cards, in the real order. Studying-for vs Deep-Work-on is the choice
              people hesitate over, so the tour cannot show a two-card screen that no longer exists. */}
          <MiniRow glyph="📚" title="Studying" highlight />
          <MiniRow glyph="📐" title="Deep Work" />
          <MiniRow glyph="🏋️" title="Fitness" />
        </MiniScreen>,
        <MiniScreen key="f2">
          <MiniHeader glyph="📚" title="Studying" />
          <MiniRow title="KP390" highlight />
          <MiniRow title="EC120" />
          <MiniRow glyph="＋" title="Custom" />
        </MiniScreen>,
        <MiniScreen center key="f3">
          <MiniMuted>📚 KP390 · locked in</MiniMuted>
          <TourFlame height={96} />
          <MiniMuted color={Colors.amber}>00:12</MiniMuted>
        </MiniScreen>,
      ],
    },
    {
      key: 'ranks',
      title: 'Climb the ranks',
      // 🔴 COPY + EMBLEMS ONLY. Rank is a lifetime climb (0230) — no decay, no seasonal reset. Only
      // the Flame Pass is seasonal, so that is the one thing this card may say starts over.
      cindy: [
        'Your rank never resets — every hour you lock in climbs it for good. The mortal climb, up to Diamond, is for everyone; crossing into ascension (Hero → Primordial) takes years. The Flame Pass is what starts fresh each season.',
      ],
      steps: [
        <MiniScreen key="r">
          <MiniHeader glyph="🏆" title="The ranks" right="10 tiers · for life" />
          <RankLadder />
        </MiniScreen>,
      ],
    },
    {
      key: 'profile',
      title: 'Your profile',
      cindy: [
        'Your profile is your Trophy Hall. Earn a discipline relic for each thing you grind — and each one levels up (α → Ω) the more you show up. There is even a secret one to find. 🔒',
      ],
      steps: [
        <MiniScreen key="p">
          <MiniHeader glyph="👤" title={at} right="Diamond III" />
          <Text style={styles.sectionLabel}>Discipline relics</Text>
          <View style={styles.relics}>
            {RELIC_SHELF.map((r) => (
              <View key={r.short} style={styles.relic}>
                <View style={[styles.relicTile, { borderColor: r.color }]}>
                  <RelicTile relicKey={r.relicKey} />
                  {r.rung ? <Text style={[styles.rung, { color: r.color }]}>{r.rung}</Text> : null}
                </View>
                <Text style={styles.relicCap} numberOfLines={1}>
                  {r.short}
                </Text>
              </View>
            ))}
            <View style={styles.relic}>
              <View style={[styles.relicTile, styles.relicLocked]}>
                <Text style={styles.relicGlyph}>🔒</Text>
              </View>
              <Text style={styles.relicCap}>Secret</Text>
            </View>
          </View>
        </MiniScreen>,
      ],
    },

    // ─────────────────────────── SOCIAL ───────────────────────────
    {
      key: 'campfires',
      title: 'Campfires',
      section: 'Social',
      cindy: [
        'Campfires are your crew — private groups where you set goals together and keep each other going.',
      ],
      steps: [
        <MiniScreen key="c">
          <MiniHeader glyph="🏕️" title="Campfires" />
          <MiniRow glyph="🏃" title="LRC" sub="🔥 4-day streak · 2 members" />
          <MiniRow glyph="🐐" title="Goat" sub="🔥 1-day streak" />
          <View style={styles.spacer} />
          <MiniButton label="+ Start a campfire" />
        </MiniScreen>,
      ],
    },
    {
      key: 'chat',
      title: 'Campfire chat',
      cindy: [
        "This is a campfire's chat. See the ＋ in the corner? Tap it.",
        'Post a photo, start a challenge, share a lock-in, or ping a teammate to get them moving. 💬',
      ],
      steps: [
        <MiniScreen key="ch0">
          <MiniHeader glyph="🏃" title="LRC 👑" />
          <MiniBanner label="📸 Shared a lock-in" colors={['#7a3f8f', '#f0a04b']} height={46} />
          <MiniBubble text="on it 💪" me />
          <View style={styles.spacer} />
          <MiniButton label="＋" />
        </MiniScreen>,
        <MiniScreen key="ch1">
          <MiniHeader glyph="＋" title="Add to the fire" />
          <MiniRow glyph="📸" title="Post a photo" />
          <MiniRow glyph="⚔️" title="Start a challenge" />
          <MiniRow glyph="🔗" title="Share a lock-in" />
          <MiniRow glyph="🔔" title="Ping a member" />
        </MiniScreen>,
      ],
    },
    {
      key: 'challenges',
      title: 'Challenges',
      cindy: [
        "Wanna see who's actually more locked in? Start a duel — you vs a friend. Race your whole campfire, or run a team game. Tap to send it.",
        'Sent! The second they accept, the race is on. ⚔️',
      ],
      steps: [
        <MiniScreen key="d0">
          <MiniHeader glyph="⚔️" title="Duel" />
          <View style={styles.vs}>
            <View style={styles.pf}>
              <Text style={styles.pfText}>N</Text>
            </View>
            <Text style={styles.vsText}>VS</Text>
            <View style={styles.pf}>
              <Text style={styles.pfText}>🐐</Text>
            </View>
          </View>
          <MiniMuted>Most lock-ins · 3 days</MiniMuted>
          <View style={styles.spacer} />
          <MiniButton label="Start the duel" />
        </MiniScreen>,
        <MiniScreen center key="d1">
          <View style={styles.vs}>
            <View style={styles.pf}>
              <Text style={styles.pfText}>N</Text>
            </View>
            <Text style={styles.vsText}>VS</Text>
            <View style={styles.pf}>
              <Text style={styles.pfText}>🐐</Text>
            </View>
          </View>
          <MiniMuted color={Colors.amber}>Challenge sent 🔥</MiniMuted>
          <MiniMuted>Waiting for them to accept…</MiniMuted>
        </MiniScreen>,
      ],
    },
    {
      key: 'goals',
      title: 'Personal goals',
      cindy: [
        "Challenges aren't only duels — set a personal goal. Nail 80% in a hard STEM course and I stake you a real reward. Fitness works a little differently…",
        'For fitness I reward consistency and effort, not the number. Train 3× a week, or climb a relic, and the crate is yours. Everyone\'s body is different, so I never pay out for raw weight.',
        'A big PR is your flex — and I score it against your own bodyweight (1.9× you 💪). No crate for it; share it far and wide instead. 🔥',
      ],
      steps: [
        <MiniScreen key="g0">
          <MiniHeader glyph="🎯" title="New goal" />
          <MiniRow glyph="📚" title="Get 80% in CHEM 121" sub="Hard STEM course · by Dec 12" />
          <MiniRow
            glyph="🧰"
            title="Legendary reward"
            sub="Staked by Cindy — earn it if you hit 80%"
            accent={RARITY_COLOR.legendary}
          />
          <View style={styles.spacer} />
          <MiniButton label="🎯 Track this goal" />
        </MiniScreen>,
        <MiniScreen key="g1">
          <MiniHeader glyph="🏋️" title="Fitness" />
          <MiniRow glyph="🔥" title="Train 3× this week" sub="Consistency challenge" />
          <MiniRow
            glyph="🔥"
            title="Rare crate on the streak"
            sub="Consistency + relics earn loot"
            accent={RARITY_COLOR.rare}
          />
          {/* 🔴 THE ETHOS, ON SCREEN AND IN CINDY'S OWN WORDS. Noah's decision, and it is a policy
              the user has to be TOLD rather than left to infer from an absent reward — someone who
              PRs and gets no crate will read that as a bug unless this card got there first. */}
          <Text style={styles.ethos}>
            For fitness I reward <Text style={styles.ethosStrong}>showing up</Text> — not the weight on the bar.
            Everyone&apos;s body is different. 💪
          </Text>
          <View style={styles.spacer} />
          <MiniButton label="🔥 Track consistency" />
        </MiniScreen>,
        <MiniScreen center key="g2">
          <ShareCard big="300 SQUAT" sub="1.9× bodyweight 🔥" art={<RelicTile relicKey="relic-hercules-might" />} user={at} />
          <MiniChip label="Your flex · 1.9× your bodyweight" color={RARITY_COLOR.legendary} />
          <MiniMuted>A PR is a flex, not a payout → Agora · Campfire · Story</MiniMuted>
        </MiniScreen>,
      ],
    },
    {
      key: 'cindy',
      title: 'Ask Cindy',
      cindy: [
        'I am always one tap away — tap your flame right on the home screen to open me up.',
        'Watch. I can scope anything you throw at me…',
      ],
      steps: [
        <MiniScreen center key="ac0">
          <TourFlame height={96} />
          <MiniMuted color={Colors.amber}>Tap your flame to talk to me</MiniMuted>
        </MiniScreen>,
        <MiniScreen key="ac1">
          <MiniHeader icon={<FlameGlyph />} title="Ask Cindy" />
          <CindyDemo />
        </MiniScreen>,
      ],
    },
    {
      key: 'leaderboard',
      title: 'Leaderboard',
      cindy: [
        'This is Friends — you vs your crew. Tap Campus up top to widen it.',
        'Campus — everyone at your school, ranked. Now tap Inter-Uni.',
        'Inter-Uni — your whole school stacked against other universities. Rep your campus. 🏛️ (You can go private any time.)',
      ],
      steps: [
        <MiniScreen key="lb0">
          <MiniHeader glyph="📊" title="Leaderboard" />
          <MiniTabs names={['Friends', 'Campus', 'Inter-Uni']} active={0} />
          <MiniRow glyph="1" title="@ava" right="12,480" />
          <MiniRow glyph="2" title="You" right="11,905" highlight />
          <MiniRow glyph="3" title="@marcus" right="9,340" />
        </MiniScreen>,
        <MiniScreen key="lb1">
          <MiniHeader glyph="📊" title="Leaderboard" />
          <MiniTabs names={['Friends', 'Campus', 'Inter-Uni']} active={1} />
          <MiniRow glyph="1" title="@kwn_ari" right="48,900" />
          <MiniRow glyph="2" title="@devsam" right="44,210" />
          <MiniRow glyph="17" title="You" right="11,905" highlight />
        </MiniScreen>,
        <MiniScreen key="lb2">
          <MiniHeader glyph="📊" title="Leaderboard" />
          <MiniTabs names={['Friends', 'Campus', 'Inter-Uni']} active={2} />
          <MiniRow glyph="🥇" title="Laurier" right="2.4M" highlight />
          <MiniRow glyph="2" title="Waterloo" right="2.1M" />
          <MiniRow glyph="3" title="Western" right="1.6M" />
        </MiniScreen>,
      ],
    },
    {
      key: 'agora',
      title: 'The Agora',
      cindy: [
        'The Agora is your campus feed — rank-ups, lock-ins and photos from everyone at school. React, hype each other up, catch the momentum. 🔥',
      ],
      steps: [
        <MiniScreen key="ag">
          <MiniHeader glyph="🏛️" title="The Agora" />
          <View style={styles.post}>
            <MiniRow glyph="A" title="Ava · ranked up 🔥" sub="Platinum III → Diamond I · 2m" />
            <View style={styles.reacts}>
              <MiniChip label="🔥 24" color={Colors.amber} />
              <MiniChip label="👏 8" color={Colors.muted} />
              <MiniChip label="💬 3" color={Colors.muted} />
            </View>
          </View>
          <View style={styles.post}>
            <MiniRow glyph="M" title="Marcus" sub="locked in · 90 min 📚 · 6m" />
            <MiniBanner label="📸 late night at the library" colors={['#2f5a8f', '#4fb0e5']} height={42} />
            <View style={styles.reacts}>
              <MiniChip label="🔥 41" color={Colors.amber} />
              <MiniChip label="🫡 12" color={Colors.muted} />
            </View>
          </View>
        </MiniScreen>,
      ],
    },
    {
      key: 'share',
      title: 'Share your wins',
      cindy: [
        'Hit a milestone — a rank-up, a relic, a monster lock-in? Philoi builds you a share card for it. Tap Share.',
        'Send it three ways: the Agora, your Campfire, or straight to your story so the whole world knows. 🌍',
      ],
      steps: [
        <MiniScreen center key="s0">
          <ShareCard big="RANK UP" sub="Diamond II → Diamond III" art={<FlameGlyph size={36} />} user={at} kicker="PHILOI" />
          <MiniButton label="📤 Share this" style={styles.shareBtn} />
        </MiniScreen>,
        <MiniScreen key="s1">
          <MiniHeader glyph="📤" title="Share your win" />
          <MiniRow glyph="📣" title="Post to the Agora" sub="Your whole campus sees it" />
          <MiniRow glyph="🏕️" title="Send to your Campfire" sub="Hype up your crew" />
          <MiniRow glyph="📸" title="Share to your story" sub="IG / Snap — the whole world" />
          <MiniMuted color={Colors.amber}>Rank-ups hit different on socials 🔥</MiniMuted>
        </MiniScreen>,
      ],
    },

    // ─────────────────────────── COSMETIC ───────────────────────────
    {
      key: 'cosmetics',
      title: 'Cosmetics',
      section: 'Cosmetic',
      cindy: COSMETICS.map((c) => c.cindy),
      steps: COSMETICS.map((c) => <CosmeticStep key={c.name} spec={c} name={at} />),
    },
    {
      key: 'shop',
      title: 'The Shop',
      cindy: [
        'Wanna look cooler than your friends? Crates are how you flex. Tap Open ×10 to crack a batch.',
        'Here we go…',
      ],
      steps: [
        <MiniScreen key="sh0">
          <MiniHeader glyph="📦" title="Shop" right="🔥 1,240" />
          <CrateShelf boxes={['furnace', 'hestia', 'hephaestus']} />
          <MiniMuted>The Furnace · 250 🔥</MiniMuted>
          <View style={styles.spacer} />
          <MiniButton label="Open ×10" />
        </MiniScreen>,
        // The REAL crate-open — rattle, lid lift, burst — not a 📦.
        <MiniScreen center key="sh1">
          <TourCrateOpen />
          <MiniMuted color={RARITY_COLOR.rare}>Cracking them open…</MiniMuted>
        </MiniScreen>,
      ],
    },
    {
      key: 'crates',
      title: 'Open crates',
      // 🔴 TEN, and no Crown of Olympus — that is not a crate drop, and the tour must not promise
      // one. The haul is ordinary cosmetics at mixed rarities, and it is TAPPABLE: what you tap loads
      // onto a profile chip live, which is the reason anyone opens a crate.
      cindy: [
        'Ten shards, face down. Tap to flip them over — no peeking, rarity is the surprise.',
        'These are yours to flex. Tap any one and watch it land on your profile, live. ✨',
      ],
      steps: [
        <MiniScreen key="cr0">
          <MiniHeader glyph="✨" title="Opening ×10" right="0 / 10" />
          <View style={styles.grid}>
            {Array.from({ length: 10 }, (_, i) => (
              <FaceDownTile key={i} />
            ))}
          </View>
        </MiniScreen>,
        <MiniScreen key="cr1">
          <MiniHeader glyph="✨" title="Your haul" right="10 pulls" />
          <HaulPreview name={at} />
        </MiniScreen>,
      ],
    },
    {
      key: 'inventory',
      title: 'Your inventory',
      cindy: [
        'Everything you own lives here. Tap the gold one in the corner to check it out.',
        'Equip it and your flame and profile show it off. Flex on. ✨',
      ],
      steps: [
        <MiniScreen key="in0">
          <MiniHeader glyph="🎒" title="Inventory" />
          <ItemGrid ids={INVENTORY_IDS} />
        </MiniScreen>,
        <MiniScreen center key="in1">
          <ItemHero id={INVENTORY_IDS[0]} size={64} />
          <MiniMuted color={Colors.ink}>{getItem(INVENTORY_IDS[0])?.name ?? 'Inferno Flare'} · Legendary</MiniMuted>
          <MiniButton label="Equipped ✓" style={styles.shareBtn} />
        </MiniScreen>,
      ],
    },
    {
      key: 'forge',
      title: 'The Forge',
      // BEFORE → FORGE → AFTER (mock 239, 18/20), then the real strike.
      cindy: [
        'Duplicates are never wasted. Tap Forge and watch your two spares fuse into something a rarity up.',
        'Boom. Two Epics became a Legendary. Keep climbing toward Mythic. 🔨',
      ],
      steps: [
        <MiniScreen key="fo0">
          <MiniHeader glyph="🔨" title="The Forge" />
          <ForgeBefore forgeButton={<MiniButton label="Forge" style={styles.forgeBtn} />} />
        </MiniScreen>,
        <MiniScreen center key="fo1">
          <ForgeAfter />
        </MiniScreen>,
      ],
    },
    // ─────────────────────────── SETUP ───────────────────────────
    {
      key: 'settings',
      title: 'Set it up',
      section: 'Setup',
      cindy: [
        'Nearly there. Tap the toggles to flip them on — notifications, your apps, all of it.',
        "Perfect. Notifications on, apps connected, privacy your call. You're ready to light the fire. 🔥",
      ],
      steps: [
        <MiniScreen key="st0">
          <MiniHeader glyph="⚙️" title="Settings" />
          <MiniToggle label="Notifications" on={false} />
          <MiniToggle label="Strava / Health" on={false} />
          <MiniToggle label="Google Calendar" on={false} />
          <MiniToggle label="Focus Nudge" on={false} />
        </MiniScreen>,
        <MiniScreen key="st1">
          <MiniHeader glyph="⚙️" title="Settings" />
          <MiniToggle label="Notifications" on />
          <MiniToggle label="Strava / Health" on />
          <MiniToggle label="Google Calendar" on />
          <MiniToggle label="Focus Nudge" on />
          <MiniMuted color={Colors.green}>All set 🔥</MiniMuted>
        </MiniScreen>,
      ],
    },

    // ─────────────────────────── SEASON 1: EMBERFALL — saved for the finish (mock 239, 19/20) ───────────────────────────
    //
    // Late on purpose: after every free thing has been shown, so the season lands as the stakes rather
    // than as card three of twenty. Big and bold — the real sky and the real falling embers fill the
    // whole card.
    {
      key: 'emberfall',
      title: 'Season 1: Emberfall',
      section: 'Season',
      cindy: [
        `Every semester the sky rains fire — that's Emberfall. Catch an ember, keep it burning all season, and you ascend with it. Season 1 ends ${SEASON_ENDS}.`,
      ],
      steps: [<EmberfallHero key="e" />],
    },

    // ─────────────────────────── THE FLAME PASS — the finale (mocks 226 / 227) ───────────────────────────
    //
    // LAST, after every free thing has been shown, and in the EMBER palette: a deliberate premium
    // shift, so it reads as a special moment rather than one more info card. It teaches the one
    // thing about the pass nobody would guess — a holder's NAME burns — with a board where one name
    // is on fire. The example board is inert, like every preview here; the fire on it is forced,
    // not read from anyone's entitlement.
    {
      key: 'pass',
      title: 'The Flame Pass',
      section: 'Flame Pass',
      // 🔴 SELLS THE VALUE, NOT THE TRANSACTION. Cindy explains what the fire means and never says
      // "grab it now" — the two buttons carry that, and the opt-out sits right there, always.
      cindy: [
        "The Flame Pass is your key to Emberfall's premium reward track — and it sets your name on fire everywhere the campus looks. 🔥",
      ],
      next: 'See the Flame Pass 🔥',
      secondary: 'Maybe later',
      buy: true,
      steps: [<FlamePassPreview key="fp" you={you} />],
    },
  ];
}

/** Mock 226's board: three names, the middle one — yours — on fire. */
function FlamePassPreview({ you }: { you: string }) {
  const rows = [
    { rank: 1, name: 'Maya', pts: '4,120' },
    { rank: 2, name: you, pts: '3,880', fire: true },
    { rank: 3, name: 'Priya', pts: '3,540' },
  ];
  return (
    <MiniScreen center style={styles.fireScreen}>
      <EmberfallSky kind="tutorial" />
      <FallingEmbers count={5} fall={420} />
      <View style={styles.fireBoard}>
        {rows.map((r) => (
          <View key={r.rank} style={[styles.fireRow, r.fire && styles.fireRowOn]}>
            <Text style={[styles.fireRank, r.fire && { color: EMBER.e2 }]}>{r.rank}</Text>
            <View style={[styles.fireAv, r.fire && styles.fireAvOn]} />
            <View style={styles.fireName}>
              <BurningName owns={Boolean(r.fire)} style={styles.fireNameText}>
                {r.name}
              </BurningName>
            </View>
            <Text style={styles.firePts}>{r.pts}</Text>
          </View>
        ))}
      </View>
      <Text style={styles.fireH1}>
        See a name <Text style={styles.fireH1Hot}>on fire?</Text>
      </Text>
      <Text style={styles.fireP}>
        That&apos;s a <Text style={styles.fireB}>Flame Pass</Text> holder.
      </Text>
      {/* 🔴 THE CONNECTION, SPELLED OUT (mock 239, 20/20). The pass is two things and the second one
          is the one nobody guesses: it is the key to the season's premium track, not only a name
          effect. The card that sells it has to say both. */}
      <View style={styles.unlocks}>
        <Text style={styles.unlocksCap}>FLAME PASS UNLOCKS</Text>
        <View style={styles.unlockRow}>
          <FlameGlyph size={11} />
          <Text style={styles.unlockText}>
            Your name <Text style={styles.fireB}>on fire</Text> everywhere — boards, campfires, the Agora
          </Text>
        </View>
        <View style={styles.unlockRow}>
          <EmberfallSeal size={12} spin={false} />
          <Text style={styles.unlockText}>
            The <Text style={styles.unlockStrong}>Emberfall premium track</Text> — the season&apos;s exclusive rewards
          </Text>
        </View>
      </View>
    </MiniScreen>
  );
}

// ─────────────────────────── Emberfall, big and bold ───────────────────────────

/**
 * When Season 1 closes, as the tour says it. The live window is economy_config.season (ends_at
 * 2026-12-23T05:00Z — midnight Eastern), so the last full day is the 22nd. Hardcoded rather than
 * read because the tour is inert and must run offline on a first cold launch; update it with the
 * season row.
 */
const SEASON_ENDS = 'Dec 22';

function EmberfallHero() {
  const reduceMotion = useReduceMotion();
  return (
    <MiniScreen center style={styles.emberScreen}>
      <EmberfallSky kind="paywall" />
      <FallingEmbers count={12} fall={520} />
      <EmberfallSeal size={58} spin={!reduceMotion} />
      <Text style={styles.emberKicker}>SEASON 1</Text>
      <Text style={styles.emberBig}>EMBERFALL</Text>
      <Text style={styles.emberLore}>
        &ldquo;When the fire fell from Olympus, only those who kept an ember lit rose with it.&rdquo;
      </Text>
      <Text style={styles.emberEnds}>Ends {SEASON_ENDS} · rewards that never return</Text>
    </MiniScreen>
  );
}

/** The live families, named and coloured from RELIC_LADDERS so the shelf matches the real one. */
const RELIC_SHELF = RELIC_LADDERS.map((l, i) => ({
  short: l.short,
  // The real drawing for each family's relic (relic-art.tsx), not an emoji stand-in.
  relicKey: l.relicKey,
  color: RARITY_COLOR[l.rarities[Math.min(i % l.rarities.length, l.rarities.length - 1)]],
  rung: RUNG_GLYPH[Math.min(i, RUNG_GLYPH.length - 1)],
}));

/** The inventory card's shelf. The FIRST is "the gold one in the corner" Cindy asks them to tap. */
const INVENTORY_IDS = [
  'halo-inferno-flare',
  'particle-falling-ash',
  'flame-electric-cyan',
  'title-pacesetter',
  'banner-ashfall-ridge',
  'card-obsidian-mesh',
  'flame-neutron-starfire',
  'halo-copper-ring',
];

// ─────────────────────────── the nine cosmetic types ───────────────────────────
//
// 🔴 THE CONVERSION HOOK. Cosmetics are what people actually chase, so this card is nine taps, one
// per type, each drawn with the SHIPPED renderer on the flame and on a profile chip — not a list of
// names. The message the whole card exists to deliver is at the end of it: EVERY part of your flame
// is customizable. The rarity chip is read off the real catalog item, so it cannot disagree with
// the art (tour-art.tsx's COSMETIC_ITEM).

type CosmeticSpec = {
  name: string;
  kind: CosmeticKind;
  blurb: string;
  cindy: string;
};

const COSMETICS: CosmeticSpec[] = [
  {
    name: 'Flame skin',
    kind: 'flame',
    blurb: 'Your core look. Swap the whole flame — and it follows your name everywhere.',
    cindy: 'Cosmetics are how you make your flame yours. Start with the flame skin — tap through every type.',
  },
  {
    name: 'Flare',
    kind: 'flare',
    blurb: 'A glowing aura around your whole screen while you are locked in — and around your profile.',
    cindy: 'A Flare — a glowing aura around your *whole screen* and your profile. The ultimate flex.',
  },
  {
    name: 'Ring',
    kind: 'ring',
    blurb: 'Crowns your flame — and circles your profile icon everywhere you appear.',
    cindy: 'Rings crown your flame — and circle your profile icon everywhere you appear.',
  },
  {
    name: 'Particles',
    kind: 'particles',
    blurb: 'Little effects that drift around your flame and your profile — embers, sparks, ash.',
    cindy: 'Particles drift around your flame and your profile — embers, sparks, ash.',
  },
  {
    name: 'Banner',
    kind: 'banner',
    blurb: 'The scene behind your profile and your campfire — it flies for your whole crew.',
    cindy: 'Banners are the backdrop on your profile and campfire.',
  },
  {
    name: 'Title',
    kind: 'title',
    blurb: 'A tag under your name everyone sees — flex your grind.',
    cindy: 'Titles sit under your name for everyone to see.',
  },
  {
    name: 'SFX',
    kind: 'sfx',
    blurb: 'The sound your lock-in starts and ends on — two stings, your call.',
    cindy: 'SFX — the sound your lock-in starts *and* ends on.',
  },
  {
    name: 'Audio',
    kind: 'audio',
    blurb: 'A background track that plays while you grind — set the vibe.',
    cindy: 'Audio sets your background track while you grind.',
  },
  {
    name: 'Card',
    kind: 'card',
    blurb: 'The surface your name sits on — on your profile and on your Agora posts.',
    cindy: 'And your card — the surface your name sits on. Every single thing is customizable — that is the flex. 🎨',
  },
];

/**
 * One cosmetic type. The `n / 9` lives in the frame's spine now (`TOUR 11 / 20 · COSMETICS 3 / 9`),
 * so the miniature header no longer repeats it.
 */
function CosmeticStep({ spec, name }: { spec: CosmeticSpec; name: string }) {
  const rarity = cosmeticRarity(spec.kind);
  const tint = RARITY_COLOR[rarity];
  return (
    <MiniScreen>
      <MiniHeader glyph="🎨" title="Cosmetics" />
      <View style={styles.cosStage}>
        <CosmeticHero kind={spec.kind} name={name} />
      </View>
      <View style={styles.reacts}>
        <MiniChip label={`${rarity.toUpperCase()} · ${spec.name}`} color={tint} />
      </View>
      <Text style={styles.cosCap}>{spec.blurb}</Text>
    </MiniScreen>
  );
}

/** The story-format share card, as it appears in the tour. `art` is real art, never an emoji. */
function ShareCard({
  big,
  sub,
  art,
  user,
  kicker,
}: {
  big: string;
  sub: string;
  art: ReactNode;
  user: string;
  kicker?: string;
}) {
  return (
    <View style={styles.shareCard}>
      {kicker ? <Text style={styles.scTop}>{kicker}</Text> : null}
      {art}
      <Text style={styles.scBig} numberOfLines={1}>
        {big}
      </Text>
      <Text style={styles.scSub} numberOfLines={1}>
        {sub}
      </Text>
      <Text style={styles.scUser}>{user}</Text>
    </View>
  );
}

/**
 * The live-typed Cindy demo.
 *
 * A real typewriter rather than a static bubble, because the point of the card is that Cindy
 * ANSWERS — a screenshot of a chat teaches that there is a chat, and watching a sentence get typed
 * and priced teaches what she is for. "I want to learn a backflip" is the example on purpose: it is
 * not a study goal, not a fitness goal, and not on any list, which is the whole claim.
 */
function CindyDemo() {
  const reduceMotion = useReduceMotion();
  // TWO COMPONENTS, not one with a branch inside its effect. The reduced-motion version has no
  // timeline at all — the conversation is simply already there — and expressing that as an early
  // setState inside the animated component's effect is both a cascading render and the thing
  // react-hooks/set-state-in-effect rejects. Splitting makes "no animation" a different render
  // rather than an animation that skips to the end.
  return reduceMotion ? <CindyDemoStatic /> : <CindyDemoTyped />;
}

const CINDY_Q = 'I want to learn a backflip';
const CINDY_A = "Love it 🤸 That's an Epic feat — nail it and here's a fair reward:";

/** What Cindy prices the feat at. Shared, so the two versions cannot drift apart. */
function CindyReward() {
  return (
    <MiniRow
      glyph="⚱️"
      title="Vessel of Hestia"
      sub="Epic reward · on completion"
      accent={RARITY_COLOR.epic}
    />
  );
}

function CindyDemoStatic() {
  return (
    <View style={styles.cindyStream}>
      <MiniBubble text={CINDY_Q} me />
      <MiniBubble text={CINDY_A} />
      <CindyReward />
    </View>
  );
}

/**
 * The live-typed Cindy demo.
 *
 * A real typewriter rather than a static bubble, because the point of the card is that Cindy
 * ANSWERS — a screenshot of a chat teaches that there is a chat; watching a sentence get typed and
 * then PRICED teaches what she is for. "I want to learn a backflip" is the example on purpose: it
 * is not a study goal, not a fitness goal, and not on any list, which is the whole claim.
 */
function CindyDemoTyped() {
  const [typed, setTyped] = useState('');
  const [reply, setReply] = useState('');
  const [stage, setStage] = useState<0 | 1 | 2 | 3>(0);

  useEffect(() => {
    let cancelled = false;
    const timers: ReturnType<typeof setTimeout>[] = [];

    const type = (text: string, ms: number, onChar: (s: string) => void, done: () => void) => {
      let i = 0;
      const step = () => {
        if (cancelled) return;
        onChar(text.slice(0, i));
        i += 1;
        if (i <= text.length) timers.push(setTimeout(step, ms));
        else done();
      };
      // SCHEDULED, not called. Invoking step() here would write the first character during the
      // effect body, which is a synchronous setState in an effect — the exact thing this split
      // exists to avoid.
      timers.push(setTimeout(step, ms));
    };

    type(CINDY_Q, 55, setTyped, () => {
      if (cancelled) return;
      setStage(1);
      timers.push(
        setTimeout(() => {
          if (cancelled) return;
          setStage(2);
          type(CINDY_A, 26, setReply, () => {
            if (!cancelled) setStage(3);
          });
        }, 900)
      );
    });

    // Every timer is tracked and cleared. This card can be left mid-sentence by a rail tap, and a
    // surviving chain would setState on an unmounted tree for the next two seconds.
    return () => {
      cancelled = true;
      timers.forEach(clearTimeout);
    };
  }, []);

  return (
    <View style={styles.cindyStream}>
      {stage >= 1 ? <MiniBubble text={CINDY_Q} me /> : null}
      {stage === 1 ? <MiniBubble text="typing…" /> : null}
      {stage >= 2 ? <MiniBubble text={reply} /> : null}
      {stage >= 3 ? <CindyReward /> : null}
      {stage === 0 ? (
        <View style={styles.cindyInput}>
          <Text style={styles.cindyInputText}>{typed}</Text>
          <Text style={styles.caret}>|</Text>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  welcome: { fontFamily: Fonts.black, fontSize: 17, color: Colors.ink, textAlign: 'center', marginTop: 4 },
  forgeBtn: { alignSelf: 'stretch', marginVertical: 4 },
  unlocks: {
    alignSelf: 'stretch',
    backgroundColor: 'rgba(29,20,48,0.85)',
    borderWidth: 1,
    borderColor: 'rgba(255,157,46,0.35)',
    borderRadius: 10,
    padding: 8,
    gap: 4,
  },
  unlocksCap: { fontFamily: Fonts.bodyBold, fontSize: 8, letterSpacing: 1, color: Colors.amber },
  unlockRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  unlockText: { flex: 1, fontFamily: Fonts.body, fontSize: 9.5, lineHeight: 13, color: EMBER.ink },
  unlockStrong: { fontFamily: Fonts.bodyBold, color: EMBER.ink },
  emberScreen: { borderColor: 'rgba(255,122,24,0.45)', gap: 6 },
  emberKicker: { fontFamily: Fonts.bodyBold, fontSize: 10, letterSpacing: 5, color: '#ffe3bd', marginTop: 4 },
  emberBig: { fontFamily: Fonts.black, fontSize: 30, letterSpacing: 1, color: EMBER.ink, textAlign: 'center' },
  emberLore: {
    fontFamily: Fonts.body,
    fontStyle: 'italic',
    fontSize: 11,
    lineHeight: 15.5,
    color: '#ffe6c6',
    textAlign: 'center',
    paddingHorizontal: 6,
    marginTop: 4,
  },
  emberEnds: { fontFamily: Fonts.bodyBold, fontSize: 10, color: '#ffd9a0', textAlign: 'center', marginTop: 4 },
  fireScreen: { borderColor: 'rgba(255,158,77,0.4)', gap: 10 },
  fireBoard: {
    alignSelf: 'stretch',
    backgroundColor: 'rgba(10,6,16,0.4)',
    borderWidth: 1,
    borderColor: '#2C2140',
    borderRadius: 12,
    overflow: 'hidden',
  },
  fireRow: { flexDirection: 'row', alignItems: 'center', gap: 7, paddingVertical: 8, paddingHorizontal: 9 },
  fireRowOn: { backgroundColor: 'rgba(224,97,44,0.16)' },
  fireRank: { width: 10, fontFamily: Fonts.bodyBold, fontSize: 11, color: EMBER.mut },
  fireAv: { width: 18, height: 18, borderRadius: 9, backgroundColor: '#2f2447', borderWidth: 1, borderColor: '#2C2140' },
  fireAvOn: { borderColor: EMBER.e1, borderWidth: 1.5 },
  fireName: { flex: 1, minWidth: 0 },
  fireNameText: { fontFamily: Fonts.bodyBold, fontSize: 12, color: EMBER.ink },
  firePts: { fontFamily: Fonts.bodyBold, fontSize: 10.5, color: EMBER.mut },
  fireH1: { fontFamily: Fonts.black, fontSize: 17, color: EMBER.ink, textAlign: 'center', marginTop: 4 },
  fireH1Hot: { color: EMBER.e2 },
  fireP: { fontFamily: Fonts.body, fontSize: 11.5, lineHeight: 16, color: EMBER.dim, textAlign: 'center' },
  fireB: { fontFamily: Fonts.bodyBold, color: EMBER.e2 },
  flameWrap: { alignItems: 'center', gap: 2, marginTop: 6, flex: 1, justifyContent: 'center' },
  spacer: { flex: 1 },
  sectionLabel: { fontFamily: Fonts.bodyBold, fontSize: 10, color: '#cbbfe6' },
  relics: { flexDirection: 'row', flexWrap: 'wrap', gap: 7, justifyContent: 'center' },
  relic: { alignItems: 'center', width: 44, gap: 2 },
  relicTile: {
    width: 36,
    height: 36,
    borderRadius: 10,
    borderWidth: 2,
    backgroundColor: '#1e1630',
    alignItems: 'center',
    justifyContent: 'center',
  },
  relicLocked: { borderColor: '#3a2c58', opacity: 0.5 },
  relicGlyph: { fontSize: 16 },
  rung: { position: 'absolute', bottom: 1, right: 3, fontSize: 8, fontFamily: Fonts.bodyBold },
  relicCap: { fontFamily: Fonts.body, fontSize: 8, color: Colors.muted },
  vs: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, marginTop: 6 },
  pf: {
    width: 38,
    height: 38,
    borderRadius: 12,
    borderWidth: 2,
    borderColor: '#3a2c58',
    backgroundColor: '#1e1630',
    alignItems: 'center',
    justifyContent: 'center',
  },
  pfText: { fontSize: 15, color: Colors.ink, fontFamily: Fonts.bodyBold },
  vsText: { fontFamily: Fonts.displayHeavy, fontSize: 12, color: Colors.muted },
  ethos: {
    fontFamily: Fonts.body,
    fontSize: 9.5,
    lineHeight: 14,
    color: Colors.muted,
    backgroundColor: '#241a38',
    borderWidth: 1,
    borderColor: '#3a2c58',
    borderRadius: 9,
    padding: 7,
  },
  ethosStrong: { color: Colors.ink, fontFamily: Fonts.bodyBold },
  post: { gap: 4, backgroundColor: '#1a1327', borderRadius: 10, padding: 6 },
  reacts: { flexDirection: 'row', gap: 4, justifyContent: 'center', flexWrap: 'wrap' },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 5, justifyContent: 'center', marginTop: 4 },
  shareBtn: { alignSelf: 'stretch', marginTop: 8 },
  shareCard: {
    width: 118,
    height: 168,
    borderRadius: 16,
    backgroundColor: '#5a2a50',
    borderWidth: 1,
    borderColor: '#f5a62366',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 3,
    overflow: 'hidden',
  },
  scTop: { position: 'absolute', top: 8, fontSize: 7, letterSpacing: 2, color: '#ffe0b8', fontFamily: Fonts.bodyBold },
  scBig: { fontSize: 15, fontFamily: Fonts.displayHeavy, color: '#fff', letterSpacing: 0.4 },
  scSub: { fontSize: 8.5, color: '#ffe6cf', fontFamily: Fonts.bodyBold },
  scUser: { position: 'absolute', bottom: 8, fontSize: 8.5, color: '#fff', fontFamily: Fonts.bodyBold },
  cosStage: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#140f22',
    borderRadius: 12,
    marginVertical: 4,
    overflow: 'hidden',
  },
  cosCap: { fontFamily: Fonts.body, fontSize: 9.5, lineHeight: 13.5, color: Colors.muted, textAlign: 'center' },
  cindyStream: { flex: 1, gap: 5, justifyContent: 'flex-end' },
  cindyInput: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#140f22',
    borderWidth: 1,
    borderColor: '#2c2340',
    borderRadius: 10,
    paddingHorizontal: 8,
    paddingVertical: 7,
  },
  cindyInputText: { fontFamily: Fonts.body, fontSize: 10.5, color: Colors.ink },
  caret: { fontFamily: Fonts.body, fontSize: 11, color: Colors.amber },
});
