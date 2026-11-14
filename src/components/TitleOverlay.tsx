import React from 'react';
import { Settings, Volume2, VolumeX } from 'lucide-react';

interface TitleOverlayProps {
  bestScore: number;
  muted: boolean;
  touchEnabled: boolean;
  onStart: () => void;
  onToggleMute: () => void;
  onOpenSettings: () => void;
}

export const TitleOverlay: React.FC<TitleOverlayProps> = ({
  bestScore,
  muted,
  touchEnabled,
  onStart,
  onToggleMute,
  onOpenSettings,
}) => {
  return (
    <div className="paper-title-screen fixed inset-0 z-20 pointer-events-none flex flex-col justify-between p-4 sm:p-6 md:p-10">
      {/* Subtle atmospheric vignette scrim so title lockup reads cleanly over the live world */}
      <div
        className="absolute inset-0 pointer-events-none"
        style={{
          background:
            'radial-gradient(circle at 65% 50%, rgba(11,13,14,0.18) 0%, rgba(11,13,14,0.72) 72%, rgba(8,10,11,0.92) 100%)',
        }}
      />

      {/* Top right sound button */}
      <div className="relative z-10 flex justify-between items-center">
        <span className="font-telemetry text-xs text-[#9aa09c] tracking-wide">FIELD EDITION</span>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={(e) => {
              e.currentTarget.blur();
              onOpenSettings();
            }}
            aria-label="Open settings"
            className="pointer-events-auto hud-slot w-11 h-11 flex items-center justify-center text-[#c7c2b6] hover:text-white hover:border-[#d9822b] transition-colors cursor-pointer"
          >
            <Settings className="w-5 h-5" />
          </button>
          <button
            type="button"
            onClick={(e) => {
              e.currentTarget.blur();
              onToggleMute();
            }}
            aria-label={muted ? 'Unmute audio' : 'Mute audio'}
            className="pointer-events-auto hud-slot w-11 h-11 flex items-center justify-center text-[#c7c2b6] hover:text-white hover:border-[#d9822b] transition-colors cursor-pointer"
          >
            {muted ? <VolumeX className="w-5 h-5" /> : <Volume2 className="w-5 h-5" />}
          </button>
        </div>
      </div>

      {/* Left-third asymmetric lockup over calm negative space */}
      <div className="journal-title-card relative z-10 max-w-xl my-auto">
        <div className="title-book-kicker">THE SURVIVOR'S JOURNAL · VOL. 01</div>
        <h1 className="title-book-heading" style={{ fontSize: '0.72em' }}>THE ALIVE HORDE</h1>
        <div className="title-book-rule"><span/>A field guide to staying alive<span/></div>

        <p className="font-tactical text-sm md:text-lg text-[#c7c2b6] tracking-wide mb-4 md:mb-7 drop-shadow-[0_2px_6px_rgba(0,0,0,0.9)]">
          Isometric Zombie Apocalypse Survival · Scavenge, Barricade &amp; Outlast the Night
        </p>

        <div className="flex items-center gap-5">
          <button
            type="button"
            data-start="true"
            onClick={(e) => {
              e.currentTarget.blur();
              onStart();
            }}
            className="pointer-events-auto px-6 md:px-7 py-3 md:py-3.5 min-h-[44px] bg-[#d9822b] hover:bg-[#e8943c] active:translate-y-0.5 text-[#0d1012] font-pixel text-base md:text-lg font-bold tracking-wider border-2 border-[#f5c06e] shadow-[0_6px_20px_rgba(0,0,0,0.65)] transition-colors cursor-pointer whitespace-nowrap shrink-0"
          >
            Start Survival
          </button>

          {bestScore > 0 && (
            <div className="font-telemetry text-sm text-[#c7c2b6]">
              <span className="text-[#8a8f8c] uppercase tracking-wider mr-2">Best Score</span>
              <span className="text-[#e8a849] font-bold">{bestScore}</span>
            </div>
          )}
        </div>
      </div>

      {/* Single flat control hint line in bottom safe margin */}
      <div className="relative z-10 text-xs md:text-sm font-telemetry text-[#9aa09c] tracking-wide">
        {touchEnabled
          ? 'Horizontal Touch: Left Stick Move · Left Fire Button · Right Stick Aim · Contextual Actions'
          : 'WASD Move · Mouse Aim & Fire · E Interact/Fish · K Cook · V Barricade · G Drive · Shift Boost · T Repair'}
      </div>
    </div>
  );
};
