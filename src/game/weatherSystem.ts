import { clamp } from './isometric';
import { getDaylightInfo } from './survivalLogic';
import type { BiomeKind, ConsumableItemId, ThermalStatus, WeatherKind, WeatherSnapshot } from './types';
import { fbm2D } from './worldGen';

export const NORMAL_BODY_TEMP_C = 37.0;
export const CHILLED_TEMP_THRESHOLD_C = 35.8;
export const FREEZING_TEMP_THRESHOLD_C = 34.2;
export const MIN_BODY_TEMP_C = 32.0;
export const MAX_BODY_TEMP_C = 37.6;

/**
 * Samples regional weather & fog at world position (wx, wy) and simulation clock.
 * Different regions (pine forests, river valleys, highlands, scorched barrens) have
 * distinct rainstorm and fog climates combined with slow drifting weather fronts.
 */
export function sampleWeatherAt(
  seed: number,
  wx: number,
  wy: number,
  elapsedSeconds: number,
  timeMinutes: number,
  biome: BiomeKind,
  elevation: number,
  forcedWeather?: WeatherKind | null
): WeatherSnapshot {
  const { darkness, phaseLabel } = getDaylightInfo(timeMinutes);
  const nightT = clamp((darkness - 0.08) / 0.7, 0, 1);

  // Slow drifting regional weather fronts (~0.008 spatial scale, drifts gently over time)
  const driftX = elapsedSeconds * 0.0022;
  const driftY = elapsedSeconds * 0.0014;
  const stormFront = fbm2D(seed + 6101, wx * 0.0085 + driftX, wy * 0.0085 + driftY, 3);
  const fogFront = fbm2D(seed + 7207, wx * 0.011 - driftY * 0.8, wy * 0.011 + driftX * 0.6, 3);

  // Biome & elevation affinities
  let rainBias = 0;
  let fogBias = 0;
  let baseDayTempC = 17.5;

  switch (biome) {
    case 'pine_forest':
      rainBias = 0.14;
      fogBias = 0.08;
      baseDayTempC = 13.5;
      break;
    case 'river_valley':
      rainBias = 0.11;
      fogBias = 0.22;
      baseDayTempC = 14.0;
      break;
    case 'scorched_barrens':
      rainBias = -0.20;
      fogBias = -0.14;
      baseDayTempC = 22.0;
      break;
    case 'rural_meadow':
      rainBias = 0.04;
      fogBias = 0.05;
      baseDayTempC = 16.5;
      break;
    case 'town_edge':
    default:
      rainBias = -0.03;
      fogBias = 0.0;
      baseDayTempC = 17.5;
      break;
  }

  // High ground is cooler and catches mist/squalls more readily
  const elevCoolC = Math.max(0, elevation) * 1.45;
  rainBias += clamp((elevation - 1.2) * 0.04, 0, 0.10);
  fogBias += clamp((elevation - 1.5) * 0.05, 0, 0.14);

  // Dawn and night bring cooler temperatures and valley mist
  const dawnMist = phaseLabel === 'DAWN' ? 0.14 : 0;
  const nightCoolC = nightT * 7.5;

  const rainScore = clamp(stormFront + rainBias, 0, 1);
  const fogScore = clamp(fogFront + fogBias + dawnMist, 0, 1);

  let kind: WeatherKind = 'clear';
  let rainIntensity = 0;
  let fogIntensity = 0;
  let windStrength = 0.15;

  if (forcedWeather) {
    kind = forcedWeather;
    if (kind === 'storm') {
      rainIntensity = 0.92;
      fogIntensity = 0.72;
      windStrength = 0.95;
    } else if (kind === 'rain') {
      rainIntensity = 0.55;
      fogIntensity = 0.42;
      windStrength = 0.55;
    } else if (kind === 'fog') {
      rainIntensity = 0;
      fogIntensity = 0.85;
      windStrength = 0.22;
    } else {
      rainIntensity = 0;
      fogIntensity = 0.05;
      windStrength = 0.14;
    }
  } else {
    if (rainScore >= 0.67) {
      kind = 'storm';
      rainIntensity = clamp(0.68 + ((rainScore - 0.67) / 0.33) * 0.32, 0.68, 1.0);
      fogIntensity = clamp(0.45 + fogScore * 0.42, 0.45, 0.88);
      windStrength = clamp(0.72 + (rainIntensity - 0.68) * 0.85, 0.72, 1.0);
    } else if (rainScore >= 0.55) {
      kind = 'rain';
      rainIntensity = clamp(0.28 + ((rainScore - 0.55) / 0.12) * 0.40, 0.28, 0.68);
      fogIntensity = clamp(0.22 + fogScore * 0.35, 0.22, 0.62);
      windStrength = clamp(0.35 + rainIntensity * 0.45, 0.35, 0.72);
    } else if (fogScore >= 0.62) {
      kind = 'fog';
      rainIntensity = 0;
      fogIntensity = clamp(0.55 + ((fogScore - 0.62) / 0.38) * 0.45, 0.55, 1.0);
      windStrength = 0.2;
    } else {
      kind = 'clear';
      rainIntensity = 0;
      fogIntensity = clamp((fogScore - 0.45) * 0.4, 0, 0.18);
      windStrength = 0.16;
    }
  }

  const rainCoolC = rainIntensity * 6.5 + fogIntensity * 1.8;
  const ambientTempC = Math.round((baseDayTempC - nightCoolC - elevCoolC - rainCoolC) * 10) / 10;

  // Periodic subtle lightning flash during heavy rainstorms
  let lightningFlash = 0;
  if (kind === 'storm' && rainIntensity >= 0.75) {
    const cycle = elapsedSeconds % 13.7;
    if (cycle > 12.85 && cycle < 13.12) {
      lightningFlash = Math.sin(((cycle - 12.85) / 0.27) * Math.PI) * 0.85;
    } else if (cycle > 13.18 && cycle < 13.34) {
      lightningFlash = Math.sin(((cycle - 13.18) / 0.16) * Math.PI) * 0.55;
    }
  }

  const label =
    kind === 'storm'
      ? 'RAINSTORM'
      : kind === 'rain'
        ? 'COLD RAIN'
        : kind === 'fog'
          ? 'DENSE FOG'
          : 'CLEAR';

  return {
    kind,
    label,
    rainIntensity,
    fogIntensity,
    windStrength,
    ambientTempC,
    lightningFlash,
  };
}

export interface ThermalTickInput {
  wetness: number;
  bodyTemp: number;
  warmBuffTimer: number;
  dt: number;
  weather: WeatherSnapshot;
  sheltered: boolean;
  nearHeatSource: boolean;
  inWater: boolean;
  inHeatedCabin?: boolean;
}

export interface ThermalTickResult {
  wetness: number;
  bodyTemp: number;
  warmBuffTimer: number;
  thermalStatus: ThermalStatus;
  speedMultiplier: number;
  hpDrainPerSec: number;
}

export function classifyThermalStatus(bodyTemp: number, warmBuffTimer: number): ThermalStatus {
  if (bodyTemp < FREEZING_TEMP_THRESHOLD_C) return 'freezing';
  if (bodyTemp < CHILLED_TEMP_THRESHOLD_C) return 'chilled';
  if (warmBuffTimer > 0.5 || bodyTemp >= 37.15) return 'warmed';
  return 'normal';
}

/**
 * Balanced rain/cold survival tick:
 * - Exposure to rain or wading in water soaks clothes (wetness -> 100%).
 * - Wetness + cold rain/night/highland air drops bodyTemp.
 * - Sheltering in a cave, road tunnel, or building stops rain soak and stabilizes body heat.
 * - Campfires, burn barrels, and stoves rapidly dry clothes and restore normal body temperature.
 * - Shivering (< 35.8°C) slows movement (-12%); Freezing (< 34.2°C) slows (-22%) and drains HP (1.2/s).
 */
export function tickThermalSurvival(input: ThermalTickInput): ThermalTickResult {
  const { dt, weather, sheltered, nearHeatSource, inWater, inHeatedCabin = false } = input;
  let wetness = clamp(input.wetness, 0, 100);
  let bodyTemp = clamp(input.bodyTemp, MIN_BODY_TEMP_C, MAX_BODY_TEMP_C);
  const warmBuffTimer = Math.max(0, input.warmBuffTimer - dt);

  // 1. Clothing wetness update
  if (inWater) {
    wetness = clamp(wetness + dt * 24, 0, 100);
  } else if (nearHeatSource) {
    // Campfires, stoves, and burn barrels actively dry clothes even during outdoor rain
    const heatDryRate = sheltered ? 26.0 : 16.0;
    wetness = clamp(wetness - dt * heatDryRate, 0, 100);
  } else if (!sheltered && weather.rainIntensity > 0.05) {
    // Caught outdoors in rain: soaks clothes noticeably over ~7–14 seconds
    const soakRate = 4.5 + weather.rainIntensity * 12.5;
    wetness = clamp(wetness + dt * soakRate, 0, 100);
  } else {
    // Drying out: heated cabins dry faster; dry caves/buildings dry steadily; clear air dries slowly
    const dryRate = inHeatedCabin ? 8.5 : sheltered ? 4.6 : 2.6;
    wetness = clamp(wetness - dt * dryRate, 0, 100);
  }

  // 2. Body temperature update
  const wetFactor = wetness / 100;
  if (nearHeatSource) {
    // Active campfire/stove/burn barrel warms quickly back up to 37.2°C
    const warmTarget = 37.2;
    const warmRate = sheltered ? 0.72 : 0.52;
    bodyTemp += clamp(warmTarget - bodyTemp, -0.15 * dt, warmRate * dt);
  } else {
    // Compute equilibrium target body temp based on ambient cold, rain, wind, wetness, and shelter
    const coldSeverity = clamp((13.5 - weather.ambientTempC) / 15.0, 0, 1.3);
    const rainChill = !sheltered ? weather.rainIntensity * 0.95 : 0;
    const wetChill = wetFactor * (inHeatedCabin ? 0.65 : sheltered ? 1.1 : 2.45);
    const windChill = !sheltered ? weather.windStrength * 0.45 : 0;

    let targetTemp = NORMAL_BODY_TEMP_C - (coldSeverity * (sheltered ? 0.55 : 1.55) + rainChill + wetChill + windChill);
    if (inHeatedCabin) {
      targetTemp = Math.max(targetTemp, 36.6);
    } else if (sheltered && wetFactor < 0.25) {
      // Dry shelter keeps survivor from freezing even on cold nights
      targetTemp = Math.max(targetTemp, 36.2);
    }
    if (warmBuffTimer > 0) {
      // Hot rations / stew provide meaningful thermal insulation while traveling in rain
      targetTemp = Math.max(targetTemp + 1.4, 36.1);
    }
    targetTemp = clamp(targetTemp, MIN_BODY_TEMP_C + 0.6, NORMAL_BODY_TEMP_C);

    if (targetTemp < bodyTemp) {
      // Cooling rate scales with wetness & storm severity; slowed by Warmed buff
      const baseCoolRate = 0.06 + wetFactor * 0.16 + (!sheltered ? weather.rainIntensity * 0.10 : 0);
      const effectiveCoolRate = warmBuffTimer > 0 ? baseCoolRate * 0.35 : baseCoolRate;
      bodyTemp = Math.max(targetTemp, bodyTemp - effectiveCoolRate * dt);
    } else {
      // Gentle natural recovery when dry & warm
      const recoverRate = inHeatedCabin ? 0.28 : sheltered ? 0.18 : 0.10;
      bodyTemp = Math.min(targetTemp, bodyTemp + recoverRate * dt);
    }
  }

  bodyTemp = clamp(bodyTemp, MIN_BODY_TEMP_C, MAX_BODY_TEMP_C);
  const thermalStatus = classifyThermalStatus(bodyTemp, warmBuffTimer);

  // 3. Balanced penalties
  let speedMultiplier = 1.0;
  let hpDrainPerSec = 0;
  if (thermalStatus === 'freezing') {
    speedMultiplier = 0.78;
    hpDrainPerSec = 1.2;
  } else if (thermalStatus === 'chilled') {
    speedMultiplier = 0.88;
    hpDrainPerSec = 0;
  }

  return {
    wetness,
    bodyTemp,
    warmBuffTimer,
    thermalStatus,
    speedMultiplier,
    hpDrainPerSec,
  };
}

/**
 * Applies immediate warmth + thermal insulation buff when eating hot cooked meals.
 */
export function applyConsumableWarmth(
  item: ConsumableItemId,
  bodyTemp: number,
  warmBuffTimer: number,
  wetness: number
): { bodyTemp: number; warmBuffTimer: number; wetness: number; warmedText: string | null } {
  if (item === 'hot_rations') {
    return {
      bodyTemp: clamp(bodyTemp + 1.8, MIN_BODY_TEMP_C, 37.4),
      warmBuffTimer: Math.max(warmBuffTimer, 60),
      wetness: Math.max(0, wetness - 12),
      warmedText: '+1.8°C Warmth · 60s Insulated',
    };
  }
  if (item === 'fish_stew') {
    return {
      bodyTemp: clamp(bodyTemp + 2.2, MIN_BODY_TEMP_C, 37.5),
      warmBuffTimer: Math.max(warmBuffTimer, 75),
      wetness: Math.max(0, wetness - 15),
      warmedText: '+2.2°C Warmth · 75s Insulated',
    };
  }
  if (item === 'cooked_fish') {
    return {
      bodyTemp: clamp(bodyTemp + 1.2, MIN_BODY_TEMP_C, 37.3),
      warmBuffTimer: Math.max(warmBuffTimer, 40),
      wetness: Math.max(0, wetness - 6),
      warmedText: '+1.2°C Warmth · 40s Insulated',
    };
  }
  return { bodyTemp, warmBuffTimer, wetness, warmedText: null };
}
