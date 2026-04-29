// ── v2 types ──────────────────────────────────────────────────────────────

export interface Project {
  id: string;
  name: string;
  created_at: string;
}

export interface Agent {
  id: string;
  project_id: string;
  name: string;
  role_description: string;
  status: 'idle' | 'working';
  last_seen_at: string;
  created_at: string;
}

export type Priority = 'normal' | 'important' | 'urgent';
export type UserStatus = 'idle' | 'typing' | 'waiting' | 'done' | 'working';

export interface PresenceData {
  userId: string;
  name: string;
  status: UserStatus;
  isAgent: boolean;
  roleDescription: string;
  color: string;
  /** Epoch ms of the user's last activity. Older than 100 s = treated as offline. */
  lastActiveAt?: number;
}

export interface Requirement {
  id: string;
  project_id: string;
  content: string;
  posted_by: string;
  created_at: string;
  priority: Priority;
  weight: number;
  pending?: boolean;
}

export interface Submission {
  id: string;
  project_id: string;
  requirement_id: string;
  agent_id: string;
  html_content: string;
  summary: string;
  /** Agent's reasoning before generating the HTML — may be empty for older submissions. */
  thinking?: string;
  created_at: string;
  agent?: Agent;
}

// ── v1 types (kept for reference) ─────────────────────────────────────────

export type RoleId = 'designer' | 'copywriter' | 'developer' | 'product' | 'marketing' | 'employee';
export * from './deeploop-protocol';

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
  section: string;
  content: string;
  created_at: string;
  participant?: Participant;
}

export interface RoomSection {
  id: string;
  room_id: string;
  name: string;
  created_by: string | null;
  created_at: string;
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
