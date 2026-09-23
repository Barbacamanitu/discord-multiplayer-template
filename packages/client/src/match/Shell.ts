import Phaser from "phaser";
import { ShotEvent } from "../lobby/LobbyService";
import { MatchEvents } from "./MatchEvents";

// keep in sync with EXPLOSION_RADIUS in the server's ballistics.ts (visual only)
const EXPLOSION_RADIUS = 50;

// Animates a fired shell along the path the server computed, then the explosion. Call update() every frame.
export class Shell {
  private projectile: Phaser.GameObjects.Arc;
  private trail: Phaser.GameObjects.Graphics;
  private current: { shot: ShotEvent; startedAt: number } | null = null;

  constructor(private scene: Phaser.Scene, private events: MatchEvents) {
    this.trail = scene.add.graphics();
    this.projectile = scene.add.circle(0,0,5,0xffffff).setStrokeStyle(1,0x000000).setVisible(false);
  }

  play(shot: ShotEvent) {
    this.current = { shot, startedAt: this.scene.time.now };
    this.trail.clear();
    this.projectile.setPosition(shot.points[0], shot.points[1]).setVisible(true);
  }

  update(time: number) {
    if (!this.current) {
      return;
    }
    const { shot, startedAt } = this.current;
    const count = shot.points.length / 2;
    const progress = (time - startedAt) / shot.stepMs;
    const i = Math.floor(progress);
    if (i >= count - 1) {
      this.projectile.setVisible(false);
      this.current = null;
      if (shot.impact) {
        this.explode(shot.impact.x, shot.impact.y);
        this.events.emit("shellExploded", { shooter: shot.shooter, x: shot.impact.x, y: shot.impact.y });
      } else {
        this.events.emit("shellMissed", { shooter: shot.shooter });
      }
      return;
    }
    // interpolate between samples so the shell moves smoothly at any frame rate
    const t = progress - i;
    const x = Phaser.Math.Linear(shot.points[i*2], shot.points[i*2+2], t);
    const y = Phaser.Math.Linear(shot.points[i*2+1], shot.points[i*2+3], t);
    this.projectile.setPosition(x, y);
    this.trail.lineStyle(2, 0xffffff, 0.5).lineBetween(shot.points[i*2], shot.points[i*2+1], x, y);
  }

  private explode(x: number, y: number) {
    const blast = this.scene.add.circle(x,y,EXPLOSION_RADIUS,0xffaa33,0.9).setScale(0.2);
    this.scene.tweens.add({
      targets: blast,
      scale: 1,
      alpha: 0,
      duration: 600,
      ease: "Cubic.easeOut",
      onComplete: () => blast.destroy(),
    });
  }
}
