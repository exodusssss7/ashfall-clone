import assert from 'node:assert/strict';
import test from 'node:test';
import {
  decodeExploredChunks,
  encodeExploredChunks,
  getRunSaveMeta,
  isValidSnapshot,
  parseRunSnapshot,
  SAVE_KEY,
  SAVE_VERSION,
  storeRunSnapshot,
  loadRunSnapshot,
  clearRunSnapshot,
  type RunSnapshot,
} from './saveGame';
import { generateChunk, generateWorld } from './survivalLogic';
import type { WorldChunk, WorldStore } from './types';

function makeChunk(store: WorldStore, cx: number, cy: number): WorldChunk {
  generateChunk(store, cx, cy, { nextId: 1 });
  const chunk = store.chunks.get(`${cx},${cy}`);
  assert.ok(chunk, `chunk ${cx},${cy} generated`);
  return chunk;
}

function exploredCount(chunk: WorldChunk): number {
  let n = 0;
  for (const row of chunk.cells) for (const cell of row) if (cell.explored) n++;
  return n;
}

test('explored fog codec round-trips the explored bits of every chunk', () => {
  const { worldStore } = generateWorld(1994);
  const chunks = worldStore.chunks;
  const a = makeChunk(worldStore, 0, 0);
  const b = makeChunk(worldStore, -3, 7);
  // Mark a scattered pattern of cells explored.
  a.cells[0][0].explored = true;
  a.cells[5][9].explored = true;
  a.cells[15][15].explored = true;
  b.cells[3][4].explored = true;
  chunks.set(a.key, a);
  chunks.set(b.key, b);

  const encoded = encodeExploredChunks(chunks);
  assert.equal(encoded.length, 2);
  for (const entry of encoded) {
    assert.equal(entry.bits.length, 64);
    assert.match(entry.bits, /^[0-9a-f]+$/);
  }

  // Fresh copies start unexplored; decoding restores exactly the same cells.
  const { worldStore: freshStore } = generateWorld(1994);
  const fresh = freshStore.chunks;
  const fa = makeChunk(freshStore, 0, 0);
  const fb = makeChunk(freshStore, -3, 7);
  assert.equal(exploredCount(fa), 0);
  decodeExploredChunks(fresh, encoded);
  const ra = fresh.get(a.key)!;
  const rb = fresh.get(b.key)!;
  assert.equal(exploredCount(ra), 3);
  assert.equal(exploredCount(rb), 1);
  assert.equal(ra.cells[0][0].explored, true);
  assert.equal(ra.cells[5][9].explored, true);
  assert.equal(ra.cells[15][15].explored, true);
  assert.equal(ra.cells[5][10].explored, false);
  assert.equal(rb.cells[3][4].explored, true);
});

test('explored fog codec skips chunks that are not loaded and ignores junk bits', () => {
  const { worldStore } = generateWorld(1994);
  const chunks = worldStore.chunks;
  const a = makeChunk(worldStore, 1, 1);
  decodeExploredChunks(chunks, [
    { key: '999,999', bits: 'f'.repeat(64) },
    { key: a.key, bits: 'zzz' },
  ]);
  assert.equal(exploredCount(a), 0);
});

function minimalSnapshot(): RunSnapshot {
  return {
    version: SAVE_VERSION,
    savedAt: 1731700000000,
    hardcore: false,
    playerName: 'Ash',
    day: 2,
    timeMinutes: 690,
    timeLabel: '11:30',
    kills: 5,
    score: 120,
    restCooldownSeconds: 0,
    player: { x: 10, y: 12, hp: 80 } as RunSnapshot['player'],
    inventory: {} as RunSnapshot['inventory'],
    activeVehicleId: null,
    nextVehicleId: 3,
    nextEntityId: 40,
    nextPickupToastId: 2,
    scoredLootSources: [],
    populatedChunks: ['0,0'],
    landmarks: [],
    containers: [],
    structures: [],
    vehicles: [],
    doors: [],
    zombies: [],
    explored: [],
  };
}

test('snapshot validation accepts a well-formed run and rejects corrupt or foreign saves', () => {
  assert.equal(isValidSnapshot(minimalSnapshot()), true);
  assert.equal(isValidSnapshot(null), false);
  assert.equal(isValidSnapshot('save'), false);
  assert.equal(isValidSnapshot({ ...minimalSnapshot(), version: 99 }), false);
  assert.equal(isValidSnapshot({ ...minimalSnapshot(), player: { x: 'oops' } }), false);
  assert.equal(isValidSnapshot({ ...minimalSnapshot(), zombies: {} }), false);
  const missing = minimalSnapshot() as unknown as Record<string, unknown>;
  delete missing.explored;
  assert.equal(isValidSnapshot(missing), false);
});

test('parseRunSnapshot returns null for garbage JSON and invalid payloads', () => {
  assert.equal(parseRunSnapshot(null), null);
  assert.equal(parseRunSnapshot(''), null);
  assert.equal(parseRunSnapshot('{not json'), null);
  assert.equal(parseRunSnapshot(JSON.stringify({ hello: 'world' })), null);
  const good = parseRunSnapshot(JSON.stringify(minimalSnapshot()));
  assert.equal(good?.day, 2);
  assert.equal(good?.playerName, 'Ash');
});

test('run save storage round-trips and reports menu metadata', () => {
  const store = new Map<string, string>();
  (globalThis as { localStorage?: Storage }).localStorage = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
    clear: () => store.clear(),
    key: () => null,
    get length() {
      return store.size;
    },
  } as Storage;
  try {
    clearRunSnapshot();
    assert.equal(loadRunSnapshot(), null);
    assert.equal(getRunSaveMeta(), null);

    const save = minimalSnapshot();
    save.hardcore = true;
    save.playerName = 'Rook';
    storeRunSnapshot(save);
    assert.ok(store.has(SAVE_KEY));

    const loaded = loadRunSnapshot();
    assert.equal(loaded?.hardcore, true);
    assert.equal(loaded?.playerName, 'Rook');
    const meta = getRunSaveMeta();
    assert.deepEqual(meta, {
      day: 2,
      timeLabel: '11:30',
      hardcore: true,
      playerName: 'Rook',
      savedAt: 1731700000000,
    });

    clearRunSnapshot();
    assert.equal(getRunSaveMeta(), null);
  } finally {
    delete (globalThis as { localStorage?: Storage }).localStorage;
  }
});
