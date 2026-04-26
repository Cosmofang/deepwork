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

export type DeepWorkRecommendedActionSuggestion =
  | 'write_event'
  | 'run_synthesis'
  | 'invite_actor'
  | 'review_patch';

export interface DeepWorkRecommendedAction {
  id: string;
  priority: DeepWorkActionPriority;
  summary: string;
  reason: string;
  eventTypes?: DeepWorkEventType[];
  affectedSections?: string[];
  affectedFiles?: string[];
  linkedEventIds?: string[];
  suggestedAction?: DeepWorkRecommendedActionSuggestion;
  actorScope?: {
    missingActorRoles?: string[];
    presentActorRoles?: string[];
    note?: string;
  };
  closeWith?: {
    eventType: DeepWorkEventType;
    field: 'decisionId' | 'linkedEventIds' | 'linkedIntents';
    acceptedValues: string[];
    note?: string;
  };
  governancePolicy?: DeepWorkGovernancePolicy;
}

export interface DeepWorkActionCapabilityExample {
  eventType?: DeepWorkEventType;
  description: string;
  // Full HTTP request body to POST to writeEndpoint. Replace ROOM_ID with the actual roomId.
  body: Record<string, unknown>;
}

export interface DeepWorkActionCapability {
  suggestedAction: DeepWorkRecommendedActionSuggestion;
  description: string;
  writeEndpoint?: string;
  requiredEventTypes?: DeepWorkEventType[];
  requiresHumanReview?: boolean;
  // Concrete copy-paste examples an agent can use to construct a valid request.
  examplePayloads?: DeepWorkActionCapabilityExample[];
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

export const DEEPWORK_ACTION_CAPABILITIES: DeepWorkActionCapability[] = [
  {
    suggestedAction: 'write_event',
    description: 'Append a validated semantic event through the workspace event writer.',
    writeEndpoint: 'POST /api/workspace/events',
    examplePayloads: [
      {
        eventType: 'conflict.detected',
        description: 'Record a conflict between two actors on a section. Use snapshot.unresolvedConflicts[].id as conflictId when closing.',
        body: {
          roomId: 'ROOM_ID',
          event: {
            type: 'conflict.detected',
            summary: 'Designer and copywriter have conflicting intents on hero headline',
            sections: ['hero'],
            actorIds: [],
          },
        },
      },
      {
        eventType: 'decision.accepted',
        description: 'Resolve a conflict or formally accept a decision. Set decisionId to the conflictId from snapshot.unresolvedConflicts[].id to close it.',
        body: {
          roomId: 'ROOM_ID',
          event: {
            type: 'decision.accepted',
            summary: 'Hero headline conflict resolved: adopt copywriter version',
            decisionId: '<conflict-id-from-snapshot.unresolvedConflicts[].id>',
            title: 'Hero headline decision',
            value: 'Use copywriter headline; designer adjusts visual hierarchy to match',
          },
        },
      },
      {
        eventType: 'intent.created',
        description: 'Agent contributes an additional intent to a section.',
        body: {
          roomId: 'ROOM_ID',
          event: {
            type: 'intent.created',
            summary: 'Agent proposes adding a live demo embed to the hero section',
            section: 'hero',
            content: 'Hero should include an interactive embed showing a live DeepWork session so visitors understand the product without reading.',
            actorId: 'agent-machine-b',
          },
        },
      },
      {
        eventType: 'patch.proposed',
        description: 'Agent proposes a content or code change. At least one of affectedSections, affectedFiles, linkedEventIds, or linkedIntents is required. Use patchId when you want a deterministic alias that another machine can later close.',
        body: {
          roomId: 'ROOM_ID',
          event: {
            type: 'patch.proposed',
            summary: 'Agent proposes rewording the primary CTA button',
            affectedSections: ['cta'],
            linkedIntents: ['<intent-id-from-snapshot.recentIntents[].id>'],
            reason: 'Aligns with copywriter intent: "Start your free trial" converts better than "Sign up"',
            patchId: 'cta-copy-free-trial',
            actorId: 'agent-machine-b',
          },
        },
      },
      {
        eventType: 'artifact.updated',
        description: 'Record that an artifact file was updated.',
        body: {
          roomId: 'ROOM_ID',
          event: {
            type: 'artifact.updated',
            summary: 'Hero section HTML updated after applying copywriter patch',
            artifactType: 'html',
            artifactPath: '.deepwork/rooms/ROOM_ID/latest.html',
          },
        },
      },
      {
        eventType: 'summary.updated',
        description: 'Record that a section summary was revised.',
        body: {
          roomId: 'ROOM_ID',
          event: {
            type: 'summary.updated',
            summary: 'Hero section summary updated to reflect latest synthesis output',
            section: 'hero',
          },
        },
      },
    ],
  },
  {
    suggestedAction: 'run_synthesis',
    description: 'Trigger the synthesis flow so recorded intent becomes an attributed visible artifact.',
    requiredEventTypes: ['synthesis.started', 'synthesis.completed', 'artifact.updated'],
    requiresHumanReview: true,
  },
  {
    suggestedAction: 'invite_actor',
    description: 'Invite a missing human or agent role to contribute intent before synthesis.',
    requiredEventTypes: ['actor.joined', 'intent.created'],
  },
  {
    suggestedAction: 'review_patch',
    description: 'Review a proposed patch and close it with patch.applied or decision.accepted after approval.',
    writeEndpoint: 'POST /api/workspace/events',
    requiredEventTypes: ['patch.applied', 'decision.accepted'],
    requiresHumanReview: true,
    examplePayloads: [
      {
        eventType: 'patch.applied',
        description: 'Mark a proposed patch as applied after human review. Use a value from recommendedNextActions[].closeWith.acceptedValues or snapshot.proposedPatches[].id in patchId and/or linkedEventIds so the proposal closes.',
        body: {
          roomId: 'ROOM_ID',
          event: {
            type: 'patch.applied',
            summary: 'CTA button copy patch applied after human review',
            status: 'applied',
            affectedSections: ['cta'],
            patchId: '<patch-event-id-or-patchId-from-closeWith.acceptedValues>',
            linkedEventIds: ['<patch-event-id-or-patchId-from-closeWith.acceptedValues>'],
            actorId: 'agent-machine-b',
          },
        },
      },
      {
        eventType: 'decision.accepted',
        description: 'Formally accept the decision implied by a patch without recording a file-level change. Set decisionId to a value from recommendedNextActions[].closeWith.acceptedValues or snapshot.proposedPatches[].id.',
        body: {
          roomId: 'ROOM_ID',
          event: {
            type: 'decision.accepted',
            summary: 'Patch accepted: CTA copy changed to "Start your free trial"',
            decisionId: '<patch-event-id-from-snapshot.proposedPatches[].id>',
            title: 'CTA copy change approved',
            value: 'Apply the proposed CTA copy change as specified in the patch',
            actorId: 'agent-machine-b',
          },
        },
      },
    ],
  },
];

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
