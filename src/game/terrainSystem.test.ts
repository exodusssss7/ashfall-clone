import assert from 'node:assert/strict';
import test from 'node:test';
import {
  clearTerrainCaches,
  computeHighGroundCombatBonus,
  computeSlopeSpeedMultiplier,
  findRockyCaveAt,
  getFrontierFactor,
  getMacroRegionCave,
  getShelterInfo,
  isPointInsideClearedCave,
  isTerrainStepBlocked,
  isTunnelSideWallTile,
  sampleBridgeInfo,
  sampleRoadTunnelInfo,
  sampleTerrainHeight,
  sampleTerrainMeshHeight,
  sampleTerrainSurface,
} from './terrainSystem';
import { generateChunk, generateWorld, getWorldCell } from './survivalLogic';

const SEED = 1994;

test('starter town (0..63, 0..63) remains completely flat while outer frontier rises into hills', () => {
  clearTerrainCaches();
  for (let y = 0; y <= 63; y += 7) {
    for (let x = 0; x <= 63; x += 7) {
      assert.equal(getFrontierFactor(x + 0.5, y + 0.5), 0);
      assert.equal(sampleTerrainHeight(SEED, x + 0.5, y + 0.5), 0);
    }
  }

  let maxOuterHeight = 0;
  let highGroundCount = 0;
  for (let y = -120; y <= 184; y += 6) {
    for (let x = -120; x <= 184; x += 6) {
      if (x >= 0 && x <= 64 && y >= 0 && y <= 64) continue;
      const surf = sampleTerrainSurface(SEED, x + 0.5, y + 0.5);
      if (surf.height > maxOuterHeight) maxOuterHeight = surf.height;
      if (surf.isHighGround) highGroundCount++;
    }
  }
  assert.ok(maxOuterHeight > 2.0, `expected outer frontier hills > 2.0, got ${maxOuterHeight}`);
  assert.ok(highGroundCount > 20, `expected plenty of high ground tiles, got ${highGroundCount}`);
});

test('terrain height is continuous across chunk boundaries in outer frontier', () => {
  const seams = [-48, -32, -16, 64, 80, 96, 112];
  for (const seam of seams) {
    for (let t = -80; t <= 140; t += 13) {
      const hLeft = sampleTerrainHeight(SEED, seam - 0.01, t + 0.5);
      const hRight = sampleTerrainHeight(SEED, seam + 0.01, t + 0.5);
      assert.ok(
        Math.abs(hLeft - hRight) < 0.15,
        `discontinuity at x=${seam}, y=${t}: ${hLeft} vs ${hRight}`
      );
    }
  }
});

test('outer frontier generates steep impassable cliffs, elevated river bridges, road tunnels, and rocky cliff caves', () => {
  clearTerrainCaches();
  let cliffFound = false;
  let bridgeFound = false;
  let tunnelFound = false;

  for (let y = -220; y <= 284; y += 2) {
    for (let x = -220; x <= 284; x += 2) {
      if (x >= 0 && x <= 64 && y >= 0 && y <= 64) continue;
      const wx = x + 0.5;
      const wy = y + 0.5;
      if (!bridgeFound) {
        const b = sampleBridgeInfo(SEED, wx, wy);
        if (b.isBridge && b.bridgeHeight > 0.35) bridgeFound = true;
      }
      if (!tunnelFound) {
        const t = sampleRoadTunnelInfo(SEED, wx, wy);
        if (t.isTunnel && t.roofY > t.floorY + 2.0) tunnelFound = true;
      }
      if (!cliffFound) {
        const s = sampleTerrainSurface(SEED, wx, wy);
        if (s.isCliff && !s.isCaveWall && !s.isTunnel) cliffFound = true;
      }
      if (cliffFound && bridgeFound && tunnelFound) break;
    }
    if (cliffFound && bridgeFound && tunnelFound) break;
  }

  assert.ok(cliffFound, 'expected at least one steep impassable cliff in outer frontier');
  assert.ok(bridgeFound, 'expected at least one elevated river bridge in outer frontier');
  assert.ok(tunnelFound, 'expected at least one highway road tunnel in outer frontier');

  // Verify rocky cliff caves exist outside starter town and never inside starter town
  assert.equal(getMacroRegionCave(SEED, 0, 0), null);
  assert.equal(getMacroRegionCave(SEED, 1, 1), null);

  let foundCave = null;
  for (let ry = -6; ry <= 7 && !foundCave; ry++) {
    for (let rx = -6; rx <= 7 && !foundCave; rx++) {
      foundCave = getMacroRegionCave(SEED, rx, ry);
    }
  }
  assert.ok(foundCave !== null, 'expected at least one rocky cliff cave in outer frontier');

  const hit = findRockyCaveAt(SEED, foundCave.gx + 0.5, foundCave.gy + 0.5);
  assert.ok(hit && hit.inInterior, 'expected cave center to register as cave interior');

  const shelter = getShelterInfo(SEED, foundCave.gx + 0.5, foundCave.gy + 0.5, null, false);
  assert.equal(shelter.sheltered, true);
  assert.equal(shelter.kind, 'cave');

  // Verify chunk generation creates cave landmark & walkable cave_floor with supply crates
  const { worldStore: store } = generateWorld(SEED);
  const cx = Math.floor(foundCave.gx / 16);
  const cy = Math.floor(foundCave.gy / 16);
  const spawned = generateChunk(store, cx, cy, { nextId: 100 });
  const centerCell = getWorldCell(store, foundCave.gx, foundCave.gy);
  assert.equal(centerCell.tile, 'cave_floor');
  assert.equal(centerCell.solid, false);
  const caveLandmark = store.landmarks.get(foundCave.id);
  assert.ok(caveLandmark && caveLandmark.kind === 'cave', 'expected cave landmark registration');
  assert.ok(spawned.containers.length >= 1, 'expected at least one supply crate in cave chunk');
});

test('uphill travel slows movement and high ground grants combat damage and range bonuses', () => {
  // Find a sloped tile in the frontier
  let slopeFound = false;
  for (let y = -120; y <= 184 && !slopeFound; y += 3) {
    for (let x = -120; x <= 184 && !slopeFound; x += 3) {
      if (x >= 0 && x <= 64 && y >= 0 && y <= 64) continue;
      const s = sampleTerrainSurface(SEED, x + 0.5, y + 0.5);
      if (s.slope > 0.25 && !s.isCliff) {
        // Gradient uphill is opposite to horizontal surface normal (-normalX, -normalZ)
        const uphill = computeSlopeSpeedMultiplier(SEED, x + 0.5, y + 0.5, -s.normalX, -s.normalZ, false);
        const downhill = computeSlopeSpeedMultiplier(SEED, x + 0.5, y + 0.5, s.normalX, s.normalZ, false);
        const vehUphill = computeSlopeSpeedMultiplier(SEED, x + 0.5, y + 0.5, -s.normalX, -s.normalZ, true);
        assert.ok(uphill < 0.98, `expected uphill penalty < 0.98, got ${uphill}`);
        assert.ok(vehUphill <= uphill, `expected vehicle uphill penalty <= foot uphill penalty`);
        assert.ok(downhill >= 1.0, `expected downhill >= 1.0, got ${downhill}`);
        slopeFound = true;
      }
    }
  }
  assert.ok(slopeFound, 'expected a walkable hillside slope to test');

  const flatBonus = computeHighGroundCombatBonus(0.2, 0.0);
  assert.equal(flatBonus.active, false);
  assert.equal(flatBonus.damageMultiplier, 1);
  assert.equal(flatBonus.rangeMultiplier, 1);

  const highBonus = computeHighGroundCombatBonus(2.4, 0.2);
  assert.equal(highBonus.active, true);
  assert.ok(highBonus.damageMultiplier >= 1.15, 'expected >= 15% high-ground damage bonus');
  assert.ok(highBonus.rangeMultiplier >= 1.18, 'expected >= 18% high-ground range bonus');
});

test('cleared rocky cliff caves permanently reject zombie spawns inside the cave and mouth', () => {
  let cave = null;
  for (let ry = -6; ry <= 7 && !cave; ry++) {
    for (let rx = -6; rx <= 7 && !cave; rx++) {
      cave = getMacroRegionCave(SEED, rx, ry);
    }
  }
  assert.ok(cave !== null);

  const emptyCleared = new Set<string>();
  assert.equal(
    isPointInsideClearedCave(SEED, cave.gx + 0.5, cave.gy + 0.5, emptyCleared),
    false,
    'uncleared cave should not be blocked'
  );

  const cleared = new Set<string>([cave.id]);
  assert.equal(
    isPointInsideClearedCave(SEED, cave.gx + 0.5, cave.gy + 0.5, cleared),
    true,
    'cleared cave center must block spawns'
  );
  // Check mouth too
  const mouthX = cave.mouthDir === 'e' ? cave.gx + cave.chamberRadius + 1.2 : cave.gx + 0.5;
  const mouthY = cave.mouthDir === 's' ? cave.gy + cave.chamberRadius + 1.2 : cave.gy + 0.5;
  assert.equal(
    isPointInsideClearedCave(SEED, mouthX, mouthY, cleared),
    true,
    'cleared cave mouth must block spawns'
  );
  // Far outside the cave should remain allowed
  assert.equal(
    isPointInsideClearedCave(SEED, cave.gx + 16.5, cave.gy + 16.5, cleared),
    false,
    'points far outside cleared cave must remain spawnable'
  );
});

test('isometric caves have low SE cutaway terrain, exact lintel shelter bounds, and smooth East/South mouth floors', () => {
  clearTerrainCaches();
  let southCave = null;
  let eastCave = null;
  for (let ry = -8; ry <= 8 && (!southCave || !eastCave); ry++) {
    for (let rx = -8; rx <= 8 && (!southCave || !eastCave); rx++) {
      const c = getMacroRegionCave(SEED, rx, ry);
      if (!c) continue;
      if (c.mouthDir === 's' && !southCave) southCave = c;
      if (c.mouthDir === 'e' && !eastCave) eastCave = c;
    }
  }
  assert.ok(southCave !== null, 'expected a South-facing rocky cave');
  assert.ok(eastCave !== null, 'expected an East-facing rocky cave');

  for (const cave of [southCave, eastCave]) {
    const cx = cave.gx + 0.5;
    const cy = cave.gy + 0.5;

    // 1. Both East and South cave mouths must have smooth floor apron without a sudden cliff jump
    const m1x = cave.mouthDir === 'e' ? cx + 3.0 : cx;
    const m1y = cave.mouthDir === 's' ? cy + 3.0 : cy;
    const m2x = cave.mouthDir === 'e' ? cx + 4.4 : cx;
    const m2y = cave.mouthDir === 's' ? cy + 4.4 : cy;
    assert.ok(
      Math.abs(sampleTerrainHeight(SEED, m1x, m1y) - cave.floorY) < 0.2,
      `expected covered mouth floor near cave.floorY for ${cave.mouthDir}-cave`
    );
    assert.ok(
      !isTerrainStepBlocked(SEED, cx, cy, m1x, m1y),
      `expected walkable entry from interior to covered mouth for ${cave.mouthDir}-cave`
    );

    // 2. Exact shelter bounds: covered mouth inside lintel is sheltered, outer uncovered apron is NOT
    const insideShelter = getShelterInfo(SEED, m1x, m1y, null, false);
    assert.equal(insideShelter.sheltered, true);
    assert.equal(insideShelter.kind, 'cave');
    const outsideApron = getShelterInfo(SEED, m2x, m2y, null, false);
    assert.equal(outsideApron.sheltered, false, 'outer exposed cave apron past timber lintel must not be sheltered');

    // 3. Asymmetric isometric cave wall terrain: NW back cliff rises tall, SE foreground cutaway wall stays low
    const nwX = cx - 2.9;
    const nwY = cy - 2.9;
    const nwHit = findRockyCaveAt(SEED, nwX, nwY);
    assert.ok(nwHit && nwHit.inWallRing && !nwHit.isFrontCutawayWall);
    assert.ok(sampleTerrainHeight(SEED, nwX, nwY) >= cave.roofY - 0.25, 'NW back cliff massif should rise tall');

    const seX = cx + 2.9;
    const seY = cy + 2.9;
    const seHit = findRockyCaveAt(SEED, seX, seY);
    if (seHit && seHit.inWallRing) {
      assert.equal(seHit.isFrontCutawayWall, true);
      assert.ok(
        sampleTerrainHeight(SEED, seX, seY) <= cave.floorY + 0.7,
        'SE cutaway wall terrain should stay low for unobstructed isometric visibility'
      );
    }
  }
});

test('river bridges depress riverbed mesh height beneath elevated deck and block lateral guardrail exits', () => {
  clearTerrainCaches();
  let testedBridge = false;
  let testedTunnel = false;

  for (let y = -180; y <= 240 && (!testedBridge || !testedTunnel); y += 1) {
    for (let x = -180; x <= 240 && (!testedBridge || !testedTunnel); x += 1) {
      if (x >= 0 && x <= 64 && y >= 0 && y <= 64) continue;
      const wx = x + 0.5;
      const wy = y + 0.5;

      if (!testedBridge) {
        const b = sampleBridgeInfo(SEED, wx, wy);
        if (b.isBridge && b.bridgeHeight > 0.7) {
          const deckY = sampleTerrainHeight(SEED, wx, wy);
          const meshY = sampleTerrainMeshHeight(SEED, wx, wy);
          if (meshY < -0.1) {
            assert.ok(deckY > 0.6, `bridge deck should be elevated (${deckY})`);
            assert.ok(meshY < 0, `riverbed mesh under bridge should stay depressed below water (${meshY})`);

            // Find bridge edge bordering non-bridge tile laterally
            const sideX = b.axis === 'ew' ? wx : wx + 2.0;
            const sideY = b.axis === 'ew' ? wy + 2.0 : wy;
            if (!sampleBridgeInfo(SEED, sideX, sideY).isBridge) {
              assert.equal(
                isTerrainStepBlocked(SEED, wx, wy, sideX, sideY),
                true,
                'lateral step off elevated bridge over guardrail must be blocked'
              );
              testedBridge = true;
            }
          }
        }
      }

      if (!testedTunnel) {
        const t = sampleRoadTunnelInfo(SEED, wx, wy);
        if (t.isTunnel && !t.isPortal) {
          // Probe lateral tunnel side wall
          const sideGx = t.axis === 'ew' ? x : x + 1;
          const sideGy = t.axis === 'ew' ? y + 1 : y;
          if (!sampleRoadTunnelInfo(SEED, sideGx + 0.5, sideGy + 0.5).isTunnel) {
            assert.equal(
              isTunnelSideWallTile(SEED, sideGx, sideGy),
              true,
              'tile immediately flanking a tunnel road must register as a solid tunnel side wall'
            );
            assert.equal(
              isTerrainStepBlocked(SEED, wx, wy, sideGx + 0.5, sideGy + 0.5),
              true,
              'lateral movement through tunnel side wall must be blocked'
            );
            testedTunnel = true;
          }
        }
      }
    }
  }

  assert.ok(testedBridge, 'expected to verify an elevated river bridge over water');
  assert.ok(testedTunnel, 'expected to verify a road tunnel side wall');
});

