import type { TileKind } from './types';
export type FootstepSurface = 'concrete' | 'grass' | 'dirt' | 'planks' | 'carpet' | 'tile';
// Match the rendered material, not whether a tile happens to be indoors.
const SURFACES: Record<TileKind, FootstepSurface | null> = {
  road: 'concrete', sidewalk: 'concrete', crosswalk: 'concrete', asphalt_cracked: 'concrete',
  grass: 'grass', forest_floor: 'grass',
  dirt: 'dirt', gravel: 'dirt', mud: 'dirt', sand: 'dirt',
  floor: 'planks', floor_porch: 'planks', pier: 'planks',
  floor_rug: 'carpet', floor_bath: 'tile', tile_clinic: 'tile', tile_diner: 'tile',
  water: null, // Water is impassable; do not invent a wading mechanic.
};
export const footstepSurfaceForTile = (tile: TileKind): FootstepSurface | null => SURFACES[tile];
