import { Ionicons } from '@expo/vector-icons';
import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { Avatar } from '@/components/ui/avatar';
import { TextInput } from '@/components/ui/text-input';
import { Colors, Fonts, Radius, Spacing } from '@/constants/theme';
import { fetchCampfireMembers } from '@/lib/api/groups';
import { getErrorMessage } from '@/lib/errors';
import type { CampfireMember } from '@/types/database';

// THE MEMBER TICKER (CHALLENGE_V2_SPEC §1, mock 113 §1) — "pick specific campfire members (search
// + toggle), not the whole house."
//
// THIS IS THE PIECE THAT WAS MISSING, and its absence was not cosmetic. 0096 gave the invite an
// RPC (invite_challenge_members) and 0098 made a group challenge start life as a DRAFT with no
// participants. Nothing in the app ever called that RPC — inviteChallengeMembers in
// challenge-lifecycle.ts had zero call sites — so a group challenge had no roster, and
// start_challenge, which refuses to start a race nobody has accepted, refused every single one:
//
//     create → draft → (no way to invite anyone) → "Start the race" → "Nobody has accepted yet."
//
// Every group challenge created since the pass has been stranded at that error. This component is
// the step between create and start.
//
// The creator is deliberately NOT in this list. They are written in as 'accepted' by
// create_group_challenge (0112) because they proposed the race; offering to invite yourself would
// be a toggle that can only ever be on.

export type MemberTickerProps = {
  groupId: string;
  /** Selected user ids. Controlled — the caller owns the selection so it can survive a submit. */
  value: string[];
  onChange: (userIds: string[]) => void;
  /** Never offered, because they are already in: the creator, and anyone already invited. */
  excludeUserIds?: string[];
  /** How many rows before the list starts scrolling on its own. */
  maxVisible?: number;
};

export function ChallengeMemberTicker({
  groupId,
  value,
  onChange,
  excludeUserIds = [],
  maxVisible = 6,
}: MemberTickerProps) {
  const [members, setMembers] = useState<CampfireMember[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');

  useEffect(() => {
    let live = true;
    // Back to the spinner when the campfire changes — create.tsx lets the user switch circles
    // with this mounted, and keeping the previous house's roster on screen would offer people who
    // are not in the campfire being raced.
    // eslint-disable-next-line react-hooks/set-state-in-effect -- fetch-on-mount, no caching layer to defer to
    setMembers(null);
    fetchCampfireMembers(groupId)
      .then((rows) => live && setMembers(rows))
      .catch((e) => live && setError(getErrorMessage(e, 'Could not load the campfire roster.')));
    return () => {
      live = false;
    };
  }, [groupId]);

  const candidates = useMemo(() => {
    const excluded = new Set(excludeUserIds);
    const q = query.trim().toLowerCase();
    return (members ?? [])
      .filter((m) => !excluded.has(m.user_id))
      .filter((m) => !q || m.display_name.toLowerCase().includes(q) || (m.handle ?? '').toLowerCase().includes(q));
  }, [members, excludeUserIds, query]);

  function toggle(userId: string) {
    onChange(value.includes(userId) ? value.filter((id) => id !== userId) : [...value, userId]);
  }

  if (error) return <Text style={styles.hint}>{error}</Text>;
  if (!members) return <ActivityIndicator color={Colors.amber} style={styles.loading} />;

  if (candidates.length === 0 && !query) {
    return (
      <Text style={styles.hint}>
        Nobody else is in this campfire yet. Invite people to the campfire first, then start a race with
        them.
      </Text>
    );
  }

  return (
    <View style={styles.wrap}>
      {/* Search appears only when the list is long enough to need it — a search box over four
          names is furniture. */}
      {members.length > maxVisible ? (
        <TextInput value={query} onChangeText={setQuery} placeholder="Search the campfire" />
      ) : null}

      <View style={styles.actionsRow}>
        <Text style={styles.count}>
          {value.length === 0 ? 'Nobody invited yet' : `${value.length} invited`}
        </Text>
        <Pressable
          onPress={() => onChange(value.length === candidates.length ? [] : candidates.map((m) => m.user_id))}
          hitSlop={8}
          accessibilityRole="button">
          <Text style={styles.selectAll}>
            {value.length === candidates.length ? 'Clear' : 'Invite everyone'}
          </Text>
        </Pressable>
      </View>

      <ScrollView
        style={[styles.list, { maxHeight: maxVisible * 52 }]}
        nestedScrollEnabled
        keyboardShouldPersistTaps="handled">
        {candidates.map((m) => {
          const on = value.includes(m.user_id);
          return (
            <Pressable
              key={m.user_id}
              onPress={() => toggle(m.user_id)}
              style={[styles.row, on && styles.rowOn]}
              accessibilityRole="checkbox"
              accessibilityState={{ checked: on }}
              accessibilityLabel={m.display_name}>
              <Avatar label={m.display_name} size={30} lit={on} />
              <View style={styles.who}>
                <Text style={styles.name} numberOfLines={1}>
                  {m.display_name}
                </Text>
                {m.handle ? (
                  <Text style={styles.handle} numberOfLines={1}>
                    @{m.handle}
                  </Text>
                ) : null}
              </View>
              <View style={[styles.check, on && styles.checkOn]}>
                {on ? <Ionicons name="checkmark" size={13} color={Colors.onEmber} /> : null}
              </View>
            </Pressable>
          );
        })}
        {candidates.length === 0 ? <Text style={styles.hint}>Nobody by that name.</Text> : null}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    gap: Spacing.two,
  },
  loading: {
    marginVertical: Spacing.three,
  },
  actionsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  count: {
    fontFamily: Fonts.bodySemiBold,
    fontSize: 11.5,
    color: Colors.muted,
  },
  selectAll: {
    fontFamily: Fonts.bodyBold,
    fontSize: 11.5,
    color: Colors.ember,
  },
  list: {
    borderRadius: 12,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    paddingVertical: 8,
    paddingHorizontal: 10,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'transparent',
    marginBottom: 5,
    backgroundColor: Colors.achieverBg,
  },
  rowOn: {
    borderColor: Colors.ember,
    backgroundColor: Colors.selectedBg,
  },
  who: {
    flex: 1,
    gap: 1,
  },
  name: {
    fontFamily: Fonts.bodySemiBold,
    fontSize: 13,
    color: Colors.ink,
  },
  handle: {
    fontFamily: Fonts.body,
    fontSize: 10.5,
    color: Colors.textTertiary,
  },
  check: {
    width: 20,
    height: 20,
    borderRadius: Radius.pill,
    borderWidth: 1,
    borderColor: Colors.line,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkOn: {
    backgroundColor: Colors.ember,
    borderColor: Colors.ember,
  },
  hint: {
    fontFamily: Fonts.body,
    fontSize: 11.5,
    lineHeight: 17,
    color: Colors.muted,
  },
});
