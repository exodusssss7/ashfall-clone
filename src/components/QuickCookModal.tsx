import { ItemIcon } from './ItemIcon';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, Check, Flame, RotateCcw, Sparkles, X } from 'lucide-react';
import {
  advanceQteCursor,
  evaluateQteBeat,
  getCookingQteSpec,
  resolveCookingOutcome,
  type CookingGrade,
  type CookingOutcome,
  type QteJudgement,
} from '../game/cookingQte';
import { COOK_RECIPES, ITEMS } from '../game/recipes';
import { soundEngine } from '../game/sound';
import { canAffordCost } from '../game/survivalLogic';
import type { ConsumableItemId, HudSnapshot, ItemId } from '../game/types';

interface QuickCookModalProps {
  hud: HudSnapshot;
  onClose: () => void;
  onCook: (recipeId: string, grade: CookingGrade) => boolean;
  onUseConsumable: (item: ConsumableItemId) => void;
}

interface CompletedCookSummary {
  recipeId: string;
  recipeName: string;
  outputItem: ItemId;
  outcome: CookingOutcome;
  judgements: QteJudgement[];
}

export const QuickCookModal: React.FC<QuickCookModalProps> = ({
  hud,
  onClose,
  onCook,
  onUseConsumable,
}) => {
  const meals: Array<{ id: ConsumableItemId; label: string; effect: string; accent: string }> = [
    { id: 'fish_stew', label: 'Fish Stew', effect: '+58 Food · +40 H2O · +24 HP', accent: '#f0b849' },
    { id: 'hot_rations', label: 'Hot Rations', effect: '+48 Food · +12 HP', accent: '#e07b39' },
    { id: 'cooked_fish', label: 'Grilled Fish', effect: '+42 Food · +14 HP', accent: '#e8a258' },
    { id: 'water', label: 'Clean Water', effect: '+44 H2O', accent: '#4ea2d4' },
  ];

  const [activeRecipeId, setActiveRecipeId] = useState<string | null>(null);
  const [beatIndex, setBeatIndex] = useState<number>(0);
  const [cursor, setCursor] = useState<number>(0.12);
  const [judgements, setJudgements] = useState<QteJudgement[]>([]);
  const [beatFreeze, setBeatFreeze] = useState<{ judgement: QteJudgement; landedAt: number } | null>(null);
  const [summary, setSummary] = useState<CompletedCookSummary | null>(null);

  const cursorRef = useRef<number>(0.12);
  const dirRef = useRef<1 | -1>(1);
  const freezeTimerRef = useRef<number | null>(null);

  const activeRecipe = useMemo(
    () => COOK_RECIPES.find((r) => r.id === activeRecipeId) ?? null,
    [activeRecipeId]
  );
  const activeSpec = useMemo(
    () => (activeRecipeId ? getCookingQteSpec(activeRecipeId) : null),
    [activeRecipeId]
  );
  const currentBeat = activeSpec?.beats[beatIndex] ?? null;

  const clearFreezeTimer = useCallback(() => {
    if (freezeTimerRef.current !== null) {
      window.clearTimeout(freezeTimerRef.current);
      freezeTimerRef.current = null;
    }
  }, []);

  useEffect(() => clearFreezeTimer, [clearFreezeTimer]);

  const startQte = useCallback(
    (recipeId: string) => {
      const recipe = COOK_RECIPES.find((r) => r.id === recipeId);
      if (!recipe || !hud.nearCookingHeat || !canAffordCost(hud.inventory, recipe.cost)) {
        return;
      }
      clearFreezeTimer();
      soundEngine.playUiClick();
      setSummary(null);
      setActiveRecipeId(recipeId);
      setBeatIndex(0);
      setJudgements([]);
      setBeatFreeze(null);
      cursorRef.current = 0.08;
      dirRef.current = 1;
      setCursor(0.08);
    },
    [clearFreezeTimer, hud.inventory, hud.nearCookingHeat]
  );

  const cancelQte = useCallback(() => {
    clearFreezeTimer();
    soundEngine.playUiClick();
    setActiveRecipeId(null);
    setBeatFreeze(null);
    setJudgements([]);
    setBeatIndex(0);
  }, [clearFreezeTimer]);

  // Smooth 60fps needle oscillation while beat is live
  useEffect(() => {
    if (!activeRecipeId || !currentBeat || beatFreeze) return;
    let rafId = 0;
    let lastTs = performance.now();

    const step = (now: number) => {
      const dt = Math.min(0.05, Math.max(0.001, (now - lastTs) / 1000));
      lastTs = now;
      const next = advanceQteCursor(cursorRef.current, dirRef.current, currentBeat.speed, dt);
      cursorRef.current = next.cursor;
      dirRef.current = next.dir;
      setCursor(next.cursor);
      rafId = window.requestAnimationFrame(step);
    };

    rafId = window.requestAnimationFrame(step);
    return () => window.cancelAnimationFrame(rafId);
  }, [activeRecipeId, currentBeat, beatFreeze]);

  const triggerBeatHit = useCallback(() => {
    if (!activeRecipe || !activeSpec || !currentBeat || beatFreeze) return;

    const landed = cursorRef.current;
    const evalResult = evaluateQteBeat(landed, currentBeat);
    soundEngine.playCookBeatHit(evalResult.judgement);

    const nextJudgements = [...judgements, evalResult.judgement];
    setJudgements(nextJudgements);
    setBeatFreeze({ judgement: evalResult.judgement, landedAt: landed });

    const isLastBeat = beatIndex + 1 >= activeSpec.beats.length;
    clearFreezeTimer();

    freezeTimerRef.current = window.setTimeout(() => {
      setBeatFreeze(null);
      if (isLastBeat) {
        const outcome = resolveCookingOutcome(nextJudgements, activeRecipe.outputAmount ?? 1);
        const cooked = onCook(activeRecipe.id, outcome.grade);
        setActiveRecipeId(null);
        setBeatIndex(0);
        if (cooked && activeRecipe.outputItem) {
          setSummary({
            recipeId: activeRecipe.id,
            recipeName: activeRecipe.name,
            outputItem: activeRecipe.outputItem,
            outcome,
            judgements: nextJudgements,
          });
        }
      } else {
        const nextBeatIdx = beatIndex + 1;
        const startLeft = nextBeatIdx % 2 === 0;
        cursorRef.current = startLeft ? 0.08 : 0.92;
        dirRef.current = startLeft ? 1 : -1;
        setCursor(cursorRef.current);
        setBeatIndex(nextBeatIdx);
      }
    }, 340);
  }, [activeRecipe, activeSpec, beatFreeze, beatIndex, clearFreezeTimer, currentBeat, judgements, onCook]);

  // Capture Space / Enter during active QTE, or Digit1-4 quick-start on recipe list
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (activeRecipeId) {
        if (e.code === 'Space' || e.code === 'Enter') {
          e.preventDefault();
          e.stopImmediatePropagation();
          triggerBeatHit();
        } else if (e.code === 'Escape') {
          e.preventDefault();
          e.stopImmediatePropagation();
          cancelQte();
        }
        return;
      }
      if (e.code.startsWith('Digit')) {
        const idx = parseInt(e.code.replace('Digit', ''), 10) - 1;
        if (idx >= 0 && idx < COOK_RECIPES.length) {
          e.preventDefault();
          e.stopImmediatePropagation();
          const rec = COOK_RECIPES[idx];
          if (rec && hud.nearCookingHeat && canAffordCost(hud.inventory, rec.cost)) {
            startQte(rec.id);
          }
        }
      }
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [activeRecipeId, triggerBeatHit, cancelQte, startQte, hud.nearCookingHeat, hud.inventory]);

  const goodLeftPct = currentBeat ? (currentBeat.targetCenter - currentBeat.goodWidth * 0.5) * 100 : 30;
  const goodWidthPct = currentBeat ? currentBeat.goodWidth * 100 : 40;
  const perfLeftPct = currentBeat ? (currentBeat.targetCenter - currentBeat.perfectWidth * 0.5) * 100 : 42;
  const perfWidthPct = currentBeat ? currentBeat.perfectWidth * 100 : 16;
  const targetCenterPct = currentBeat ? currentBeat.targetCenter * 100 : 50;

  const liveOffset = currentBeat ? Math.abs((beatFreeze ? beatFreeze.landedAt : cursor) - currentBeat.targetCenter) : 1;
  const inPerfectZone = Boolean(currentBeat && liveOffset <= currentBeat.perfectWidth * 0.5);
  const inGoodZone = Boolean(currentBeat && !inPerfectZone && liveOffset <= currentBeat.goodWidth * 0.5);

  return (
    <div className="fixed inset-0 z-30 flex items-center justify-center p-4 bg-black/55">
      <div
        role="dialog"
        aria-label="Quick Cook Fire and Stove"
        data-cooking-active={Boolean(activeRecipe)}
        className="quick-cook-dialog hud-panel w-full max-w-xl max-h-[88vh] flex flex-col overflow-hidden"
      >
        <div className="quick-cook-header flex items-center justify-between px-5 py-3.5 border-b border-[#2e3533]">
          <div className="cooking-timing-actions flex items-center gap-2.5">
            <Flame className="w-5 h-5 text-[#f0a848] shrink-0" />
            <div>
              <h2 className="font-pixel text-xl text-[#f0ece1]">Quick Cook</h2>
              <p className="text-xs font-telemetry text-[#8a918d]">
                {activeRecipe
                  ? `Timing Skillet · ${activeRecipe.name}`
                  : 'Relaxed Skillet Timing · Gold Sweet Spot = x2 Meals + +8 HP'}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={activeRecipe ? cancelQte : onClose}
            aria-label={activeRecipe ? 'Cancel Cooking QTE' : 'Close Quick Cook'}
            className="hud-slot w-9 h-9 flex items-center justify-center text-[#c7c2b6] hover:text-white cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="quick-cook-content p-5 overflow-y-auto space-y-5">
          {!hud.nearCookingHeat && (
            <div className="bg-[#2b1b18] border border-[#c9453e] px-3.5 py-2 text-xs font-telemetry text-[#ffb4ad]">
              No active heat source in range — move beside a Campfire or Kitchen Stove to cook.
            </div>
          )}

          {/* Stock overview */}
          <div className="quick-cook-stock grid grid-cols-4 gap-2">
            {(['raw_fish', 'food', 'water', 'wood'] as ItemId[]).map((id) => (
              <div
                key={id}
                className="bg-[#121618] border border-[#2a302e] px-2.5 py-1.5 flex items-center justify-between text-xs font-telemetry"
              >
                <span className="text-[#b3b8b5] truncate">{ITEMS[id].short}</span>
                <span className="font-bold text-[#f0ece1]">{hud.inventory[id]}</span>
              </div>
            ))}
          </div>

          {/* Active Timing QTE View */}
          {activeRecipe && activeSpec && currentBeat ? (
            <div
              data-testid="cooking-qte-panel"
              className={`cooking-timing-panel bg-[#111517] border p-4 space-y-4 transition-colors ${
                inPerfectZone
                  ? 'border-[#ffd266]'
                  : inGoodZone
                    ? 'border-[#e8943c]'
                    : 'border-[#d9822b]/70'
              }`}
            >
              <div className="cooking-timing-heading flex items-center justify-between gap-3">
                <div className="flex items-center gap-3 min-w-0">
                  <div className="w-10 h-10 bg-[#171c1e] border border-[#2f3735] flex items-center justify-center shrink-0">
                    {activeRecipe.outputItem && (
                      <ItemIcon kind={activeRecipe.outputItem} className="w-6 h-6" />
                    )}
                  </div>
                  <div className="min-w-0">
                    <div className="font-tactical text-base font-bold text-[#f0ece1] flex items-center gap-2">
                      <span>{activeRecipe.name}</span>
                      <span className="text-[10px] font-telemetry uppercase px-1.5 py-0.5 bg-[#2a2113] border border-[#d9822b]/60 text-[#ffd266]">
                        Beat {beatIndex + 1} / {activeSpec.beats.length}
                      </span>
                    </div>
                    <p className="text-[11px] font-telemetry text-[#9aa09c] mt-0.5">
                      {activeSpec.heatHint}
                    </p>
                  </div>
                </div>
                <div className="hidden sm:block text-right text-[10px] font-telemetry shrink-0 bg-[#151a1c] border border-[#2c3331] px-2.5 py-1">
                  <div className="text-[#ffd266] font-bold">GOLD: x2 + 8 HP</div>
                  <div className="text-[#c7c2b6]">AMBER: x1 + 4 HP</div>
                </div>
              </div>

              {/* Beat History / Step Indicators */}
              <div className="cooking-beat-history grid gap-2" style={{ gridTemplateColumns: `repeat(${activeSpec.beats.length}, minmax(0, 1fr))` }}>
                {activeSpec.beats.map((b, idx) => {
                  const res = judgements[idx];
                  const isCurrent = idx === beatIndex && !res;
                  let boxClass = 'bg-[#151a1c] border-[#2a302e] text-[#6d7572]';
                  let statusText = b.actionVerb;
                  if (res === 'perfect') {
                    boxClass = 'bg-[#2a2210] border-[#ffd266] text-[#ffd266]';
                    statusText = 'PRIME SEAR';
                  } else if (res === 'good') {
                    boxClass = 'bg-[#251b11] border-[#d9822b] text-[#f0a848]';
                    statusText = 'GOOD';
                  } else if (res === 'miss') {
                    boxClass = 'bg-[#251b19] border-[#a65a44] text-[#e09c84]';
                    statusText = 'SINGED';
                  } else if (isCurrent) {
                    boxClass = 'bg-[#1a201f] border-[#e6e2d8] text-[#f0ece1]';
                  }
                  return (
                    <div
                      key={idx}
                      className={`border px-2 py-1.5 text-center text-[10px] font-telemetry uppercase tracking-wider ${boxClass}`}
                    >
                      <div className="opacity-70">Step {idx + 1}</div>
                      <div className="font-bold truncate">{statusText}</div>
                    </div>
                  );
                })}
              </div>

              {/* Callout Status Line */}
              <div className="cooking-timing-callout h-6 flex items-center justify-center">
                {beatFreeze ? (
                  <span
                    className={`font-pixel text-base tracking-wide ${
                      beatFreeze.judgement === 'perfect'
                        ? 'text-[#ffd266]'
                        : beatFreeze.judgement === 'good'
                          ? 'text-[#f0a848]'
                          : 'text-[#e09c84]'
                    }`}
                  >
                    {beatFreeze.judgement === 'perfect'
                      ? '★ PRIME SEAR! (+100)'
                      : beatFreeze.judgement === 'good'
                        ? 'GOOD TIMING! (+65)'
                        : 'WARM SINGE (+15)'}
                  </span>
                ) : inPerfectZone ? (
                  <span className="font-pixel text-sm tracking-wide text-[#ffd266]">
                    ★ IN GOLD SWEET SPOT — TAP [SPACE] NOW!
                  </span>
                ) : inGoodZone ? (
                  <span className="font-telemetry text-xs font-bold text-[#f0a848]">
                    IN AMBER ZONE — TAP [SPACE] OR AIM FOR GOLD!
                  </span>
                ) : (
                  <span className="text-xs font-telemetry text-[#c7c2b6]">
                    Tap <span className="text-[#ffd266] font-bold">[SPACE]</span> or click the bar inside the{' '}
                    <span className="text-[#ffd266]">Amber / Gold Zone</span>
                  </span>
                )}
              </div>

              {/* Timing Gauge Bar */}
              <button
                type="button"
                onClick={triggerBeatHit}
                aria-label={`Cooking timing bar — ${currentBeat.actionVerb}`}
                className={`relative w-full h-14 bg-[#0b0d0e] border-2 overflow-hidden cursor-pointer block focus:outline-none transition-colors ${
                  inPerfectZone
                    ? 'border-[#ffd266]'
                    : inGoodZone
                      ? 'border-[#e8943c]'
                      : 'border-[#353d3b] hover:border-[#d9822b]'
                }`}
              >
                {/* Ember tick marks */}
                <div className="absolute inset-0 flex justify-between px-2 pointer-events-none opacity-25">
                  {Array.from({ length: 17 }).map((_, i) => (
                    <div key={i} className="w-px h-full bg-[#5a6360]" />
                  ))}
                </div>

                {/* Good Zone (Wide Amber) */}
                <div
                  className={`absolute top-0 bottom-0 border-x border-[#d9822b] pointer-events-none transition-opacity ${
                    inGoodZone ? 'bg-[#d9822b]/55' : 'bg-[#d9822b]/35'
                  }`}
                  style={{ left: `${goodLeftPct}%`, width: `${goodWidthPct}%` }}
                />

                {/* Perfect Sweet Spot (Gold Ember Core) */}
                <div
                  className={`absolute top-0 bottom-0 border-x-2 border-[#fff3b0] pointer-events-none transition-opacity ${
                    inPerfectZone ? 'bg-[#ffd266]/85' : 'bg-[#ffd266]/65'
                  }`}
                  style={{ left: `${perfLeftPct}%`, width: `${perfWidthPct}%` }}
                />

                {/* Center Aim Hairline */}
                <div
                  className="absolute top-0 bottom-0 w-0.5 bg-[#fff8d6] opacity-90 pointer-events-none"
                  style={{ left: `${targetCenterPct}%`, transform: 'translateX(-50%)' }}
                />

                {/* Sweeping Cursor Needle */}
                <div
                  data-testid="qte-needle"
                  className="absolute top-0 bottom-0 w-1.5 bg-[#f0ece1] shadow-[0_0_8px_rgba(255,210,102,0.9)] pointer-events-none"
                  style={{
                    left: `${(beatFreeze ? beatFreeze.landedAt : cursor) * 100}%`,
                    transform: 'translateX(-50%)',
                  }}
                >
                  <div className="w-3 h-2 bg-[#ffd266] -ml-[3px]" />
                  <div className="w-3 h-2 bg-[#ffd266] -ml-[3px] mt-10" />
                </div>
              </button>

              {/* Primary Trigger + Cancel Controls */}
              <div className="cooking-timing-actions flex items-center gap-2.5">
                <button
                  type="button"
                  onClick={triggerBeatHit}
                  disabled={Boolean(beatFreeze)}
                  className={`flex-1 py-3 px-4 font-telemetry font-bold text-sm uppercase tracking-wider cursor-pointer transition-colors ${
                    inPerfectZone
                      ? 'bg-[#ffd266] hover:bg-[#ffe18f] text-[#0b0d0e]'
                      : 'bg-[#d9822b] hover:bg-[#e8943c] disabled:bg-[#5c4223] text-[#0b0d0e]'
                  }`}
                >
                  {inPerfectZone ? `★ PRIME SEAR! [SPACE]` : `${currentBeat.actionVerb} [SPACE]`}
                </button>
                <button
                  type="button"
                  onClick={cancelQte}
                  className="px-4 py-3 bg-[#1a2022] hover:bg-[#242c2e] border border-[#323a38] text-[#c7c2b6] text-xs font-telemetry uppercase cursor-pointer"
                >
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <>
              {/* Recent Outcome Banner */}
              {summary && (
                <div
                  data-testid="cooking-qte-result"
                  className={`border px-4 py-3 flex items-center justify-between gap-3 ${
                    summary.outcome.grade === 'perfect'
                      ? 'bg-[#241d0f] border-[#ffd266]'
                      : summary.outcome.grade === 'good'
                        ? 'bg-[#1a1f1b] border-[#d9822b]'
                        : 'bg-[#261b18] border-[#a65a44]'
                  }`}
                >
                  <div className="flex items-center gap-3 min-w-0">
                    {summary.outcome.grade === 'perfect' ? (
                      <Sparkles className="w-5 h-5 text-[#ffd266] shrink-0" />
                    ) : summary.outcome.grade === 'good' ? (
                      <Check className="w-5 h-5 text-[#f0a848] shrink-0" />
                    ) : (
                      <AlertTriangle className="w-5 h-5 text-[#e09c84] shrink-0" />
                    )}
                    <div className="min-w-0">
                      <div className="font-tactical text-sm font-bold text-[#f0ece1]">
                        {summary.outcome.label} · {summary.recipeName}
                      </div>
                      <div className="text-xs font-telemetry text-[#c7c2b6] mt-0.5">
                        Gained <span className="text-[#ffd266] font-bold">+{summary.outcome.outputAmount}</span>{' '}
                        {ITEMS[summary.outputItem].short}
                        {summary.outcome.bonusHp > 0 && ` · +${summary.outcome.bonusHp} Warmth HP`}
                        {summary.outcome.grade === 'perfect' && ' (x2 Prime Bonus!)'}
                      </div>
                    </div>
                  </div>
                  {(() => {
                    const rec = COOK_RECIPES.find((r) => r.id === summary.recipeId);
                    const canRepeat = rec && hud.nearCookingHeat && canAffordCost(hud.inventory, rec.cost);
                    return canRepeat ? (
                      <button
                        type="button"
                        onClick={() => startQte(summary.recipeId)}
                        className="px-3 py-1.5 bg-[#d9822b] hover:bg-[#e8943c] text-[#0d1012] text-xs font-telemetry font-bold flex items-center gap-1.5 shrink-0 cursor-pointer"
                      >
                        <RotateCcw className="w-3.5 h-3.5" />
                        <span>Cook Again</span>
                      </button>
                    ) : null;
                  })()}
                </div>
              )}

              {/* Cooking Recipes */}
              <div>
                <div className="text-xs font-telemetry uppercase tracking-wider text-[#8a918d] mb-2">
                  Field Recipes · Press [1]–[4] or Click Cook
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                  {COOK_RECIPES.map((recipe, rIdx) => {
                    const affordable = canAffordCost(hud.inventory, recipe.cost);
                    const canCook = hud.nearCookingHeat && affordable;
                    const qteSpec = getCookingQteSpec(recipe.id);
                    return (
                      <div
                        key={recipe.id}
                        className="bg-[#14181a] border border-[#2c3331] p-3 flex items-center justify-between gap-3"
                      >
                        <div className="min-w-0 flex items-start gap-2.5">
                          <div className="w-8 h-8 bg-[#101416] border border-[#2a302e] flex items-center justify-center shrink-0 mt-0.5">
                            {recipe.outputItem && (
                              <ItemIcon kind={recipe.outputItem} className="w-5 h-5" />
                            )}
                          </div>
                          <div className="min-w-0">
                            <div className="font-tactical text-[13px] leading-tight font-bold text-[#f0ece1] flex items-baseline gap-1.5">
                              <span className="text-[10px] font-telemetry text-[#8a918d] shrink-0">[{rIdx + 1}]</span>
                              <span>{recipe.name}</span>
                            </div>
                            <div className="text-[11px] text-[#9aa09c] mt-0.5">
                              {recipe.description}
                            </div>
                            <div className="text-[11px] font-telemetry text-[#e0bd5e] mt-1.5">
                              {Object.entries(recipe.cost)
                                .map(([k, v]) => `${v} ${ITEMS[k as ItemId].short}`)
                                .join(' · ')}
                            </div>
                            <div className="text-[10px] font-telemetry text-[#8a918d] mt-0.5 whitespace-nowrap">
                              {qteSpec.beats.length} Beats · Prime = x2 Yield
                            </div>
                          </div>
                        </div>

                        <button
                          type="button"
                          disabled={!canCook}
                          onClick={() => startQte(recipe.id)}
                          className="px-3 py-2 text-xs font-telemetry font-bold bg-[#d9822b] hover:bg-[#e8943c] disabled:bg-[#242928] disabled:text-[#666d6a] text-[#0d1012] transition-colors cursor-pointer whitespace-nowrap shrink-0"
                        >
                          Cook
                        </button>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Quick Consume Cooked Meals */}
              <div>
                <div className="text-xs font-telemetry uppercase tracking-wider text-[#8a918d] mb-2">
                  Prepared Meals &amp; Drink
                </div>
                <div className="grid grid-cols-2 gap-2">
                  {meals.map((meal) => {
                    const count = hud.inventory[meal.id];
                    return (
                      <button
                        key={meal.id}
                        type="button"
                        disabled={count <= 0}
                        onClick={() => onUseConsumable(meal.id)}
                        className="hud-slot px-3 py-2 text-left hover:border-[#d99b38] disabled:opacity-45 cursor-pointer"
                      >
                        <div className="flex items-center justify-between text-xs font-telemetry">
                          <span className="font-bold" style={{ color: meal.accent }}>
                            {meal.label}
                          </span>
                          <span className="text-[#f0ece1]">x{count}</span>
                        </div>
                        <div className="text-[10px] text-[#9aa09c] mt-0.5">{meal.effect}</div>
                      </button>
                    );
                  })}
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
};
