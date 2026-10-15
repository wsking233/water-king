/** Application models. These types do not grant browsers schema privileges. */
export const profileModel = {
  table: "profiles",
  columns: {
    user_id: "uuid primary key references auth.users(id) on delete cascade",
    nickname: "text not null default '水友' check (length(btrim(nickname)) between 1 and 40)",
    created_at: "timestamptz not null default now()",
  },
} as const;

export type Profile = {
  user_id: string;
  nickname: string;
  created_at: string;
};

// Preserve old string IDs on migration; historical IDs need not be UUIDs.
export type CloudRecord = {
  id: string;
  user_id: string;
  device_id: string;
  kind: "water" | "small";
  amount: number;
  at: string;
  cup_id: string | null;
  revision: number;
  deleted_at: string | null;
  updated_at: string;
};
export type CloudSettings = {
  user_id: string;
  daily_goal: number | null;
  revision: number;
  updated_at: string;
};
export type DeviceCup = {
  user_id: string;
  device_id: string;
  cup_id: string;
  capacity: number;
  revision: number;
  updated_at: string;
};

/** Only profiles is deployed at WK-02; sync models are contracts for WK-03. */
export type Database = {
  public: {
    Tables: {
      profiles: {
        Row: Profile;
        Insert: { user_id: string; nickname?: string };
        Update: { nickname?: string };
        Relationships: [];
      };
    };
    Views: { [_ in never]: never };
    Functions: { [_ in never]: never };
    Enums: { [_ in never]: never };
    CompositeTypes: { [_ in never]: never };
  };
};
