import assert from 'node:assert/strict';
import test from 'node:test';
import { classifySurfaceMaterial, traceSegmentWorldHit } from './ballistics';
import { footstepSurfaceForTile } from './footstepSurfaces';
import { CHUNK_SIZE } from './isometric';
import { generateChunk, generateWorld, getTileColliderHalfExtents, getWorldCell } from './survivalLogic';
import type { BiomeKind, LandmarkKind, PropKind, TileCell, TileKind } from './types';
import { getBiomeDisplayName, sampleBiomeAt, sampleRiverInfo, sampleRoadInfo } from './worldGen';

test('outer world generation is deterministic across positive and negative coordinates', () => {
  const worldA = generateWorld(1994);
  const worldB = generateWorld(1994);

  const coords: Array<[number, number]> = [
    [-42, -37],
    [125, -80],
    [-95, 114],
    [210, 175],
  ];
  for (const [gx, gy] of coords) {
    const a = getWorldCell(worldA.worldStore, gx, gy);
    const b = getWorldCell(worldB.worldStore, gx, gy);
    assert.equal(a.tile, b.tile);
    assert.equal(a.prop, b.prop);
    assert.equal(a.solid, b.solid);
    assert.equal(a.variant, b.variant);
  }
});

test('world generation produces diverse biomes, non-repeating tiles, and landmarks instead of mod56 clones', () => {
  const world = generateWorld(1994);
  const nextId = { nextId: 500 };

  const seenBiomes = new Set<BiomeKind>();
  const seenTiles = new Set<TileKind>();
  const seenProps = new Set<PropKind>();

  for (let cy = -6; cy <= 10; cy++) {
    for (let cx = -6; cx <= 10; cx++) {
      if (cx >= 0 && cx <= 3 && cy >= 0 && cy <= 3) continue;
      const spawned = generateChunk(world.worldStore, cx, cy, nextId);
      for (const row of spawned.chunk.cells) {
        for (const cell of row) {
          seenTiles.add(cell.tile);
          seenProps.add(cell.prop);
          seenBiomes.add(sampleBiomeAt(world.worldStore.seed, cell.gx, cell.gy));
        }
      }
    }
  }

  // Must generate multiple outer biomes and new biome tile types
  assert.ok(seenBiomes.has('pine_forest'), 'expected pine_forest biome');
  assert.ok(seenBiomes.has('river_valley'), 'expected river_valley biome');
  assert.ok(seenBiomes.has('scorched_barrens'), 'expected scorched_barrens biome');
  assert.ok(seenBiomes.has('rural_meadow'), 'expected rural_meadow biome');

  assert.ok(seenTiles.has('forest_floor'), 'expected forest_floor tile');
  assert.ok(seenTiles.has('gravel'), 'expected gravel tile');
  assert.ok(seenTiles.has('sand'), 'expected sand tile');
  assert.ok(seenTiles.has('mud'), 'expected mud tile');
  assert.ok(seenTiles.has('asphalt_cracked'), 'expected asphalt_cracked tile');
  assert.ok(seenTiles.has('water'), 'expected winding river water tile');

  // Must register multiple distinct landmark kinds & horde hotspots
  const landmarkKinds = new Set<LandmarkKind>();
  let hasHighThreatHotspot = false;
  for (const lm of world.worldStore.landmarks.values()) {
    landmarkKinds.add(lm.kind);
    assert.ok(lm.hotspotPacks.length >= 2, `landmark ${lm.id} should have hotspot pack`);
    if (lm.threatLevel === 'high') hasHighThreatHotspot = true;
  }
  assert.ok(world.worldStore.landmarks.size >= 8, 'expected numerous outer landmarks');
  assert.ok(landmarkKinds.has('pileup') || landmarkKinds.has('checkpoint'), 'expected highway pileup/checkpoint');
  assert.ok(landmarkKinds.has('campground'), 'expected campground');
  assert.ok(hasHighThreatHotspot, 'expected high-threat horde hotspot');

  // Verify distant 56-tile shifted chunks are NOT identical clones!
  const chunkA = generateChunk(world.worldStore, 5, 5, nextId).chunk;
  const chunkB = generateChunk(world.worldStore, 5 + 7, 5 + 7, nextId).chunk;
  let diffs = 0;
  for (let y = 0; y < CHUNK_SIZE; y++) {
    for (let x = 0; x < CHUNK_SIZE; x++) {
      if (chunkA.cells[y][x].tile !== chunkB.cells[y][x].tile || chunkA.cells[y][x].prop !== chunkB.cells[y][x].prop) {
        diffs++;
      }
    }
  }
  assert.ok(diffs > 20, `expected outer chunks to diverge organically, got ${diffs} diffs`);
});

test('winding highways and roads build walkable wooden bridges across rivers', () => {
  const world = generateWorld(1994);
  let bridgeCount = 0;

  for (let gy = -120; gy <= 180; gy += 2) {
    for (let gx = -120; gx <= 180; gx += 2) {
      if (gx >= 0 && gx < 64 && gy >= 0 && gy < 64) continue;
      const river = sampleRiverInfo(world.worldStore.seed, gx, gy);
      const road = sampleRoadInfo(world.worldStore.seed, gx, gy);
      if (river.inWater && road.isAnyRoad) {
        const cell = getWorldCell(world.worldStore, gx, gy);
        assert.equal(cell.tile, 'pier', `road-river crossing at (${gx}, ${gy}) should form a pier bridge`);
        assert.equal(cell.solid, false, `bridge at (${gx}, ${gy}) must be walkable`);
        bridgeCount++;
      }
      if (road.isCountryRoad && river.inWater) {
        const cell = getWorldCell(world.worldStore, gx, gy);
        assert.equal(cell.tile, 'pier', `country road-river crossing at (${gx}, ${gy}) should form a pier bridge`);
      }
    }
  }

  assert.ok(bridgeCount >= 4, `expected multiple road-river bridge crossings, found ${bridgeCount}`);
});

test('new biome tiles and exploration props map cleanly to footstep surfaces, colliders, and ballistics', () => {
  const newTiles: TileKind[] = ['forest_floor', 'gravel', 'mud', 'sand', 'asphalt_cracked'];
  for (const t of newTiles) {
    assert.ok(footstepSurfaceForTile(t) !== null, `expected footstep surface for ${t}`);
    const mat = classifySurfaceMaterial(t, 'none');
    assert.ok(mat === 'dirt' || mat === 'stone', `expected valid ballistic material for ${t}`);
  }

  const newProps: PropKind[] = ['tent', 'rock_boulder', 'fallen_log', 'road_sign', 'wrecked_car', 'sandbag_wall'];
  for (const p of newProps) {
    const dummyCell: TileCell = {
      gx: 10,
      gy: 10,
      tile: 'grass',
      prop: p,
      solid: true,
      blocksSight: false,
      variant: 0,
      explored: true,
    };
    const ext = getTileColliderHalfExtents(dummyCell);
    assert.ok(ext.hx > 0 && ext.hy > 0, `expected collider extents for ${p}`);

    // Verify raycast hits the 3D prop box
    const hit = traceSegmentWorldHit(
      9.0,
      10.5,
      0.35,
      11.0,
      10.5,
      0.35,
      true,
      (gx, gy) =>
        gx === 10 && gy === 10
          ? dummyCell
          : { gx, gy, tile: 'grass', prop: 'none', solid: false, blocksSight: false, variant: 0, explored: true },
      [],
      [],
      []
    );
    assert.ok(hit !== null, `expected ballistics hit against prop ${p}`);
  }

  assert.equal(getBiomeDisplayName('pine_forest'), 'WHISPERING PINES');
});
