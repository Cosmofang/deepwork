import { promises as fs } from 'fs';
import path from 'path';
import { DeepLoopPatchEvent, DeepLoopSemanticEvent } from '@/types/deeploop-protocol';

export interface GovernanceConflict {
  id: string;
  conflictId?: string;
  summary: string;
  sections?: string[];
  actorIds?: string[];
  recordedAt: string;
}

export interface GovernanceIndex {
  version: 1;
  roomId: string;
  updatedAt: string;
  openConflicts: GovernanceConflict[];
  openPatches: DeepLoopPatchEvent[];
}

function emptyIndex(roomId: string): GovernanceIndex {
  return {
    version: 1,
    roomId,
    updatedAt: new Date().toISOString(),
    openConflicts: [],
    openPatches: [],
  };
}

export async function readGovernanceIndex(roomDir: string): Promise<GovernanceIndex | null> {
  try {
    const raw = await fs.readFile(path.join(roomDir, 'governance-index.json'), 'utf8');
    return JSON.parse(raw) as GovernanceIndex;
  } catch {
    return null;
  }
}

function eventId(event: DeepLoopSemanticEvent): string {
  return ((event as unknown as Record<string, unknown>).id as string) || '';
}

export function applyEventsToIndex(index: GovernanceIndex, events: DeepLoopSemanticEvent[]): GovernanceIndex {
  let { openConflicts, openPatches } = index;

  for (const event of events) {
    if (event.type === 'conflict.detected') {
      const e = event as { type: 'conflict.detected'; conflictId?: string; summary: string; sections?: string[]; actorIds?: string[]; recordedAt: string; id?: string };
      const id = e.id || e.conflictId || '';
      // Dedup by id or conflictId
      const alreadyTracked = openConflicts.some(c => c.id === id || (e.conflictId && c.conflictId === e.conflictId));
      if (!alreadyTracked) {
        openConflicts = [...openConflicts, {
          id,
          conflictId: e.conflictId,
          summary: e.summary,
          sections: e.sections,
          actorIds: e.actorIds,
          recordedAt: e.recordedAt,
        }];
      }
    } else if (event.type === 'patch.proposed') {
      const patch = event as DeepLoopPatchEvent;
      const id = eventId(patch);
      const alreadyTracked = openPatches.some(p => eventId(p) === id || (patch.patchId && p.patchId === patch.patchId));
      if (!alreadyTracked) {
        openPatches = [...openPatches, patch];
      }
    } else if (event.type === 'decision.accepted') {
      const e = event as { type: 'decision.accepted'; decisionId?: string };
      if (e.decisionId) {
        openConflicts = openConflicts.filter(c =>
          c.id !== e.decisionId && c.conflictId !== e.decisionId
        );
        openPatches = openPatches.filter(p =>
          eventId(p) !== e.decisionId && p.patchId !== e.decisionId
        );
      }
    } else if (event.type === 'patch.applied') {
      const e = event as { type: 'patch.applied'; linkedEventIds?: string[]; linkedIntents?: string[]; patchId?: string };
      openPatches = openPatches.filter(p => {
        const pId = eventId(p);
        const aliases = [pId, p.patchId].filter(Boolean) as string[];
        if (e.patchId && aliases.includes(e.patchId)) return false;
        if (e.linkedEventIds?.some(id => aliases.includes(id))) return false;
        if (e.linkedIntents?.some(id => aliases.includes(id))) return false;
        return true;
      });
    }
  }

  return { ...index, openConflicts, openPatches, updatedAt: new Date().toISOString() };
}

export async function updateGovernanceIndex(
  roomDir: string,
  roomId: string,
  newEvents: DeepLoopSemanticEvent[]
): Promise<void> {
  if (newEvents.length === 0) return;

  const existing = await readGovernanceIndex(roomDir) ?? emptyIndex(roomId);
  const updated = applyEventsToIndex(existing, newEvents);
  await fs.mkdir(roomDir, { recursive: true });
  await fs.writeFile(
    path.join(roomDir, 'governance-index.json'),
    JSON.stringify(updated, null, 2),
    'utf8'
  );
}
