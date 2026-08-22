import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { Linking, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { Screen } from '@/components/ui/screen';
import { Colors, Fonts, Radius, Spacing } from '@/constants/theme';
import { useAuth } from '@/lib/auth/auth-context';

// "TALK TO SOMEONE" — mock 116 frame 3, the support surface APP_BLOCKER_SPEC §C-safety requires
// ("pairs with a lightweight support-resources surface in-app — build a minimal one if none
// exists"). Cindy links here from the wellbeing/safety voice via her open_support action.
//
// Deliberately NOT clinical and deliberately NOT a wall of hotlines. §C-safety's whole point is
// warm, brief, non-diagnosing — so the first option is a real person the user already knows, and
// the crisis line is present without being the headline. A screen that leads with a suicide
// hotline turns "you seem tired" into "we think you're in crisis," which is its own harm.
//
// 🔒 No analytics on this screen. Nothing about who opened it, when, or what they tapped. A
// person reaching for help is not a funnel to measure, and a support surface that phones home
// is one nobody should trust.

type Option = {
  icon: keyof typeof Ionicons.glyphMap;
  tint: string;
  title: string;
  detail: string;
  action: () => void;
};

export default function SupportScreen() {
  const router = useRouter();
  const { profile } = useAuth();

  const options: Option[] = [
    {
      icon: 'chatbubble-ellipses',
      tint: 'rgba(120,220,160,0.15)',
      title: 'Text a friend',
      detail: 'Someone from your campfire, or anyone you trust',
      // Routes into the app's own social layer rather than out to a dialler — the healthiest
      // version of the urge that brought them here is usually a person they already have.
      action: () => router.push('/people'),
    },
    {
      icon: 'school',
      tint: 'rgba(110,155,255,0.15)',
      title: campusWellnessTitle(profile?.university ?? null),
      detail: 'Most campuses offer free counselling — book or drop in',
      action: () => openUrl(campusWellnessSearch(profile?.university ?? null)),
    },
    {
      icon: 'heart',
      tint: 'rgba(255,120,120,0.14)',
      title: '988 · Suicide & Crisis Lifeline',
      detail: 'Call or text, 24/7, if things feel heavy',
      // 988 covers the US and Canada, which is where Philoi's campuses are. `tel:` rather than
      // an in-app dialogue: one tap, no friction, no confirmation step.
      action: () => openUrl('tel:988'),
    },
  ];

  return (
    <Screen padded={false}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={12} accessibilityLabel="Back">
          <Ionicons name="chevron-back" size={24} color={Colors.muted} />
        </Pressable>
        <Text style={styles.headerTitle}>Talk to someone</Text>
      </View>

      <ScrollView contentContainerStyle={styles.body} showsVerticalScrollIndicator={false}>
        <View style={styles.hero}>
          <Text style={styles.heroTitle}>You don&apos;t have to power through it alone.</Text>
          <Text style={styles.heroBody}>
            Reaching out isn&apos;t quitting — it&apos;s the strong move. Pick whatever feels easiest right
            now.
          </Text>
        </View>

        {options.map((option) => (
          <Pressable
            key={option.title}
            onPress={option.action}
            style={styles.option}
            accessibilityRole="button"
            accessibilityLabel={`${option.title}. ${option.detail}`}>
            <View style={[styles.icon, { backgroundColor: option.tint }]}>
              <Ionicons name={option.icon} size={17} color={Colors.ink} />
            </View>
            <View style={styles.optionText}>
              <Text style={styles.optionTitle}>{option.title}</Text>
              <Text style={styles.optionDetail}>{option.detail}</Text>
            </View>
            <Ionicons name="chevron-forward" size={16} color={Colors.textTertiary} />
          </Pressable>
        ))}

        <Text style={styles.foot}>
          Philoi isn&apos;t a substitute for real support — these people are. If you&apos;re in immediate
          danger, call your local emergency number.
        </Text>
      </ScrollView>
    </Screen>
  );
}

function campusWellnessTitle(university: string | null): string {
  return university ? `${university} student wellness` : 'Your campus wellness centre';
}

/**
 * A search rather than a hardcoded per-school URL.
 *
 * Wellness pages move constantly and a stale deep link on this particular screen is worse than a
 * search result — a dead end is exactly what someone reaching out must not hit.
 */
function campusWellnessSearch(university: string | null): string {
  const query = university ? `${university} student wellness counselling` : 'student wellness counselling';
  return `https://www.google.com/search?q=${encodeURIComponent(query)}`;
}

function openUrl(url: string) {
  Linking.openURL(url).catch(() => {
    // Swallowed on purpose: a device with no dialler or no browser should not throw an error
    // dialog at someone who just tapped for help.
  });
}

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.twelve,
    paddingHorizontal: Spacing.three,
    paddingBottom: Spacing.twelve,
  },
  headerTitle: { fontFamily: Fonts.bodyBold, fontSize: 16, color: Colors.ink },
  body: { padding: Spacing.three, gap: Spacing.twelve, paddingBottom: Spacing.five },
  hero: { gap: Spacing.two, marginBottom: Spacing.two },
  heroTitle: { fontFamily: Fonts.bodyBold, fontSize: 19, lineHeight: 26, color: Colors.ink },
  heroBody: { fontFamily: Fonts.body, fontSize: 13, lineHeight: 20, color: Colors.muted },
  option: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.twelve,
    backgroundColor: Colors.card,
    borderRadius: Radius.input,
    padding: Spacing.twelve,
  },
  icon: { width: 38, height: 38, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  optionText: { flex: 1, gap: 2 },
  optionTitle: { fontFamily: Fonts.bodySemiBold, fontSize: 14, color: Colors.ink },
  optionDetail: { fontFamily: Fonts.body, fontSize: 11.5, lineHeight: 16, color: Colors.muted },
  foot: {
    fontFamily: Fonts.body,
    fontSize: 11,
    lineHeight: 17,
    color: Colors.textTertiary,
    marginTop: Spacing.two,
  },
});
