export type GoalType = 'gym' | 'run' | 'study' | 'custom';
export type MemberRole = 'owner' | 'member';
export type CheckInStatus = 'on_time' | 'late';

export type Profile = {
  id: string;
  handle: string | null;
  display_name: string;
  avatar_url: string | null;
  university: string | null;
  /** Has an active paid Philoi membership. Unused for gating during free early access — see use-entitlement.ts. */
  is_pro: boolean;
  pro_until: string | null;
  /** 18+ attestation + ToS/Privacy consent. Null or false = must complete setup-age-consent screen. */
  has_consented: boolean;
  consented_at: string | null;
  consent_version: string | null;
  created_at: string;
};

export type Group = {
  id: string;
  name: string;
  emoji: string;
  owner_id: string;
  join_code: string;
  goal_type: GoalType;
  cadence: string;
  is_public: boolean;
  created_at: string;
};

export type DiscoverableGroup = {
  id: string;
  name: string;
  emoji: string;
  goal_type: GoalType;
  cadence: string;
  member_count: number;
  owner_university: string | null;
};

export type GroupMember = {
  group_id: string;
  user_id: string;
  role: MemberRole;
  joined_at: string;
  current_streak: number;
  longest_streak: number;
  /** Personal target within the circle, e.g. "A in CHEM101" — set via set_my_goal_target(). */
  goal_target: string | null;
};

export type CheckIn = {
  id: string;
  group_id: string;
  user_id: string;
  created_at: string;
  photo_url: string;
  caption: string | null;
  status: CheckInStatus;
};

export type Reaction = {
  id: string;
  check_in_id: string;
  user_id: string;
  emoji: string;
  created_at: string;
};

export type Invite = {
  code: string;
  inviter_id: string;
  group_id: string | null;
  created_at: string;
};

export type AnalyticsEventName =
  | 'signed_up'
  | 'circle_created'
  | 'circle_joined'
  | 'invite_sent'
  | 'invite_accepted'
  | 'check_in_completed';

export type AnalyticsEvent = {
  id: string;
  user_id: string | null;
  name: AnalyticsEventName;
  properties: Record<string, unknown>;
  created_at: string;
};

export type LeaderboardRow = {
  user_id: string;
  handle: string;
  display_name: string;
  avatar_url: string | null;
  is_pro: boolean;
  current_streak: number;
  goal_target: string | null;
  check_ins_this_week: number;
};

export type UniversityLeaderboardRow = {
  user_id: string;
  handle: string;
  display_name: string;
  avatar_url: string | null;
  is_pro: boolean;
  best_streak: number;
  check_ins_this_week: number;
};

export type WeeklyRecap = {
  group_id: string;
  group_name: string;
  check_ins_this_week: number;
};

export type Database = {
  public: {
    Tables: {
      profiles: {
        Row: Profile;
        Insert: Partial<Profile> & { id: string };
        Update: Partial<Profile>;
        Relationships: [];
      };
      groups: {
        Row: Group;
        Insert: Partial<Group> & { name: string; owner_id: string };
        Update: Partial<Group>;
        Relationships: [];
      };
      group_members: {
        Row: GroupMember;
        Insert: Partial<GroupMember> & { group_id: string; user_id: string };
        Update: Partial<GroupMember>;
        Relationships: [
          {
            foreignKeyName: 'group_members_group_id_fkey';
            columns: ['group_id'];
            isOneToOne: false;
            referencedRelation: 'groups';
            referencedColumns: ['id'];
          },
        ];
      };
      check_ins: {
        Row: CheckIn;
        Insert: Partial<CheckIn> & { group_id: string; user_id: string; photo_url: string };
        Update: Partial<CheckIn>;
        Relationships: [
          {
            foreignKeyName: 'check_ins_user_id_fkey';
            columns: ['user_id'];
            isOneToOne: false;
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          },
        ];
      };
      reactions: {
        Row: Reaction;
        Insert: Partial<Reaction> & { check_in_id: string; user_id: string; emoji: string };
        Update: Partial<Reaction>;
        Relationships: [
          {
            foreignKeyName: 'reactions_check_in_id_fkey';
            columns: ['check_in_id'];
            isOneToOne: false;
            referencedRelation: 'check_ins';
            referencedColumns: ['id'];
          },
        ];
      };
      invites: {
        Row: Invite;
        Insert: Partial<Invite> & { code: string; inviter_id: string };
        Update: Partial<Invite>;
        Relationships: [];
      };
      events: {
        Row: AnalyticsEvent;
        Insert: Partial<AnalyticsEvent> & { user_id: string; name: AnalyticsEventName };
        Update: Partial<AnalyticsEvent>;
        Relationships: [];
      };
      moderation_reports: {
        Row: { id: string; reporter_id: string | null; reported_check_in_id: string | null; reported_user_id: string | null; reason: string; status: string; created_at: string };
        Insert: { reporter_id?: string | null; reported_check_in_id?: string | null; reported_user_id?: string | null; reason: string };
        Update: { status?: string };
        Relationships: [];
      };
      blocked_users: {
        Row: { blocker_id: string; blocked_id: string; created_at: string };
        Insert: { blocker_id: string; blocked_id: string };
        Update: never;
        Relationships: [];
      };
    };
    Views: Record<string, never>;
    Functions: {
      get_group_leaderboard: { Args: { p_group_id: string }; Returns: LeaderboardRow[] };
      get_weekly_recap: { Args: { p_user_id: string }; Returns: WeeklyRecap[] };
      create_group_with_owner: {
        Args: {
          p_name: string;
          p_emoji: string;
          p_goal_type: GoalType;
          p_cadence: string;
          p_is_public?: boolean;
        };
        Returns: Group;
      };
      join_group_with_code: { Args: { p_code: string }; Returns: Group };
      join_public_group: { Args: { p_group_id: string }; Returns: Group };
      get_discoverable_groups: {
        Args: { p_goal_type?: GoalType | null; p_limit?: number };
        Returns: DiscoverableGroup[];
      };
      ensure_personal_invite: { Args: Record<string, never>; Returns: string };
      set_my_goal_target: { Args: { p_group_id: string; p_goal_target: string | null }; Returns: undefined };
      delete_group: { Args: { p_group_id: string }; Returns: undefined };
      delete_my_account: { Args: Record<string, never>; Returns: undefined };
      get_university_leaderboard: {
        Args: { p_university: string; p_limit?: number };
        Returns: UniversityLeaderboardRow[];
      };
    };
  };
};
