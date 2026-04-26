export type DeepWorkProtocolVersion = '0.1';

export type DeepWorkStateMode = 'local-room-snapshots' | 'local-only' | 'file-sync' | 'hybrid';

export type DeepWorkEventType =
  | 'actor.joined'
  | 'intent.created'
  | 'section.created'
  | 'decision.accepted'
  | 'patch.proposed'
  | 'patch.applied'
  | 'artifact.updated'
  | 'synthesis.started'
  | 'synthesis.completed'
  | 'conflict.detected'
  | 'summary.updated';

export type DeepWorkActorType = 'human' | 'agent' | 'service';

export type DeepWorkActorTrustLevel = 'owner' | 'trusted' | 'scoped' | 'observer';

export interface DeepWorkProjectKey {
  protocolVersion: DeepWorkProtocolVersion;
  projectId: string;
  projectName?: string;
  stateMode: DeepWorkStateMode;
  currentRoomId?: string;
  currentSnapshotPath: string;
  roomsIndexPath?: string;
  eventsPath: string;
  realtimeChannel?: string;
  supportedEventTypes: DeepWorkEventType[];
  outputs?: Record<string, string>;
  permissions?: {
    humanCanPropose?: boolean;
    agentCanPropose?: boolean;
    agentCanSynthesize?: boolean;
    agentCanApplyPatch?: boolean;
  };
  updatedAt: string;
}

export interface DeepWorkActor {
  id: string;
  type: DeepWorkActorType;
  name: string;
  role?: string;
  capabilities?: string[];
  trustLevel?: DeepWorkActorTrustLevel;
}

export interface DeepWorkBaseEvent {
  id?: string;
  type: DeepWorkEventType;
  projectId: string;
  roomId?: string;
  actorId?: string;
  participantId?: string;
  participantName?: string;
  role?: string;
  summary: string;
  recordedAt: string;
}

export interface DeepWorkIntentCreatedEvent extends DeepWorkBaseEvent {
  type: 'intent.created';
  intentId?: string;
  section: string;
  content: string;
}

export interface DeepWorkPatchEvent extends DeepWorkBaseEvent {
  type: 'patch.proposed' | 'patch.applied';
  linkedEventIds?: string[];
  linkedIntents?: string[];
  affectedSections?: string[];
  affectedFiles?: string[];
  status: 'proposed' | 'applied' | 'rejected' | 'superseded';
  reason?: string;
  patchId?: string;
}

export interface DeepWorkArtifactUpdatedEvent extends DeepWorkBaseEvent {
  type: 'artifact.updated';
  artifactType: 'html' | 'markdown' | 'doc' | 'code' | 'other';
  artifactPath?: string;
  attributionMap?: Record<string, string>;
}

export interface DeepWorkActorJoinedEvent extends DeepWorkBaseEvent {
  type: 'actor.joined';
}

export interface DeepWorkSectionCreatedEvent extends DeepWorkBaseEvent {
  type: 'section.created';
  section: string;
}

export interface DeepWorkSynthesisEvent extends DeepWorkBaseEvent {
  type: 'synthesis.started' | 'synthesis.completed';
  round?: number;
}

export interface DeepWorkDecisionAcceptedEvent extends DeepWorkBaseEvent {
  type: 'decision.accepted';
  decisionId?: string;
  title?: string;
  value?: string;
}

export interface DeepWorkConflictDetectedEvent extends DeepWorkBaseEvent {
  type: 'conflict.detected';
  conflictId?: string;
  sections?: string[];
  actorIds?: string[];
}

export interface DeepWorkSummaryUpdatedEvent extends DeepWorkBaseEvent {
  type: 'summary.updated';
  section?: string;
}

export type DeepWorkSemanticEvent =
  | DeepWorkActorJoinedEvent
  | DeepWorkIntentCreatedEvent
  | DeepWorkSectionCreatedEvent
  | DeepWorkDecisionAcceptedEvent
  | DeepWorkPatchEvent
  | DeepWorkArtifactUpdatedEvent
  | DeepWorkSynthesisEvent
  | DeepWorkConflictDetectedEvent
  | DeepWorkSummaryUpdatedEvent;

export type DeepWorkActionPriority = 'p0' | 'p1' | 'p2';

export interface DeepWorkGovernancePolicy {
  rule: 'human_review_required' | 'agent_may_write_event' | 'agent_may_propose_only';
  reason: string;
  requiredEventTypes?: DeepWorkEventType[];
  allowedActorTrustLevels?: DeepWorkActorTrustLevel[];
}

export interface DeepWorkRecommendedAction {
  id: string;
  priority: DeepWorkActionPriority;
  summary: string;
  reason: string;
  eventTypes?: DeepWorkEventType[];
  affectedSections?: string[];
  affectedFiles?: string[];
  linkedEventIds?: string[];
  suggestedAction?: 'write_event' | 'run_synthesis' | 'invite_actor' | 'review_patch';
  closeWith?: {
    eventType: DeepWorkEventType;
    field: 'decisionId' | 'linkedEventIds' | 'linkedIntents';
    acceptedValues: string[];
    note?: string;
  };
  governancePolicy?: DeepWorkGovernancePolicy;
}

export interface DeepWorkSnapshot {
  meta: {
    projectId: string;
    roomId?: string;
    protocolVersion: DeepWorkProtocolVersion;
    snapshotVersion: 1;
    updatedAt: string;
  };
  goal?: string;
  positioning?: string;
  actors: DeepWorkActor[];
  sections: Array<{
    id?: string;
    name: string;
    status?: 'active' | 'resolved' | 'paused';
    summary: string | null;
    totalIntents?: number;
    contributors?: string[];
    updatedAt?: string | null;
  }>;
  recentIntents: Array<{
    id: string;
    section: string;
    content: string;
    actorId?: string;
    createdAt: string;
  }>;
  decisions?: Array<{
    id: string;
    title: string;
    value: string;
    status: 'proposed' | 'accepted' | 'rejected' | 'superseded';
    acceptedAt?: string;
  }>;
  proposedPatches?: DeepWorkPatchEvent[];
  latestArtifacts?: Array<{
    id?: string;
    type: string;
    path: string;
    updatedAt: string;
    attributionMap?: Record<string, string>;
  }>;
  unresolvedConflicts?: Array<{
    id?: string;
    summary: string;
    sections?: string[];
    actorIds?: string[];
  }>;
  recommendedNextActions?: DeepWorkRecommendedAction[];
}

export const DEEPWORK_SUPPORTED_EVENT_TYPES: DeepWorkEventType[] = [
  'actor.joined',
  'intent.created',
  'section.created',
  'decision.accepted',
  'patch.proposed',
  'patch.applied',
  'artifact.updated',
  'synthesis.started',
  'synthesis.completed',
  'conflict.detected',
  'summary.updated',
];

export function toSemanticEventType(type: string): DeepWorkEventType {
  const legacyToSemantic: Record<string, DeepWorkEventType> = {
    room_joined: 'actor.joined',
    intent_created: 'intent.created',
    section_added: 'section.created',
    synthesis_started: 'synthesis.started',
    synthesis_completed: 'synthesis.completed',
  };

  const semanticType = legacyToSemantic[type] ?? type;

  if (!DEEPWORK_SUPPORTED_EVENT_TYPES.includes(semanticType as DeepWorkEventType)) {
    throw new Error(`Unsupported DeepWork event type: ${type}`);
  }

  return semanticType as DeepWorkEventType;
}
