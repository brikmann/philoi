import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect } from 'react';

import { HomeConnectionSurface } from '@/components/home/home-connection-surface';

// HOME = YOU + YOUR PEOPLE (mock 318). Not a feed: the immersive feed (mock 317) moved to the
// Social tab, which also takes a campfire's ?channel= deep link now. Home leads with your week vs
// your own last week, the friends backing you, and what your people are doing — see
// components/home/home-connection-surface.tsx.

export default function HomeScreen() {
  const router = useRouter();

  // A friend's "lock in?" nudge still deep-links to /?lockin=1 (0207 writes that route server-side
  // and installed builds read it). Starting a session lives on the Lock In tab now, so forward there.
  const { lockin } = useLocalSearchParams<{ lockin?: string }>();
  useEffect(() => {
    if (lockin === '1') {
      router.setParams({ lockin: undefined });
      router.navigate('/lockin');
    }
  }, [lockin, router]);

  return <HomeConnectionSurface />;
}
