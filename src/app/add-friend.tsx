import { Ionicons } from '@expo/vector-icons';
import { Stack, useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Avatar } from '@/components/ui/avatar';
import { TextInput } from '@/components/ui/text-input';
import { Colors, Fonts, Radius, Spacing } from '@/constants/theme';
import {
  cancelFriendRequest,
  fetchPendingFriendRequests,
  fetchSuggestedPeople,
  respondFriendRequest,
  searchPeople,
  sendFriendRequest,
  type PendingFriendRequest,
  type PersonSearchResult,
  type Relationship,
  type SuggestedPerson,
} from '@/lib/api/friend-requests';
import { getErrorMessage } from '@/lib/errors';

// "Add friends" (design-mocks/34 + 35 — the same screen in two states, per their identical
// header title: 34 is the idle default with a static search prompt + pending requests + sent;
// 35 is what it looks like once you're actively typing a query). PHILOI_UI_SPEC.md §4b/§16 —
// distinct from "Join a campfire" (valley/discover only — this screen never touches campfire
// membership).
export default function AddFriendScreen() {
  const router = useRouter();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<PersonSearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [suggested, setSuggested] = useState<SuggestedPerson[]>([]);
  const [requests, setRequests] = useState<PendingFriendRequest[]>([]);
  const [loadingRequests, setLoadingRequests] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // Per-user in-flight/optimistic relationship overrides — lets a row update immediately on tap
  // without waiting on (or fully trusting) a refetch of the whole list.
  const [overrides, setOverrides] = useState<Record<string, Relationship>>({});

  const refetchRequests = useCallback(() => {
    fetchPendingFriendRequests()
      .then(setRequests)
      .catch((e) => setError(getErrorMessage(e, 'Could not load requests.')))
      .finally(() => setLoadingRequests(false));
  }, []);

  useFocusEffect(
    useCallback(() => {
      refetchRequests();
    }, [refetchRequests])
  );

  useEffect(() => {
    fetchSuggestedPeople()
      .then(setSuggested)
      .catch(() => {
        // Flavor section only — a failed fetch just leaves it out.
      });
  }, []);

  useEffect(() => {
    const trimmed = query.trim();
    if (!trimmed) {
      setResults([]);
      return;
    }
    setSearching(true);
    const timer = setTimeout(() => {
      searchPeople(trimmed)
        .then(setResults)
        .catch((e) => setError(getErrorMessage(e, 'Search failed.')))
        .finally(() => setSearching(false));
    }, 300);
    return () => clearTimeout(timer);
  }, [query]);

  function relationshipFor(userId: string, base: Relationship): Relationship {
    return overrides[userId] ?? base;
  }

  async function handleAdd(userId: string) {
    setOverrides((prev) => ({ ...prev, [userId]: 'requested' }));
    try {
      await sendFriendRequest(userId);
    } catch (e) {
      setOverrides((prev) => ({ ...prev, [userId]: 'none' }));
      setError(getErrorMessage(e, 'Could not send that request.'));
    }
  }

  async function handleCancel(userId: string) {
    setOverrides((prev) => ({ ...prev, [userId]: 'none' }));
    try {
      await cancelFriendRequest(userId);
      setRequests((prev) => prev.filter((r) => r.request_user_id !== userId));
    } catch (e) {
      setOverrides((prev) => ({ ...prev, [userId]: 'requested' }));
      setError(getErrorMessage(e, 'Could not cancel that request.'));
    }
  }

  async function handleAccept(userId: string) {
    setOverrides((prev) => ({ ...prev, [userId]: 'friends' }));
    setRequests((prev) => prev.filter((r) => r.request_user_id !== userId));
    try {
      await respondFriendRequest(userId, true);
    } catch (e) {
      setOverrides((prev) => ({ ...prev, [userId]: 'incoming' }));
      setError(getErrorMessage(e, 'Could not accept that request.'));
      refetchRequests();
    }
  }

  async function handleDecline(userId: string) {
    setRequests((prev) => prev.filter((r) => r.request_user_id !== userId));
    try {
      await respondFriendRequest(userId, false);
    } catch (e) {
      setError(getErrorMessage(e, 'Could not decline that request.'));
      refetchRequests();
    }
  }

  function renderActionButton(userId: string, relationship: Relationship) {
    switch (relationship) {
      case 'none':
        return (
          <Pressable style={styles.addBtn} onPress={() => handleAdd(userId)}>
            <Ionicons name="add" size={14} color={Colors.ink} />
            <Text style={styles.addBtnLabel}>Add</Text>
          </Pressable>
        );
      case 'requested':
        return (
          <Pressable style={styles.pendingBtn} onPress={() => handleCancel(userId)}>
            <Text style={styles.pendingBtnLabel}>Requested</Text>
          </Pressable>
        );
      case 'incoming':
        return (
          <Pressable style={styles.addBtn} onPress={() => handleAccept(userId)}>
            <Text style={styles.addBtnLabel}>Accept</Text>
          </Pressable>
        );
      case 'friends':
        return (
          <View style={styles.friendsBtn}>
            <Ionicons name="checkmark" size={14} color={Colors.textTertiary} />
            <Text style={styles.friendsBtnLabel}>Friends</Text>
          </View>
        );
    }
  }

  const searchingActive = query.trim().length > 0;
  const incoming = requests.filter((r) => r.direction === 'incoming');
  const sent = requests.filter((r) => r.direction === 'sent');

  return (
    <SafeAreaView edges={['top']} style={styles.safe}>
      <Stack.Screen options={{ headerShown: false }} />

      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={8} accessibilityLabel="Back">
          <Ionicons name="chevron-back" size={22} color={Colors.muted} />
        </Pressable>
        <Text style={styles.title}>Add friends</Text>
      </View>

      <View style={styles.searchWrap}>
        <Ionicons name="search" size={15} color={Colors.textTertiary} />
        <TextInput
          style={styles.searchInput}
          placeholder="Add by @username or name"
          placeholderTextColor={Colors.textTertiary}
          value={query}
          onChangeText={setQuery}
          autoCapitalize="none"
        />
        {searching && <ActivityIndicator size="small" color={Colors.textTertiary} />}
      </View>

      <ScrollView contentContainerStyle={styles.list} keyboardShouldPersistTaps="handled">
        {error && <Text style={styles.error}>{error}</Text>}

        {searchingActive ? (
          <>
            <Text style={styles.sectionLabel}>Results</Text>
            {results.length === 0 && !searching && <Text style={styles.emptyHint}>No one found.</Text>}
            {results.map((r) => (
              <View key={r.user_id} style={styles.row}>
                <Avatar label={r.display_name} size={38} />
                <View style={styles.who}>
                  <Text style={styles.name} numberOfLines={1}>
                    {r.display_name}
                  </Text>
                  {r.handle && <Text style={styles.handle}>@{r.handle}</Text>}
                  {r.mutual_circle_name && <Text style={styles.sub}>in {r.mutual_circle_name}</Text>}
                </View>
                {renderActionButton(r.user_id, relationshipFor(r.user_id, r.relationship))}
              </View>
            ))}
          </>
        ) : (
          <>
            <View style={styles.sectionHead}>
              <Text style={styles.sectionLabel}>Friend requests</Text>
              <Text style={styles.sectionCount}>{incoming.length}</Text>
            </View>
            {!loadingRequests && incoming.length === 0 && (
              <Text style={styles.emptyHint}>No pending requests.</Text>
            )}
            {incoming.map((r) => (
              <View key={r.request_user_id} style={styles.reqCard}>
                <View style={styles.reqTop}>
                  <Avatar label={r.display_name} size={38} />
                  <View style={styles.who}>
                    <Text style={styles.name} numberOfLines={1}>
                      {r.display_name}
                    </Text>
                    {r.handle && <Text style={styles.handle}>@{r.handle}</Text>}
                  </View>
                </View>
                {(r.mutual_count > 0 || r.mutual_circle_name) && (
                  <Text style={styles.ctx}>
                    {r.mutual_count > 0 ? `${r.mutual_count} mutual friend${r.mutual_count === 1 ? '' : 's'}` : ''}
                    {r.mutual_count > 0 && r.mutual_circle_name ? ' · ' : ''}
                    {r.mutual_circle_name ? `also in ${r.mutual_circle_name}` : ''}
                  </Text>
                )}
                <View style={styles.acts}>
                  <Pressable style={styles.acceptBtn} onPress={() => handleAccept(r.request_user_id)}>
                    <Text style={styles.acceptBtnLabel}>Accept</Text>
                  </Pressable>
                  <Pressable style={styles.declineBtn} onPress={() => handleDecline(r.request_user_id)}>
                    <Text style={styles.declineBtnLabel}>Decline</Text>
                  </Pressable>
                </View>
              </View>
            ))}

            {sent.length > 0 && (
              <>
                <Text style={[styles.sectionLabel, styles.sectionLabelSpaced]}>Sent</Text>
                {sent.map((r) => (
                  <Pressable
                    key={r.request_user_id}
                    style={styles.sentRow}
                    onPress={() => handleCancel(r.request_user_id)}>
                    <Avatar label={r.display_name} size={34} />
                    <View style={styles.who}>
                      <Text style={styles.name} numberOfLines={1}>
                        {r.display_name}
                      </Text>
                      {r.handle && <Text style={styles.handle}>@{r.handle}</Text>}
                    </View>
                    <View style={styles.pend}>
                      <Text style={styles.pendLabel}>Requested</Text>
                    </View>
                  </Pressable>
                ))}
              </>
            )}

            {suggested.length > 0 && (
              <>
                <Text style={[styles.sectionLabel, styles.sectionLabelSpaced]}>Suggested · from your campfires</Text>
                {suggested.map((s) => (
                  <View key={s.user_id} style={styles.row}>
                    <Avatar label={s.display_name} size={38} />
                    <View style={styles.who}>
                      <Text style={styles.name} numberOfLines={1}>
                        {s.display_name}
                      </Text>
                      {s.mutual_circle_name && <Text style={styles.sub}>in {s.mutual_circle_name}</Text>}
                    </View>
                    {renderActionButton(s.user_id, relationshipFor(s.user_id, 'none'))}
                  </View>
                ))}
              </>
            )}
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: Colors.cream,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    paddingHorizontal: Spacing.three,
    paddingTop: Spacing.three,
    marginBottom: Spacing.three,
  },
  title: {
    fontFamily: Fonts.bodySemiBold,
    fontSize: 17,
    color: Colors.ink,
  },
  searchWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    backgroundColor: Colors.card,
    borderWidth: 1,
    borderColor: Colors.coral,
    borderRadius: Radius.card,
    paddingVertical: 10,
    paddingHorizontal: 12,
    marginHorizontal: Spacing.three,
    marginBottom: Spacing.three,
  },
  searchInput: {
    flex: 1,
    padding: 0,
    fontFamily: Fonts.body,
    fontSize: 13,
    color: Colors.ink,
  },
  list: {
    paddingHorizontal: Spacing.three,
    paddingBottom: Spacing.six,
  },
  sectionHead: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 9,
  },
  sectionLabel: {
    fontFamily: Fonts.bodySemiBold,
    fontSize: 10.5,
    letterSpacing: 1,
    textTransform: 'uppercase',
    color: Colors.textTertiary,
  },
  sectionCount: {
    fontFamily: Fonts.bodySemiBold,
    fontSize: 11,
    color: Colors.ember,
  },
  sectionLabelSpaced: {
    marginTop: Spacing.four,
    marginBottom: 9,
  },
  emptyHint: {
    fontFamily: Fonts.body,
    fontSize: 12.5,
    color: Colors.muted,
    paddingVertical: Spacing.two,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 8,
  },
  who: {
    flex: 1,
    minWidth: 0,
  },
  name: {
    fontFamily: Fonts.bodySemiBold,
    fontSize: 13.5,
    color: Colors.ink,
  },
  handle: {
    fontFamily: Fonts.body,
    fontSize: 11,
    color: Colors.muted,
  },
  sub: {
    fontFamily: Fonts.body,
    fontSize: 10.5,
    color: Colors.textTertiary,
    marginTop: 1,
  },
  addBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: Colors.coral,
    borderRadius: Radius.pill,
    paddingVertical: 7,
    paddingHorizontal: 14,
  },
  addBtnLabel: {
    fontFamily: Fonts.bodySemiBold,
    fontSize: 12,
    color: Colors.ink,
  },
  pendingBtn: {
    backgroundColor: Colors.disabled,
    borderRadius: Radius.pill,
    paddingVertical: 7,
    paddingHorizontal: 14,
  },
  pendingBtnLabel: {
    fontFamily: Fonts.body,
    fontSize: 12,
    color: Colors.muted,
  },
  friendsBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    borderWidth: 1,
    borderColor: Colors.line,
    borderRadius: Radius.pill,
    paddingVertical: 7,
    paddingHorizontal: 14,
  },
  friendsBtnLabel: {
    fontFamily: Fonts.body,
    fontSize: 12,
    color: Colors.textTertiary,
  },
  reqCard: {
    backgroundColor: Colors.card,
    borderRadius: Radius.card,
    padding: Spacing.three,
    marginBottom: Spacing.two,
  },
  reqTop: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  ctx: {
    fontFamily: Fonts.body,
    fontSize: 11,
    color: Colors.textTertiary,
    marginTop: 8,
  },
  acts: {
    flexDirection: 'row',
    gap: Spacing.two,
    marginTop: 10,
  },
  acceptBtn: {
    flex: 1,
    alignItems: 'center',
    backgroundColor: Colors.coral,
    borderRadius: Radius.button,
    paddingVertical: 9,
  },
  acceptBtnLabel: {
    fontFamily: Fonts.bodySemiBold,
    fontSize: 12.5,
    color: Colors.ink,
  },
  declineBtn: {
    flex: 1,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: Colors.line,
    borderRadius: Radius.button,
    paddingVertical: 9,
  },
  declineBtnLabel: {
    fontFamily: Fonts.body,
    fontSize: 12.5,
    color: Colors.muted,
  },
  sentRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 8,
    paddingHorizontal: 4,
  },
  pend: {
    backgroundColor: Colors.disabled,
    borderRadius: Radius.pill,
    paddingVertical: 5,
    paddingHorizontal: 11,
  },
  pendLabel: {
    fontFamily: Fonts.body,
    fontSize: 11.5,
    color: Colors.muted,
  },
  error: {
    fontFamily: Fonts.body,
    fontSize: 12,
    color: Colors.coral,
    marginBottom: Spacing.two,
  },
});
