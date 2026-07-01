#!/usr/bin/env node

/**
 * One-time seed for public fitness-themed demo circles, so cold-start discovery
 * (get_discoverable_groups in supabase/schema.sql) has something to show brand-new
 * users instead of an empty list.
 *
 * Needs the service_role key (Project Settings -> API -> service_role) because creating
 * the demo accounts goes through the auth admin API, which bypasses RLS by design — never
 * put this key in .env or commit it. Run as:
 *
 *   SUPABASE_SERVICE_ROLE_KEY=xxx node scripts/seed-demo-circles.js
 */

const crypto = require('node:crypto');
const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
  console.error('Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in the environment before running this.');
  process.exit(1);
}

const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const PERSONAS = [
  { email: 'demo.morning-lifters@philoi.demo', display_name: 'Jordan', university: null },
  { email: 'demo.c25k-crew@philoi.demo', display_name: 'Sam', university: null },
  { email: 'demo.push-day@philoi.demo', display_name: 'Riley', university: null },
  { email: 'demo.run-club@philoi.demo', display_name: 'Casey', university: null },
];

const CIRCLES = [
  { name: 'Sunrise Lift Club', emoji: '🏋️', goal_type: 'gym', cadence: '5x/week', owner: 0, joiners: [2] },
  { name: 'Couch to 5K Crew', emoji: '🏃', goal_type: 'run', cadence: '4x/week', owner: 1, joiners: [3] },
  { name: 'Push Day Collective', emoji: '💪', goal_type: 'gym', cadence: '6x/week', owner: 2, joiners: [0] },
  { name: 'Sunday Long Run Club', emoji: '🏃‍♀️', goal_type: 'run', cadence: '7x/week', owner: 3, joiners: [1] },
];

async function ensurePersona(persona) {
  const { data: created, error: createError } = await admin.auth.admin.createUser({
    email: persona.email,
    email_confirm: true,
    password: crypto.randomUUID(),
    user_metadata: { full_name: persona.display_name },
  });

  let userId;
  if (createError) {
    if (!String(createError.message).toLowerCase().includes('already')) throw createError;
    const { data: list, error: listError } = await admin.auth.admin.listUsers();
    if (listError) throw listError;
    const existing = list.users.find((u) => u.email === persona.email);
    if (!existing) throw createError;
    userId = existing.id;
  } else {
    userId = created.user.id;
  }

  const { error: profileError } = await admin
    .from('profiles')
    .upsert(
      { id: userId, display_name: persona.display_name, university: persona.university, is_demo: true },
      { onConflict: 'id' }
    );
  if (profileError) throw profileError;

  return userId;
}

async function ensureCircle(circle, ownerId) {
  // Match on name AND owner — matching on name alone risks colliding with a real user's
  // circle that happens to share a demo circle's name (this bit us once: a real "Morning
  // Lifters" circle absorbed a demo joiner before this owner check existed).
  const { data: existing } = await admin
    .from('groups')
    .select('id')
    .eq('name', circle.name)
    .eq('owner_id', ownerId)
    .maybeSingle();
  if (existing) return existing.id;

  const { data: group, error } = await admin
    .from('groups')
    .insert({
      name: circle.name,
      emoji: circle.emoji,
      owner_id: ownerId,
      goal_type: circle.goal_type,
      cadence: circle.cadence,
      is_public: true,
    })
    .select('id')
    .single();
  if (error) throw error;

  const { error: memberError } = await admin
    .from('group_members')
    .insert({ group_id: group.id, user_id: ownerId, role: 'owner' });
  if (memberError) throw memberError;

  return group.id;
}

async function joinCircle(groupId, userId) {
  const { error } = await admin
    .from('group_members')
    .upsert({ group_id: groupId, user_id: userId, role: 'member' }, { onConflict: 'group_id,user_id' });
  if (error) throw error;
}

async function main() {
  const userIds = [];
  for (const persona of PERSONAS) {
    const id = await ensurePersona(persona);
    userIds.push(id);
    console.log(`persona ready: ${persona.display_name} (${id})`);
  }

  for (const circle of CIRCLES) {
    const groupId = await ensureCircle(circle, userIds[circle.owner]);
    console.log(`circle ready: ${circle.name} (${groupId})`);
    for (const joinerIndex of circle.joiners) {
      await joinCircle(groupId, userIds[joinerIndex]);
    }
  }

  console.log('Done — demo fitness circles are public and discoverable.');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
