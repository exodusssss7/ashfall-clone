import React from 'react';
import { ItemIcon } from './ItemIcon';
import type { PickupNotification } from '../game/types';

interface PickupFeedProps {
  notifications: PickupNotification[];
  touchEnabled: boolean;
}

export const PickupFeed: React.FC<PickupFeedProps> = ({ notifications, touchEnabled }) => {
  if (notifications.length === 0) return null;

  return (
    <div
      aria-live="polite"
      data-testid="pickup-feed"
      className={`fixed z-20 pointer-events-none flex flex-col items-end gap-1.5 ${
        touchEnabled ? 'top-[146px] sm:top-[116px] right-3.5' : 'top-[116px] right-3.5'
      }`}
    >
      {notifications.map((n) => {
        const progress = n.age / (n.duration || 1);
        const opacity = progress > 0.78 ? Math.max(0, 1 - (progress - 0.78) / 0.22) : 1;
        return (
          <div
            key={n.id}
            data-pickup-item={n.item}
            style={{ opacity }}
            className="hud-panel px-2.5 py-1.5 flex items-center gap-2.5 min-w-[168px] max-w-[240px] border-l-2 border-l-[#f0d078]"
          >
            <div className="hud-slot w-9 h-9 flex items-center justify-center shrink-0 p-1">
              <ItemIcon kind={n.item} className="w-7 h-7" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-baseline justify-between gap-2">
                <span className="font-tactical text-xs font-bold text-[#f3ecd8] truncate">
                  {n.name}
                </span>
                <span
                  className="font-telemetry text-xs font-bold shrink-0"
                  style={{ color: n.color }}
                >
                  +{n.qty}
                </span>
              </div>
              {n.source && (
                <div className="font-telemetry text-[9px] uppercase tracking-wider text-[#9db097] truncate">
                  {n.source}
                </div>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
};
