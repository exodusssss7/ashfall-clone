import React, { useEffect, useRef, useState } from 'react';
import { Play, RotateCcw, Settings, Skull, UserRound, Volume2, VolumeX } from 'lucide-react';
import {
  APPEARANCE_PRESETS,
  derivePlayerPalette,
  getProfile,
  hasCompletedSetup,
  sanitizeName,
  subscribeProfile,
  updateProfile,
  type PlayerAppearance,
  type PlayerProfile,
} from '../game/profile';
import { APP_VERSION } from '../game/version';

export interface StartScreenSaveMeta {
  day: number;
  timeLabel: string;
  hardcore: boolean;
  playerName: string;
}

interface StartScreenProps {
  bestScore: number;
  muted: boolean;
  touchEnabled: boolean;
  saveMeta: StartScreenSaveMeta | null;
  onStart: (hardcore: boolean) => void;
  onContinue: () => void;
  onToggleMute: () => void;
  onOpenSettings: () => void;
}

/** Approved game badge: pixel field-badge ring around the ash-fall camp scene (user-approved artwork). */
const AshEmblem: React.FC<{ size?: number }> = ({ size = 84 }) => (
  <img
    src="/ui/the-alive-horde-badge.png"
    alt=""
    width={size}
    height={size}
    aria-hidden="true"
    style={{ imageRendering: 'pixelated' }}
  />
);

/** Front-facing pixel survivor preview for the colour customizer. */
function drawSurvivorPreview(canvas: HTMLCanvasElement, appearance: PlayerAppearance): void {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const pal = derivePlayerPalette(appearance);
  const S = 6; // pixel scale
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.imageSmoothingEnabled = false;
  const px = (x: number, y: number, w: number, h: number, color: string) => {
    ctx.fillStyle = color;
    ctx.fillRect(x * S, y * S, w * S, h * S);
  };
  // cap + crown highlight
  px(4, 0, 8, 3, pal.hair);
  px(5, 0, 6, 1, shade(pal.hair, 1.35));
  px(3, 2, 10, 1, shade(pal.hair, 0.55)); // brim
  // face
  px(4, 3, 8, 4, pal.skin);
  px(4, 6, 8, 1, pal.skinShadow);
  px(5, 4, 2, 1, '#17191c');
  px(9, 4, 2, 1, '#17191c');
  // torso + arms
  px(3, 7, 10, 6, pal.shirt);
  px(3, 7, 10, 2, pal.shirtHi);
  px(3, 12, 10, 1, pal.shirtDark);
  px(1, 7, 2, 5, pal.shirt);
  px(13, 7, 2, 5, pal.shirt);
  px(1, 11, 2, 2, pal.skin);
  px(13, 11, 2, 2, pal.skin);
  // belt
  px(3, 13, 10, 1, '#241c16');
  // legs + boots
  px(4, 14, 3, 4, pal.pants);
  px(9, 14, 3, 4, pal.pants);
  px(4, 14, 3, 1, pal.pantsHi);
  px(9, 14, 3, 1, pal.pantsHi);
  px(4, 18, 3, 2, '#1b1614');
  px(9, 18, 3, 2, '#1b1614');
}

function shade(hex: string, factor: number): string {
  const n = parseInt(hex.slice(1), 16);
  const ch = (v: number) => Math.max(0, Math.min(255, Math.round(v * factor)));
  return `#${((ch((n >> 16) & 0xff) << 16) | (ch((n >> 8) & 0xff) << 8) | ch(n & 0xff)).toString(16).padStart(6, '0')}`;
}

const APPEARANCE_ROWS: Array<{ key: keyof PlayerAppearance; label: string }> = [
  { key: 'skin', label: 'Skin' },
  { key: 'shirt', label: 'Shirt' },
  { key: 'pants', label: 'Pants' },
  { key: 'hair', label: 'Cap / Hair' },
];

export const StartScreen: React.FC<StartScreenProps> = ({
  bestScore,
  muted,
  touchEnabled,
  saveMeta,
  onStart,
  onContinue,
  onToggleMute,
  onOpenSettings,
}) => {
  const [step, setStep] = useState<'splash' | 'menu' | 'setup'>('splash');
  const [mode, setMode] = useState<'normal' | 'hardcore'>('normal');
  const [profile, setProfile] = useState<PlayerProfile>(() => getProfile());
  const [draftName, setDraftName] = useState(profile.name);
  const [firstRunSetup, setFirstRunSetup] = useState(false);
  const previewRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => subscribeProfile((p) => setProfile(p)), []);

  useEffect(() => {
    if (step === 'setup' && previewRef.current) {
      drawSurvivorPreview(previewRef.current, profile.appearance);
    }
  }, [step, profile.appearance]);

  const beginRun = () => {
    if (!hasCompletedSetup()) {
      setDraftName(profile.name);
      setFirstRunSetup(true);
      setStep('setup');
      return;
    }
    onStart(mode === 'hardcore');
  };

  const saveSetup = (thenStart: boolean) => {
    const name = sanitizeName(draftName) || 'Survivor';
    updateProfile({ name, customized: true });
    setFirstRunSetup(false);
    if (thenStart) {
      onStart(mode === 'hardcore');
    } else {
      setStep('menu');
    }
  };

  if (step === 'splash') {
    return (
      <div
        className="paper-title-screen fixed inset-0 z-20 flex flex-col items-center justify-center cursor-pointer select-none"
        role="button"
        aria-label="The alive horde - tap to begin"
        onPointerDown={() => setStep('menu')}
      >
        <div className="splash-fade flex flex-col items-center gap-4">
          <AshEmblem size={110} />
          <div className="flex flex-col items-center leading-none">
            <span className="font-telemetry text-sm tracking-[0.5em] text-[#c7c2b6] uppercase">The Alive</span>
            <h1 className="title-book-heading splash-logo" style={{ margin: '6px 0 0' }}>HORDE</h1>
            <span className="block w-28 h-[3px] bg-[#d9822b] mt-2" />
          </div>
        </div>
        <div className="splash-tap font-telemetry text-sm tracking-widest text-[#e8a849] absolute bottom-14">
          TAP TO BEGIN
        </div>
        <div className="absolute bottom-4 font-telemetry text-[10px] tracking-wider text-[#69706c]">
          v{APP_VERSION} · FIELD EDITION
        </div>
      </div>
    );
  }

  if (step === 'setup') {
    return (
      <div className="paper-title-screen fixed inset-0 z-20 overflow-y-auto">
        <div className="min-h-full flex items-center justify-center p-4">
          <div className="journal-title-card setup-card relative z-10 w-full max-w-md">
            <div className="title-book-kicker">FIELD REGISTRATION</div>
            <h2 className="font-pixel text-xl md:text-2xl text-[#f0ece1] tracking-wide mb-1">
              {firstRunSetup ? 'Name Your Survivor' : 'Survivor Profile'}
            </h2>
            <p className="font-telemetry text-[11px] text-[#9aa09c] mb-4">
              Colours only - the survivor keeps their gear and build.
            </p>

            <div className="flex gap-4 items-start">
              <div className="setup-preview shrink-0">
                <canvas ref={previewRef} width={96} height={120} className="pixelated" />
                <div className="font-telemetry text-[10px] text-[#c7c2b6] text-center mt-1 truncate max-w-[96px]">
                  {sanitizeName(draftName) || 'Survivor'}
                </div>
              </div>

              <div className="flex-1 min-w-0">
                <label className="font-telemetry text-[10px] uppercase tracking-wider text-[#8a918d]" htmlFor="survivor-name">
                  Name
                </label>
                <input
                  id="survivor-name"
                  value={draftName}
                  onChange={(e) => setDraftName(e.target.value)}
                  maxLength={12}
                  placeholder="Survivor"
                  autoComplete="off"
                  className="setup-name-input w-full font-tactical text-base px-2.5 py-2 mb-3"
                />

                {APPEARANCE_ROWS.map((row) => (
                  <div key={row.key} className="mb-2.5">
                    <div className="font-telemetry text-[10px] uppercase tracking-wider text-[#8a918d] mb-1">
                      {row.label}
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      {APPEARANCE_PRESETS[row.key].map((color) => (
                        <button
                          key={color}
                          type="button"
                          aria-label={`${row.label} ${color}`}
                          onClick={() =>
                            updateProfile({ appearance: { ...profile.appearance, [row.key]: color } })
                          }
                          className={`setup-swatch ${profile.appearance[row.key] === color ? 'setup-swatch-active' : ''}`}
                          style={{ background: color }}
                        />
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="flex gap-2.5 mt-4">
              {!firstRunSetup && (
                <button
                  type="button"
                  onClick={() => setStep('menu')}
                  className="flex-1 py-2.5 hud-slot text-[#c7c2b6] hover:text-white font-tactical text-sm cursor-pointer"
                >
                  Back
                </button>
              )}
              <button
                type="button"
                data-start="true"
                onClick={() => saveSetup(firstRunSetup)}
                className="flex-1 py-3 bg-[#d9822b] hover:bg-[#e8943c] text-[#0d1012] font-pixel font-bold text-sm tracking-wide cursor-pointer"
              >
                {firstRunSetup ? 'BEGIN' : 'Save'}
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // Main menu
  return (
    <div className="paper-title-screen fixed inset-0 z-20 pointer-events-none flex flex-col justify-between p-4 sm:p-6 md:p-10">
      <div
        className="absolute inset-0 pointer-events-none"
        style={{
          background:
            'radial-gradient(circle at 65% 50%, rgba(11,13,14,0.18) 0%, rgba(11,13,14,0.72) 72%, rgba(8,10,11,0.92) 100%)',
        }}
      />

      <div className="relative z-10 flex justify-between items-center">
        <span className="font-telemetry text-xs text-[#9aa09c] tracking-wide">
          FIELD EDITION · v{APP_VERSION}
        </span>
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

      <div className="journal-title-card relative z-10 max-w-xl my-auto">
        <div className="flex items-center gap-3 mb-2">
          <AshEmblem size={54} />
          <div>
            <div className="title-book-kicker">THE SURVIVOR'S JOURNAL · VOL. 01</div>
            <h1 className="title-book-heading" style={{ fontSize: '0.72em' }}>THE ALIVE HORDE</h1>
          </div>
        </div>

        {profile.name && (
          <button
            type="button"
            onClick={() => {
              setDraftName(profile.name);
              setFirstRunSetup(false);
              setStep('setup');
            }}
            className="pointer-events-auto menu-survivor-chip font-telemetry text-xs cursor-pointer"
          >
            <UserRound className="w-3.5 h-3.5" /> {profile.name}
            <span className="text-[#8a918d]">· edit</span>
          </button>
        )}

        <div className="menu-mode-row" role="radiogroup" aria-label="Run mode">
          <button
            type="button"
            role="radio"
            aria-checked={mode === 'normal'}
            onClick={() => setMode('normal')}
            className={`pointer-events-auto menu-mode-card cursor-pointer ${mode === 'normal' ? 'menu-mode-active' : ''}`}
          >
            <span className="font-pixel text-sm">SURVIVAL</span>
            <span className="font-telemetry text-[10px] text-[#9aa09c]">Autosaves · fall and wake at camp</span>
          </button>
          <button
            type="button"
            role="radio"
            aria-checked={mode === 'hardcore'}
            onClick={() => setMode('hardcore')}
            className={`pointer-events-auto menu-mode-card menu-mode-hardcore cursor-pointer ${mode === 'hardcore' ? 'menu-mode-active' : ''}`}
          >
            <span className="font-pixel text-sm flex items-center gap-1.5">
              <Skull className="w-3.5 h-3.5" /> HARDCORE
            </span>
            <span className="font-telemetry text-[10px] text-[#9aa09c]">One life · death deletes the run</span>
          </button>
        </div>

        <div className="flex flex-col gap-2.5 mt-4">
          {saveMeta && (
            <button
              type="button"
              onClick={(e) => {
                e.currentTarget.blur();
                onContinue();
              }}
              className="pointer-events-auto menu-continue-btn cursor-pointer"
            >
              <RotateCcw className="w-4 h-4" />
              <span>
                CONTINUE · Day {saveMeta.day} · {saveMeta.timeLabel}
                {saveMeta.hardcore ? ' · HARDCORE' : ''}
                {saveMeta.playerName ? ` · ${saveMeta.playerName}` : ''}
              </span>
            </button>
          )}
          <div className="flex items-center gap-5">
            <button
              type="button"
              data-start="true"
              onClick={(e) => {
                e.currentTarget.blur();
                beginRun();
              }}
              className="pointer-events-auto px-6 md:px-7 py-3 md:py-3.5 min-h-[44px] bg-[#d9822b] hover:bg-[#e8943c] active:translate-y-0.5 text-[#0d1012] font-pixel text-base md:text-lg font-bold tracking-wider border-2 border-[#f5c06e] shadow-[0_6px_20px_rgba(0,0,0,0.65)] transition-colors cursor-pointer whitespace-nowrap shrink-0 flex items-center gap-2"
            >
              <Play className="w-4 h-4" /> {saveMeta ? 'New Run' : 'Start Survival'}
            </button>

            {bestScore > 0 && (
              <div className="font-telemetry text-sm text-[#c7c2b6]">
                <span className="text-[#8a8f8c] uppercase tracking-wider mr-2">Best Score</span>
                <span className="text-[#e8a849] font-bold">{bestScore}</span>
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="menu-hints relative z-10 text-[11px] md:text-xs font-telemetry text-[#b9beb9] tracking-wide">
        {touchEnabled
          ? 'Horizontal Touch: Left Stick Move · Left Fire Button · Right Stick Aim · Contextual Actions'
          : 'WASD Move · Mouse Aim & Fire · E Interact/Fish · K Cook · V Barricade · G Drive · Shift Boost · T Repair'}
      </div>
    </div>
  );
};
