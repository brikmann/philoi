import { Ionicons } from '@expo/vector-icons';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, { FadeOut } from 'react-native-reanimated';

import { FlameSvg } from '@/components/flame-icon';
import { Screen } from '@/components/ui/screen';
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

      <View style={styles.hd}>
        <Pressable onPress={() => router.back()} hitSlop={8} accessibilityLabel="Back">
          <Ionicons name="arrow-back" size={20} color={Colors.muted} />
        </Pressable>
        <Text style={styles.title}>Join requests</Text>
        {requests.length > 0 && (
          <View style={styles.cnt}>
            <Text style={styles.cntLabel}>{requests.length}</Text>
          </View>
        )}
      </View>

      <View style={styles.sub}>
        <Text style={styles.subGroup} numberOfLines={1}>
          {group?.name ?? '…'} · gated
        </Text>
        {requests.length > 0 && (
          <Pressable onPress={handleApproveAll} disabled={approvingAll} hitSlop={8}>
            <Text style={styles.approveAll}>{approvingAll ? 'Approving…' : 'Approve all'}</Text>
          </Pressable>
        )}
      </View>

      {error && <Text style={styles.error}>{error}</Text>}

      {!loading && requests.length === 0 ? (
        <View style={styles.empty}>
          <FlameSvg width={44} height={55} />
          <Text style={styles.emptyTitle}>No pending requests</Text>
          <Text style={styles.emptySub}>New requests to join show up here.</Text>
        </View>
      ) : (
        <View style={styles.list}>
          {requests.map((r) => (
            <Animated.View key={r.id} exiting={FadeOut.duration(220)} style={styles.req}>
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
                  <Ionicons name="location" size={11} color={Colors.textTertiary} />
                  <Text style={styles.ctxText} numberOfLines={1}>
                    {[r.university, r.shared_circle_name ? `in "${r.shared_circle_name}"` : null].filter(Boolean).join(' · ')}
                  </Text>
                </View>
              )}

              <View style={styles.acts}>
                <Pressable style={styles.app} onPress={() => handleApprove(r.id)} disabled={busyId === r.id}>
                  <Ionicons name="checkmark" size={14} color={Colors.onEmber} />
                  <Text style={styles.appLabel}>Approve</Text>
                </Pressable>
                <Pressable style={styles.den} onPress={() => handleDeny(r.id)} disabled={busyId === r.id}>
                  <Text style={styles.denLabel}>Deny</Text>
                </Pressable>
              </View>
            </Animated.View>
          ))}
        </View>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    paddingHorizontal: 14,
    paddingTop: 15,
    // Room under the last card — Screen's SafeAreaView clears the home indicator, this is the
    // gap on top of it.
    paddingBottom: Spacing.three,
  },
  hd: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginBottom: 4,
  },
  title: {
    flex: 1,
    fontFamily: Fonts.bodyBold,
    fontSize: 17,
    color: Colors.ink,
  },
  cnt: {
    backgroundColor: Colors.achieverBg,
    borderRadius: Radius.pill,
    paddingHorizontal: 9,
    paddingVertical: 3,
  },
  cntLabel: {
    fontFamily: Fonts.bodyBold,
    fontSize: 11,
    color: Colors.achieverText,
  },
  sub: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 10,
    marginBottom: 12,
    paddingHorizontal: 2,
  },
  subGroup: {
    flex: 1,
    fontFamily: Fonts.body,
    fontSize: 11.5,
    color: Colors.muted,
  },
  approveAll: {
    fontFamily: Fonts.bodySemiBold,
    fontSize: 12,
    color: Colors.amber,
  },
  error: {
    fontFamily: Fonts.body,
    fontSize: 12,
    color: Colors.coral,
    marginBottom: Spacing.two,
  },
  list: {
    gap: 9,
  },
  req: {
    backgroundColor: '#141020',
    borderWidth: 1,
    borderColor: '#221A34',
    borderRadius: 14,
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
    backgroundColor: '#1C1430',
    alignItems: 'center',
    justifyContent: 'center',
  },
  avLabel: {
    fontFamily: Fonts.bodySemiBold,
    fontSize: 14,
    color: Colors.achieverText,
  },
  who: {
    flex: 1,
    minWidth: 0,
  },
  nm: {
    fontFamily: Fonts.bodySemiBold,
    fontSize: 13.5,
    color: Colors.ink,
  },
  un: {
    fontFamily: Fonts.body,
    fontSize: 11,
    color: Colors.muted,
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
    fontSize: 11,
    color: Colors.textTertiary,
  },
  acts: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 10,
  },
  // Amber + near-black, not the old bold coral with cream text — the ember language's "this is
  // the action" treatment (DESIGN_LANGUAGE_EMBER §3).
  app: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
    backgroundColor: Colors.amber,
    borderRadius: 10,
    paddingVertical: 9,
  },
  appLabel: {
    fontFamily: Fonts.bodyBold,
    fontSize: 12.5,
    color: Colors.onEmber,
  },
  den: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: '#2A2140',
    borderRadius: 10,
    paddingVertical: 9,
  },
  denLabel: {
    fontFamily: Fonts.body,
    fontSize: 12.5,
    color: Colors.muted,
  },
  empty: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
  },
  emptyTitle: {
    fontFamily: Fonts.bodySemiBold,
    fontSize: 14,
    color: Colors.muted,
  },
  emptySub: {
    fontFamily: Fonts.body,
    fontSize: 12,
    color: Colors.textTertiary,
  },
});
