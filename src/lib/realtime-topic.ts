// A FRESH REALTIME TOPIC PER SUBSCRIPTION.
//
// supabase-js `channel(name)` does not always make a channel: if one with the same topic is still in
// the client's list it RETURNS THAT ONE. And `removeChannel()` is async — the channel only leaves the
// list after the server acks the unsubscribe. So a screen that unmounts and re-mounts quickly (a tab
// re-focus, Strict/Fast Refresh, two components watching the same room) gets the old, already-joined
// channel back, and the very next `.on('postgres_changes', …)` throws
// "cannot add `postgres_changes` callbacks for realtime:… after `subscribe()`" — the gym-room crash.
//
// postgres_changes routing is by the filter in the join payload, never by the topic name, so a unique
// suffix costs nothing server-side and guarantees every subscribe() builds its own channel (all `.on()`
// before `.subscribe()`), which its own cleanup then removes. Do NOT use this for BROADCAST topics
// whose name the server publishes to (e.g. lockin-presence): those must keep the exact topic.

let seq = 0;

export function freshTopic(base: string): string {
  seq += 1;
  return `${base}:${seq}-${Math.random().toString(36).slice(2, 8)}`;
}
