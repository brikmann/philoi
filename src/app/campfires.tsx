import { useCampfireHeat } from '@/hooks/use-campfire-heat';
import { useMyGroups } from '@/hooks/use-my-groups';
import { ValleyPage } from '@/app/(tabs)/index';

// Campfires as a destination (punchlist 16 §4). It used to be page 2 of a horizontal pager on
// Home; Home is now the flame / lock-in hub with no swipe, and this is reached from the hamburger.
//
// A wrapper rather than a copy: the page itself still lives beside the five helpers and dozen
// styles it depends on. What moves here is only the data fetching the pager used to do for it.
export default function CampfiresScreen() {
  const { groups } = useMyGroups();
  const heatByGroupId = useCampfireHeat();
  return <ValleyPage myGroups={groups} heatByGroupId={heatByGroupId} />;
}
