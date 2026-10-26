import { useMemo } from 'react';
import { StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ValleyPage } from '@/components/campfire/valley-page';
import { ErrorBoundary } from '@/components/ui/error-boundary';
import { SpaceHeader } from '@/components/ui/space-kit';
import { useCampfireHeat } from '@/hooks/use-campfire-heat';
import { useMyGroups } from '@/hooks/use-my-groups';

// Campfires as a destination (punchlist 16 §4). It used to be page 2 of a horizontal pager on
// Home; Home is now the flame / lock-in hub with no swipe, and this is reached from the hamburger.
//
// The page itself (and the five helpers + styles it leans on) lives in
// components/campfire/valley-page.tsx since the old Home it came from was retired. What lives here
// is only the data fetching the pager used to do for it, plus the screen chrome.
function CampfiresScreenContent() {
  const { groups } = useMyGroups();
  const heatByGroupId = useCampfireHeat();
  // Guard a null `name` on any campfire: ValleyPage's "mine" filter calls name.toLowerCase(),
  // which throws on null and — with no boundary above it — used to take the whole screen white
  // (device triage build 9, P0 #4). Coerce to a string here, where this screen owns the data,
  // rather than reaching into ValleyPage.
  const safeGroups = useMemo(() => groups.map((g) => ({ ...g, name: g.name ?? '' })), [groups]);
  // The root layout paints the space background now, so this only has to supply the flex:1
  // full-height parent — without one the absolutely-positioned fire nodes bunch at the top (device
  // triage: "amalgamated near the top"). SafeAreaView's flex:1 is that parent, and its top edge
  // keeps the SpaceHeader clear of the status bar (the route is headerShown:false).
  return (
    <SafeAreaView edges={['top']} style={styles.safe}>
      <SpaceHeader
        title="Campfires"
        subtitle={groups.length > 0 ? `${groups.length} fire${groups.length === 1 ? '' : 's'} you sit at` : undefined}
      />
      <ValleyPage myGroups={safeGroups} heatByGroupId={heatByGroupId} />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
  },
});

// Wrapped so a throw anywhere in the valley's data or nodes degrades to a retry card instead of a
// blank app. The boundary is a parent of the content it guards (see error-boundary.tsx).
export default function CampfiresScreen() {
  return (
    <ErrorBoundary label="Campfire Valley">
      <CampfiresScreenContent />
    </ErrorBoundary>
  );
}
