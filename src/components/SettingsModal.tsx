import React, { useState } from 'react';
import { Volume2, VolumeX } from 'lucide-react';
import {
  DEFAULT_SETTINGS,
  getSettings,
  updateSettings,
  type GameSettings,
  type GraphicsQuality,
} from '../game/settings';

interface SettingsModalProps {
  onClose: () => void;
}

const QUALITY_OPTIONS: { id: GraphicsQuality; label: string; hint: string }[] = [
  { id: 'low', label: 'Low', hint: 'Battery saver' },
  { id: 'medium', label: 'Medium', hint: 'Balanced' },
  { id: 'high', label: 'High', hint: 'Sharpest' },
];

export const SettingsModal: React.FC<SettingsModalProps> = ({ onClose }) => {
  const [settings, setSettings] = useState<GameSettings>(getSettings());

  const patch = (p: Partial<GameSettings>) => {
    setSettings(updateSettings(p));
  };

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center p-4 bg-black/60">
      <div
        role="dialog"
        aria-label="Game Settings"
        className="hud-panel w-full max-w-sm p-6 space-y-5 text-left"
      >
        <div className="flex items-center justify-between">
          <h2 className="font-pixel text-2xl text-[#f0ece1] tracking-wide">Settings</h2>
          <button
            type="button"
            onClick={(e) => {
              e.currentTarget.blur();
              onClose();
            }}
            className="hud-slot px-3 py-1.5 text-[#e06c64] hover:text-white font-tactical text-sm cursor-pointer"
          >
            Done
          </button>
        </div>

        {/* Sound effects volume */}
        <div className="space-y-1.5">
          <div className="flex items-center justify-between">
            <label htmlFor="sfx-volume" className="text-[10px] font-telemetry uppercase text-[#8a918d]">
              Sound FX Volume
            </label>
            <span className="font-telemetry text-xs text-[#e8a849]">{Math.round(settings.sfxVolume * 100)}%</span>
          </div>
          <div className="flex items-center gap-2.5">
            <button
              type="button"
              aria-label={settings.muted ? 'Unmute audio' : 'Mute audio'}
              onClick={(e) => {
                e.currentTarget.blur();
                patch({ muted: !settings.muted });
              }}
              className="hud-slot w-9 h-9 shrink-0 flex items-center justify-center text-[#c7c2b6] hover:text-white cursor-pointer"
            >
              {settings.muted ? <VolumeX className="w-4 h-4" /> : <Volume2 className="w-4 h-4" />}
            </button>
            <input
              id="sfx-volume"
              type="range"
              min={0}
              max={100}
              step={1}
              value={Math.round(settings.sfxVolume * 100)}
              onChange={(e) => patch({ sfxVolume: Number(e.target.value) / 100, muted: Number(e.target.value) === 0 ? settings.muted : false })}
              className="settings-slider flex-1"
            />
          </div>
        </div>

        {/* Graphics quality */}
        <div className="space-y-1.5">
          <div className="text-[10px] font-telemetry uppercase text-[#8a918d]">Graphics Quality</div>
          <div className="grid grid-cols-3 gap-2">
            {QUALITY_OPTIONS.map((opt) => (
              <button
                key={opt.id}
                type="button"
                onClick={(e) => {
                  e.currentTarget.blur();
                  patch({ graphicsQuality: opt.id });
                }}
                className={`px-2 py-2 font-tactical text-sm cursor-pointer transition-colors ${
                  settings.graphicsQuality === opt.id
                    ? 'hud-slot-active text-[#f0d078]'
                    : 'hud-slot text-[#9aa09c] hover:text-white'
                }`}
              >
                <div className="font-semibold">{opt.label}</div>
                <div className="text-[9px] font-telemetry opacity-70">{opt.hint}</div>
              </button>
            ))}
          </div>
        </div>

        {/* Touch sensitivity */}
        <div className="space-y-1.5">
          <div className="flex items-center justify-between">
            <label htmlFor="touch-sensitivity" className="text-[10px] font-telemetry uppercase text-[#8a918d]">
              Aim / Look Sensitivity
            </label>
            <span className="font-telemetry text-xs text-[#e8a849]">{Math.round(settings.touchSensitivity * 100)}%</span>
          </div>
          <input
            id="touch-sensitivity"
            type="range"
            min={50}
            max={200}
            step={5}
            value={Math.round(settings.touchSensitivity * 100)}
            onChange={(e) => patch({ touchSensitivity: Number(e.target.value) / 100 })}
            className="settings-slider w-full"
          />
        </div>

        {/* Screen shake */}
        <button
          type="button"
          onClick={(e) => {
            e.currentTarget.blur();
            patch({ screenShake: !settings.screenShake });
          }}
          className="w-full flex items-center justify-between px-3 py-2.5 hud-slot hover:border-[#d9822b] cursor-pointer"
        >
          <span className="font-tactical text-sm text-[#e6e2d8]">Screen Shake</span>
          <span className={`font-telemetry text-xs font-bold ${settings.screenShake ? 'text-[#8ee08a]' : 'text-[#8a918d]'}`}>
            {settings.screenShake ? 'ON' : 'OFF'}
          </span>
        </button>

        <button
          type="button"
          onClick={(e) => {
            e.currentTarget.blur();
            patch({ ...DEFAULT_SETTINGS });
          }}
          className="w-full py-2 text-[#9aa09c] hover:text-white font-tactical text-xs cursor-pointer"
        >
          Reset to Defaults
        </button>
      </div>
    </div>
  );
};
