export interface Database {
  public: {
    Tables: {
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
        Row: { id: string; room_id: string; participant_id: string; content: string; created_at: string };
        Insert: { room_id: string; participant_id: string; content: string; id?: string; created_at?: string };
        Update: { content?: string };
      };
      synthesis_results: {
        Row: {
          id: string;
          room_id: string;
          round: number;
          html_content: string;
          attribution_map: Record<string, string> | null;
          conflicts_resolved: string[] | null;
          created_at: string;
        };
        Insert: {
          room_id: string;
          round: number;
          html_content: string;
          attribution_map?: Record<string, string>;
          conflicts_resolved?: string[];
          id?: string;
          created_at?: string;
        };
        Update: never;
      };
    };
  };
}
