import AsyncStorage from '@react-native-async-storage/async-storage';
import Constants from 'expo-constants';
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

import { supabase } from '@/lib/supabase';

// Without this, expo-notifications silently swallows the banner/sound for any push that
// arrives while the app is in the foreground — the OS still receives it, but nothing shows
// on screen. Registered at module scope so it's set before the app can possibly receive one.
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

const REMINDER_MAP_KEY = 'philoi_group_reminders';
const LAST_PUSH_TOKEN_KEY = 'philoi_last_push_token';

// "Accountability" stays a separate, higher-priority channel from "Messages" so chat volume
// can never bury a friend-checked-in / streak-at-risk notification — see notify_push()'s
// p_channel_id param in schema.sql, which routes each push to one of these by name.
async function ensureNotificationChannels() {
  if (Platform.OS !== 'android') return;
  await Notifications.setNotificationChannelAsync('accountability', {
    name: 'Accountability',
    description: 'Friend check-ins, reactions, and streak reminders.',
    importance: Notifications.AndroidImportance.HIGH,
  });
  await Notifications.setNotificationChannelAsync('messages', {
    name: 'Messages',
    description: 'Campfire chat.',
    importance: Notifications.AndroidImportance.DEFAULT,
  });
}

type ReminderMap = Record<string, { hour: number; minute: number; notificationId: string }>;

async function getReminderMap(): Promise<ReminderMap> {
  const raw = await AsyncStorage.getItem(REMINDER_MAP_KEY);
  return raw ? JSON.parse(raw) : {};
}

async function saveReminderMap(map: ReminderMap) {
  await AsyncStorage.setItem(REMINDER_MAP_KEY, JSON.stringify(map));
}

export async function requestNotificationPermissions(): Promise<boolean> {
  const current = await Notifications.getPermissionsAsync();
  if (current.granted) return true;
  const requested = await Notifications.requestPermissionsAsync();
  return requested.granted;
}

// Registers this device for server-sent pushes (friend checked in / reaction / streak at
// risk / chat mentions / batched chat — see notify_push and its triggers in schema.sql).
// Best-effort: a user who declines the OS permission prompt just doesn't get these, same as
// local reminders. Called once the user has actually joined/created their first circle (see
// _layout.tsx) rather than cold on launch, so the permission prompt has real context.
export async function registerPushToken(userId: string): Promise<void> {
  if (Platform.OS === 'web') return;
  try {
    const granted = await requestNotificationPermissions();
    if (!granted) return;

    await ensureNotificationChannels();

    const projectId = Constants.expoConfig?.extra?.eas?.projectId;
    const { data: token } = await Notifications.getExpoPushTokenAsync({ projectId });
    if (!token) return;

    await supabase.from('push_tokens').upsert(
      { user_id: userId, token },
      { onConflict: 'user_id,token' }
    );
    await AsyncStorage.setItem(LAST_PUSH_TOKEN_KEY, token);
  } catch (e) {
    console.warn('[notifications] failed to register push token:', e);
  }
}

// Removes just this device's token, not every device the user's signed in on elsewhere.
export async function unregisterPushToken(userId: string): Promise<void> {
  try {
    const token = await AsyncStorage.getItem(LAST_PUSH_TOKEN_KEY);
    if (!token) return;
    await supabase.from('push_tokens').delete().eq('user_id', userId).eq('token', token);
    await AsyncStorage.removeItem(LAST_PUSH_TOKEN_KEY);
  } catch (e) {
    console.warn('[notifications] failed to unregister push token:', e);
  }
}

export async function getGroupReminder(groupId: string) {
  const map = await getReminderMap();
  return map[groupId] ?? null;
}

export async function setGroupReminder(input: {
  groupId: string;
  groupName: string;
  hour: number;
  minute: number;
}) {
  const granted = await requestNotificationPermissions();
  if (!granted) throw new Error('Notification permission was not granted.');

  await ensureNotificationChannels();

  const map = await getReminderMap();
  const existing = map[input.groupId];
  if (existing) {
    await Notifications.cancelScheduledNotificationAsync(existing.notificationId);
  }

  const notificationId = await Notifications.scheduleNotificationAsync({
    content: {
      title: `${input.groupName} — don't break the streak 🔥`,
      body: "Your Campfire's counting on you. Lock in today.",
    },
    // DAILY, not CALENDAR — CALENDAR triggers are iOS-only in expo-notifications.
    trigger: {
      type: Notifications.SchedulableTriggerInputTypes.DAILY,
      hour: input.hour,
      minute: input.minute,
      channelId: 'accountability',
    },
  });

  map[input.groupId] = { hour: input.hour, minute: input.minute, notificationId };
  await saveReminderMap(map);
}

export async function clearGroupReminder(groupId: string) {
  const map = await getReminderMap();
  const existing = map[groupId];
  if (!existing) return;
  await Notifications.cancelScheduledNotificationAsync(existing.notificationId);
  delete map[groupId];
  await saveReminderMap(map);
}
