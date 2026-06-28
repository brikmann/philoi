export type GoalType = 'gym' | 'run' | 'study' | 'custom';
export type MemberRole = 'owner' | 'member';
export type CheckInStatus = 'on_time' | 'late';

export type Profile = {
  id: string;
  handle: string | null;
  display_name: string;
  avatar_url: string | null;
  is_pro: boolean;
  pro_until: string | null;
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
  created_at: string;
};

export type GroupMember = {
  group_id: string;
  user_id: string;
  role: MemberRole;
  joined_at: string;
  current_streak: number;
  longest_streak: number;
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

export type LeaderboardRow = {
  user_id: string;
  handle: string;
  display_name: string;
  avatar_url: string | null;
  is_pro: boolean;
  current_streak: number;
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
    };
    Views: Record<string, never>;
    Functions: {
      get_group_leaderboard: { Args: { p_group_id: string }; Returns: LeaderboardRow[] };
      get_weekly_recap: { Args: { p_user_id: string }; Returns: WeeklyRecap[] };
      create_group_with_owner: {
        Args: { p_name: string; p_emoji: string; p_goal_type: GoalType; p_cadence: string };
        Returns: Group;
      };
      join_group_with_code: { Args: { p_code: string }; Returns: Group };
      ensure_personal_invite: { Args: Record<string, never>; Returns: string };
    };
  };
};
