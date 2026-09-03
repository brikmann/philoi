import { Ionicons } from '@expo/vector-icons';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';

import { ScopedRewardTease } from '@/components/cindy/scoped-reward-tease';
import { Colors, Fonts, Radius, Spacing } from '@/constants/theme';
import type { DifficultyTier } from '@/types/database';
import type { CoachAction } from '@/lib/api/coach';

// The action chip (mock 115 frames 2 + 5: "▶ BU111 · Work · started", "🏆 Milestone posted").
//
// ONE component, two states, and the difference is the whole safety story:
//
//   effect 'auto'    → it already happened. The chip is a RECEIPT, past tense, not tappable.
//   effect 'confirm' → nothing has happened yet. The chip carries a real button, and the write
//                      does not occur until the user taps it.
//
// The confirm state is deliberately an inline chip rather than a modal. Mock 115 shows actions
// landing in the flow of conversation, and a system alert on top of a chat with a friend would
// read as paperwork — but a milestone posts into other people's feeds and a stop ends a running
// session, so those cannot be silent. An inline confirm keeps the mock's feel and the guarantee.

const ICON: Record<string, keyof typeof Ionicons.glyphMap> = {
  start_session: 'play',
  stop_session: 'stop',
  add_milestone: 'trophy',
  create_challenge: 'flag',
  host_campfire_challenge: 'bonfire',
  equip_cosmetic: 'color-palette',
  mark_notifications_read: 'notifications-off',
  open_support: 'heart',
};

export function CindyActionChip({
  action,
  busy,
  onConfirm,
  onDecline,
}: {
  action: CoachAction;
  busy: boolean;
  onConfirm: () => void;
  onDecline: () => void;
}) {
  const icon = ICON[action.tool] ?? 'sparkles';

  if (action.status === 'declined') {
    return (
      <View style={[styles.chip, styles.quiet]}>
        <Ionicons name="close" size={14} color={Colors.textTertiary} />
        <Text style={styles.quietLabel}>{action.summary} — skipped</Text>
      </View>
    );
  }

  if (action.status === 'failed') {
    return (
      <View style={[styles.chip, styles.quiet]}>
        <Ionicons name="alert-circle-outline" size={14} color={Colors.danger} />
        <Text style={styles.quietLabel}>{action.summary} — didn&apos;t go through</Text>
      </View>
    );
  }

  // Done, or an auto action that has already run: a receipt, nothing to tap.
  if (action.status === 'done' || (action.effect === 'auto' && action.status !== 'proposed')) {
    return (
      <View style={styles.chip}>
        <Ionicons name={icon} size={14} color={Colors.ember} />
        <Text style={styles.label}>{receiptFor(action)}</Text>
      </View>
    );
  }

  // §3 — what the server says it is worth, shown BEFORE the confirm. Only on a create that Cindy
  // actually scoped: an unscoped goal has no tier to price, and a tease with nothing behind it
  // would be worse than none.
  // Both create paths, because both carry a tier and both price it the same way. Hosting one for
  // a campfire is the case where the tease matters MOST: the confirm sends a push to every member
  // of the fire, so what it is worth should be on screen before the tap, not after it.
  const scopedTier =
    (action.tool === 'create_challenge' || action.tool === 'host_campfire_challenge') &&
    typeof action.input?.difficulty_tier === 'string'
      ? (action.input.difficulty_tier as DifficultyTier)
      : null;

  return (
    <View style={styles.pending}>
      <View style={styles.pendingHead}>
        <Ionicons name={icon} size={14} color={Colors.ember} />
        <Text style={styles.label}>{action.summary}</Text>
      </View>
      {scopedTier ? (
        <ScopedRewardTease
          tier={scopedTier}
          rationale={typeof action.input?.scope_rationale === 'string' ? action.input.scope_rationale : null}
        />
      ) : null}
      <View style={styles.buttons}>
        <Pressable
          onPress={onConfirm}
          disabled={busy}
          style={styles.confirm}
          accessibilityRole="button"
          accessibilityLabel={`Confirm: ${action.summary}`}>
          {busy ? (
            <ActivityIndicator size="small" color={Colors.onEmber} />
          ) : (
            <Text style={styles.confirmLabel}>{confirmVerb(action.tool)}</Text>
          )}
        </Pressable>
        <Pressable
          onPress={onDecline}
          disabled={busy}
          style={styles.decline}
          accessibilityRole="button"
          accessibilityLabel="Not now">
          <Text style={styles.declineLabel}>Not now</Text>
        </Pressable>
      </View>
    </View>
  );
}

function confirmVerb(tool: string): string {
  switch (tool) {
    case 'add_milestone':
      return 'Post it';
    case 'stop_session':
      return 'End it';
    case 'create_challenge':
      return 'Create it';
    case 'host_campfire_challenge':
      // Not "Create it". This posts to a whole campfire — the verb should say where it lands, so
      // nobody taps a generic confirm and is surprised by forty people getting a push.
      return 'Post it to the campfire';
    default:
      return 'Do it';
  }
}

function receiptFor(action: CoachAction): string {
  switch (action.tool) {
    case 'start_session':
      return `${action.summary} · started`;
    case 'add_milestone':
      // 🔒 Says the quiet part out loud on the receipt itself, not just in Cindy's prose. A
      // milestone pays nothing by design (PROFILE_SPEC §G), and the one place a user is most
      // likely to assume otherwise is the moment it posts.
      return `${action.summary} · posted · no XP`;
    case 'host_campfire_challenge':
      // Says where it went. The receipt for a campfire post should name the outcome the user
      // cannot see from this screen — the card is in a chat they may not be looking at.
      return `${action.summary} · posted to the campfire`;
    default:
      return action.summary;
  }
}

const styles = StyleSheet.create({
  chip: {
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    backgroundColor: Colors.cardDark,
    borderWidth: 1,
    borderColor: 'rgba(242,163,60,0.4)',
    borderRadius: Radius.card,
    paddingHorizontal: Spacing.twelve,
    paddingVertical: Spacing.two + 1,
    maxWidth: '85%',
  },
  quiet: { borderColor: Colors.line },
  label: {
    fontFamily: Fonts.bodySemiBold,
    fontSize: 12,
    color: Colors.ember,
    flexShrink: 1,
  },
  quietLabel: {
    fontFamily: Fonts.body,
    fontSize: 12,
    color: Colors.textTertiary,
    flexShrink: 1,
  },
  pending: {
    alignSelf: 'flex-start',
    backgroundColor: Colors.cardDark,
    borderWidth: 1,
    borderColor: 'rgba(242,163,60,0.4)',
    borderRadius: Radius.card,
    padding: Spacing.twelve,
    gap: Spacing.two + 2,
    maxWidth: '90%',
  },
  pendingHead: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  buttons: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  confirm: {
    backgroundColor: Colors.amber,
    borderRadius: Radius.pill,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two - 1,
    minWidth: 78,
    alignItems: 'center',
  },
  confirmLabel: { fontFamily: Fonts.bodyBold, fontSize: 12, color: Colors.onEmber },
  decline: {
    paddingHorizontal: Spacing.twelve,
    paddingVertical: Spacing.two - 1,
  },
  declineLabel: { fontFamily: Fonts.body, fontSize: 12, color: Colors.textTertiary },
});
