import { usePathname, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { BottomBar, TAB_SLOTS, type TabKey } from '@/components/nav/bottom-bar';
import { useActiveSession } from '@/lib/active-session-context';
import { useAuth } from '@/lib/auth/auth-context';

// THE FOOTER THAT NEVER GOES AWAY (ui_pass2 §2).
//
// The tab navigator's own bar only exists inside (tabs), so every drawer destination — Shop, Forge,
// Campfires, Settings — was pushed onto the root Stack ABOVE it and lost the bar: a dead end with no
// way to Home but back, back, back. So the bar is mounted ONCE, here, under the whole navigator (the
// root layout gives the navigator flex:1 and this sits after it in normal flow, so every screen lays
// out above it rather than underneath it). The (tabs) navigator's own bar is switched off; this is
// the only one, on tabs and drawer screens alike, so it never jumps when you cross between them.
//
// Lit slot: the tab you're on, or — on a drawer screen — the tab you came from, so "where am I"
// stays answered. A tap navigates to that tab, which pops any drawer screens above (tabs) first.
//
// Hidden where a bar would be wrong: the immersive lock-in, the first-run gates, OAuth returns,
// chat threads (their composer owns the bottom edge), and every modal / full-screen flow.

const TAB_PATHS: Record<string, TabKey> = {
  '/': 'index',
  '/search': 'search',
  '/lockin': 'lockin',
  '/leaderboards': 'leaderboards',
  '/profile': 'profile',
};

/** Path prefixes with no footer. Matched as `path === p || path.startsWith(p + '/')`. */
const HIDDEN: string[] = [
  // immersive / full-screen
  '/lock-in',
  '/shop/open',
  '/purchase-success',
  '/paywall',
  '/cindy-voice',
  // first run + gates + auth returns
  '/sign-in',
  '/setup-handle',
  '/account-disabled',
  '/tutorial',
  '/house/claim',
  '/join',
  '/auth',
  '/strava-auth',
  '/gcal-auth',
  // chat threads — the composer owns the bottom edge
  '/dm',
  '/cindy',
  // modals
  '/goal',
  '/group/create',
  '/challenge/create',
  '/challenge-change',
  '/milestone/new',
  '/agora/compose',
  '/forest/create',
  '/activity',
  '/edit-profile',
  '/report',
];

const MODAL_SUFFIXES = ['/edit', '/invite'];

function isHidden(path: string): boolean {
  if (HIDDEN.some((p) => path === p || path.startsWith(p + '/'))) return true;
  // group/[id]/edit, group/[id]/invite and inventory/[itemId] are modals.
  if (path.startsWith('/group/') && MODAL_SUFFIXES.some((s) => path.endsWith(s))) return true;
  if (path.startsWith('/inventory/')) return true;
  return false;
}

export function GlobalFooter() {
  const router = useRouter();
  const pathname = usePathname();
  const insets = useSafeAreaInsets();
  const { session, needsHandle, needsConsent, needsAccountDisabled } = useAuth();
  const { session: activeSession } = useActiveSession();
  const onTab = TAB_PATHS[pathname] ?? null;
  const [lastTab, setLastTab] = useState<TabKey>('index');

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- remembers the last tab across a route change; the pathname is the external system here
    if (onTab) setLastTab(onTab);
  }, [onTab]);

  const usable = Boolean(session) && !needsHandle && !needsConsent && !needsAccountDisabled;
  if (!usable || isHidden(pathname)) return null;

  return (
    <BottomBar
      active={onTab ?? lastTab}
      sessionLive={Boolean(activeSession)}
      bottomInset={insets.bottom}
      onSelect={(key) => {
        const slot = TAB_SLOTS.find((s) => s.key === key);
        if (!slot) return;
        // navigate(), not push(): back to the (tabs) screen already in the stack, never a second copy.
        router.navigate(slot.href as never);
      }}
    />
  );
}
