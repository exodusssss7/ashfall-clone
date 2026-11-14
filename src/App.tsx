import { NavigationRadar } from './components/NavigationRadar';
import { useEffect, useRef, useState } from 'react';
import { CraftModal } from './components/CraftModal';
import { GameHud } from './components/GameHud';
import { GameOverModal } from './components/GameOverModal';
import { PauseModal } from './components/PauseModal';
import { QuickCookModal } from './components/QuickCookModal';
import { TitleOverlay } from './components/TitleOverlay';
import { TouchControls } from './components/TouchControls';
import { TouchLookPad } from './components/TouchLookPad';
import { SurvivalEngine } from './game/engine';
import { soundEngine } from './game/sound';
import { SettingsModal } from './components/SettingsModal';
import { getSettings, initSettings, subscribeSettings, updateSettings } from './game/settings';
import { createInitialInventory } from './game/survivalLogic';
import type { GamePhase, HudSnapshot } from './game/types';

const INITIAL_HUD: HudSnapshot = {
  phase: 'title',
  hp: 100,
  maxHp: 100,
  hunger: 88,
  thirst: 86,
  bleeding: false,
  battery: 100,
  flashlightOn: true,
  equippedWeapon: 'crowbar',
  pistolMag: 8,
  pistolMagSize: 8,
  shotgunMag: 4,
  shotgunMagSize: 4,
  isReloading: false,
  reloadProgress: 0,
  restCooldownSeconds: 0,
  restSafe: true,
  dodgeReady: true,
  buildMode: null,
  inventory: createInitialInventory(),
  day: 1,
  timeMinutes: 510,
  timeLabel: '08:30',
  dayPhaseLabel: 'DAYLIGHT',
  kills: 0,
  score: 0,
  bestScore: 0,
  zombiesAlive: 0,
  worldCoords: { gx: 28, gy: 28 },
  nearCookingHeat: false,
  fishing: null,
  nearbyPrompt: null,
  nearbyDoorAction: null,
  nearbyVehiclePrompt: null,
  drivingVehicle: null,
  statusBanner: null,
  cameraMode: 'iso',
  currentBiomeLabel: 'ASHFALL CROSSROADS',
  discoveredLandmarks: [],
};

function detectTouchCapability(): boolean {
  if (typeof window === 'undefined') return false;
  const params = new URLSearchParams(window.location.search);
  if (params.get('touch') === '1') return true;
  if (params.get('touch') === '0') return false;
  return (
    'ontouchstart' in window ||
    navigator.maxTouchPoints > 0 ||
    window.matchMedia('(pointer: coarse)').matches
  );
}

export default function App() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const minimapRef = useRef<HTMLCanvasElement | null>(null);
  const engineRef = useRef<SurvivalEngine | null>(null);

  const [phase, setPhase] = useState<GamePhase>('title');
  const [hud, setHud] = useState<HudSnapshot>(INITIAL_HUD);
  const [muted, setMuted] = useState<boolean>(() => getSettings().muted);
  const [settingsOpen, setSettingsOpen] = useState<boolean>(false);
  const [craftOpen, setCraftOpen] = useState<boolean>(false);
  const [cookOpen, setCookOpen] = useState<boolean>(false);
  const [navOpen, setNavOpen] = useState<boolean>(false);
  const [touchEnabled, setTouchEnabled] = useState<boolean>(() => detectTouchCapability());

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const engine = new SurvivalEngine(
      canvas,
      (nextHud) => setHud(nextHud),
      (nextPhase) => {
        setPhase(nextPhase);
        if (nextPhase !== 'playing') {
          setCraftOpen(false);
          setCookOpen(false);
          setNavOpen(false);
        }
      },
      () => {
        setCraftOpen(false);
        setNavOpen(false);
        setCookOpen(true);
      }
    );
    engineRef.current = engine;
    // Deterministic verification handle, only with ?debug=1 (never in normal play)
    if (new URLSearchParams(window.location.search).get('debug') === '1') {
      (window as any).__ash = engine;
    }
    engine.start();

    // Boot persisted settings into the audio engine and keep mute state in sync
    initSettings();
    const unsubSettings = subscribeSettings((s) => setMuted(s.muted));

    // Support ?autostart=1, ?fps=1, and ?spawn=x,y for direct verification
    const params = new URLSearchParams(window.location.search);
    if (params.get('fps') === '1') {
      engine.setCameraMode('fps', true);
    }
    if (params.get('autostart') === '1') {
      const spawnParam = params.get('spawn');
      let spawnOverride: { x: number; y: number } | undefined;
      if (spawnParam) {
        const [sx, sy] = spawnParam.split(',').map(Number);
        if (Number.isFinite(sx) && Number.isFinite(sy)) {
          spawnOverride = { x: sx, y: sy };
        }
      }
      engine.startGame(false, spawnOverride);
    } else {
      document.body.dataset.state = 'title';
    }

    return () => {
      unsubSettings();
      engine.destroy();
      engineRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (engineRef.current) {
      engineRef.current.setTouchMode(touchEnabled);
      engineRef.current.attachMinimapCanvas(
        phase === 'playing' ? minimapRef.current : null
      );
    }
  }, [phase, touchEnabled]);

  useEffect(() => {
    engineRef.current?.setModalOpen(craftOpen || cookOpen || navOpen);
  }, [craftOpen, cookOpen, navOpen]);

  useEffect(() => {
    const onGlobalKey = (e: KeyboardEvent) => {
      if (e.code === 'KeyM') {
        updateSettings({ muted: !getSettings().muted });
        return;
      }
      if (e.code === 'Escape' && (craftOpen || cookOpen || navOpen)) {
        e.stopImmediatePropagation();
        soundEngine.playUiClick();
        setCraftOpen(false);
        setCookOpen(false);
        setNavOpen(false);
        return;
      }
      if (e.code === 'KeyN' && phase === 'playing') {
        soundEngine.playUiClick();
        setCraftOpen(false);
        setCookOpen(false);
        setNavOpen((prev) => !prev);
        return;
      }
      if ((e.code === 'KeyI' || e.code === 'KeyC') && phase === 'playing') {
        soundEngine.playUiClick();
        setCookOpen(false);
        setNavOpen(false);
        setCraftOpen((prev) => !prev);
        return;
      }
      if (e.code === 'KeyK' && phase === 'playing') {
        if (cookOpen) {
          soundEngine.playUiClick();
          setCookOpen(false);
        } else if (engineRef.current?.isNearCookingHeat()) {
          soundEngine.playUiClick();
          setCraftOpen(false);
          setNavOpen(false);
          setCookOpen(true);
        } else {
          engineRef.current?.triggerQuickCook();
        }
      }
    };
    window.addEventListener('keydown', onGlobalKey, true);
    return () => window.removeEventListener('keydown', onGlobalKey, true);
  }, [phase, craftOpen, cookOpen, navOpen]);

  const handleToggleMute = () => {
    updateSettings({ muted: !getSettings().muted });
  };

  const handleStartGame = () => {
    if (touchEnabled && typeof screen !== 'undefined' && screen.orientation) {
      const ori = screen.orientation as ScreenOrientation & { lock?: (mode: string) => Promise<void> };
      ori.lock?.('landscape')?.catch(() => {});
    }
    engineRef.current?.startGame(true);
  };

  return (
    <main className="relative w-screen h-screen overflow-hidden bg-[#0b0d0e]">
      {/* Isolated Canvas Viewport */}
      <div className="absolute inset-0">
        <canvas
          ref={canvasRef}
          data-testid="game-canvas"
          className="block w-full h-full pixelated cursor-crosshair"
        />
      </div>

      {/* Title Screen */}
      {phase === 'title' && (
        <TitleOverlay
          bestScore={hud.bestScore}
          muted={muted}
          touchEnabled={touchEnabled}
          onStart={handleStartGame}
          onToggleMute={handleToggleMute}
          onOpenSettings={() => {
            soundEngine.playUiClick();
            setSettingsOpen(true);
          }}
        />
      )}

      {/* Active Playing HUD */}
      {phase === 'playing' && (
        <GameHud
          hud={hud}
          muted={muted}
          craftOpen={craftOpen}
          cookOpen={cookOpen}
          touchEnabled={touchEnabled}
          minimapRef={minimapRef}
          onSelectWeapon={(w) => engineRef.current?.selectWeapon(w)}
          onToggleBuild={(k) => engineRef.current?.toggleBuildMode(k)}
          onUseConsumable={(item) => engineRef.current?.useConsumable(item)}
          onToggleCraft={() => {
            soundEngine.playUiClick();
            setCookOpen(false);
            setCraftOpen((prev) => !prev);
          }}
          onToggleCook={() => {
            if (cookOpen) {
              soundEngine.playUiClick();
              setCookOpen(false);
            } else {
              setCraftOpen(false);
              engineRef.current?.triggerQuickCook();
            }
          }}
          onToggleTouch={() => {
            soundEngine.playUiClick();
            setTouchEnabled((prev) => !prev);
          }}
          onToggleMute={handleToggleMute}
          onToggleCamera={() => {
            soundEngine.playUiClick();
            engineRef.current?.toggleCameraMode();
          }}
          onPause={() => engineRef.current?.pauseGame()}
          onRestart={() => engineRef.current?.startGame()}
          onEnterExitVehicle={() => engineRef.current?.triggerEnterExitVehicle()}
          onToggleHeadlights={() => engineRef.current?.triggerFlashlight()}
          onHorn={() => engineRef.current?.triggerHorn()}
          onRefuel={() => engineRef.current?.refuelActiveVehicle()}
          onRepairVehicle={() => engineRef.current?.triggerRepairVehicle()}
          onPrimaryInteract={() => engineRef.current?.triggerLoot()}
          onBarricadeDoor={() => engineRef.current?.triggerBarricadeDoor()}
          onOpenNavigation={() => {
            soundEngine.playUiClick();
            setCraftOpen(false);
            setCookOpen(false);
            setNavOpen((prev) => !prev);
          }}
        />
      )}

      {phase === 'playing' && (
        <NavigationRadar
          hud={hud}
          canvasRef={minimapRef}
          showTrigger={touchEnabled}
          open={navOpen}
          onOpenChange={setNavOpen}
          onWaypoint={(x, y) => engineRef.current?.setWaypoint(x, y)}
        />
      )}

      {/* First-Person Right-Side Touch Camera Look Surface (behind HUD & combat buttons) */}
      {phase === 'playing' && touchEnabled && hud.cameraMode === 'fps' && !craftOpen && !cookOpen && (
        <TouchLookPad onLookDelta={(dx, dy) => engineRef.current?.applyVirtualLookDelta(dx, dy)} />
      )}

      {/* Mobile Touch Controls (Twin-Stick in ISO; Move + Touch Look Pad + Slash/Fire triggers in FPS) */}
      {phase === 'playing' && touchEnabled && !craftOpen && !cookOpen && (
        <TouchControls
          hud={hud}
          onMoveStick={(nx, ny) => engineRef.current?.setVirtualMove(nx, ny)}
          onAimStick={(nx, ny, active) => engineRef.current?.setVirtualAim(nx, ny, active)}
          onFireChange={(held) => engineRef.current?.setVirtualFire(held)}
          onBrakeChange={(held) => engineRef.current?.setVirtualBrake(held)}
          onBoostChange={(held) => engineRef.current?.setVirtualBoost(held)}
          onDodge={() => engineRef.current?.triggerDodge()}
          onReload={() => engineRef.current?.triggerReload()}
          onLoot={() => engineRef.current?.triggerLoot()}
          onDoor={() => engineRef.current?.triggerDoor()}
          onBarricadeDoor={() => engineRef.current?.triggerBarricadeDoor()}
          onRepairVehicle={() => engineRef.current?.triggerRepairVehicle()}
          onQuickCook={() => engineRef.current?.triggerQuickCook()}
          onToggleFlashlight={() => engineRef.current?.triggerFlashlight()}
          onEnterExitVehicle={() => engineRef.current?.triggerEnterExitVehicle()}
          onHorn={() => engineRef.current?.triggerHorn()}
        />
      )}

      {/* Backpack & Crafting Modal */}
      {phase === 'playing' && craftOpen && (
        <CraftModal
          hud={hud}
          onClose={() => {
            soundEngine.playUiClick();
            setCraftOpen(false);
          }}
          onCraft={(recipeId) => {if(engineRef.current?.craftRecipe(recipeId))setCraftOpen(false);}}
          onUseConsumable={(item) => {if(engineRef.current?.useConsumable(item))setCraftOpen(false);}}
        />
      )}

      {/* Quick Cook Modal */}
      {phase === 'playing' && cookOpen && (
        <QuickCookModal
          hud={hud}
          onClose={() => {
            soundEngine.playUiClick();
            setCookOpen(false);
          }}
          onCook={(recipeId, grade) => Boolean(engineRef.current?.cookRecipe(recipeId, grade))}
          onUseConsumable={(item) => {if(engineRef.current?.useConsumable(item))setCookOpen(false);}}
        />
      )}

      {/* Pause Modal */}
      {phase === 'paused' && (
        <PauseModal
          hud={hud}
          onResume={() => engineRef.current?.resumeGame()}
          onToggleCamera={() => {
            soundEngine.playUiClick();
            engineRef.current?.toggleCameraMode();
          }}
          onRestart={() => engineRef.current?.startGame()}
          onTitle={() => engineRef.current?.returnToTitle()}
          onOpenSettings={() => {
            soundEngine.playUiClick();
            setSettingsOpen(true);
          }}
        />
      )}

      {/* Settings Modal (available from title and pause) */}
      {settingsOpen && (
        <SettingsModal
          onClose={() => {
            soundEngine.playUiClick();
            setSettingsOpen(false);
          }}
        />
      )}

      {/* Game Over Modal */}
      {phase === 'gameover' && (
        <GameOverModal
          hud={hud}
          onRestart={() => engineRef.current?.startGame()}
          onTitle={() => engineRef.current?.returnToTitle()}
        />
      )}
    </main>
  );
}
