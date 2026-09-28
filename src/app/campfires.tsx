import { useMemo } from 'react';

import { ValleyPage } from '@/app/(tabs)/index';
import { ErrorBoundary } from '@/components/ui/error-boundary';
import { useCampfireHeat } from '@/hooks/use-campfire-heat';
import { useMyGroups } from '@/hooks/use-my-groups';

// Campfires as a destination (punchlist 16 §4). It used to be page 2 of a horizontal pager on
// Home; Home is now the flame / lock-in hub with no swipe, and this is reached from the hamburger.
//
// A wrapper rather than a copy: the page itself still lives beside the five helpers and dozen
// styles it depends on. What moves here is only the data fetching the pager used to do for it.
function CampfiresScreenContent() {
  const { groups } = useMyGroups();
  const heatByGroupId = useCampfireHeat();
  // Guard a null `name` on any campfire: ValleyPage's "mine" filter calls name.toLowerCase(),
  // which throws on null and — with no boundary above it — used to take the whole screen white
  // (device triage build 9, P0 #4). Coerce to a string here, where this screen owns the data,
  // rather than reaching into the shared Home file that hosts ValleyPage.
  const safeGroups = useMemo(() => groups.map((g) => ({ ...g, name: g.name ?? '' })), [groups]);
  return <ValleyPage myGroups={safeGroups} heatByGroupId={heatByGroupId} />;
}

// Wrapped so a throw anywhere in the valley's data or nodes degrades to a retry card instead of a
// blank app. The boundary is a parent of the content it guards (see error-boundary.tsx).
export default function CampfiresScreen() {
  return (
    <ErrorBoundary label="Campfire Valley">
      <CampfiresScreenContent />
    </ErrorBoundary>
  );
}
