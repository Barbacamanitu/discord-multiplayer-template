import Phaser from "phaser";
import { AimControl, MatchEvents } from "../match/MatchEvents";

// Sound files, relative to public/assets (Preloader loads from /.proxy/assets), and the volume each plays at.
// path null = no file yet: the handler below still runs but plays nothing, so adding a sound is just dropping the
// file in and filling in its path.
export const MATCH_SOUNDS = {
  // angle/power adjust loops
  aimLoop: { path: "audio/tank/aim_loop.wav", volume: 0.3 },
  powerLoop: { path: "audio/tank/power_loop.wav", volume: 0.5 },
  // fire pressed, shell being loaded (plays ~0.5s before fire)
  loading: { path: null, volume: 1 },
  fire: { path: "audio/tank/shoot_1.wav", volume: 0.6 },
  explosion: { path: "audio/tank/explosion_1.wav", volume: 0.7 },
  miss: { path: null, volume: 1 },
  damage: { path: null, volume: 1 },
  destroyed: { path: null, volume: 1 },
  fall: { path: null, volume: 1 },
  turnStart: { path: null, volume: 1 },
  yourTurn: { path: null, volume: 1 },
  win: { path: null, volume: 1 },
  lose: { path: null, volume: 1 },
} satisfies Record<string, { path: string | null; volume: number }>;

type SoundName = keyof typeof MATCH_SOUNDS;

const key = (name: SoundName) => `match.${name}`;

// angle/power adjust loops: how quickly they fade in on start and out on stop
const ADJUST_LOOP_FADE_IN_MS = 100;
const ADJUST_LOOP_FADE_OUT_MS = 500;

// how far sounds pan toward the side of the stage they come from: 0 = everything centered, 1 = hard left/right at
// the stage edges. Below 1 keeps far-side sounds audible in both ears.
const PAN_AMOUNT = 0.7;

// Plays match sounds in response to MatchEvents. It only listens; nothing in the match depends on it.
// Sounds that come from a place on the stage (a tank, an explosion) are panned left/right by their x.
export class MatchAudio {
  private unsubscribers: (() => void)[] = [];
  private adjustLoops: Record<AimControl, FadingLoop>;

  // call from a scene's preload(), with the loader path pointing at the assets folder
  static preload(scene: Phaser.Scene) {
    (Object.keys(MATCH_SOUNDS) as SoundName[]).forEach((name) => {
      const { path } = MATCH_SOUNDS[name];
      if (path) {
        scene.load.audio(key(name), path);
      }
    });
  }

  constructor(private scene: Phaser.Scene, events: MatchEvents) {
    this.adjustLoops = {
      angle: new FadingLoop(scene, key("aimLoop"), MATCH_SOUNDS.aimLoop.volume),
      power: new FadingLoop(scene, key("powerLoop"), MATCH_SOUNDS.powerLoop.volume),
    };
    this.unsubscribers = [
      events.on("aimAdjustStarted", ({ control, x }) => this.adjustLoops[control].start(this.panFor(x))),
      events.on("aimAdjustStopped", ({ control }) => this.adjustLoops[control].stop()),
      events.on("turnStarted", ({ isLocal }) => {
        this.stopAdjustLoops();
        this.play(isLocal ? "yourTurn" : "turnStart");
      }),
      events.on("shellLoading", ({ x }) => {
        this.stopAdjustLoops();
        this.play("loading", x);
      }),
      events.on("shotFired", ({ x }) => {
        this.stopAdjustLoops();
        this.play("fire", x);
      }),
      events.on("shellExploded", ({ x }) => this.play("explosion", x)),
      events.on("shellMissed", () => this.play("miss")),
      events.on("tankDamaged", ({ x }) => this.play("damage", x)),
      events.on("tankDestroyed", ({ x }) => this.play("destroyed", x)),
      events.on("tankFell", ({ x }) => this.play("fall", x)),
      events.on("matchOver", ({ localWon, isDraw }) => {
        this.stopAdjustLoops();
        // spectators and the loser hear "lose"; swap in a neutral sound for spectators if you prefer
        this.play(localWon && !isDraw ? "win" : "lose");
      }),
    ];
  }

  destroy() {
    this.unsubscribers.forEach((unsubscribe) => unsubscribe());
    this.unsubscribers = [];
    this.adjustLoops.angle.destroy();
    this.adjustLoops.power.destroy();
  }

  // stage x -> stereo pan (-1 left .. 1 right)
  private panFor(x: number): number {
    const halfWidth = this.scene.scale.gameSize.width / 2;
    return Phaser.Math.Clamp((x - halfWidth) / halfWidth, -1, 1) * PAN_AMOUNT;
  }

  private stopAdjustLoops() {
    this.adjustLoops.angle.stop();
    this.adjustLoops.power.stop();
  }

  // plays a one-shot sound if its file has been added and loaded, otherwise does nothing.
  // Pass the stage x it comes from to pan it; leave it out for UI-style sounds that play centered.
  private play(name: SoundName, x?: number) {
    if (this.scene.cache.audio.exists(key(name))) {
      this.scene.sound.play(key(name), { volume: MATCH_SOUNDS[name].volume, pan: x === undefined ? 0 : this.panFor(x) });
    }
  }
}

// A looping sound that fades in when started and out when stopped. It reuses one instance, so starting again
// mid-fade-out just fades back up instead of layering a second copy.
class FadingLoop {
  private sound: Phaser.Sound.BaseSound | null = null;

  constructor(private scene: Phaser.Scene, private soundKey: string, private volume: number) {}

  start(pan: number) {
    if (!this.scene.cache.audio.exists(this.soundKey)) {
      return;
    }
    this.sound ??= this.scene.sound.add(this.soundKey, { loop: true, volume: 0 });
    const sound = this.sound;
    this.scene.tweens.killTweensOf(sound);
    if (!sound.isPlaying) {
      sound.play({ loop: true, volume: 0 });
    }
    // pan isn't on BaseSound's type, but both WebAudio and HTML5 sounds have it (HTML5 ignores it)
    (sound as Phaser.Sound.WebAudioSound).setPan(pan);
    // from wherever the volume is now, so restarting during a fade-out doesn't jump
    this.scene.tweens.add({ targets: sound, volume: this.volume, duration: ADJUST_LOOP_FADE_IN_MS });
  }

  stop() {
    const sound = this.sound;
    if (!sound?.isPlaying) {
      return;
    }
    this.scene.tweens.killTweensOf(sound);
    this.scene.tweens.add({
      targets: sound,
      volume: 0,
      duration: ADJUST_LOOP_FADE_OUT_MS,
      onComplete: () => sound.stop(),
    });
  }

  // immediate, for scene shutdown: tweens are about to be torn down, so a fade wouldn't finish
  destroy() {
    if (this.sound) {
      this.scene.tweens.killTweensOf(this.sound);
      this.sound.stop();
      this.sound.destroy();
      this.sound = null;
    }
  }
}
