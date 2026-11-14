import React from 'react';
import { PackageOpen, CheckCheck, X } from 'lucide-react';
import { ItemIcon } from './ItemIcon';
import { ITEMS } from '../game/recipes';
import type { ActiveLootContainer, ItemId } from '../game/types';

interface LootModalProps {
  container: ActiveLootContainer;
  onTakeItem: (item: ItemId) => void;
  onTakeAll: () => void;
  onClose: () => void;
}

const ITEM_CATEGORY_LABEL: Record<ItemId, string> = {
  wood: 'Material',
  scrap: 'Material',
  cloth: 'Material',
  fuel: 'Fuel',
  food: 'Provision',
  water: 'Hydration',
  bandage: 'Medical',
  ammo_9mm: 'Ammo',
  ammo_shell: 'Ammo',
  molotov: 'Throwable',
  raw_fish: 'Raw Catch',
  cooked_fish: 'Cooked Food',
  fish_stew: 'Hot Meal',
  hot_rations: 'Hot Meal',
};

export const LootModal: React.FC<LootModalProps> = ({
  container,
  onTakeItem,
  onTakeAll,
  onClose,
}) => {
  const totalCount = container.entries.reduce((acc, e) => acc + e.qty, 0);

  return (
    <div className="fixed inset-0 z-30 flex items-center justify-center bg-black/60 p-3">
      <div
        role="dialog"
        aria-label={container.title}
        data-testid="loot-modal"
        className="hud-panel w-full max-w-[540px] flex flex-col overflow-hidden"
      >
        <header className="flex items-center justify-between gap-3 px-4 py-3 border-b border-[#536159] bg-[#14271e]/95">
          <div className="flex items-center gap-3 min-w-0">
            <div className="hud-slot w-11 h-11 flex items-center justify-center shrink-0 p-1.5">
              <ItemIcon kind={container.kind} className="w-8 h-8" />
            </div>
            <div className="min-w-0">
              <h2 className="font-pixel text-lg md:text-xl leading-tight text-[#f0e6c4] truncate">
                {container.title}
              </h2>
              <p className="font-telemetry text-[10px] tracking-wider uppercase text-[#adb99c]">
                {container.subtitle} · {totalCount} {totalCount === 1 ? 'item' : 'items'}
              </p>
            </div>
          </div>

          <button
            type="button"
            aria-label="Close Container"
            onClick={onClose}
            className="hud-slot w-10 h-10 flex items-center justify-center text-[#f2dfbb] hover:text-white cursor-pointer shrink-0"
          >
            <X className="w-5 h-5" />
          </button>
        </header>

        <div className="p-4 max-h-[58dvh] overflow-y-auto">
          {container.entries.length === 0 ? (
            <div className="py-8 text-center font-telemetry text-xs text-[#9aa894]">
              <PackageOpen className="w-8 h-8 mx-auto mb-2 opacity-60" />
              Container is empty.
            </div>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5">
              {container.entries.map((entry) => {
                const meta = ITEMS[entry.item];
                return (
                  <button
                    key={entry.item}
                    type="button"
                    data-loot-item={entry.item}
                    onClick={() => onTakeItem(entry.item)}
                    className="hud-slot p-2.5 flex flex-col items-center text-center gap-1.5 cursor-pointer hover:border-[#f0d078] group"
                  >
                    <div className="w-full flex items-center justify-between text-[9px] font-telemetry uppercase tracking-wider text-[#9db097]">
                      <span>{ITEM_CATEGORY_LABEL[entry.item]}</span>
                      <span
                        className="px-1.5 py-0.5 bg-[#121c18] border border-[#4c5c4d] text-[11px] font-bold"
                        style={{ color: meta.color }}
                      >
                        +{entry.qty}
                      </span>
                    </div>
                    <div className="w-12 h-12 flex items-center justify-center my-0.5">
                      <ItemIcon
                        kind={entry.item}
                        className="w-11 h-11 transition-transform group-hover:scale-110"
                      />
                    </div>
                    <div className="font-tactical text-xs font-bold text-[#f2ebd5] leading-tight">
                      {meta.name}
                    </div>
                    <span className="font-telemetry text-[9px] uppercase tracking-wider text-[#d9c58b]">
                      Tap to Take
                    </span>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        <footer className="flex items-center justify-between gap-2 px-4 py-3 border-t border-[#536159] bg-[#12221b]/95">
          <button
            type="button"
            onClick={onClose}
            className="hud-slot px-3.5 py-2 text-xs font-telemetry text-[#c7c2b6] hover:text-white cursor-pointer"
          >
            [ESC] CLOSE
          </button>
          <button
            type="button"
            data-testid="loot-take-all"
            disabled={container.entries.length === 0}
            onClick={onTakeAll}
            className="bg-[#d9822b] px-4 py-2 text-xs font-telemetry font-bold flex items-center gap-2 cursor-pointer"
          >
            <CheckCheck className="w-4 h-4" />
            TAKE ALL [E]
          </button>
        </footer>
      </div>
    </div>
  );
};
