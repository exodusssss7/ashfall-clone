import React from 'react';
import type { HudSnapshot } from '../game/types';

interface PauseModalProps {
  hud: HudSnapshot;
  onResume: () => void;
  onRestart: () => void;
  onTitle: () => void;
}

export const PauseModal: React.FC<PauseModalProps> = ({
  hud,
  onResume,
  onRestart,
  onTitle,
}) => {
  return (
    <div className="fixed inset-0 z-30 flex items-center justify-center p-4 bg-black/60">
      <div
        role="dialog"
        aria-label="Game Paused"
        className="hud-panel w-full max-w-sm p-6 text-center space-y-5"
      >
        <div>
          <h2 className="font-pixel text-2xl text-[#f0ece1] tracking-wide">Paused</h2>
          <p className="text-xs font-telemetry text-[#8a918d] mt-1">
            Day {hud.day} · {hud.timeLabel}
          </p>
        </div>

        <div className="grid grid-cols-2 gap-3 text-left bg-[#111416] border border-[#2a302e] p-3">
          <div>
            <div className="text-[10px] font-telemetry uppercase text-[#8a918d]">Killed</div>
            <div className="font-telemetry text-lg font-bold text-[#f0ece1]">{hud.kills}</div>
          </div>
          <div>
            <div className="text-[10px] font-telemetry uppercase text-[#8a918d]">Score</div>
            <div className="font-telemetry text-lg font-bold text-[#e8a849]">{hud.score}</div>
          </div>
        </div>

        <div className="flex flex-col gap-2.5">
          <button
            type="button"
            onClick={onResume}
            className="w-full py-2.5 bg-[#d9822b] hover:bg-[#e8943c] text-[#0d1012] font-pixel font-bold text-base tracking-wide cursor-pointer"
          >
            Resume
          </button>
          <button
            type="button"
            onClick={onRestart}
            className="w-full py-2.5 hud-slot hover:border-[#d9822b] text-[#e6e2d8] font-tactical font-semibold text-sm cursor-pointer"
          >
            Restart Run
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
