import { useEffect, useState, type ReactNode } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import {
  MiniBanner,
  MiniBar,
  MiniBubble,
  MiniButton,
  MiniChip,
  MiniHeader,
  MiniMuted,
  MiniRow,
  MiniScreen,
  MiniTabs,
  MiniTile,
  MiniToggle,
} from '@/components/tutorial/mini-ui';
import { Colors, Fonts } from '@/constants/theme';
import { useReduceMotion } from '@/hooks/use-reduce-motion';
import { RELIC_LADDERS, RUNG_GLYPH } from '@/lib/economy/relic-ladders';
import { RARITY_COLOR } from '@/lib/economy/rarity';
import { RANK_TIER_METAL } from '@/lib/rank-tiers';
import type { RankTierName } from '@/types/database';

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
// cosmetics, the shop, opening crates, inventory, the Forge, the Flame Pass, settings. The three
// that were missing from earlier drafts and are explicitly not to be dropped again are the Agora,
// the Inventory and the Forge.
//
// ─────────────────────────── WHY THE RAIL IS THE PROGRESS UI ───────────────────────────
//
// Not dots. The rail lists EVERY section at once, grouped into four acts, so the first thing the
// user sees is the entire scope of the app — which is closure rather than anxiety. Dots say "there
// are more of these and you don't know how many", which is the feeling the tutorial exists to fix.
//
// ─────────────────────────── PLAYABLE, NOT A SLIDESHOW ───────────────────────────
//
// A card with `steps.length > 1` advances when the preview is TAPPED, and says so with a pulsing
// hint. Learning the ＋ menu by pressing ＋ is what makes it stick; watching a screenshot of ＋ is
// not. Concept cards — Welcome, Ranks, Emberfall, Profile, Agora, Flame Pass — stay single-state,
// because there is nothing to do on them and a tap hint that leads nowhere teaches the user to
// ignore tap hints.
// ══════════════════════════════════════════════════════════════════════════════════════════════

export type TutorialSection = 'Core' | 'Social' | 'Cosmetic' | 'Setup';

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
      steps: [
        <MiniScreen center key="w">
          <Text style={styles.bigFlame}>🔥</Text>
          <MiniMuted>Welcome, {you}</MiniMuted>
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
      // list — Study / Gym / Run — and taught a screen that no longer exists: the top level is
      // exactly Studying and Fitness, Deep Work and Meditate are gone entirely, and the thing that
      // makes the new picker worth showing off is that the second tap is a COURSE. A tour whose
      // whole promise is "here is what the app looks like" cannot be the one screenshot that lies.
      cindy: [
        'This is your flame — it *is* you. See the orange ⏱ Lock in button? Tap it.',
        "Two taps, that's it. First: what are you doing? Tap 📚 Studying.",
        'Then which one — your course, or Custom for anything else. (Fitness goes Cardio or Strength.)',
        "And you're locked in. Embers and XP are already stacking, and your streak is alive. 🔥",
      ],
      steps: [
        <MiniScreen key="f0">
          <MiniHeader glyph="🔥" title="Home" right="🔥 1,240" />
          <View style={styles.flameWrap}>
            <Text style={styles.bigFlame}>🔥</Text>
            <MiniMuted>4-day streak</MiniMuted>
          </View>
          <MiniButton label="⏱ Lock in" />
        </MiniScreen>,
        <MiniScreen key="f1">
          <MiniHeader glyph="🔥" title="Lock in for…" />
          {/* Bare labels, no subtitles — the mock is emphatic that the two cards say only this. */}
          <MiniRow glyph="📚" title="Studying" highlight />
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
          <Text style={styles.bigFlame}>🔥</Text>
          <MiniMuted color={Colors.amber}>00:12</MiniMuted>
        </MiniScreen>,
      ],
    },
    {
      key: 'ranks',
      title: 'Climb the ranks',
      cindy: [
        'Philoi has 10 tiers — Bronze all the way up to Primordial — and 28 ranks in total. Every session climbs you, and each rank you cross drops rewards.',
      ],
      steps: [
        <MiniScreen key="r">
          <MiniHeader glyph="🏆" title="The ranks" right="10 tiers · 28" />
          <View style={styles.ladder}>
            {LADDER.map((t) => (
              <View key={t.tier} style={[styles.lrow, t.here && styles.lrowHere]}>
                <View style={[styles.ldot, { backgroundColor: RANK_TIER_METAL[t.tier].inner }]} />
                <Text style={styles.lname} numberOfLines={1}>
                  {t.label}
                </Text>
                <Text style={[styles.ldiv, t.here && { color: Colors.amber }]}>
                  {t.here ? "you're here" : t.divisions}
                </Text>
              </View>
            ))}
          </View>
        </MiniScreen>,
      ],
    },
    {
      key: 'emberfall',
      title: 'Season 1: Emberfall',
      cindy: [
        'Emberfall is here. Lock in as much as you can, climb the ranks, and earn exclusive season rewards before it ends. This is the moment.',
      ],
      steps: [
        <MiniScreen key="e">
          <MiniHeader glyph="🍂" title="Season 1" right="Emberfall" />
          <MiniBanner label="SEASON 1 · EMBERFALL" colors={['#3a2b5c', '#c94f7c']} height={78} />
          <MiniMuted>Climb for exclusive season rewards</MiniMuted>
          <MiniBar pct={34} />
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
                  <Text style={styles.relicGlyph}>{r.glyph}</Text>
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
          <ShareCard big="300 SQUAT" sub="1.9× bodyweight 🔥" glyph="🏋️" user={at} />
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
          <Text style={styles.bigFlame}>🔥</Text>
          <MiniMuted color={Colors.amber}>Tap your flame to talk to me</MiniMuted>
        </MiniScreen>,
        <MiniScreen key="ac1">
          <MiniHeader glyph="🔥" title="Ask Cindy" />
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
            <MiniRow glyph="A" title="Ava · ranked up 🔥" sub="Diamond → Platinum I · 2m" />
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
          <ShareCard big="RANK UP" sub="Diamond III → Diamond II" glyph="🔥" user={at} kicker="PHILOI" />
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
      steps: COSMETICS.map((c, i) => (
        <CosmeticStep key={c.name} index={i + 1} total={COSMETICS.length} spec={c} />
      )),
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
          <View style={styles.tileRow}>
            <MiniTile glyph="🔥" color={RARITY_COLOR.rare} size={40} />
            <MiniTile glyph="⚱️" color={RARITY_COLOR.epic} size={40} />
            <MiniTile glyph="🧰" color={RARITY_COLOR.legendary} size={40} />
          </View>
          <MiniMuted>The Furnace · 250 🔥</MiniMuted>
          <View style={styles.spacer} />
          <MiniButton label="Open ×10" />
        </MiniScreen>,
        <MiniScreen center key="sh1">
          <Text style={[styles.bigFlame, { color: RARITY_COLOR.rare }]}>📦</Text>
          <MiniMuted color={RARITY_COLOR.rare}>Cracking them open…</MiniMuted>
        </MiniScreen>,
      ],
    },
    {
      key: 'crates',
      title: 'Open crates',
      cindy: [
        'Ten shards, face down. Tap to flip them over — no peeking, rarity is the surprise.',
        'A Mythic! The rarest pull always gets the spotlight. 👑',
      ],
      steps: [
        <MiniScreen key="cr0">
          <MiniHeader glyph="✨" title="Opening ×10" right="0 / 10" />
          <View style={styles.grid}>
            {Array.from({ length: 8 }, (_, i) => (
              <MiniTile key={i} glyph="🔥" color="#3a2c58" faceDown size={36} />
            ))}
          </View>
        </MiniScreen>,
        <MiniScreen key="cr1">
          <MiniHeader glyph="✨" title="Your haul" right="10 / 10" />
          <View style={styles.grid}>
            <MiniTile glyph="👑" color={RARITY_COLOR.mythic} size={36} />
            <MiniTile glyph="🌀" color={RARITY_COLOR.epic} size={36} />
            <MiniTile glyph="❄️" color={RARITY_COLOR.rare} size={36} />
            <MiniTile glyph="✨" color={RARITY_COLOR.uncommon} size={36} />
            {Array.from({ length: 4 }, (_, i) => (
              <MiniTile key={i} glyph="🔥" color={RARITY_COLOR.common} size={36} />
            ))}
          </View>
          <MiniMuted color={RARITY_COLOR.mythic}>★ Crown of Olympus!</MiniMuted>
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
          <View style={styles.grid}>
            <MiniTile glyph="🔥" color={RARITY_COLOR.legendary} size={36} />
            <MiniTile glyph="🌀" color={RARITY_COLOR.epic} size={36} />
            <MiniTile glyph="❄️" color={RARITY_COLOR.rare} size={36} />
            <MiniTile glyph="✨" color={RARITY_COLOR.uncommon} size={36} />
            <MiniTile glyph="🎏" color={RARITY_COLOR.epic} size={36} />
            <MiniTile glyph="💠" color={RARITY_COLOR.rare} size={36} />
            <MiniTile glyph="🔆" color={RARITY_COLOR.legendary} size={36} />
            <MiniTile glyph="⚡" color={RARITY_COLOR.uncommon} size={36} />
          </View>
        </MiniScreen>,
        <MiniScreen center key="in1">
          <MiniTile glyph="🔥" color={RARITY_COLOR.legendary} size={58} />
          <MiniMuted color={Colors.ink}>Inferno Flare · Legendary</MiniMuted>
          <MiniButton label="Equipped ✓" style={styles.shareBtn} />
        </MiniScreen>,
      ],
    },
    {
      key: 'forge',
      title: 'The Forge',
      cindy: [
        'Duplicates are never wasted — Forge them UP a rarity. Tap Forge to fuse these two.',
        'Boom. Two Uncommons became a Rare. Keep climbing toward Mythic. 🔨',
      ],
      steps: [
        <MiniScreen key="fo0">
          <MiniHeader glyph="🔨" title="The Forge" />
          <View style={styles.vs}>
            <MiniTile glyph="✨" color={RARITY_COLOR.uncommon} size={38} />
            <MiniTile glyph="✨" color={RARITY_COLOR.uncommon} size={38} />
            <Text style={styles.vsText}>→</Text>
            <MiniTile glyph="❄️" color={RARITY_COLOR.rare} size={38} />
          </View>
          <MiniMuted>2 spares → 1 rarer</MiniMuted>
          <View style={styles.spacer} />
          <MiniButton label="Forge" />
        </MiniScreen>,
        <MiniScreen center key="fo1">
          <MiniTile glyph="❄️" color={RARITY_COLOR.rare} size={58} />
          <MiniMuted color={RARITY_COLOR.rare}>Forged! Frost Halo · Rare</MiniMuted>
        </MiniScreen>,
      ],
    },
    {
      key: 'pass',
      title: 'The Flame Pass',
      // 🔴 SELLS THE VALUE, NOT THE TRANSACTION. Cindy hypes what it unlocks and never says "grab
      // it now" or "decide later" — the two buttons carry that, and putting the ask in her mouth
      // as well is what makes a tour feel like an ad. The opt-out sits right there, always.
      cindy: [
        "The Flame Pass lights up Emberfall's premium track — exclusive flares, halos and banners you can't earn any other way, dropping all season. Let the whole board know you were here from day one. 🔥",
      ],
      next: 'Unlock the Flame Pass 🔥',
      secondary: 'Maybe later',
      buy: true,
      steps: [
        <MiniScreen center key="fp">
          <Text style={styles.bigFlame}>🔥</Text>
          <View style={styles.reacts}>
            <MiniChip label="FLAME PASS" color={Colors.amber} />
            <MiniChip label="Emberfall" color={Colors.ember} />
          </View>
        </MiniScreen>,
      ],
    },

    // ─────────────────────────── SETUP ───────────────────────────
    {
      key: 'settings',
      title: 'Set it up',
      section: 'Setup',
      cindy: [
        'Last stop. Tap the toggles to flip them on — notifications, your apps, all of it.',
        "Perfect. Notifications on, apps connected, privacy your call. You're ready to light the fire. 🔥",
      ],
      next: 'Light the fire 🔥',
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
  ];
}

// ─────────────────────────── the ladder, from the real metals ───────────────────────────
//
// Colours come from RANK_TIER_METAL rather than being transcribed out of the mock, so the tutorial
// cannot show a Diamond that is a different blue from the one on the profile.

const LADDER: { tier: RankTierName; label: string; divisions: string; here?: boolean }[] = [
  { tier: 'primordial', label: 'Primordial', divisions: 'apex' },
  { tier: 'immortal', label: 'Immortal', divisions: 'III–I' },
  { tier: 'olympian', label: 'Olympian', divisions: 'III–I' },
  { tier: 'titan', label: 'Titan', divisions: 'III–I' },
  { tier: 'hero', label: 'Hero', divisions: 'III–I' },
  { tier: 'diamond', label: 'Diamond', divisions: 'III–I', here: true },
  { tier: 'platinum', label: 'Platinum', divisions: 'III–I' },
  { tier: 'gold', label: 'Gold', divisions: 'III–I' },
  { tier: 'silver', label: 'Silver', divisions: 'III–I' },
  { tier: 'bronze', label: 'Bronze', divisions: 'III–I' },
];

/** The five families, named and coloured from RELIC_LADDERS so the shelf matches the real one. */
const RELIC_SHELF = RELIC_LADDERS.map((l, i) => ({
  short: l.short,
  glyph: ['💪', '🏃', '📜', '🧠', '🧘'][i] ?? '🏅',
  color: RARITY_COLOR[l.rarities[Math.min(i % l.rarities.length, l.rarities.length - 1)]],
  rung: RUNG_GLYPH[Math.min(i, RUNG_GLYPH.length - 1)],
}));

// ─────────────────────────── the nine cosmetic types ───────────────────────────
//
// 🔴 THE CONVERSION HOOK. Cosmetics are what people actually chase, so this card is nine taps, one
// per type, each with its own live mini-render — not a list of names. The message the whole card
// exists to deliver is at the end of it: EVERY part of your flame is customizable.

type CosmeticSpec = {
  name: string;
  rarity: keyof typeof RARITY_COLOR;
  blurb: string;
  cindy: string;
  render: 'flame' | 'flare' | 'halo' | 'particles' | 'banner' | 'title' | 'sfx' | 'audio' | 'card';
};

const COSMETICS: CosmeticSpec[] = [
  {
    name: 'Flame skin',
    rarity: 'epic',
    render: 'flame',
    blurb: 'Your core look. Swap the whole flame — Ember, Frost, Void and more.',
    cindy: 'Cosmetics are how you make your flame yours. Start with the flame skin — tap through every type.',
  },
  {
    name: 'Flare',
    rarity: 'mythic',
    render: 'flare',
    blurb: 'A glowing aura around your whole screen while you are locked in — the biggest flex.',
    cindy: 'This is a Flare 🔥 — a glowing aura around your *whole screen*. The ultimate flex.',
  },
  {
    name: 'Halo',
    rarity: 'legendary',
    render: 'halo',
    blurb: 'A ring that crowns your flame — gold, angelic, cursed…',
    cindy: 'Halos crown your flame with a ring.',
  },
  {
    name: 'Particles',
    rarity: 'rare',
    render: 'particles',
    blurb: 'Little effects that drift around your flame — embers, sparks, petals.',
    cindy: 'Particles drift around you — embers, sparks, petals.',
  },
  {
    name: 'Banner',
    rarity: 'epic',
    render: 'banner',
    blurb: 'The backdrop on your profile and campfire — it flies for your whole crew.',
    cindy: 'Banners are the backdrop on your profile and campfire.',
  },
  {
    name: 'Title',
    rarity: 'legendary',
    render: 'title',
    blurb: 'A tag under your name everyone sees — flex your grind.',
    cindy: 'Titles sit under your name for everyone to see.',
  },
  {
    name: 'SFX',
    rarity: 'rare',
    render: 'sfx',
    blurb: 'The sound your lock-in starts and ends on — two stings, your call.',
    cindy: 'SFX — the sound your lock-in starts *and* ends on.',
  },
  {
    name: 'Audio',
    rarity: 'epic',
    render: 'audio',
    blurb: 'A background track that plays while you grind — set the vibe.',
    cindy: 'Audio sets your background track while you grind.',
  },
  {
    name: 'Share card',
    rarity: 'uncommon',
    render: 'card',
    blurb: 'The card you post to your story — its frame and style are yours.',
    cindy: 'And your share card. Every single thing is customizable — that is the flex. 🎨',
  },
];

function CosmeticStep({ index, total, spec }: { index: number; total: number; spec: CosmeticSpec }) {
  const tint = RARITY_COLOR[spec.rarity];
  return (
    <MiniScreen>
      <MiniHeader glyph="🎨" title="Cosmetics" right={`${index} / ${total}`} />
      <View style={styles.cosStage}>
        <CosmeticVisual render={spec.render} tint={tint} />
      </View>
      <View style={styles.reacts}>
        <MiniChip label={`${spec.rarity.toUpperCase()} · ${spec.name}`} color={tint} />
      </View>
      <Text style={styles.cosCap}>{spec.blurb}</Text>
    </MiniScreen>
  );
}

function CosmeticVisual({ render, tint }: { render: CosmeticSpec['render']; tint: string }) {
  const reduceMotion = useReduceMotion();
  switch (render) {
    case 'flare':
      return (
        <View style={styles.cosCenter}>
          <View style={[styles.flareAura, { borderColor: tint, shadowColor: tint }]} />
          <Text style={styles.cosFlame}>🔥</Text>
        </View>
      );
    case 'halo':
      return (
        <View style={styles.cosCenter}>
          <View style={[styles.halo, { borderColor: tint, shadowColor: tint }]} />
          <Text style={styles.cosFlame}>🔥</Text>
        </View>
      );
    case 'particles':
      return (
        <View style={styles.cosCenter}>
          <Text style={[styles.particle, { left: '24%', top: '18%' }]}>✦</Text>
          <Text style={[styles.particle, { right: '22%', top: '12%' }]}>✧</Text>
          <Text style={[styles.particle, { left: '40%', bottom: '10%' }]}>✦</Text>
          <Text style={styles.cosFlame}>🔥</Text>
        </View>
      );
    case 'banner':
      return <MiniBanner label="🏕️ LRC · Emberfall" colors={['#7a3f8f', '#f0a04b']} height={54} />;
    case 'title':
      return (
        <View style={styles.cosCenter}>
          <Text style={styles.cosName}>@brikmn</Text>
          <MiniChip label="The Relentless" color={tint} />
        </View>
      );
    case 'sfx':
      return (
        <View style={styles.waveRow}>
          <View style={styles.waveCol}>
            <Bars heights={[6, 16, 10, 20, 8]} color={Colors.muted} animate={false} />
            <MiniMuted>▶ Start</MiniMuted>
          </View>
          <View style={styles.waveCol}>
            <Bars heights={[14, 8, 18, 6, 12]} color={Colors.muted} animate={false} />
            <MiniMuted>▶ End</MiniMuted>
          </View>
        </View>
      );
    case 'audio':
      return (
        <View style={styles.cosCenter}>
          <Bars heights={[8, 20, 12, 24, 10]} color={Colors.amber} animate={!reduceMotion} />
          <MiniMuted>♪ Lo-fi Embers</MiniMuted>
        </View>
      );
    case 'card':
      return <ShareCard big="🔥 90m" sub="Diamond III" glyph="🔥" user="@brikmn" small />;
    case 'flame':
    default:
      return (
        <View style={styles.cosCenter}>
          <Text style={styles.cosFlame}>🔥</Text>
          <View style={styles.swatches}>
            {[RARITY_COLOR.legendary, RARITY_COLOR.rare, RARITY_COLOR.epic].map((c) => (
              <View key={c} style={[styles.swatch, { borderColor: c }]}>
                <Text style={styles.swatchText}>🔥</Text>
              </View>
            ))}
          </View>
        </View>
      );
  }
}

/** An equaliser / waveform. Static bars unless `animate`. */
function Bars({ heights, color, animate }: { heights: number[]; color: string; animate: boolean }) {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!animate) return;
    const id = setInterval(() => setTick((t) => t + 1), 160);
    return () => clearInterval(id);
  }, [animate]);
  return (
    <View style={styles.bars}>
      {heights.map((h, i) => {
        const wobble = animate ? 1 + 0.5 * Math.sin((tick + i) * 1.1) : 1;
        return (
          <View
            key={i}
            style={[styles.bar, { height: Math.max(4, Math.round(h * wobble)), backgroundColor: color }]}
          />
        );
      })}
    </View>
  );
}

/** The story-format share card, as it appears in the tour. */
function ShareCard({
  big,
  sub,
  glyph,
  user,
  kicker,
  small,
}: {
  big: string;
  sub: string;
  glyph: string;
  user: string;
  kicker?: string;
  small?: boolean;
}) {
  return (
    <View style={[styles.shareCard, small && styles.shareCardSmall]}>
      {kicker ? <Text style={styles.scTop}>{kicker}</Text> : null}
      <Text style={small ? styles.scFlameSmall : styles.scFlame}>{glyph}</Text>
      <Text style={small ? styles.scBigSmall : styles.scBig} numberOfLines={1}>
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
  bigFlame: { fontSize: 54, textAlign: 'center' },
  flameWrap: { alignItems: 'center', gap: 2, marginTop: 6, flex: 1, justifyContent: 'center' },
  spacer: { flex: 1 },
  sectionLabel: { fontFamily: Fonts.bodyBold, fontSize: 10, color: '#cbbfe6' },
  ladder: { gap: 2, flex: 1 },
  lrow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 2,
    paddingHorizontal: 4,
    borderRadius: 6,
  },
  lrowHere: { backgroundColor: '#2b2036' },
  ldot: { width: 7, height: 7, borderRadius: 4 },
  lname: { flex: 1, fontFamily: Fonts.bodyBold, fontSize: 9.5, color: Colors.ink },
  ldiv: { fontFamily: Fonts.body, fontSize: 8.5, color: Colors.textTertiary },
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
  tileRow: { flexDirection: 'row', gap: 8, justifyContent: 'center', marginTop: 4 },
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
  shareCardSmall: { width: 94, height: 62, gap: 0 },
  scTop: { position: 'absolute', top: 8, fontSize: 7, letterSpacing: 2, color: '#ffe0b8', fontFamily: Fonts.bodyBold },
  scFlame: { fontSize: 38 },
  scFlameSmall: { fontSize: 16 },
  scBig: { fontSize: 15, fontFamily: Fonts.displayHeavy, color: '#fff', letterSpacing: 0.4 },
  scBigSmall: { fontSize: 10, fontFamily: Fonts.displayHeavy, color: '#fff' },
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
  cosCenter: { alignItems: 'center', justifyContent: 'center', gap: 6, width: '100%', height: '100%' },
  cosFlame: { fontSize: 40 },
  cosCap: { fontFamily: Fonts.body, fontSize: 9.5, lineHeight: 13.5, color: Colors.muted, textAlign: 'center' },
  cosName: { fontFamily: Fonts.bodyBold, fontSize: 12, color: Colors.ink },
  flareAura: {
    position: 'absolute',
    top: 6,
    left: 6,
    right: 6,
    bottom: 6,
    borderRadius: 14,
    borderWidth: 3,
    opacity: 0.8,
    shadowOpacity: 1,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 0 },
  },
  halo: {
    position: 'absolute',
    width: 62,
    height: 24,
    borderWidth: 3,
    borderRadius: 31,
    top: '22%',
    shadowOpacity: 1,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 0 },
  },
  particle: { position: 'absolute', fontSize: 12, color: Colors.ember },
  swatches: { flexDirection: 'row', gap: 6 },
  swatch: {
    width: 24,
    height: 24,
    borderRadius: 12,
    borderWidth: 2,
    backgroundColor: '#171023',
    alignItems: 'center',
    justifyContent: 'center',
  },
  swatchText: { fontSize: 12 },
  waveRow: { flexDirection: 'row', gap: 18 },
  waveCol: { alignItems: 'center', gap: 4 },
  bars: { flexDirection: 'row', alignItems: 'flex-end', gap: 3, height: 26 },
  bar: { width: 4, borderRadius: 2 },
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
