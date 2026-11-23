import type { CubeFaceId, DoorEntity, LootContainer } from './types';

// Only these two seed-1994 guardhouses were approved for removal. Other contacts
// need their own review, so this is deliberately not a general overlap rule.
const REMOVED = [
  { face: 3, gx: 116, gy: -368 },
  { face: 5, gx: 108, gy: 40 },
] as const;

export function isRemovedTunnelGuardhouse(seed: number, face: CubeFaceId, gx: number, gy: number): boolean {
  return seed === 1994 && REMOVED.some(p => p.face === face && p.gx === gx && p.gy === gy);
}

export function removeObsoleteGuardhouseEntities<T extends { doors: DoorEntity[]; containers: LootContainer[] }>(seed: number, face: CubeFaceId, bundle: T): T {
  const sites = seed === 1994 ? REMOVED.filter(p => p.face === face) : [];
  if (!sites.length) return bundle;
  return {
    ...bundle,
    doors: bundle.doors.filter(d => !sites.some(p => d.id === `door_${p.gx + 5}_${p.gy - 2}` && d.gx === p.gx + 5 && d.gy === p.gy - 2)),
    containers: bundle.containers.filter(c => !sites.some(p =>
      c.gy === p.gy - 5 && c.id === `c_${c.gx}_${c.gy}` &&
      ((c.gx === p.gx + 4 && c.kind === 'med_cabinet') || (c.gx === p.gx + 6 && c.kind === 'crate_military')))),
  };
}
