import type { EntityKind, EntityValue } from "../syncProtocol.ts";

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

// Records, settings and cups use the same version protocol and JSON payloads;
// record payloads preserve legacy IDs/cupId and local-time-compatible timestamps.
export type SyncEntityRow = {
  user_id: string;
  entity: EntityKind;
  entity_id: string;
  revision: number;
  cursor: string;
  value: EntityValue;
  updated_at: string;
};
export type SyncHeadRow = {
  user_id: string;
  cursor: string;
};
export type SyncReceiptRow = {
  user_id: string;
  mutation_id: string;
  request: Json;
  response: Json;
};

export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

/** Private tables are deliberately absent from the public client schema. */
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
    Functions: {
      account_status: { Args: { [_ in never]: never }; Returns: Json };
      sync_apply: {
        Args: { p_mutation_id: string; p_entity: string; p_entity_id: string; p_expected_revision: number; p_value: Json };
        Returns: Json;
      };
      sync_pull: {
        Args: { p_after?: string; p_limit?: number };
        Returns: Json;
      };
    };
    Enums: { [_ in never]: never };
    CompositeTypes: { [_ in never]: never };
  };
};
