import { Stack, useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { LiveStatusBadge } from '@/components/live-status-badge';
import { Avatar } from '@/components/ui/avatar';
import { NavGlyph } from '@/components/ui/nav-glyph';
import { SPACE_GUTTER, SpaceButton, SpaceHeader, SpaceSection } from '@/components/ui/space-kit';
import { TextInput } from '@/components/ui/text-input';
import { UiGlyph } from '@/components/ui/ui-glyph';
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
import { usePresence } from '@/hooks/use-presence';
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
            <UiGlyph name="add" size={13} color="#2A0F05" />
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
          <Pressable style={styles.acceptResultBtn} onPress={() => handleAccept(userId)}>
            <UiGlyph name="check" size={13} color="#2A0F05" />
            <Text style={styles.addBtnLabel}>Accept</Text>
          </Pressable>
        );
      case 'friends':
        return (
          <View style={styles.friendsBtn}>
            <UiGlyph name="check" size={13} color={Colors.gold} />
            <Text style={styles.friendsBtnLabel}>Friends</Text>
          </View>
        );
    }
  }

  const searchingActive = query.trim().length > 0;
  // Live status (0245) on search results and suggestions — one batched call for whichever list is up.
  const presence = usePresence(searchingActive ? results.map((r) => r.user_id) : suggested.map((s) => s.user_id));
  const incoming = requests.filter((r) => r.direction === 'incoming');
  const sent = requests.filter((r) => r.direction === 'sent');

  return (
    <SafeAreaView edges={['top']} style={styles.safe}>
      <Stack.Screen options={{ headerShown: false }} />

      <SpaceHeader title="Add friends" onBack={() => router.back()} />

      <View style={styles.searchWrap}>
        <NavGlyph name="search" size={16} color={Colors.spaceDim} />
        <TextInput
          style={styles.searchInput}
          placeholder="Add by @username or name"
          placeholderTextColor={Colors.spaceFaint}
          value={query}
          onChangeText={setQuery}
          autoCapitalize="none"
        />
        {searching && <ActivityIndicator size="small" color={Colors.navEmber} />}
      </View>

      <ScrollView contentContainerStyle={styles.list} keyboardShouldPersistTaps="handled">
        {error && <Text style={styles.error}>{error}</Text>}

        {searchingActive ? (
          <>
            <SpaceSection>Results</SpaceSection>
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
                  <LiveStatusBadge presence={presence[r.user_id]} />
                </View>
                {renderActionButton(r.user_id, relationshipFor(r.user_id, r.relationship))}
              </View>
            ))}
          </>
        ) : (
          <>
            <SpaceSection right={<Text style={styles.sectionCount}>{incoming.length}</Text>}>Friend requests</SpaceSection>
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
                  <SpaceButton label="Accept" onPress={() => handleAccept(r.request_user_id)} style={styles.actBtn} />
                  <SpaceButton
                    label="Decline"
                    variant="secondary"
                    onPress={() => handleDecline(r.request_user_id)}
                    style={styles.actBtn}
                  />
                </View>
              </View>
            ))}

            {sent.length > 0 && (
              <>
                <SpaceSection>Sent</SpaceSection>
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
                <SpaceSection>Suggested · from your campfires</SpaceSection>
                {suggested.map((s) => (
                  <View key={s.user_id} style={styles.row}>
                    <Avatar label={s.display_name} size={38} />
                    <View style={styles.who}>
                      <Text style={styles.name} numberOfLines={1}>
                        {s.display_name}
                      </Text>
                      {s.mutual_circle_name && <Text style={styles.sub}>in {s.mutual_circle_name}</Text>}
                      <LiveStatusBadge presence={presence[s.user_id]} />
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
    // Was Colors.cream, an opaque flat fill that painted over the deep-purple radial. These
    // screens don't route through <Screen>, so the radial reaches them from the navigator's
    // scene background — an opaque colour here blocks it (Ember reskin sweep).
    backgroundColor: 'transparent',
  },
  // The search field sits in the space-kit panel family: panel fill on the 1px line, with an ember
  // ring kept as the one cue that this field is the screen's action.
  searchWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    backgroundColor: Colors.spacePanel,
    borderWidth: 1,
    borderColor: 'rgba(255,122,47,0.55)',
    borderRadius: 14,
    paddingVertical: 11,
    paddingHorizontal: 14,
    marginHorizontal: SPACE_GUTTER,
    marginBottom: Spacing.one,
  },
  searchInput: {
    flex: 1,
    padding: 0,
    fontFamily: Fonts.body,
    fontSize: 13.5,
    color: Colors.ink,
  },
  list: {
    paddingHorizontal: SPACE_GUTTER,
    paddingBottom: Spacing.six,
  },
  sectionCount: {
    fontFamily: Fonts.bodyBold,
    fontSize: 11,
    color: Colors.navEmber2,
  },
  emptyHint: {
    fontFamily: Fonts.body,
    fontSize: 12.5,
    color: Colors.spaceDim,
    paddingVertical: Spacing.two,
  },
  // Each person is a space-kit panel row (SpaceRow's surface); hand-built because the trailing
  // relationship pill and the live badge under the name don't fit SpaceRow's slots.
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 10,
    paddingHorizontal: Spacing.twelve,
    borderRadius: 14,
    backgroundColor: Colors.spacePanel,
    borderWidth: 1,
    borderColor: Colors.spaceLine,
    marginBottom: 6,
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
    color: Colors.spaceDim,
  },
  sub: {
    fontFamily: Fonts.body,
    fontSize: 10.5,
    color: Colors.spaceFaint,
    marginTop: 1,
  },
  addBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: Colors.navEmber,
    borderRadius: Radius.pill,
    paddingVertical: 7,
    paddingHorizontal: 14,
  },
  addBtnLabel: {
    fontFamily: Fonts.bodyBold,
    fontSize: 12,
    color: '#2A0F05',
  },
  pendingBtn: {
    backgroundColor: Colors.spacePanel2,
    borderWidth: 1,
    borderColor: Colors.spaceLine,
    borderRadius: Radius.pill,
    paddingVertical: 7,
    paddingHorizontal: 14,
  },
  pendingBtnLabel: {
    fontFamily: Fonts.bodySemiBold,
    fontSize: 12,
    color: Colors.spaceDim,
  },
  // Friends = earned, so gold (the kit's gold tone) rather than the old grey outline.
  friendsBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    borderWidth: 1,
    borderColor: '#5A4A1E',
    backgroundColor: 'rgba(255,209,102,0.07)',
    borderRadius: Radius.pill,
    paddingVertical: 7,
    paddingHorizontal: 14,
  },
  friendsBtnLabel: {
    fontFamily: Fonts.bodySemiBold,
    fontSize: 12,
    color: Colors.gold,
  },
  reqCard: {
    backgroundColor: Colors.spacePanel,
    borderWidth: 1,
    borderColor: Colors.spaceLine,
    borderRadius: 14,
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
    color: Colors.spaceDim,
    marginTop: 8,
  },
  acts: {
    flexDirection: 'row',
    gap: Spacing.two,
    marginTop: Spacing.twelve,
  },
  actBtn: {
    flex: 1,
    minHeight: 42,
    borderRadius: 12,
  },
  // Accepting a request from a search result — the same ember pill as Add (it is the row's one
  // action); the old success-green was the only green control left in this family.
  acceptResultBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: Colors.navEmber,
    borderRadius: Radius.pill,
    paddingVertical: 7,
    paddingHorizontal: 14,
  },
  sentRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 10,
    paddingHorizontal: Spacing.twelve,
    borderRadius: 14,
    backgroundColor: Colors.spacePanel,
    borderWidth: 1,
    borderColor: Colors.spaceLine,
    marginBottom: 6,
  },
  pend: {
    backgroundColor: Colors.spacePanel2,
    borderRadius: Radius.pill,
    paddingVertical: 5,
    paddingHorizontal: 11,
  },
  pendLabel: {
    fontFamily: Fonts.bodySemiBold,
    fontSize: 11.5,
    color: Colors.spaceDim,
  },
  error: {
    fontFamily: Fonts.body,
    fontSize: 12,
    color: Colors.danger,
    marginBottom: Spacing.two,
  },
});
