import { ItemIcon } from './ItemIcon';
import React from 'react';
import { Flame, X } from 'lucide-react';
import { COOK_RECIPES, ITEMS } from '../game/recipes';
import { canAffordCost } from '../game/survivalLogic';
import type { ConsumableItemId, HudSnapshot, ItemId } from '../game/types';

interface QuickCookModalProps {
  hud: HudSnapshot;
  onClose: () => void;
  onCook: (recipeId: string) => void;
  onUseConsumable: (item: ConsumableItemId) => void;
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

  return (
    <div className="fixed inset-0 z-30 flex items-center justify-center p-4 bg-black/55">
      <div
        role="dialog"
        aria-label="Quick Cook Fire and Stove"
        className="hud-panel w-full max-w-xl max-h-[85vh] flex flex-col overflow-hidden"
      >
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-[#2e3533]">
          <div className="flex items-center gap-2.5">
            <Flame className="w-5 h-5 text-[#f0a848] shrink-0" />
            <div>
              <h2 className="font-pixel text-xl text-[#f0ece1]">Quick Cook</h2>
              <p className="text-xs font-telemetry text-[#8a918d]">
                Prepare hot meals &amp; clean water at campfires or kitchen stoves
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close Quick Cook"
            className="hud-slot w-9 h-9 flex items-center justify-center text-[#c7c2b6] hover:text-white cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-5 overflow-y-auto space-y-5">
          {!hud.nearCookingHeat && (
            <div className="bg-[#2b1b18] border border-[#c9453e] px-3.5 py-2 text-xs font-telemetry text-[#ffb4ad]">
              No active heat source in range — move beside a Campfire or Kitchen Stove to cook.
            </div>
          )}

          {/* Stock overview */}
          <div className="grid grid-cols-4 gap-2">
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

          {/* Cooking Recipes */}
          <div>
            <div className="text-xs font-telemetry uppercase tracking-wider text-[#8a918d] mb-2">
              Field Recipes
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
              {COOK_RECIPES.map((recipe) => {
                const affordable = canAffordCost(hud.inventory, recipe.cost);
                const canCook = hud.nearCookingHeat && affordable;
                return (
                  <div
                    key={recipe.id}
                    className="bg-[#14181a] border border-[#2c3331] p-3 flex items-center justify-between gap-3"
                  >
                    <div className="min-w-0">
                      <div className="font-tactical text-sm font-bold text-[#f0ece1]">
                        {recipe.name}
                      </div>
                      <div className="text-[11px] text-[#9aa09c] mt-0.5">
                        {recipe.description}
                      </div>
                      <div className="text-[11px] font-telemetry text-[#e0bd5e] mt-1.5">
                        {Object.entries(recipe.cost)
                          .map(([k, v]) => `${v} ${ITEMS[k as ItemId].short}`)
                          .join(' · ')}
                      </div>
                    </div>

                    <button
                      type="button"
                      disabled={!canCook}
                      onClick={() => onCook(recipe.id)}
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
        </div>
      </div>
    </div>
  );
};
