import assert from 'node:assert/strict';
import test from 'node:test';
import {
  CUBE_FACES,
  CUBE_FACE_CHUNKS,
  CUBE_FACE_MAX_CHUNK,
  CUBE_FACE_MIN_CHUNK,
  CUBE_FACE_SIZE,
  PLANET_CIRCUMFERENCE_TILES,
  TOTAL_PLANET_CHUNKS,
  cubeChunkKey,
  cubeFaceToSphere,
  fbm3D,
  greatCircleDistanceTiles,
  parseCubeChunkKey,
  resolveCubeSphereCoord,
  resolveCubeSphereTile,
  rotateVectorQuarterTurns,
  samplePlanetTelemetry,
  sphereToCubeFace,
  type CubeFaceId,
} from './cubeSphere';
import { generateChunk, generateWorld, getWorldCell } from './survivalLogic';
import { sampleRawHillHeight, sampleTerrainHeight } from './terrainSystem';
import { sampleBiomeAt } from './worldGen';

test('Cube-Sphere defines a strictly finite 6-face planet (24,576 chunks, 4,096-tile circumference)', () => {
  assert.equal(CUBE_FACES.length, 6);
  assert.equal(CUBE_FACE_CHUNKS, 64);
  assert.equal(CUBE_FACE_SIZE, 1024);
  assert.equal(TOTAL_PLANET_CHUNKS, 24576);
  assert.equal(PLANET_CIRCUMFERENCE_TILES, 4096);

  // Chunk key round-trip across all 6 faces
  for (const face of [0, 1, 2, 3, 4, 5] as CubeFaceId[]) {
    const key = cubeChunkKey(face, -30, 33);
    const parsed = parseCubeChunkKey(key);
    assert.deepEqual(parsed, { face, cx: -30, cy: 33 });
  }
});

test('all 4 cardinal 4,096-tile circumnavigations return to exact starting tile and heading', () => {
  const dirs: Array<{ name: string; dx: number; dy: number }> = [
    { name: 'East', dx: 1, dy: 0 },
    { name: 'West', dx: -1, dy: 0 },
    { name: 'South', dx: 0, dy: 1 },
    { name: 'North', dx: 0, dy: -1 },
  ];

  for (const { name, dx, dy } of dirs) {
    let face: CubeFaceId = 0;
    let x = 28.5;
    let y = 28.5;
    let vx = dx;
    let vy = dy;
    const visitedFaces = new Set<CubeFaceId>();

    for (let step = 0; step < PLANET_CIRCUMFERENCE_TILES; step++) {
      visitedFaces.add(face);
      const next = resolveCubeSphereCoord(face, x + vx, y + vy);
      face = next.face;
      x = next.gx;
      y = next.gy;
      const rv = rotateVectorQuarterTurns(vx, vy, next.rotQuarterTurns);
      vx = rv.x;
      vy = rv.y;
    }

    assert.equal(face, 0, `${name} circumnavigation should return to Face 0`);
    assert.ok(Math.abs(x - 28.5) < 1e-6, `${name} x mismatch: ${x}`);
    assert.ok(Math.abs(y - 28.5) < 1e-6, `${name} y mismatch: ${y}`);
    assert.equal(vx, dx, `${name} heading vx mismatch`);
    assert.equal(vy, dy, `${name} heading vy mismatch`);
    assert.equal(visitedFaces.size, 4, `${name} great circle should traverse 4 faces`);
  }
});

test('all 24 directed cube-edge crossings are exact involutions and round-trip on the unit sphere', () => {
  for (const face of [0, 1, 2, 3, 4, 5] as CubeFaceId[]) {
    const probes: Array<[number, number, number, number]> = [
      [543.5, 17.5, 1, 0],
      [-479.5, 42.5, -1, 0],
      [17.5, 543.5, 0, 1],
      [42.5, -479.5, 0, -1],
    ];

    for (const [x0, y0, dx, dy] of probes) {
      const p0 = cubeFaceToSphere(face, x0, y0);
      assert.ok(Math.abs(Math.hypot(p0.x, p0.y, p0.z) - 1) < 1e-9, 'sphere point must be unit length');

      const back = sphereToCubeFace(p0);
      assert.equal(back.face, face);
      assert.ok(Math.abs(back.gx - x0) < 0.05 && Math.abs(back.gy - y0) < 0.05);

      const step1 = resolveCubeSphereCoord(face, x0 + dx, y0 + dy);
      assert.equal(step1.crossedEdge, true);
      assert.notEqual(step1.face, face);

      const backDir = rotateVectorQuarterTurns(-dx, -dy, step1.rotQuarterTurns);
      const step2 = resolveCubeSphereCoord(step1.face, step1.gx + backDir.x, step1.gy + backDir.y);
      assert.equal(step2.face, face);
      assert.ok(Math.abs(step2.gx - x0) < 1e-6 && Math.abs(step2.gy - y0) < 1e-6);
    }
  }
});

test('3D spherical noise and terrain elevation are continuous across cube-face seams', () => {
  const seed = 1994;
  for (const face of [0, 1, 2, 3, 4, 5] as CubeFaceId[]) {
    // Probe across the East edge of every face
    const leftX = 543.95;
    const y = 32.5;
    const rightResolved = resolveCubeSphereCoord(face, 544.05, y);

    const pLeft = cubeFaceToSphere(face, leftX, y);
    const pRight = cubeFaceToSphere(rightResolved.face, rightResolved.gx, rightResolved.gy);
    const nLeft = fbm3D(seed, pLeft.x * 3, pLeft.y * 3, pLeft.z * 3, 3);
    const nRight = fbm3D(seed, pRight.x * 3, pRight.y * 3, pRight.z * 3, 3);
    assert.ok(Math.abs(nLeft - nRight) < 0.02, `3D noise seam jump on face ${face}: ${nLeft} vs ${nRight}`);

    const hLeft = sampleRawHillHeight(seed, leftX, y, face);
    const hRight = sampleRawHillHeight(seed, rightResolved.gx, rightResolved.gy, rightResolved.face);
    assert.ok(Math.abs(hLeft - hRight) < 0.25, `Terrain height seam jump on face ${face}: ${hLeft} vs ${hRight}`);
  }
});

test('world generation wraps out-of-face coordinates onto finite Cube-Sphere chunks and preserves starter town', () => {
  const world = generateWorld(1994);
  assert.equal(world.worldStore.activeFace, 0);

  // Starter town on Face 0 remains flat
  assert.equal(sampleTerrainHeight(1994, 28.5, 28.5, 0), 0);
  assert.equal(sampleBiomeAt(1994, 28, 28, 0), 'town_edge');

  // Antipode (Face 5, Dead Caldera) is at ~180 deg great-circle distance and has high threat telemetry
  const antipodeDist = greatCircleDistanceTiles(0, 32, 32, 5, 32, 32);
  assert.ok(antipodeDist > 2000 && antipodeDist < 2100, `expected antipode geodesic ~2048 tiles, got ${antipodeDist}`);
  const telAntipode = samplePlanetTelemetry(5, 32, 32);
  assert.equal(telAntipode.faceCode, 'CALDERA');
  assert.ok(telAntipode.threatFactor > 0.95);

  // Sampling far outside Face 0 resolves cleanly to canonical finite face chunks without creating infinite keys
  const farEast = resolveCubeSphereTile(0, 620, 32);
  assert.equal(farEast.face, 1); // Whispering Timberlands (+X)
  const cell = getWorldCell(world.worldStore, 620, 32, 0);
  assert.ok(cell.tile.length > 0);

  // Generating chunks beyond face boundaries always stays within [-4..7] on valid faces 0..5
  const nextId = { nextId: 500 };
  const spawned = generateChunk(world.worldStore, 40, 0, nextId, 0);
  assert.ok(spawned.chunk.cx >= CUBE_FACE_MIN_CHUNK && spawned.chunk.cx <= CUBE_FACE_MAX_CHUNK);
  assert.ok(spawned.chunk.cy >= CUBE_FACE_MIN_CHUNK && spawned.chunk.cy <= CUBE_FACE_MAX_CHUNK);
  assert.ok(world.worldStore.chunks.size <= TOTAL_PLANET_CHUNKS);
});
