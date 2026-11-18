import React from 'react';
import { Hammer } from 'lucide-react';
import type { ActionCue } from '../game/actionAlerts';
import {
  HOTBAR_TOOLS,
  describeHotbarEntry,
  type HotbarEntry,
  type HotbarSlotValue,
} from '../game/hotbarSystem';
import { STRUCTURES, WEAPONS } from '../game/recipes';
import { canAffordCost } from '../game/survivalLogic';
import type { HudSnapshot } from '../game/types';
import { ItemIcon } from './ItemIcon';

export interface HotbarSlotMeta {
  icon: string;
  title: string;
  shortLabel: string;
  badgeText: string;
  badgeHighlight: boolean;
  isActive: boolean;
  isDimmed: boolean;
  cue: ActionCue;
}

export function getHotbarSlotMeta(
  entry: HotbarSlotValue,
  hud: HudSnapshot,
  touchEnabled = false
): HotbarSlotMeta {
  if (!entry) {
    return {
      icon: '',
      title: 'Empty shortcut slot — drag a weapon, consumable, or tool here',
      shortLabel: 'Empty',
      badgeText: 'EMPTY',
      badgeHighlight: false,
      isActive: false,
      isDimmed: true,
      cue: { state: 'idle', reason: 'Empty hotbar slot' },
    };
  }

  const desc = describeHotbarEntry(entry);

  if (entry.kind === 'weapon') {
    const spec = WEAPONS[entry.id];
    const active = hud.equippedWeapon === entry.id && !hud.buildMode;
    let ammoText = 'INF';
    let cue: ActionCue = { state: 'idle', reason: `${spec.name} ready` };

    if (entry.id === 'pistol') {
      ammoText = `${hud.pistolMag}/${hud.inventory.ammo_9mm}`;
      if (hud.pistolMag <= 0 && hud.inventory.ammo_9mm <= 0) {
        cue = { state: 'urgent', reason: 'Pistol out of ammunition' };
      }
    } else if (entry.id === 'shotgun') {
      ammoText = `${hud.shotgunMag}/${hud.inventory.ammo_shell}`;
      if (hud.shotgunMag <= 0 && hud.inventory.ammo_shell <= 0) {
        cue = { state: 'urgent', reason: 'Shotgun out of shells' };
      }
    } else if (entry.id === 'molotov') {
      ammoText = `x${hud.inventory.molotov}`;
      if (hud.inventory.molotov <= 0) {
        cue = { state: 'urgent', reason: 'No molotovs left' };
      }
    }

    return {
      icon: desc.icon,
      title: `${spec.name} · Drag to move or swap slots`,
      shortLabel: touchEnabled ? desc.shortName : spec.name,
      badgeText: ammoText,
      badgeHighlight: active,
      isActive: active,
      isDimmed: entry.id === 'molotov' && hud.inventory.molotov <= 0,
      cue,
    };
  }

  if (entry.kind === 'consumable') {
    const qty = hud.inventory[entry.id] ?? 0;
    let cue: ActionCue = { state: 'idle', reason: `${desc.name} (x${qty})` };
    if (entry.id === 'bandage' && (hud.bleeding || hud.hp <= 45) && qty > 0) {
      cue = {
        state: 'urgent',
        reason: hud.bleeding ? 'Apply bandage to stop bleeding' : 'Critical health — use bandage',
      };
    } else if (
      (entry.id === 'food' ||
        entry.id === 'cooked_fish' ||
        entry.id === 'fish_stew' ||
        entry.id === 'hot_rations') &&
      hud.hunger <= 25 &&
      qty > 0
    ) {
      cue = { state: 'urgent', reason: 'Starving — eat rations' };
    } else if (entry.id === 'water' && hud.thirst <= 25 && qty > 0) {
      cue = { state: 'urgent', reason: 'Dehydrated — drink water' };
    }

    return {
      icon: desc.icon,
      title: `${desc.name} (x${qty}) · Click to use or drag to rearrange`,
      shortLabel: desc.shortName,
      badgeText: `x${qty}`,
      badgeHighlight: false,
      isActive: false,
      isDimmed: qty <= 0,
      cue,
    };
  }

  // Tool entry
  const tool = HOTBAR_TOOLS[entry.id];
  if (entry.id === 'build_hammer') {
    const active = Boolean(hud.buildMode);
    return {
      icon: tool.icon,
      title: `${tool.name} · Click to toggle Build Mode or drag to rearrange`,
      shortLabel: tool.short,
      badgeText: active ? 'BUILD' : 'TOOL',
      badgeHighlight: active,
      isActive: active,
      isDimmed: false,
      cue: { state: active ? 'active' : 'idle', reason: tool.name },
    };
  }

  if (entry.id === 'flashlight') {
    const on = Boolean(hud.flashlightOn) && hud.battery > 1;
    return {
      icon: tool.icon,
      title: `${tool.name} (${hud.battery}% battery) · Click to toggle or drag to rearrange`,
      shortLabel: tool.short,
      badgeText: hud.battery <= 1 ? 'DEAD' : on ? 'ON' : 'OFF',
      badgeHighlight: on,
      isActive: on,
      isDimmed: hud.battery <= 1,
      cue: {
        state: on ? 'active' : hud.battery <= 15 ? 'warning' : 'idle',
        reason: `${tool.name} ${on ? 'ON' : 'OFF'}`,
      },
    };
  }

  // Placeable structure quick tool
  const structSpec = STRUCTURES[entry.id];
  const affordable = canAffordCost(hud.inventory, structSpec.cost);
  const active = hud.buildMode === entry.id;
  return {
    icon: tool.icon,
    title: `${tool.name} (${tool.effect}) · Click to place or drag to rearrange`,
    shortLabel: tool.short,
    badgeText: active ? 'PLACE' : affordable ? 'READY' : 'LOW',
    badgeHighlight: active,
    isActive: active,
    isDimmed: !affordable && !active,
    cue: { state: active ? 'active' : 'idle', reason: tool.name },
  };
}

interface GhostProps {
  entry: HotbarEntry;
  x: number;
  y: number;
  hint?: string;
}

export const HotbarDragGhost: React.FC<GhostProps> = ({ entry, x, y, hint }) => {
  const desc = describeHotbarEntry(entry);
  return (
    <div
      aria-hidden="true"
      className="hotbar-drag-ghost fixed z-[90] pointer-events-none"
      style={{
        left: `${x}px`,
        top: `${y}px`,
        transform: 'translate(-50%, -50%)',
      }}
    >
      <div className="hotbar-drag-ghost-card">
        <ItemIcon kind={desc.icon} className="w-8 h-8" />
        <div className="hotbar-drag-ghost-text">
          <strong>{desc.shortName}</strong>
          {hint && <span>{hint}</span>}
        </div>
      </div>
    </div>
  );
};

export function ToolCornerMark({ entry }: { entry: HotbarSlotValue }) {
  if (!entry || entry.kind !== 'tool' || entry.id !== 'build_hammer') return null;
  return (
    <Hammer
      className="hotbar-tool-mark w-2.5 h-2.5 text-[#e8a849]"
      aria-hidden="true"
    />
  );
}
