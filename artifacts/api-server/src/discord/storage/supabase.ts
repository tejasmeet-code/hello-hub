import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import ws from "ws";

const url = process.env["SUPABASE_URL"];
const key = process.env["SUPABASE_SERVICE_ROLE_KEY"];

export const supabase: SupabaseClient | null =
  url && key
    ? createClient(url, key, {
        auth: { persistSession: false },
        realtime: { transport: ws as any },
      })
    : null;

export type Database = {
  guild_settings: {
    Row: {
      guild_id: string;
      module_name: string;
      enabled: boolean;
      log_channel_id: string | null;
      permitted_role_ids: string[];
      updated_at: string;
    };
    Insert: Omit<Database["guild_settings"]["Row"], "updated_at">;
    Update: Partial<Database["guild_settings"]["Insert"]>;
  };
  cases: {
    Row: {
      id: number;
      guild_id: string;
      case_number: number;
      action: string;
      moderator_id: string;
      target_id: string;
      reason: string;
      proof: string | null;
      active: boolean;
      created_at: string;
      updated_at: string;
    };
    Insert: Omit<Database["cases"]["Row"], "id" | "case_number" | "created_at" | "updated_at">;
    Update: Partial<Pick<Database["cases"]["Row"], "reason" | "active">>;
  };
  appeals: {
    Row: {
      id: number;
      guild_id: string;
      case_number: number;
      user_id: string;
      punishment_type: string;
      why_happened: string;
      defense: string;
      proof: string | null;
      status: "pending" | "accepted" | "rejected";
      reviewed_by: string | null;
      created_at: string;
    };
    Insert: Omit<Database["appeals"]["Row"], "id" | "status" | "reviewed_by" | "created_at">;
  };
  quota_streaks: {
    Row: {
      guild_id: string;
      user_id: string;
      consecutive_fails: number;
      last_check_week: number;
      updated_at: string;
    };
    Insert: Omit<Database["quota_streaks"]["Row"], "updated_at">;
    Update: Partial<Pick<Database["quota_streaks"]["Row"], "consecutive_fails" | "last_check_week">>;
  };
  server_backups: {
    Row: {
      id: string;
      guild_id: string;
      trigger: "join" | "periodic" | "manual";
      taken_at: string;
      data: unknown;
      created_at: string;
    };
    Insert: Omit<Database["server_backups"]["Row"], "created_at">;
    Update: Partial<Database["server_backups"]["Insert"]>;
  };
  bot_json_store: {
    Row: {
      store_name: string;
      payload: unknown;
      updated_at: string;
    };
    Insert: Omit<Database["bot_json_store"]["Row"], "updated_at">;
    Update: Partial<Pick<Database["bot_json_store"]["Row"], "payload">>;
  };
};