import assert from 'node:assert/strict';
import test from 'node:test';
import {
  CHILLED_TEMP_THRESHOLD_C,
  FREEZING_TEMP_THRESHOLD_C,
  NORMAL_BODY_TEMP_C,
  applyConsumableWarmth,
  sampleWeatherAt,
  tickThermalSurvival,
} from './weatherSystem';
import { createInitialInventory, createInitialPlayer, useConsumableItem } from './survivalLogic';

const SEED = 1994;

test('regional biomes produce distinct weather & ambient temperatures (pine/river cooler & damper than scorched barrens)', () => {
  const forest = sampleWeatherAt(SEED, 120, 40, 0, 720, 'pine_forest', 2.0);
  const valley = sampleWeatherAt(SEED, 120, 40, 0, 720, 'river_valley', 0.2);
  const barrens = sampleWeatherAt(SEED, 120, 40, 0, 720, 'scorched_barrens', 0.2);

  assert.ok(forest.ambientTempC < barrens.ambientTempC, 'pine forest highlands should be cooler than barrens');
  assert.ok(valley.ambientTempC < barrens.ambientTempC, 'river valley should be cooler than barrens');

  const forcedStorm = sampleWeatherAt(SEED, 28, 28, 12.95, 720, 'town_edge', 0, 'storm');
  assert.equal(forcedStorm.kind, 'storm');
  assert.equal(forcedStorm.label, 'RAINSTORM');
  assert.ok(forcedStorm.rainIntensity > 0.8);
  assert.ok(forcedStorm.fogIntensity > 0.5);
  assert.ok(forcedStorm.lightningFlash > 0);
});

test('getting caught in a cold rainstorm soaks clothes, chills and slows survivor, then freezes & drains HP', () => {
  const storm = sampleWeatherAt(SEED, 120, 120, 10, 1320, 'pine_forest', 2.5, 'storm');
  let wetness = 0;
  let bodyTemp = NORMAL_BODY_TEMP_C;
  let warmBuffTimer = 0;

  let reachedChilled = false;
  let reachedFreezing = false;

  for (let i = 0; i < 160; i++) {
    const res = tickThermalSurvival({
      wetness,
      bodyTemp,
      warmBuffTimer,
      dt: 0.25,
      weather: storm,
      sheltered: false,
      nearHeatSource: false,
      inWater: false,
    });
    wetness = res.wetness;
    bodyTemp = res.bodyTemp;
    warmBuffTimer = res.warmBuffTimer;

    if (res.thermalStatus === 'chilled') {
      reachedChilled = true;
      assert.ok(res.speedMultiplier < 1.0, 'chilled shivering must slow movement');
      assert.equal(res.hpDrainPerSec, 0, 'chilled alone should not drain HP');
    }
    if (res.thermalStatus === 'freezing') {
      reachedFreezing = true;
      assert.ok(res.speedMultiplier < 0.85, 'freezing must noticeably slow movement');
      assert.ok(res.hpDrainPerSec > 0, 'freezing must drain HP');
    }
  }

  assert.ok(wetness >= 90, `expected soaked clothes >= 90%, got ${wetness}`);
  assert.ok(bodyTemp < FREEZING_TEMP_THRESHOLD_C, `expected freezing temp, got ${bodyTemp}`);
  assert.ok(reachedChilled, 'expected chilled state before freezing');
  assert.ok(reachedFreezing, 'expected freezing state after prolonged storm exposure');
});

test('dry cave shelter stops rain soaking and campfires rapidly dry and warm the survivor', () => {
  const storm = sampleWeatherAt(SEED, 120, 120, 10, 1320, 'pine_forest', 2.0, 'storm');

  // Sheltered inside cave without campfire stops getting wetter and dries out slowly
  let wetness = 80;
  let bodyTemp = 34.8;
  for (let i = 0; i < 40; i++) {
    const res = tickThermalSurvival({
      wetness,
      bodyTemp,
      warmBuffTimer: 0,
      dt: 0.25,
      weather: storm,
      sheltered: true,
      nearHeatSource: false,
      inWater: false,
    });
    wetness = res.wetness;
    bodyTemp = res.bodyTemp;
  }
  assert.ok(wetness < 50, `expected cave shelter to dry clothes below 50%, got ${wetness}`);

  // Standing by a campfire dries clothes fast and warms bodyTemp above chilled threshold
  let fireWet = 95;
  let fireTemp = 33.8;
  for (let i = 0; i < 32; i++) {
    const res = tickThermalSurvival({
      wetness: fireWet,
      bodyTemp: fireTemp,
      warmBuffTimer: 0,
      dt: 0.25,
      weather: storm,
      sheltered: false,
      nearHeatSource: true,
      inWater: false,
    });
    fireWet = res.wetness;
    fireTemp = res.bodyTemp;
  }
  assert.ok(fireWet < 5, `expected campfire to dry clothes rapidly, got ${fireWet}`);
  assert.ok(fireTemp > CHILLED_TEMP_THRESHOLD_C, `expected campfire to warm survivor above chilled, got ${fireTemp}`);
});

test('hot rations and fish stew immediately restore warmth, grant insulation buff, and can be eaten when cold even if hunger is full', () => {
  const warmed = applyConsumableWarmth('hot_rations', 34.5, 0, 50);
  assert.ok(warmed.bodyTemp > 36.0);
  assert.equal(warmed.warmBuffTimer, 60);
  assert.ok(warmed.wetness < 50);

  const player = createInitialPlayer();
  player.hunger = 100;
  player.hp = 100;
  player.bodyTemp = 34.5;
  player.wetness = 60;
  const inv = { ...createInitialInventory(), hot_rations: 1 };

  const res = useConsumableItem(player, inv, 'hot_rations');
  assert.equal(res.used, true, 'chilled survivor should be able to eat hot rations even at full hunger');
  assert.equal(res.inventory.hot_rations, 0);
  assert.ok(res.player.bodyTemp >= 36.0, `expected bodyTemp >= 36.0 after hot rations, got ${res.player.bodyTemp}`);
  assert.ok(res.player.warmBuffTimer >= 60, 'expected warm insulation buff timer');
});

test('heated vehicle cabin dries clothes and gently recovers hypothermia during a storm', () => {
  const storm = sampleWeatherAt(SEED, 120, 120, 10, 1320, 'pine_forest', 2.0, 'storm');
  let wetness = 85;
  let bodyTemp = 34.4;
  for (let i = 0; i < 40; i++) {
    const res = tickThermalSurvival({
      wetness,
      bodyTemp,
      warmBuffTimer: 0,
      dt: 0.25,
      weather: storm,
      sheltered: true,
      nearHeatSource: false,
      inWater: false,
      inHeatedCabin: true,
    });
    wetness = res.wetness;
    bodyTemp = res.bodyTemp;
  }
  assert.ok(wetness < 15, `expected heated cabin to dry soaked clothes below 15%, got ${wetness}`);
  assert.ok(bodyTemp > 36.0, `expected heated cabin to warm chilled survivor above 36°C, got ${bodyTemp}`);
});

