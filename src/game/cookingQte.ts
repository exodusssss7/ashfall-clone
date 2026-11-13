import { COOK_RECIPES } from './recipes';

export type QteJudgement = 'perfect' | 'good' | 'miss';
export type CookingGrade = 'perfect' | 'good' | 'burnt';

export interface CookingQteBeatSpec {
  targetCenter: number;
  goodWidth: number;
  perfectWidth: number;
  speed: number;
  actionVerb: string;
}

export interface CookingQteSpec {
  recipeId: string;
  beats: CookingQteBeatSpec[];
  heatHint: string;
}

export interface CookingBeatResult {
  judgement: QteJudgement;
  score: number;
  offset: number;
}

export interface CookingOutcome {
  grade: CookingGrade;
  label: string;
  outputMultiplier: number;
  outputAmount: number;
  bonusHp: number;
  bonusScore: number;
  avgScore: number;
}

export function getCookingQteSpec(recipeId: string): CookingQteSpec {
  switch (recipeId) {
    case 'cook_boil_water':
      return {
        recipeId,
        heatHint: 'Tap Space when the needle enters the wide amber zone — gold grants x2 Water!',
        beats: [
          { targetCenter: 0.50, goodWidth: 0.44, perfectWidth: 0.18, speed: 0.62, actionVerb: 'CHECK BOIL' },
          { targetCenter: 0.58, goodWidth: 0.42, perfectWidth: 0.17, speed: 0.68, actionVerb: 'BOTTLE STEAM' },
        ],
      };
    case 'cook_hot_rations':
      return {
        recipeId,
        heatHint: 'Easy 2-beat skillet warm-up — hit gold for x2 Hot Meal + +8 HP!',
        beats: [
          { targetCenter: 0.48, goodWidth: 0.42, perfectWidth: 0.17, speed: 0.65, actionVerb: 'STIR PAN' },
          { targetCenter: 0.60, goodWidth: 0.40, perfectWidth: 0.16, speed: 0.72, actionVerb: 'SEAR & PLATE' },
        ],
      };
    case 'cook_grilled_fish':
      return {
        recipeId,
        heatHint: 'Smooth 2-beat sear & flip — hit gold for x2 Grilled Fish + +8 HP!',
        beats: [
          { targetCenter: 0.50, goodWidth: 0.40, perfectWidth: 0.16, speed: 0.68, actionVerb: 'SEAR SKIN' },
          { targetCenter: 0.62, goodWidth: 0.38, perfectWidth: 0.15, speed: 0.76, actionVerb: 'FLIP & SERVE' },
        ],
      };
    case 'cook_fish_stew':
      return {
        recipeId,
        heatHint: 'Gentle 3-beat simmer — Prime timing yields x2 Hearty Pots + +8 HP!',
        beats: [
          { targetCenter: 0.50, goodWidth: 0.40, perfectWidth: 0.16, speed: 0.68, actionVerb: 'SKIM BROTH' },
          { targetCenter: 0.38, goodWidth: 0.38, perfectWidth: 0.15, speed: 0.74, actionVerb: 'STIR HERBS' },
          { targetCenter: 0.62, goodWidth: 0.38, perfectWidth: 0.15, speed: 0.80, actionVerb: 'LADLE STEW' },
        ],
      };
    default:
      return {
        recipeId,
        heatHint: 'Hit Space or click inside the wide amber/gold ember zone!',
        beats: [
          { targetCenter: 0.50, goodWidth: 0.42, perfectWidth: 0.17, speed: 0.65, actionVerb: 'SEAR' },
          { targetCenter: 0.58, goodWidth: 0.40, perfectWidth: 0.16, speed: 0.72, actionVerb: 'PLATE' },
        ],
      };
  }
}

export function advanceQteCursor(
  cursor: number,
  dir: 1 | -1,
  speed: number,
  dt: number
): { cursor: number; dir: 1 | -1 } {
  const safeDt = Math.max(0, Math.min(0.1, dt));
  let next = cursor + dir * speed * safeDt;
  let nextDir = dir;

  if (next >= 1) {
    next = 1 - (next - 1);
    nextDir = -1;
  } else if (next <= 0) {
    next = -next;
    nextDir = 1;
  }

  return {
    cursor: Math.max(0, Math.min(1, next)),
    dir: nextDir,
  };
}

export function evaluateQteBeat(
  cursor: number,
  beat: Pick<CookingQteBeatSpec, 'targetCenter' | 'goodWidth' | 'perfectWidth'>
): CookingBeatResult {
  const offset = cursor - beat.targetCenter;
  const dist = Math.abs(offset);
  if (dist <= beat.perfectWidth * 0.5) {
    return { judgement: 'perfect', score: 100, offset };
  }
  if (dist <= beat.goodWidth * 0.5) {
    return { judgement: 'good', score: 65, offset };
  }
  return { judgement: 'miss', score: 15, offset };
}

export function resolveCookingOutcomeForGrade(
  grade: CookingGrade,
  baseOutputAmount = 1
): CookingOutcome {
  if (grade === 'perfect') {
    return {
      grade: 'perfect',
      label: 'PRIME CHEF',
      outputMultiplier: 2,
      outputAmount: baseOutputAmount * 2,
      bonusHp: 8,
      bonusScore: 40,
      avgScore: 100,
    };
  }
  if (grade === 'good') {
    return {
      grade: 'good',
      label: 'WELL COOKED',
      outputMultiplier: 1,
      outputAmount: baseOutputAmount,
      bonusHp: 4,
      bonusScore: 20,
      avgScore: 65,
    };
  }
  return {
    grade: 'burnt',
    label: 'WARM SALVAGE',
    outputMultiplier: 1,
    outputAmount: baseOutputAmount,
    bonusHp: 1,
    bonusScore: 5,
    avgScore: 15,
  };
}

export function resolveCookingOutcome(
  judgements: QteJudgement[],
  baseOutputAmount = 1
): CookingOutcome {
  if (judgements.length === 0) {
    return resolveCookingOutcomeForGrade('good', baseOutputAmount);
  }
  let total = 0;
  for (const j of judgements) {
    if (j === 'perfect') total += 100;
    else if (j === 'good') total += 65;
    else total += 15;
  }
  const avgScore = total / judgements.length;

  let grade: CookingGrade = 'burnt';
  if (avgScore >= 75) grade = 'perfect';
  else if (avgScore >= 30) grade = 'good';

  const outcome = resolveCookingOutcomeForGrade(grade, baseOutputAmount);
  return {
    ...outcome,
    avgScore: Math.round(avgScore),
  };
}

export function getRecipeBaseOutputAmount(recipeId: string): number {
  return COOK_RECIPES.find((r) => r.id === recipeId)?.outputAmount ?? 1;
}
