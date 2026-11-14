import { ItemIcon } from './ItemIcon';
import { useState, type RefObject } from 'react';
import { Map, X, Navigation, AlertTriangle, CheckCircle2 } from 'lucide-react';
import type { HudSnapshot, LandmarkKind } from '../game/types';

const PLACES = [
  { name: 'Crossroads camp', detail: 'Starting campfire · cooking', x: 26.5, y: 27.5, icon: 'meal' },
  { name: 'Lake pier', detail: 'Fishing · north-east of town', x: 40.5, y: 10.5, icon: 'fish' },
  { name: 'Diner', detail: 'Kitchen stove · food supplies', x: 39.5, y: 23.5, icon: 'food' },
  { name: 'Clinic', detail: 'Medical supplies · locked entrance', x: 18.5, y: 23.5, icon: 'bandage' },
  { name: 'Hardware shed', detail: 'Building materials', x: 18.5, y: 33.5, icon: 'wood' },
  { name: 'Police outpost', detail: 'Ammunition · locked entrance', x: 39.5, y: 33.5, icon: 'pistol' },
];

interface Place {
  name: string;
  detail: string;
  x: number;
  y: number;
  icon: string;
}

function iconForLandmark(kind: LandmarkKind): string {
  switch (kind) {
    case 'checkpoint':
    case 'outpost':
      return 'pistol';
    case 'pileup':
      return 'scrap';
    case 'campground':
      return 'meal';
    case 'clinic':
      return 'bandage';
    case 'diner':
      return 'food';
    case 'cabin':
    default:
      return 'wood';
  }
}

interface Props {
  hud: HudSnapshot;
  canvasRef: RefObject<HTMLCanvasElement | null>;
  showTrigger: boolean;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onWaypoint: (x: number | null, y: number | null) => void;
}

export function NavigationRadar({
  hud,
  canvasRef,
  showTrigger,
  open,
  onOpenChange,
  onWaypoint,
}: Props) {
  const [selected, setSelected] = useState<Place | null>(null);
  const dx = selected ? selected.x - hud.worldCoords.gx - 0.5 : 0;
  const dy = selected ? selected.y - hud.worldCoords.gy - 0.5 : 0;
  const distance = Math.round(Math.hypot(dx, dy));
  // Compass is screen-aligned to the same isometric projection as the game.
  const angle = (Math.atan2(dx + dy, dx - dy) * 180) / Math.PI + 90;

  return (
    <>
      {showTrigger && (
        <button
          type="button"
          aria-label="Open navigation map"
          data-testid="mobile-map"
          onClick={() => onOpenChange(true)}
          className="fixed left-3 top-[122px] z-10 pointer-events-auto hud-panel p-1 text-left text-[#c7c2b6] w-[88px] shadow-lg"
        >
          <div className="flex justify-between items-center text-[9px] font-telemetry px-0.5 pb-0.5">
            <span>MAP</span>
            <Map className="w-3 h-3" />
          </div>
          <canvas
            ref={canvasRef}
            width={112}
            height={112}
            aria-label="Nearby explored terrain, survivor, loot and infected"
            className="block pixelated w-[76px] h-[76px]"
          />
          {selected ? (
            <div className="text-[9px] font-telemetry text-[#70d9ff] leading-tight mt-1 flex gap-1 items-center">
              <Navigation
                className="w-3 h-3 shrink-0"
                style={{ transform: `rotate(${angle - 45}deg)` }}
              />
              <span>
                {distance <= 2 ? 'ARRIVED' : `${distance} tiles`}
                <br />
                {selected.name}
              </span>
            </div>
          ) : (
            <div className="text-[9px] font-telemetry mt-0.5 truncate">{hud.currentBiomeLabel}</div>
          )}
        </button>
      )}

      {open && (
        <div
          className="fixed inset-0 z-30 bg-black/75 flex items-center justify-center p-3 pointer-events-auto"
          onPointerDown={(ev) => ev.stopPropagation()}
        >
          <section
            role="dialog"
            aria-label="World navigation"
            className="hud-panel w-full max-w-lg max-h-[94dvh] flex flex-col"
          >
            <header className="flex justify-between items-center px-4 py-2 border-b border-[#353d3b]">
              <div>
                <h2 className="font-pixel text-xl text-[#f0ece1]">World Navigation</h2>
                <p className="text-[10px] font-telemetry text-[#9aa09c]">
                  Region: <span className="text-[#f0d078]">{hud.currentBiomeLabel}</span> · Coords ({hud.worldCoords.gx},{' '}
                  {hud.worldCoords.gy})
                </p>
              </div>
              <button
                type="button"
                aria-label="Close navigation"
                className="hud-slot p-2 cursor-pointer"
                onClick={() => onOpenChange(false)}
              >
                <X className="w-4 h-4" />
              </button>
            </header>

            <div className="overflow-y-auto p-3 space-y-3">
              {hud.discoveredLandmarks.length > 0 && (
                <div>
                  <div className="text-[10px] font-telemetry uppercase tracking-wider text-[#f0d078] mb-1.5">
                    Discovered Wild Landmarks &amp; Hotspots
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    {hud.discoveredLandmarks.map((lm) => {
                      const lmDist = Math.round(
                        Math.hypot(lm.x - hud.worldCoords.gx - 0.5, lm.y - hud.worldCoords.gy - 0.5)
                      );
                      const isSel = selected?.name === lm.name;
                      return (
                        <button
                          type="button"
                          key={lm.id}
                          onClick={() => {
                            setSelected({
                              name: lm.name,
                              detail: `${lmDist}m · ${lm.kind}`,
                              x: lm.x,
                              y: lm.y,
                              icon: iconForLandmark(lm.kind),
                            });
                            onWaypoint(lm.x, lm.y);
                            onOpenChange(false);
                          }}
                          className={`hud-slot p-2 text-left min-h-[54px] flex gap-2 items-center cursor-pointer ${
                            isSel ? 'border-[#70d9ff]' : ''
                          }`}
                        >
                          <ItemIcon kind={iconForLandmark(lm.kind)} className="w-8 h-8 shrink-0" />
                          <div className="min-w-0 flex-1">
                            <div className="text-xs font-bold text-[#f0ece1] truncate">{lm.name}</div>
                            <div className="text-[10px] text-[#9aa09c] flex items-center gap-1.5">
                              <span>{lmDist} tiles</span>
                              {lm.hotspotCleared ? (
                                <span className="inline-flex items-center gap-0.5 text-[#78c796]">
                                  <CheckCircle2 className="w-3 h-3" /> Cleared
                                </span>
                              ) : lm.threatLevel === 'high' ? (
                                <span className="inline-flex items-center gap-0.5 text-[#ff6e66]">
                                  <AlertTriangle className="w-3 h-3" /> Horde
                                </span>
                              ) : (
                                <span className="text-[#f0d078]">Active</span>
                              )}
                            </div>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

              <div>
                <div className="text-[10px] font-telemetry uppercase tracking-wider text-[#9aa09c] mb-1.5">
                  Starter Town Landmarks
                </div>
                <div className="grid grid-cols-2 gap-2">
                  {PLACES.map((place) => (
                    <button
                      type="button"
                      key={place.name}
                      onClick={() => {
                        setSelected(place);
                        onWaypoint(place.x, place.y);
                        onOpenChange(false);
                      }}
                      className={`hud-slot p-2 text-left min-h-[54px] flex gap-2 items-center cursor-pointer ${
                        selected?.name === place.name ? 'border-[#70d9ff]' : ''
                      }`}
                    >
                      <ItemIcon kind={place.icon} className="w-8 h-8 shrink-0" />
                      <div>
                        <div className="text-xs font-bold text-[#f0ece1]">{place.name}</div>
                        <div className="text-[10px] text-[#9aa09c]">{place.detail}</div>
                      </div>
                    </button>
                  ))}
                </div>
              </div>
            </div>

            <footer className="px-4 pb-2 pt-1.5 border-t border-[#353d3b] text-[10px] font-telemetry text-[#9aa09c]">
              <span className="text-[#5ef28f]">Green: YOU</span> · <span className="text-[#e0483e]">Red: INFECTED</span> ·{' '}
              <span className="text-[#ff5a52]">Diamond: HOTSPOT</span> · Gold: LOOT
              <br />
              Map is north-up (world grid). Unknown terrain stays dark.
              {selected && (
                <button
                  type="button"
                  onClick={() => {
                    setSelected(null);
                    onWaypoint(null, null);
                    onOpenChange(false);
                  }}
                  className="block text-[#70d9ff] mt-1 py-1 cursor-pointer"
                >
                  Clear destination ({selected.name})
                </button>
              )}
            </footer>
          </section>
        </div>
      )}
    </>
  );
}
