import React from 'react';
import type { HudSnapshot } from '../game/types';

interface GameOverModalProps {
  hud: HudSnapshot;
  onRestart: () => void;
  onTitle: () => void;
}

export const GameOverModal: React.FC<GameOverModalProps> = ({
  hud,
  onRestart,
  onTitle,
}) => {
  return (
    <div className="fixed inset-0 z-30 flex items-center justify-center p-4 bg-black/70">
      <div
        role="dialog"
        aria-label="Game Over"
        className="hud-panel w-full max-w-md p-6 text-center space-y-5"
      >
        <div>
          <h2 className="font-pixel text-3xl text-[#e0564f] tracking-wide">You Fell</h2>
          <p className="text-xs font-telemetry text-[#9aa09c] mt-1">
            Survived until Day {hud.day} · {hud.timeLabel}
          </p>
        </div>

        <div className="grid grid-cols-3 gap-2.5 bg-[#111416] border border-[#2a302e] p-3.5 text-left">
          <div>
            <div className="text-[10px] font-telemetry uppercase text-[#8a918d]">Days</div>
            <div className="font-telemetry text-lg font-bold text-[#f0ece1]">{hud.day}</div>
          </div>
          <div>
            <div className="text-[10px] font-telemetry uppercase text-[#8a918d]">Kills</div>
            <div className="font-telemetry text-lg font-bold text-[#f0ece1]">{hud.kills}</div>
          </div>
          <div>
            <div className="text-[10px] font-telemetry uppercase text-[#8a918d]">Score / Best</div>
            <div className="font-telemetry text-base font-bold text-[#e8a849]">
              {hud.score} <span className="text-xs text-[#79807c]">/ {hud.bestScore}</span>
            </div>
          </div>
        </div>

        <div className="flex flex-col gap-2.5">
          <button
            type="button"
            data-start="true"
            onClick={onRestart}
            className="w-full py-3 bg-[#d9822b] hover:bg-[#e8943c] text-[#0d1012] font-pixel font-bold text-base tracking-wide cursor-pointer"
          >
            Try Again
          </button>
          <button
            type="button"
            onClick={onTitle}
            className="w-full py-2.5 hud-slot hover:border-[#8a918d] text-[#9aa09c] hover:text-white font-tactical text-sm cursor-pointer"
          >
            Main Menu
          </button>
        </div>
      </div>
    </div>
  );
};
