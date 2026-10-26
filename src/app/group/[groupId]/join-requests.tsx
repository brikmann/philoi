import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, { FadeOut } from 'react-native-reanimated';

import { FlameSvg } from '@/components/flame-icon';
import { SocialGlyph } from '@/components/ui/glyphs-social';
import { Screen } from '@/components/ui/screen';
import { SPACE_GUTTER, SpaceCard, SpaceEmpty, SpaceHeader, SpaceSection } from '@/components/ui/space-kit';
import { UiGlyph } from '@/components/ui/ui-glyph';
import { Colors, Fonts, Radius, Spacing } from '@/constants/theme';
import { useGroup } from '@/hooks/use-group';
import { approveAllJoinRequests, approveJoinRequest, denyJoinRequest, fetchJoinRequests } from '@/lib/api/groups';
import { getErrorMessage } from '@/lib/errors';
import type { JoinRequest } from '@/types/database';

// design-mocks/22 + mock 112 §C — ADMIN-only approve/deny for a gated campfire's pending join
// requests. Gated on role in the RPCs themselves (list/approve/deny all call is_campfire_admin(),
// migration 0094), not just hidden client-side — so a promoted admin can work the queue and a
// member gets a refusal from Postgres rather than a hidden button.
//
// This screen used to fail outright with `column reference "id" is ambiguous`: list_join_requests
// declares RETURNS TABLE (id uuid, ...), and its body's `where id = p_group_id` could mean either
// that OUT variable or groups.id. Fixed in 0094 by alias-qualifying every column in the body.
export default function JoinRequestsScreen() {
  const router = useRouter();
  const { groupId } = useLocalSearchParams<{ groupId: string }>();
  const { group } = useGroup(groupId);
  const [requests, setRequests] = useState<JoinRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [approvingAll, setApprovingAll] = useState(false);

  const load = useCallback(async () => {
    try {
      setError(null);
      setRequests(await fetchJoinRequests(groupId));
    } catch (e) {
      setError(getErrorMessage(e, 'Could not load join requests.'));
    } finally {
      setLoading(false);
    }
  }, [groupId]);

  useEffect(() => {
    load();
  }, [load]);

  async function handleApprove(requestId: string) {
    setBusyId(requestId);
    try {
      await approveJoinRequest(requestId);
      setRequests((prev) => prev.filter((r) => r.id !== requestId));
    } catch (e) {
      setError(getErrorMessage(e, 'Could not approve that request.'));
    } finally {
      setBusyId(null);
    }
  }

  async function handleDeny(requestId: string) {
    setBusyId(requestId);
    try {
      await denyJoinRequest(requestId);
      setRequests((prev) => prev.filter((r) => r.id !== requestId));
    } catch (e) {
      setError(getErrorMessage(e, 'Could not deny that request.'));
    } finally {
      setBusyId(null);
    }
  }

  async function handleApproveAll() {
    setApprovingAll(true);
    try {
      await approveAllJoinRequests(groupId);
      setRequests([]);
    } catch (e) {
      setError(getErrorMessage(e, 'Could not approve all requests.'));
    } finally {
      setApprovingAll(false);
    }
  }

  return (
    <Screen padded={false} style={styles.container}>
      <Stack.Screen options={{ headerShown: false }} />

      <SpaceHeader
        title="Join requests"
        subtitle={`${group?.name ?? '…'} · gated`}
        onBack={() => router.back()}
        right={
          requests.length > 0 ? (
            <View style={styles.cnt}>
              <Text style={styles.cntLabel}>{requests.length}</Text>
            </View>
          ) : null
        }
      />

      <View style={styles.body}>
        {requests.length > 0 && (
          <SpaceSection
            right={
              <Pressable onPress={handleApproveAll} disabled={approvingAll} hitSlop={8} accessibilityRole="button">
                <Text style={styles.approveAll}>{approvingAll ? 'Approving…' : 'Approve all'}</Text>
              </Pressable>
            }>
            Pending
          </SpaceSection>
        )}

        {error && <Text style={styles.error}>{error}</Text>}

        {!loading && requests.length === 0 ? (
          <View style={styles.empty}>
            <FlameSvg width={44} height={55} />
            <SpaceEmpty title="No pending requests" body="New requests to join show up here." />
          </View>
        ) : (
          <View style={styles.list}>
            {requests.map((r) => (
              <Animated.View key={r.id} exiting={FadeOut.duration(220)}>
                <SpaceCard style={styles.req}>
                  <View style={styles.rtop}>
                    <View style={styles.av}>
                      <Text style={styles.avLabel}>{r.display_name.charAt(0).toUpperCase()}</Text>
                    </View>
                    <View style={styles.who}>
                      <Text style={styles.nm} numberOfLines={1}>
                        {r.display_name}
                      </Text>
                      {r.handle && <Text style={styles.un}>@{r.handle}</Text>}
                    </View>
                  </View>

                  {(r.university || r.shared_circle_name) && (
                    <View style={styles.ctx}>
                      <SocialGlyph name="pin" size={12} color={Colors.spaceFaint} />
                      <Text style={styles.ctxText} numberOfLines={1}>
                        {[r.university, r.shared_circle_name ? `in "${r.shared_circle_name}"` : null].filter(Boolean).join(' · ')}
                      </Text>
                    </View>
                  )}

                  <View style={styles.acts}>
                    <Pressable
                      style={({ pressed }) => [styles.app, busyId === r.id && styles.actOff, pressed && styles.pressed]}
                      onPress={() => handleApprove(r.id)}
                      disabled={busyId === r.id}>
                      <UiGlyph name="check" size={14} color="#2A0F05" />
                      <Text style={styles.appLabel}>Approve</Text>
                    </Pressable>
                    <Pressable
                      style={({ pressed }) => [styles.den, busyId === r.id && styles.actOff, pressed && styles.pressed]}
                      onPress={() => handleDeny(r.id)}
                      disabled={busyId === r.id}>
                      <Text style={styles.denLabel}>Deny</Text>
                    </Pressable>
                  </View>
                </SpaceCard>
              </Animated.View>
            ))}
          </View>
        )}
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    paddingTop: Spacing.two,
    // Room under the last card — Screen's SafeAreaView clears the home indicator, this is the
    // gap on top of it.
    paddingBottom: Spacing.three,
  },
  body: {
    flex: 1,
    paddingHorizontal: SPACE_GUTTER,
  },
  cnt: {
    backgroundColor: 'rgba(255,122,47,0.14)',
    borderRadius: Radius.pill,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  cntLabel: {
    fontFamily: Fonts.bodyBold,
    fontSize: 12,
    color: Colors.navEmber2,
  },
  approveAll: {
    fontFamily: Fonts.bodyBold,
    fontSize: 12.5,
    color: Colors.navEmber2,
  },
  error: {
    fontFamily: Fonts.body,
    fontSize: 12,
    color: Colors.danger,
    marginBottom: Spacing.two,
  },
  list: {
    gap: 8,
  },
  req: {
    padding: 12,
  },
  rtop: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  av: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: Colors.spacePanel2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avLabel: {
    fontFamily: Fonts.bodyBold,
    fontSize: 14,
    color: Colors.gold,
  },
  who: {
    flex: 1,
    minWidth: 0,
  },
  nm: {
    fontFamily: Fonts.bodyBold,
    fontSize: 14,
    color: Colors.ink,
  },
  un: {
    fontFamily: Fonts.body,
    fontSize: 11.5,
    color: Colors.spaceDim,
  },
  ctx: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 9,
  },
  ctxText: {
    flex: 1,
    fontFamily: Fonts.body,
    fontSize: 11.5,
    color: Colors.spaceDim,
  },
  acts: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 12,
  },
  // A compact SpaceButton pair: ember fill for the one action, the secondary panel for Deny.
  app: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
    paddingVertical: 9,
    borderRadius: 12,
    backgroundColor: Colors.navEmber,
  },
  appLabel: {
    fontFamily: Fonts.black,
    fontSize: 12.5,
    color: '#2A0F05',
  },
  den: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: Colors.spaceLine,
    backgroundColor: Colors.spacePanel2,
    borderRadius: 12,
    paddingVertical: 9,
  },
  denLabel: {
    fontFamily: Fonts.bodyBold,
    fontSize: 12.5,
    color: Colors.ink,
  },
  actOff: {
    opacity: 0.45,
  },
  pressed: {
    opacity: 0.85,
  },
  empty: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
