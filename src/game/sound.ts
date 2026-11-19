import { tickSprintBreathing, type SprintBreathingState } from './sprintBreathing';
import type { FootstepSurface } from './footstepSurfaces';
import type { ImpactMaterial, ZombieArchetype } from './types';
import { ambienceMix } from './audioMix';
import {
  SPATIAL_MAX_DISTANCE,
  SPATIAL_REF_DISTANCE,
  SPATIAL_ROLLOFF_FACTOR,
  worldToAudioPosition,
  type AudioListenerPose,
  type SpatialPosition,
} from './spatialAudio';

const SAMPLE_NAMES = [
  'concrete0', 'concrete1', 'concrete2', 'concrete3', 'grass0', 'grass1', 'grass2', 'grass3',
  'planks0', 'planks1', 'planks2', 'planks3', 'carpet0', 'carpet1', 'carpet2', 'carpet3',
  'dirt0', 'dirt1', 'dirt2', 'dirt3', 'tile0', 'tile1', 'tile2', 'tile3',
  'wood0', 'wood1', 'punch0', 'punch1', 'metal0', 'metal1', 'glass0', 'glass1',
  'cloth1', 'cloth2', 'cloth3', 'metalClick', 'metalLatch', 'doorOpen_1', 'doorClose_1',
  'creak1', 'swing0', 'swing1', 'swing2', 'hurt0', 'hurt1', 'hurt2',
  'drink', 'bottleOpen', 'liquid', 'repair0', 'repair1', 'splash', 'handleSmallLeather', 'beltHandle1', 'metalPot1',
  'groan1', 'groan2', 'groan3', 'groan4', 'pistol0', 'pistol1', 'shotgun0', 'shotgun1',
  'reload', 'rack', 'day', 'night', 'breathing', 'heartbeat',
  'lmg0', 'lmg1', 'zombiedie0', 'zombiedie1', 'carhit0', 'carhit1', 'zhurt0', 'zhurt1', 'zhurt2', 'zmoan0', 'zmoan1', 'zmoan2',
];

/** Recorded foley/weapon banks, with quiet continuous day/night soundscapes and 3D HRTF spatialization.
 * No arcade reward tones. Small variations prevent repeated footsteps sounding identical.
 * Source licences and edits are documented in public/audio/CREDITS.txt.
 */
class SurvivalSoundEngine {
  private ctx: AudioContext | null = null;
  private masterGain: GainNode | null = null;
  private dryGain: GainNode | null = null;
  private muted = false;
  private volume = 1;
  private lastZombieHurtTime = -10;
  private buffers = new Map<string, AudioBuffer>();
  private loading: Promise<void> | null = null;
  private ambience = new Map<string, { source: AudioBufferSourceNode; gain: GainNode }>();
  private ambienceActive = false;
  private timeMinutes = 510;
  private lastAmbienceTarget = '';
  private lastGroanTime = -10;
  private lastHurtTime = -10;
  private lastVariants = new Map<string, number>();
  private voices = new Set<AudioBufferSourceNode>();
  private activePanners = new Set<PannerNode>();
  private listenerPose: AudioListenerPose | null = null;
  private lastListenerSyncTime = -1;
  private noise: AudioBuffer | null = null;
  private engineOsc: OscillatorNode | null = null;
  private engineSubOsc: OscillatorNode | null = null;
  private engineFilter: BiquadFilterNode | null = null;
  private engineGain: GainNode | null = null;
  private rainSource: AudioBufferSourceNode | null = null;
  private rainFilter: BiquadFilterNode | null = null;
  private rainGain: GainNode | null = null;
  private lastThunderTime = -20;

  private sprintBreathing: SprintBreathingState = { sprintSeconds: 0, wasSprinting: false };
  private breathingVoice: AudioBufferSourceNode | null = null;

  updateListenerPose(pose: AudioListenerPose): void {
    const prev = this.listenerPose;
    if (
      prev &&
      Math.abs(prev.x - pose.x) < 0.002 &&
      Math.abs(prev.y - pose.y) < 0.002 &&
      Math.abs(prev.z - pose.z) < 0.002 &&
      Math.abs(prev.forwardX - pose.forwardX) < 0.002 &&
      Math.abs(prev.forwardY - pose.forwardY) < 0.002 &&
      Math.abs(prev.forwardZ - pose.forwardZ) < 0.002 &&
      Math.abs(prev.upX - pose.upX) < 0.002 &&
      Math.abs(prev.upY - pose.upY) < 0.002 &&
      Math.abs(prev.upZ - pose.upZ) < 0.002
    ) {
      return;
    }
    this.listenerPose = { ...pose };
    this.applyListenerPoseToCtx();
  }

  private applyListenerPoseToCtx(): void {
    if (!this.ctx || !this.listenerPose) return;
    const listener = this.ctx.listener;
    const p = this.listenerPose;
    const now = this.ctx.currentTime;
    if (listener.positionX) {
      // Only interpolate with setTargetAtTime when AudioContext is running and at least one
      // spatial panner is active; otherwise update directly to avoid AudioParam queue buildup.
      if (this.ctx.state === 'running' && this.activePanners.size > 0 && now > this.lastListenerSyncTime) {
        this.lastListenerSyncTime = now;
        listener.positionX.setTargetAtTime(p.x, now, 0.016);
        listener.positionY.setTargetAtTime(p.y, now, 0.016);
        listener.positionZ.setTargetAtTime(p.z, now, 0.016);
        listener.forwardX.setTargetAtTime(p.forwardX, now, 0.016);
        listener.forwardY.setTargetAtTime(p.forwardY, now, 0.016);
        listener.forwardZ.setTargetAtTime(p.forwardZ, now, 0.016);
        listener.upX.setTargetAtTime(p.upX, now, 0.016);
        listener.upY.setTargetAtTime(p.upY, now, 0.016);
        listener.upZ.setTargetAtTime(p.upZ, now, 0.016);
      } else {
        listener.positionX.value = p.x;
        listener.positionY.value = p.y;
        listener.positionZ.value = p.z;
        listener.forwardX.value = p.forwardX;
        listener.forwardY.value = p.forwardY;
        listener.forwardZ.value = p.forwardZ;
        listener.upX.value = p.upX;
        listener.upY.value = p.upY;
        listener.upZ.value = p.upZ;
      }
    } else {
      listener.setPosition?.(p.x, p.y, p.z);
      listener.setOrientation?.(p.forwardX, p.forwardY, p.forwardZ, p.upX, p.upY, p.upZ);
    }
  }

  getSpatialDebugInfo(): {
    panningModel: 'HRTF';
    listener: AudioListenerPose | null;
    activePanners: number;
    ctxState: string;
    spatialCategories: readonly ['zombie', 'gunshot'];
    ambienceBypassCompressor: boolean;
  } {
    return {
      panningModel: 'HRTF',
      listener: this.listenerPose ? { ...this.listenerPose } : null,
      activePanners: this.activePanners.size,
      ctxState: this.ctx?.state ?? 'uninitialized',
      spatialCategories: ['zombie', 'gunshot'],
      ambienceBypassCompressor: true,
    };
  }

  private createSpatialPanner(
    pos: SpatialPosition,
    defaultHeight = 1.0,
    refDistance = SPATIAL_REF_DISTANCE,
    rolloffFactor = SPATIAL_ROLLOFF_FACTOR
  ): PannerNode | null {
    if (!this.ctx || !this.dryGain) return null;
    const panner = this.ctx.createPanner();
    panner.panningModel = 'HRTF';
    panner.distanceModel = 'inverse';
    panner.refDistance = refDistance;
    panner.maxDistance = SPATIAL_MAX_DISTANCE;
    panner.rolloffFactor = rolloffFactor;
    panner.coneInnerAngle = 360;
    panner.coneOuterAngle = 360;
    panner.coneOuterGain = 0;

    const coords = worldToAudioPosition(pos, defaultHeight);
    if (panner.positionX) {
      panner.positionX.value = coords.x;
      panner.positionY.value = coords.y;
      panner.positionZ.value = coords.z;
    } else {
      panner.setPosition?.(coords.x, coords.y, coords.z);
    }
    panner.connect(this.dryGain);
    this.activePanners.add(panner);
    return panner;
  }

  private releasePanner(panner: PannerNode | null): void {
    if (!panner) return;
    this.activePanners.delete(panner);
    try { panner.disconnect(); } catch { /* already disconnected */ }
  }

  updateSprintBreathing(sprinting: boolean, active: boolean, dt: number): void {
    const result = tickSprintBreathing(this.sprintBreathing, sprinting, active, dt);
    this.sprintBreathing = result.state;
    if (!active || sprinting) this.stopBreathing();
    if (result.playSeconds > 0) this.playRecoveryBreathing(result.playSeconds);
  }

  private stopBreathing(): void {
    if (this.breathingVoice) {
      try { this.breathingVoice.stop(); } catch { /* already stopped */ }
      this.breathingVoice = null;
    }
  }

  private playRecoveryBreathing(seconds: number): void {
    if (!this.ctx || !this.dryGain || this.muted || document.hidden || this.ctx.state !== 'running') return;
    const buffer = this.buffers.get('breathing');
    if (!buffer) return;
    this.stopBreathing();
    const source = this.ctx.createBufferSource();
    source.buffer = buffer;
    const gain = this.ctx.createGain();
    const now = this.ctx.currentTime;
    const duration = Math.min(seconds, buffer.duration);
    // Asset is 11 dB below the first preview, another 3 dB below the approved quieter preview.
    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(1, now + .15);
    gain.gain.setValueAtTime(1, now + Math.max(.15, duration - .8));
    gain.gain.linearRampToValueAtTime(0, now + duration);
    source.connect(gain); gain.connect(this.dryGain);
    this.breathingVoice = source;
    source.onended = () => {
      if (this.breathingVoice === source) this.breathingVoice = null;
      source.disconnect(); gain.disconnect();
    };
    source.start(now, 0, duration);
  }

  isMuted(): boolean { return this.muted; }

  setVolume(volume: number): void {
    this.volume = Math.min(1, Math.max(0, volume));
    this.applyMasterGain();
  }

  getVolume(): number { return this.volume; }

  private applyMasterGain(): void {
    if (this.masterGain && this.ctx) {
      this.masterGain.gain.setTargetAtTime(this.muted ? 0 : 0.72 * this.volume, this.ctx.currentTime, 0.025);
    }
  }

  setMuted(mute: boolean): void {
    this.muted = mute;
    this.applyMasterGain();
    if (mute) { this.updateEngineSound(false, 0, false); this.stopBreathing(); this.stopHeartbeat(); }
  }

  toggleMute(): boolean { this.setMuted(!this.muted); return this.muted; }

  unlock(): void {
    if (typeof window === 'undefined') return;
    if (!this.ctx) {
      const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (!AudioCtx) return;
      this.ctx = new AudioCtx();
      const compressor = this.ctx.createDynamicsCompressor();
      compressor.threshold.value = -14;
      compressor.knee.value = 18;
      compressor.ratio.value = 5;
      compressor.attack.value = 0.003;
      compressor.release.value = 0.18;
      this.masterGain = this.ctx.createGain();
      this.masterGain.gain.value = this.muted ? 0 : 0.72 * this.volume;
      this.dryGain = this.ctx.createGain();
      this.dryGain.connect(compressor);
      compressor.connect(this.masterGain);
      this.masterGain.connect(this.ctx.destination);
      this.noise = this.ctx.createBuffer(1, this.ctx.sampleRate * 2, this.ctx.sampleRate);
      const data = this.noise.getChannelData(0);
      for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
      this.applyListenerPoseToCtx();
      document.addEventListener('visibilitychange', this.onVisibilityChange);
    }
    if (!document.hidden && this.ctx.state === 'suspended') void this.ctx.resume();
    if (!this.loading) this.loading = this.loadSamples();
  }

  private onVisibilityChange = (): void => {
    if (!this.ctx) return;
    if (document.hidden) {
      this.updateEngineSound(false, 0, false);
      this.stopEffects();
      void this.ctx.suspend();
    } else if (this.ctx.state === 'suspended') {
      void this.ctx.resume().catch(() => { /* next gesture can resume on restrictive devices */ });
    }
  };

  private async loadSamples(): Promise<void> {
    // Limit concurrent decoding on low-memory phones. Failures never fall back to old beeps.
    const queue = [...SAMPLE_NAMES];
    const worker = async () => {
      while (queue.length && this.ctx) {
        const name = queue.shift()!;
        try {
          const response = await fetch(`${import.meta.env.BASE_URL}audio/${name}.mp3`);
          if (!response.ok) throw new Error(`HTTP ${response.status}`);
          const buffer = await this.ctx.decodeAudioData(await response.arrayBuffer());
          this.buffers.set(name, buffer);
          if (name === 'day' || name === 'night') this.ensureAmbience();
        } catch (error) {
          console.warn(`Audio asset unavailable: ${name}`, error);
        }
      }
    };
    await Promise.all([worker(), worker(), worker(), worker()]);
  }

  private route(node: AudioNode, panner?: PannerNode | null): void {
    if (panner) node.connect(panner);
    else if (this.dryGain) node.connect(this.dryGain);
  }

  private choose(bank: string, count: number): string {
    const previous = this.lastVariants.get(bank) ?? -1;
    let next = Math.floor(Math.random() * count);
    if (next === previous && count > 1) next = (next + 1) % count;
    this.lastVariants.set(bank, next);
    return `${bank}${next}`;
  }

  private sample(
    name: string,
    volume = 0.3,
    rate = 1,
    delay = 0,
    spatial?: SpatialPosition,
    defaultHeight = 1.0,
    refDistance = SPATIAL_REF_DISTANCE,
    rolloffFactor = SPATIAL_ROLLOFF_FACTOR
  ): void {
    if (!this.ctx || !this.dryGain || this.muted || document.hidden || this.ctx.state !== 'running') return;
    const buffer = this.buffers.get(name);
    if (!buffer || this.voices.size >= 28) return;
    const source = this.ctx.createBufferSource();
    source.buffer = buffer;
    source.playbackRate.value = rate * (0.98 + Math.random() * 0.04);
    const gain = this.ctx.createGain();
    gain.gain.value = volume;
    const panner = spatial
      ? this.createSpatialPanner(spatial, defaultHeight, refDistance, rolloffFactor)
      : null;
    source.connect(gain);
    this.route(gain, panner);
    this.voices.add(source);
    source.onended = () => {
      this.voices.delete(source);
      source.disconnect();
      gain.disconnect();
      this.releasePanner(panner);
    };
    source.start(this.ctx.currentTime + delay);
  }

  private stopEffects(): void {
    this.stopHeartbeat();
    this.updateSprintBreathing(false, false, 0);
    for (const source of this.voices) { try { source.stop(); } catch { /* already ended */ } }
    this.voices.clear();
    for (const panner of this.activePanners) {
      try { panner.disconnect(); } catch { /* ignore */ }
    }
    this.activePanners.clear();
    this.lastListenerSyncTime = -1;
  }

  private ensureAmbience(): void {
    if (!this.ctx || !this.masterGain) return;
    for (const name of ['day', 'night']) {
      const buffer = this.buffers.get(name);
      if (!buffer || this.ambience.has(name)) continue;
      const source = this.ctx.createBufferSource();
      source.buffer = buffer;
      source.loop = true;
      const gain = this.ctx.createGain();
      gain.gain.value = 0;
      source.connect(gain);
      // Connect ambience directly to masterGain so SFX compressor dynamics never duck or flicker it.
      gain.connect(this.masterGain);
      source.start();
      this.ambience.set(name, { source, gain });
      this.lastAmbienceTarget = '';
    }
    this.applyAmbience();
  }

  updateAmbience(active: boolean, timeMinutes: number): void {
    if (this.ambienceActive && !active) this.stopEffects();
    this.ambienceActive = active;
    this.timeMinutes = timeMinutes;
    this.applyAmbience();
  }

  private applyAmbience(): void {
    if (!this.ctx) return;
    const mix = ambienceMix(this.timeMinutes);
    const active = this.ambienceActive;
    const day = active ? mix.day * 0.82 : 0;
    const night = active ? mix.night * 0.82 : 0;
    // Quantize only the control updates, not the audio fade. Avoid rescheduling on every frame.
    const key = `${day.toFixed(3)}:${night.toFixed(3)}`;
    if (key === this.lastAmbienceTarget) return;
    this.lastAmbienceTarget = key;
    const now = this.ctx.currentTime;
    for (const [name, value] of [['day', day], ['night', night]] as const) {
      const bus = this.ambience.get(name);
      if (!bus) continue;
      bus.gain.gain.setTargetAtTime(value, now, active ? 1.4 : 0.07);
    }
  }

  stop(): void {
    this.updateAmbience(false, this.timeMinutes);
    this.updateEngineSound(false, 0, false);
    this.updateWeatherAudio(false, 0, 0, false, 0);
    this.stopEffects();
  }

  playFootstep(surface: FootstepSurface, sprinting: boolean): void {
    if (surface === 'water') {
      this.sample('splash', sprinting ? 0.2 : 0.15, (sprinting ? 1.2 : 1.05) + Math.random() * 0.12);
      return;
    }
    const level = { concrete: 0.17, grass: 0.17, dirt: 0.17, planks: 0.19, carpet: 0.12, tile: 0.16 }[surface];
    this.sample(this.choose(surface, 4), level * (sprinting ? 1.28 : 1), sprinting ? 1.07 : 1);
  }
  playMeleeSwing(rate = 0.9, gain = 0.42): void {
    this.sample(this.choose('swing', 3), gain, rate);
  }
  playDodge(): void {
    this.sample('cloth2', 0.22, 0.85);
    this.sample('cloth3', 0.14, 1.05, 0.06);
  }
  playMeleeHit(heavy = false, rate?: number): void {
    this.sample(this.choose('punch', 2), heavy ? 0.54 : 0.4, rate ?? (heavy ? 0.88 : 1));
  }
  playGunshot(kind: 'pistol' | 'shotgun' | 'lmg', pos?: SpatialPosition): void {
    // LMG fires ~11 rounds/s, so each shot sits lower than the handguns to keep the mix clean.
    const level = kind === 'pistol' ? 0.75 : kind === 'shotgun' ? 0.85 : 0.5;
    this.sample(this.choose(kind, 2), level, kind === 'lmg' ? 1.02 : 1, 0, pos, 1.3, 4.0, 0.95);
  }
  /** Wet impact when a zombie goes down for good. A low groan tail sells the collapse. */
  playZombieDeath(archetype: ZombieArchetype, pos?: SpatialPosition): void {
    this.sample(this.choose('zombiedie', 2), 0.5, 1, 0, pos, 0.85, 2.8, 1.1);
    const rates = { walker: 0.62, runner: 0.78, spitter: 0.7, bloater: 0.5 };
    this.sample(`groan${1 + Math.floor(Math.random() * 4)}`, 0.15, rates[archetype], 0.05, pos, 0.85, 2.8, 1.1);
  }
  /** Short pained reaction on every non-lethal hit, throttled so automatic fire cannot spam it. */
  playZombieHurt(archetype: ZombieArchetype, pos?: SpatialPosition): void {
    if (!this.ctx || this.ctx.currentTime - this.lastZombieHurtTime < 0.16) return;
    this.lastZombieHurtTime = this.ctx.currentTime;
    const rates = { walker: 0.95, runner: 1.14, spitter: 1.05, bloater: 0.74 };
    this.sample(this.choose('zhurt', 3), 0.3, rates[archetype], 0, pos, 1.05, 2.6, 1.15);
  }
  /** Fleshy slam when the car runs through a zombie, with a hint of bodywork under it. */
  playCarZombieImpact(pos?: SpatialPosition): void {
    this.sample(this.choose('carhit', 2), 0.6, 1, 0, pos, 0.7, 3.0, 1.05);
    this.sample(this.choose('metal', 2), 0.2, 0.78, 0.02, pos, 0.7, 3.0, 1.05);
  }
  playBulletImpact(kind: ImpactMaterial | 'flesh' | 'headshot'): void {
    if (kind === 'headshot') {
      this.sample(this.choose('punch', 2), 0.52, 0.86);
      this.sample('glass0', 0.2, 1.65);
      return;
    }
    if (kind === 'flesh') {
      this.sample(this.choose('punch', 2), 0.28, 1.12);
      return;
    }
    if (kind === 'metal') {
      this.sample(this.choose('metal', 2), 0.34, 1.38);
      this.texture(4200, 0.08, 0.12);
      return;
    }
    if (kind === 'wood') {
      this.sample(this.choose('wood', 2), 0.3, 1.32);
      return;
    }
    if (kind === 'water') {
      this.sample('splash', 0.26, 1.28);
      return;
    }
    if (kind === 'dirt') {
      this.sample(this.choose('dirt', 4), 0.24, 1.15);
      return;
    }
    this.sample(this.choose('concrete', 4), 0.28, 1.42);
    this.texture(3200, 0.06, 0.09);
  }
  playDryFire(): void { this.sample('metalClick', 0.22); }
  playReload(): void { this.sample('reload', 0.29); this.sample('metalLatch', 0.22, 1, 0.16); }
  playReloadComplete(): void { this.sample('rack', 0.32); }
  playMolotovShatter(): void { this.sample(this.choose('glass', 2), 0.62); this.texture(2200, 0.65, 0.14); }
  playZombieGroan(archetype: ZombieArchetype, pos?: SpatialPosition): void {
    if (!this.ctx || this.ctx.currentTime - this.lastGroanTime < 1.55) return;
    this.lastGroanTime = this.ctx.currentTime;
    const rates = { walker: 0.94, runner: 1.13, spitter: 1.04, bloater: 0.7 };
    // User-selected EmoPreben moans (option B); hurt and death banks stay separate.
    this.sample(this.choose('zmoan', 3), 0.3, rates[archetype], 0, pos, 1.25, 2.6, 1.15);
  }
  playBuildHammer(): void { this.sample(this.choose('wood', 2), 0.43); }
  playLootPickup(): void { this.sample('handleSmallLeather', 0.28); }
  playConsume(kind: 'food' | 'water' | 'bandage'): void {
    if (kind === 'water') {
      this.sample('bottleOpen', 0.18);
      this.sample('drink', 0.29, 1, 0.12);
    } else {
      this.sample(kind === 'bandage' ? 'cloth3' : 'cloth1', 0.23);
    }
  }
  playCampfireCrackle(): void { this.texture(3300, 0.035, 0.045); }
  playSpitHiss(pos?: SpatialPosition): void {
    this.texture(2200, 0.27, 0.19, 0, pos, 1.25);
  }
  playPlayerHurt(): void {
    // One short human reaction per actual damage event, not every invulnerable contact.
    if (!this.ctx || this.ctx.currentTime - this.lastHurtTime < 0.65) return;
    this.lastHurtTime = this.ctx.currentTime;
    this.sample(this.choose('hurt', 3), 0.48);
    this.sample(this.choose('punch', 2), 0.18, 0.9);
  }
  playUiClick(): void { this.sample('metalClick', 0.09, 1.12); }
  playCarDoor(): void { this.sample('metalLatch', 0.36, 0.7); this.sample(this.choose('metal', 2), 0.18, 0.75, 0.03); }
  playCarImpact(): void { this.sample(this.choose('metal', 2), 0.62, 0.7); }
  playTireScreech(): void { this.texture(1600, 0.3, 0.19); }
  playFishingCast(): void { this.sample('swing0', 0.13, 1.1); this.splash(0.24, 0.24); }
  playFishingBite(): void { this.splash(0.25); this.sample('beltHandle1', 0.16, 1, 0.04); }
  playFishingCatch(): void { this.splash(0.27); this.sample('beltHandle1', 0.24); this.sample('metalLatch', 0.1, 1.1, 0.13); }
  playCookingSizzle(): void { this.texture(3600, 0.65, 0.12); this.sample('metalPot1', 0.15); }
  playCookBeatHit(judgement: 'perfect' | 'good' | 'miss'): void {
    if (judgement === 'perfect') {
      this.sample('metalPot1', 0.24, 1.18);
      this.texture(4200, 0.26, 0.14);
    } else if (judgement === 'good') {
      this.sample('metalPot1', 0.16, 0.96);
      this.texture(3000, 0.18, 0.08);
    } else {
      this.texture(680, 0.24, 0.16);
      this.sample('punch0', 0.12, 0.72);
    }
  }
  playCookOutcome(grade: 'perfect' | 'good' | 'burnt'): void {
    if (grade === 'perfect') {
      this.texture(4200, 0.75, 0.15);
      this.sample('metalPot1', 0.24, 1.15);
      this.sample('beltHandle1', 0.14, 1.05, 0.08);
    } else if (grade === 'good') {
      this.playCookingSizzle();
    } else {
      this.texture(550, 0.55, 0.2);
      this.sample('metalPot1', 0.14, 0.68);
    }
  }
  playDoorSwing(opening: boolean): void { this.sample(opening ? 'doorOpen_1' : 'doorClose_1', 0.34); }
  playLockpickClick(unlocked: boolean): void { this.sample(unlocked ? 'metalLatch' : 'metalClick', unlocked ? 0.32 : 0.16); }
  playWrenchRepair(): void { this.sample(this.choose('repair', 2), 0.3); }
  playRefuel(): void { this.sample('bottleOpen', 0.16, 0.8); this.sample('liquid', 0.32, 0.9, 0.1); }
  playTurboSurge(): void { this.texture(280, 0.35, 0.24); }
  playSleepRest(): void {
    this.sample('cloth1', 0.28, 0.85);
    this.sample('cloth3', 0.22, 0.78, 0.14);
    this.texture(420, 0.55, 0.08, 0.08);
  }

  /** Non-tonal filtered textures for liquids, flame, breath and tires. No pitch pings. */
  private texture(
    frequency: number,
    duration: number,
    volume: number,
    delay = 0,
    spatial?: SpatialPosition,
    defaultHeight = 0.8
  ): void {
    if (!this.ctx || !this.noise || this.muted || document.hidden || this.ctx.state !== 'running') return;
    const now = this.ctx.currentTime + delay;
    const source = this.ctx.createBufferSource();
    source.buffer = this.noise;
    const filter = this.ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = frequency;
    filter.Q.value = 0.6;
    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.linearRampToValueAtTime(volume, now + Math.min(0.015, duration / 4));
    gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);
    const panner = spatial ? this.createSpatialPanner(spatial, defaultHeight) : null;
    source.connect(filter); filter.connect(gain); this.route(gain, panner);
    source.onended = () => {
      source.disconnect();
      filter.disconnect();
      gain.disconnect();
      this.releasePanner(panner);
    };
    source.start(now, Math.random() * 0.5, duration);
  }
  private splash(volume: number, delay = 0): void { this.sample('splash', volume, 1, delay); }
  private heartbeatVoice: AudioBufferSourceNode | null = null;
  private heartbeatCountdown = 0;

  private stopHeartbeat(): void {
    if (this.heartbeatVoice) {
      try { this.heartbeatVoice.stop(); } catch { /* already ended */ }
      this.heartbeatVoice = null;
    }
    this.heartbeatCountdown = 0;
  }

  updateHeartbeat(hp: number, active: boolean, dt: number): void {
    if (!active || hp <= 0 || hp > 30 || this.muted || document.hidden) {
      this.stopHeartbeat(); return;
    }
    this.heartbeatCountdown -= dt;
    if (this.heartbeatCountdown > 0) return;
    if (!this.ctx || !this.dryGain || this.ctx.state !== 'running') return;
    const buffer = this.buffers.get('heartbeat');
    if (!buffer) return;
    this.heartbeatCountdown = hp <= 20 ? .85 : 1.15;
    // Single selected recording replaces the old oscillator completely.
    if (this.heartbeatVoice) return;
    const source = this.ctx.createBufferSource(); source.buffer = buffer;
    const gain = this.ctx.createGain(); gain.gain.value = .38;
    source.connect(gain); gain.connect(this.dryGain);
    this.heartbeatVoice = source;
    source.onended = () => {
      if (this.heartbeatVoice === source) this.heartbeatVoice = null;
      source.disconnect(); gain.disconnect();
    };
    source.start();
  }
  playCarHorn(police: boolean): void {
    if (this.muted || !this.ctx) return;
    const now = this.ctx.currentTime;
    if (police) {
      // Short police air-horn / yelp chirp
      const osc = this.ctx.createOscillator();
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(640, now);
      osc.frequency.exponentialRampToValueAtTime(1120, now + 0.11);
      osc.frequency.exponentialRampToValueAtTime(680, now + 0.24);
      const bp = this.ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.value = 1200;
      bp.Q.value = 1.4;
      const g = this.ctx.createGain();
      g.gain.setValueAtTime(0.001, now);
      g.gain.linearRampToValueAtTime(0.22, now + 0.02);
      g.gain.exponentialRampToValueAtTime(0.001, now + 0.26);
      osc.connect(bp);
      bp.connect(g);
      this.route(g);
      osc.onended = () => {
        osc.disconnect(); bp.disconnect(); g.disconnect();
      };
      osc.start(now);
      osc.stop(now + 0.28);
    } else {
      // Dual-tone civilian car horn (F#4 + A#4 dissonant fifth)
      for (const freq of [370, 466]) {
        const osc = this.ctx.createOscillator();
        osc.type = 'sawtooth';
        osc.frequency.value = freq;
        const lp = this.ctx.createBiquadFilter();
        lp.type = 'lowpass';
        lp.frequency.value = 1450;
        const g = this.ctx.createGain();
        g.gain.setValueAtTime(0.001, now);
        g.gain.linearRampToValueAtTime(0.14, now + 0.015);
        g.gain.setValueAtTime(0.14, now + 0.20);
        g.gain.exponentialRampToValueAtTime(0.001, now + 0.27);
        osc.connect(lp);
        lp.connect(g);
        this.route(g);
        osc.onended = () => {
          osc.disconnect(); lp.disconnect(); g.disconnect();
        };
        osc.start(now);
        osc.stop(now + 0.28);
      }
    }
  }

  updateEngineSound(active: boolean, speedNorm: number, isPolice: boolean): void {
    if (!this.ctx || !this.dryGain) return;
    const now = this.ctx.currentTime;

    if (!active || this.muted) {
      if (this.engineGain) {
        this.engineGain.gain.setTargetAtTime(0.0001, now, 0.06);
      }
      return;
    }

    if (!this.engineOsc || !this.engineSubOsc || !this.engineFilter || !this.engineGain) {
      this.engineOsc = this.ctx.createOscillator();
      this.engineOsc.type = 'sawtooth';
      this.engineOsc.frequency.value = 46;

      this.engineSubOsc = this.ctx.createOscillator();
      this.engineSubOsc.type = 'triangle';
      this.engineSubOsc.frequency.value = 23;

      this.engineFilter = this.ctx.createBiquadFilter();
      this.engineFilter.type = 'lowpass';
      this.engineFilter.frequency.value = 180;
      this.engineFilter.Q.value = 2.0;

      this.engineGain = this.ctx.createGain();
      this.engineGain.gain.value = 0.0001;

      this.engineOsc.connect(this.engineFilter);
      this.engineSubOsc.connect(this.engineFilter);
      this.engineFilter.connect(this.engineGain);
      this.route(this.engineGain);

      this.engineOsc.start(now);
      this.engineSubOsc.start(now);
    }

    const clamped = Math.max(0, Math.min(1, speedNorm));
    const baseHz = isPolice ? 48 : 42;
    const revHz = baseHz + clamped * 68;
    this.engineOsc.frequency.setTargetAtTime(revHz, now, 0.05);
    this.engineSubOsc.frequency.setTargetAtTime(revHz * 0.5, now, 0.05);
    this.engineFilter.frequency.setTargetAtTime(160 + clamped * 340, now, 0.06);
    this.engineGain.gain.setTargetAtTime(0.055 + clamped * 0.07, now, 0.06);
  }

  /**
   * Continuous filtered rainstorm bed: crisp rainfall outdoors, warm muffled low-pass inside
   * caves, road tunnels, buildings, or vehicle cabins, plus occasional distant thunder rolls.
   */
  updateWeatherAudio(
    active: boolean,
    rainIntensity: number,
    windStrength: number,
    sheltered: boolean,
    lightningFlash: number
  ): void {
    if (!this.ctx || !this.masterGain) return;
    const now = this.ctx.currentTime;
    const shouldPlay = active && !this.muted && !document.hidden && this.ctx.state === 'running' && rainIntensity > 0.04;

    if (!shouldPlay) {
      if (this.rainGain) {
        this.rainGain.gain.setTargetAtTime(0.0001, now, 0.25);
      }
      return;
    }

    if (!this.rainSource || !this.rainFilter || !this.rainGain) {
      // Generate a 2.5-second soft pink-weighted noise loop once
      const sr = this.ctx.sampleRate;
      const len = Math.floor(sr * 2.5);
      const buf = this.ctx.createBuffer(2, len, sr);
      for (let ch = 0; ch < 2; ch++) {
        const data = buf.getChannelData(ch);
        let b0 = 0;
        let b1 = 0;
        let b2 = 0;
        for (let i = 0; i < len; i++) {
          const white = Math.random() * 2 - 1;
          b0 = 0.997 * b0 + white * 0.029;
          b1 = 0.985 * b1 + white * 0.032;
          b2 = 0.95 * b2 + white * 0.048;
          data[i] = (b0 + b1 + b2 + white * 0.18) * 0.65;
        }
      }
      const src = this.ctx.createBufferSource();
      src.buffer = buf;
      src.loop = true;

      const filter = this.ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.value = 1800;
      filter.Q.value = 0.6;

      const gain = this.ctx.createGain();
      gain.gain.value = 0.0001;

      src.connect(filter);
      filter.connect(gain);
      gain.connect(this.masterGain);
      src.start(now);

      this.rainSource = src;
      this.rainFilter = filter;
      this.rainGain = gain;
    }

    const r = Math.max(0, Math.min(1, rainIntensity));
    const w = Math.max(0, Math.min(1, windStrength));
    const targetCutoff = sheltered ? 460 + r * 140 : 1850 + r * 1450 + w * 400;
    const targetGain = (0.045 + r * 0.13) * (sheltered ? 0.44 : 1.0);
    this.rainFilter.frequency.setTargetAtTime(targetCutoff, now, 0.22);
    this.rainGain.gain.setTargetAtTime(targetGain, now, 0.25);

    // Occasional deep distant thunder rumble on storm lightning
    if (lightningFlash > 0.42 && now - this.lastThunderTime > 8.5) {
      this.lastThunderTime = now;
      const osc = this.ctx.createOscillator();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(64, now + 0.35);
      osc.frequency.exponentialRampToValueAtTime(28, now + 2.1);
      const tFilter = this.ctx.createBiquadFilter();
      tFilter.type = 'lowpass';
      tFilter.frequency.value = sheltered ? 110 : 190;
      const tGain = this.ctx.createGain();
      tGain.gain.setValueAtTime(0.0001, now + 0.35);
      tGain.gain.linearRampToValueAtTime(sheltered ? 0.11 : 0.18, now + 0.65);
      tGain.gain.exponentialRampToValueAtTime(0.0001, now + 2.3);
      osc.connect(tFilter);
      tFilter.connect(tGain);
      tGain.connect(this.masterGain);
      osc.start(now + 0.35);
      osc.stop(now + 2.35);
    }
  }

}

export const soundEngine = new SurvivalSoundEngine();
