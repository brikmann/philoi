import { Redirect, useLocalSearchParams } from 'expo-router';

// The Fitness board is no longer its own screen: it's the Fitness half of the Leaderboard tab's
// XP | Fitness toggle (FitnessBoardPanel). This route stays so every existing link — Profile's
// Fitness card, pushes, the exercise board's back stack — lands on the toggle, scope carried over.
export default function FitnessBoardRedirect() {
  const { scope } = useLocalSearchParams<{ scope?: string }>();
  return <Redirect href={{ pathname: '/leaderboards', params: scope ? { board: 'fitness', scope } : { board: 'fitness' } }} />;
}
