export interface Database {
  public: {
    Tables: {
      // ── v2 tables ─────────────────────────────────────────────────────────
      projects: {
        Row: { id: string; name: string; created_at: string };
        Insert: { id: string; name?: string; created_at?: string };
        Update: { name?: string };
      };
      agents: {
        Row: {
          id: string;
          project_id: string;
          name: string;
          role_description: string;
          status: string;
          last_seen_at: string;
          created_at: string;
        };
        Insert: {
          project_id: string;
          name: string;
          role_description?: string;
          status?: string;
          last_seen_at?: string;
          id?: string;
          created_at?: string;
        };
        Update: { status?: string; last_seen_at?: string; role_description?: string };
      };
      requirements: {
        Row: {
          id: string;
          project_id: string;
          content: string;
          posted_by: string;
          created_at: string;
        };
        Insert: {
          project_id: string;
          content: string;
          posted_by?: string;
          id?: string;
          created_at?: string;
        };
        Update: never;
      };
      submissions: {
        Row: {
          id: string;
          project_id: string;
          requirement_id: string;
          agent_id: string;
          html_content: string;
          summary: string;
          created_at: string;
        };
        Insert: {
          project_id: string;
          requirement_id: string;
          agent_id: string;
          html_content: string;
          summary?: string;
          id?: string;
          created_at?: string;
        };
        Update: never;
      };

      // ── v1 tables (kept for reference) ───────────────────────────────────
      rooms: {
        Row: { id: string; created_at: string; status: string };
        Insert: { id: string; status?: string; created_at?: string };
        Update: { status?: string };
      };
      participants: {
        Row: { id: string; room_id: string; name: string; role: string; color: string; joined_at: string };
        Insert: { room_id: string; name: string; role: string; color: string; id?: string; joined_at?: string };
        Update: { name?: string; role?: string; color?: string };
      };
      intents: {
        Row: { id: string; room_id: string; participant_id: string; section: string; content: string; created_at: string };
        Insert: { room_id: string; participant_id: string; section?: string; content: string; id?: string; created_at?: string };
        Update: { section?: string; content?: string };
      };
      room_sections: {
        Row: { id: string; room_id: string; name: string; created_by: string | null; created_at: string };
        Insert: { room_id: string; name: string; created_by?: string | null; id?: string; created_at?: string };
        Update: never;
      };
      synthesis_results: {
        Row: { id: string; room_id: string; round: number; html_content: string; attribution_map: Record<string, string> | null; conflicts_resolved: string[] | null; created_at: string };
        Insert: { room_id: string; round: number; html_content: string; attribution_map?: Record<string, string>; conflicts_resolved?: string[]; id?: string; created_at?: string };
        Update: never;
      };
    };
  };
}
