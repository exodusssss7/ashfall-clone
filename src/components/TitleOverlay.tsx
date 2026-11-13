import React from 'react';
import { Volume2, VolumeX } from 'lucide-react';

interface TitleOverlayProps {
  bestScore: number;
  muted: boolean;
  touchEnabled: boolean;
  onStart: () => void;
  onToggleMute: () => void;
}

export const TitleOverlay: React.FC<TitleOverlayProps> = ({
  bestScore,
  muted,
  touchEnabled,
  onStart,
  onToggleMute,
}) => {
  return (
    <div className="fixed inset-0 z-20 pointer-events-none flex flex-col justify-between p-4 sm:p-6 md:p-10">
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
        <span className="font-telemetry text-xs text-[#9aa09c] tracking-wide">v0.4</span>
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

      {/* Left-third asymmetric lockup over calm negative space */}
      <div className="relative z-10 max-w-xl my-auto">
        {/* Bespoke inline SVG Title Emblem */}
        <svg
          viewBox="0 0 420 108"
          className="w-full max-w-[260px] md:max-w-[400px] h-auto mb-2 md:mb-3 drop-shadow-[0_4px_12px_rgba(0,0,0,0.85)]"
          role="img"
          aria-label="ASHFALL"
        >
          {/* Weathered stencil backing bar */}
          <rect x="4" y="10" width="8" height="80" fill="#d9822b" />
          <rect x="4" y="10" width="8" height="24" fill="#e8a849" />
          {/* Chunky pixel-stencil letterforms */}
          <g fill="#f0ece1" stroke="#0d1012" strokeWidth="3" style={{ paintOrder: 'stroke fill' }}>
            {/* A */}
            <path d="M26 88 L26 24 L36 14 L64 14 L74 24 L74 88 L58 88 L58 60 L42 60 L42 88 Z M42 46 L58 46 L58 28 L42 28 Z" />
            {/* S */}
            <path d="M84 88 L84 72 L114 72 L114 58 L92 58 L84 50 L84 22 L92 14 L128 14 L128 28 L100 28 L100 44 L122 44 L130 52 L130 80 L122 88 Z" />
            {/* H */}
            <path d="M140 88 L140 14 L156 14 L156 44 L174 44 L174 14 L190 14 L190 88 L174 88 L174 58 L156 58 L156 88 Z" />
            {/* F */}
            <path d="M202 88 L202 14 L248 14 L248 28 L218 28 L218 46 L242 46 L242 60 L218 60 L218 88 Z" />
            {/* A */}
            <path d="M256 88 L256 24 L266 14 L294 14 L304 24 L304 88 L288 88 L288 60 L272 60 L272 88 Z M272 46 L288 46 L288 28 L272 28 Z" />
            {/* L */}
            <path d="M314 88 L314 14 L330 14 L330 74 L356 74 L356 88 Z" />
            {/* L */}
            <path d="M364 88 L364 14 L380 14 L380 74 L406 74 L406 88 Z" />
          </g>
          {/* Ash notches */}
          <rect x="60" y="34" width="6" height="4" fill="#0d1012" />
          <rect x="210" y="20" width="8" height="3" fill="#0d1012" />
          <rect x="330" y="74" width="5" height="5" fill="#d9822b" />
        </svg>

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
