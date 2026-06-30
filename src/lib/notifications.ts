import AsyncStorage from '@react-native-async-storage/async-storage';
import Constants from 'expo-constants';
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

import { supabase } from '@/lib/supabase';

const REMINDER_MAP_KEY = 'philoi_group_reminders';

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
// risk — see notify_push and its triggers in supabase/schema.sql). Best-effort: a user who
// declines the OS permission prompt just doesn't get these, same as local reminders.
export async function registerPushToken(userId: string): Promise<void> {
  if (Platform.OS === 'web') return;
  try {
    const granted = await requestNotificationPermissions();
    if (!granted) return;

    if (Platform.OS === 'android') {
      await Notifications.setNotificationChannelAsync('default', {
        name: 'Philoi',
        importance: Notifications.AndroidImportance.DEFAULT,
      });
    }

    const projectId = Constants.expoConfig?.extra?.eas?.projectId;
    const { data: token } = await Notifications.getExpoPushTokenAsync({ projectId });
    if (!token) return;

    await supabase.from('push_tokens').upsert(
      { user_id: userId, token },
      { onConflict: 'user_id,token' }
    );
  } catch (e) {
    console.warn('[notifications] failed to register push token:', e);
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

  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync('reminders', {
      name: 'Streak reminders',
      importance: Notifications.AndroidImportance.DEFAULT,
    });
  }

  const map = await getReminderMap();
  const existing = map[input.groupId];
  if (existing) {
    await Notifications.cancelScheduledNotificationAsync(existing.notificationId);
  }

  const notificationId = await Notifications.scheduleNotificationAsync({
    content: {
      title: `${input.groupName} — don't break the streak 🔥`,
      body: "Your circle's counting on you. Lock in today.",
    },
    // DAILY, not CALENDAR — CALENDAR triggers are iOS-only in expo-notifications.
    trigger: {
      type: Notifications.SchedulableTriggerInputTypes.DAILY,
      hour: input.hour,
      minute: input.minute,
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
