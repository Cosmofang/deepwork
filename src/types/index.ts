export type RoleId = 'designer' | 'copywriter' | 'developer' | 'product' | 'marketing' | 'employee';

export interface Participant {
  id: string;
  room_id: string;
  name: string;
  role: RoleId;
  color: string;
  joined_at: string;
}

export interface Intent {
  id: string;
  room_id: string;
  participant_id: string;
  content: string;
  created_at: string;
  participant?: Participant;
}

export interface Room {
  id: string;
  created_at: string;
  status: 'collecting' | 'synthesizing' | 'done';
}

export interface SynthesisResult {
  id: string;
  room_id: string;
  round: number;
  html_content: string;
  attribution_map: Record<string, string>;
  conflicts_resolved: string[];
  created_at: string;
}

export interface SynthesisOutput {
  html: string;
  attributionMap: Record<string, string>;
  conflictsDetected: string[];
  conflictsResolved: string[];
}
