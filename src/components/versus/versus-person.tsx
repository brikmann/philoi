import { StyleSheet, Text, View } from 'react-native';

import { PublicTitle } from '@/components/economy/loadout-bits';
import { CosmeticAvatar } from '@/components/economy/public-identity';
import { HouseSeal } from '@/components/house/house-seal';
import { IdentityLine } from '@/components/house/identity-line';
import { VERSUS_THEM_TEXT } from '@/components/versus/versus-bar';
import { Colors, Fonts, Radius, Spacing } from '@/constants/theme';
import { usePublicLoadout } from '@/hooks/use-public-loadouts';

type VersusPersonProps = {
  userId: string;
  name: string;
  avatarUrl?: string | null;
  university?: string | null;
  /** Which side of the "vs" — the ember side is always you, mirroring the bars below it. */
  side: 'you' | 'them';
};

// One half of the "You vs them" header (mock 292's `.vp`): who they are before what they've done.
// The identity stack is the point — the comparison lands harder when it is Heracles' heir against
// Psyche's than when it is two first names.
export function VersusPerson({ userId, name, avatarUrl, university, side }: VersusPersonProps) {
  const loadout = usePublicLoadout(userId);

  return (
    <View style={[styles.card, side === 'you' ? styles.cardYou : styles.cardThem]}>
      <CosmeticAvatar userId={userId} name={name} avatarUrl={avatarUrl} size={42} loadout={loadout} motion="reduced" />
      <View style={styles.nameRow}>
        <HouseSeal userId={userId} size={14} />
        <Text style={[styles.name, side === 'you' ? styles.nameYou : styles.nameThem]} numberOfLines={1}>
          {side === 'you' ? 'You' : name}
        </Text>
      </View>
      <IdentityLine userId={userId} university={university} numberOfLines={2} style={styles.identity} />
      <PublicTitle loadout={loadout} compact />
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    flex: 1,
    alignItems: 'center',
    gap: Spacing.one,
    backgroundColor: Colors.card,
    borderWidth: 1,
    borderRadius: Radius.card + 2,
    paddingVertical: 11,
    paddingHorizontal: Spacing.two,
  },
  cardYou: {
    borderColor: 'rgba(224,97,44,0.35)',
  },
  cardThem: {
    borderColor: 'rgba(160,108,213,0.35)',
  },
  nameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.one,
    marginTop: Spacing.one,
    maxWidth: '100%',
  },
  name: {
    flexShrink: 1,
    fontFamily: Fonts.bodyBold,
    fontSize: 13,
  },
  nameYou: {
    color: Colors.amber,
  },
  nameThem: {
    color: VERSUS_THEM_TEXT,
  },
  identity: {
    fontSize: 9.5,
    textAlign: 'center',
  },
});
