export type ReportStatus = 'pending' | 'reviewed' | 'actioned' | 'dismissed';
export type ReportCategory = 'csae' | 'harassment' | 'spam' | 'inappropriate' | 'other';
export type ActionType =
  | 'removed_content'
  | 'warned'
  | 'disabled_account'
  | 'reported_to_authorities'
  | 'dismissed';

export type Profile = {
  id: string;
  handle: string | null;
  display_name: string;
  avatar_url: string | null;
  university: string | null;
  is_pro: boolean;
  is_admin: boolean;
  is_test: boolean;
  is_disabled: boolean;
  disabled_at: string | null;
  created_at: string;
};

export type ContentSnapshot =
  | { type: 'message'; body: string; user_id: string; created_at: string }
  | {
      type: 'check_in';
      caption: string | null;
      photo_url: string;
      user_id: string;
      created_at: string;
      goal_type?: string;
      goal_label?: string | null;
    }
  | { type: 'circle'; name: string; owner_id: string; created_at: string };

export type ModerationReport = {
  id: string;
  reporter_id: string | null;
  reported_check_in_id: string | null;
  reported_user_id: string | null;
  reported_message_id: string | null;
  reported_group_id: string | null;
  circle_id: string | null;
  reason: string;
  note: string | null;
  category: ReportCategory;
  status: ReportStatus;
  reported_content_snapshot: ContentSnapshot | null;
  created_at: string;
};

export type ModerationAction = {
  id: string;
  report_id: string | null;
  action_type: ActionType;
  target_user_id: string | null;
  notes: string | null;
  created_at: string;
};

export type AdminAuditEventType = 'content_view' | 'report_action' | 'user_suspended' | 'login';

export type Group = {
  id: string;
  name: string;
  emoji: string;
  owner_id: string;
  join_code: string;
  goal_type: string;
  cadence: string;
  is_public: boolean;
  created_at: string;
};

export type CheckIn = {
  id: string;
  goal_id: string;
  user_id: string;
  created_at: string;
  photo_url: string;
  caption: string | null;
  status: 'on_time' | 'late';
  goal_type: string;
  goal_label: string | null;
  removed_at: string | null;
};

export type ChatMessage = {
  id: string;
  group_id: string;
  user_id: string;
  body: string;
  created_at: string;
  deleted_at: string | null;
};
