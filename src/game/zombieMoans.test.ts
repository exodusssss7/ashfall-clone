import test from 'node:test';
import assert from 'node:assert/strict';
import { soundEngine } from './sound';

// Exercise the public vocal cue with a minimal running Web Audio context.
const engine = soundEngine as any;
function setup() {
  const played: string[] = [];
  const stopped: string[] = [];
  const ctx = {
    currentTime: 100, state: 'running',
    createBufferSource: () => {
      const source = { buffer: null as any, playbackRate: { value: 1 },
        connect() {}, disconnect() {},
        start() { played.push(source.buffer.name); },
        stop() { stopped.push(source.buffer.name); } };
      return source;
    },
    createGain: () => ({ gain: { value: 0 }, connect() {}, disconnect() {} }),
  };
  Object.assign(engine, { ctx, dryGain: {}, muted: false, lastGroanTime: -10,
    lastZombieHurtTime: -10, voices: new Set(), lastVariants: new Map(),
    buffers: new Map(['zmoan0','zmoan1','zmoan2','zhurt0','zhurt1','zhurt2',
      'zombiedie0','zombiedie1','groan1','groan2','groan3','groan4'].map(name => [name, {name}])) });
  Object.defineProperty(globalThis, 'document', { configurable: true, value: { hidden: false } });
  return { ctx, played, stopped };
}
test('selected B bank plays and never repeats a consecutive variant', () => {
  const {ctx, played} = setup();
  for (let i=0;i<20;i++) { ctx.currentTime += 3; soundEngine.playZombieGroan('walker'); }
  assert.equal(played.length,20);
  assert.ok(played.every(name => /^zmoan[0-2]$/.test(name)));
  assert.ok(played.slice(1).every((name,i) => name !== played[i]));
});
test('global groan cooldown prevents overlapping horde spam', () => {
  const {ctx, played}=setup();
  soundEngine.playZombieGroan('walker');
  ctx.currentTime+=1; soundEngine.playZombieGroan('runner');
  ctx.currentTime+=1.3; soundEngine.playZombieGroan('bloater');
  assert.equal(played.length,2);
});
test('muted, hidden or suspended audio cannot emit a zombie voice', () => {
  for (const condition of ['muted','hidden','suspended']) {
    const {played}=setup();
    if (condition==='muted') engine.muted=true;
    if (condition==='hidden') (globalThis.document as any).hidden=true;
    if (condition==='suspended') engine.ctx.state='suspended';
    soundEngine.playZombieGroan('spitter'); assert.equal(played.length,0);
  }
});
test('hurt and death retain their separate original banks', () => {
  const {played}=setup();
  soundEngine.playZombieHurt('walker'); soundEngine.playZombieDeath('runner');
  assert.match(played[0],/^zhurt[0-2]$/);
  assert.match(played[1],/^zombiedie[0-1]$/);
  assert.match(played[2],/^groan[1-4]$/);
});
test('missing selected asset is safely silent', () => {
  const {played}=setup(); engine.buffers.clear();
  assert.doesNotThrow(() => soundEngine.playZombieGroan('walker'));
  assert.equal(played.length,0);
});
