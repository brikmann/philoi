import { AppTopBar } from '@/components/nav/app-top-bar';

// THE GYM SPARK global top bar (v2 §6): flame logo + wordmark left; ✈ Messages, 🔔 Notifications, ☰ menu
// right — identical on Feed / Board / Chat / You, same positions on every tab, nothing else in it.
// Posting lives in the bottom bar's raised ＋ (beside 🔥 Lock In), not here.
//
// It is AppTopBar with no title and no `right` slot, on purpose: that already owns the three globals
// (✈ → /messages with the DM unread badge, 🔔 → /notifications with its badge, ☰ → the app drawer), so
// the Spark's bar can never drift from the classic one.
//
// Like AppTopBar it draws NO safe-area inset: put it inside a SafeAreaView edges={['top']} (or pad by
// insets.top yourself, as components/group-room.tsx does over its banner).
export function GymTopBar() {
  return <AppTopBar />;
}
