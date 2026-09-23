import Phaser from "phaser";
import { StageView, TankView } from "../lobby/LobbyService";
import { MatchEvents } from "./MatchEvents";

const TANK_COLORS = [0xff5555, 0x55aaff, 0xffcc33, 0x66dd66, 0xcc77ff, 0xff9955];
// how long a tank takes to drop when the ground under it is blown away
const FALL_MS = 400;
const HEALTH_BAR_WIDTH = 50;
const SMOKE_TEXTURE = "tank-smoke";
const SMOKE_PUFF_COUNT = 18;
// how widely the smoke fans out either side of the barrel direction, in degrees
const SMOKE_SPREAD = 30;

export interface TankDisplay {
  // aim to show: the server's value, or the local player's not-yet-confirmed aim during their turn
  angle: number;
  power: number;
  name: string;
  connected: boolean;
  activeTurn: boolean;
  // true only while this tank's player is choosing a shot; aim changes outside that (e.g. the server echoing
  // the final aim as the shot goes off) don't emit aimChanged
  aiming: boolean;
}

// One tank on screen. Call sync() with each state update; it redraws and emits tank events for whatever changed.
export class Tank extends Phaser.GameObjects.Container {
  private hull: Phaser.GameObjects.Rectangle;
  private barrel: Phaser.GameObjects.Rectangle;
  private healthFill: Phaser.GameObjects.Rectangle;
  private nameText: Phaser.GameObjects.Text;
  // last synced values, to detect changes; null until the first sync
  private lastSynced: { y: number; health: number; angle: number; power: number } | null = null;

  private smoke: Phaser.GameObjects.Particles.ParticleEmitter;
  // particle-space angle smoke is blown toward, updated on each puff
  private smokeDirection = -90;

  constructor(scene: Phaser.Scene, private index: number, private stage: StageView, private events: MatchEvents) {
    super(scene, 0, 0);
    const color = TANK_COLORS[index % TANK_COLORS.length];
    this.hull = scene.add.rectangle(0,0,stage.tankWidth,stage.tankHeight,color).setOrigin(0.5,1).setStrokeStyle(2,0x000000);
    // barrel pivots at the top-center of the body
    this.barrel = scene.add.rectangle(0,-stage.tankHeight,stage.barrelLength,6,color).setOrigin(0,0.5).setStrokeStyle(1,0x000000);
    const healthBg = scene.add.rectangle(-HEALTH_BAR_WIDTH/2,-stage.tankHeight-45,HEALTH_BAR_WIDTH,6,0x000000).setOrigin(0,0.5);
    this.healthFill = scene.add.rectangle(-HEALTH_BAR_WIDTH/2,-stage.tankHeight-45,HEALTH_BAR_WIDTH,6,0x33dd55).setOrigin(0,0.5);
    this.nameText = scene.add.text(0,-stage.tankHeight-62,"",{
      fontFamily: "Arial Black",
      fontSize: 16,
      color: "#ffffff",
      stroke: "#000000",
      strokeThickness: 3,
    }).setOrigin(0.5);
    this.add([this.barrel,this.hull,healthBg,this.healthFill,this.nameText]);
    scene.add.existing(this);

    // muzzle smoke: an emitter that only emits when puffMuzzleSmoke() calls explode()
    Tank.ensureSmokeTexture(scene);
    this.smoke = scene.add.particles(0, 0, SMOKE_TEXTURE, {
      emitting: false,
      lifespan: { min: 700, max: 1400 },
      speed: { min: 30, max: 110 },
      scale: { start: 0.35, end: 1.4 },
      alpha: { start: 0.55, end: 0 },
      tint: [0xdddddd, 0xbbbbbb, 0x999999],
      rotate: { min: 0, max: 360 },
      // fan out around the barrel direction; read per particle, so each puff follows the current barrel angle
      angle: { onEmit: () => this.smokeDirection + Phaser.Math.FloatBetween(-SMOKE_SPREAD, SMOKE_SPREAD) },
      // drifts upward and slows down like real smoke
      gravityY: -40,
      maxVelocityX: 110,
      maxVelocityY: 110,
    });
    // in front of the tank
    this.smoke.setDepth(1);
  }

  // soft round puff, generated once and shared by every tank
  private static ensureSmokeTexture(scene: Phaser.Scene) {
    if (scene.textures.exists(SMOKE_TEXTURE)) {
      return;
    }
    const size = 32;
    const g = scene.make.graphics({ x: 0, y: 0 }, false);
    // stacked circles fading outward approximate a radial gradient
    for (let r = size / 2; r > 0; r -= 2) {
      g.fillStyle(0xffffff, 0.12);
      g.fillCircle(size / 2, size / 2, r);
    }
    g.generateTexture(SMOKE_TEXTURE, size, size);
    g.destroy();
  }

  // burst of smoke from the barrel tip, blown out in the direction the barrel points
  puffMuzzleSmoke() {
    const angle = this.lastSynced?.angle ?? 90;
    const rad = Phaser.Math.DegToRad(angle);
    const tipX = this.x + Math.cos(rad) * this.stage.barrelLength;
    const tipY = this.y - this.stage.tankHeight - Math.sin(rad) * this.stage.barrelLength;
    // particle angles are clockwise with y down, the barrel angle is counter-clockwise, hence the minus
    this.smokeDirection = -angle;
    this.smoke.explode(SMOKE_PUFF_COUNT, tipX, tipY);
  }

  sync(view: TankView, display: TankDisplay) {
    const last = this.lastSynced;
    this.setX(view.x);

    if (!last) {
      this.setY(view.y);
    } else {
      if (view.y !== last.y) {
        // ground was blown away under it: drop onto the new surface
        this.scene.tweens.killTweensOf(this);
        this.scene.tweens.add({ targets: this, y: view.y, duration: FALL_MS, ease: "Quad.easeIn" });
        if (view.y > last.y) {
          this.events.emit("tankFell", { tank: this.index, distance: view.y - last.y, x: view.x });
        }
      }
      if (view.health < last.health) {
        this.events.emit("tankDamaged", { tank: this.index, amount: last.health - view.health, health: view.health, x: view.x });
        if (view.health <= 0) {
          this.events.emit("tankDestroyed", { tank: this.index, x: view.x });
        }
      }
      if (display.aiming && (display.angle !== last.angle || display.power !== last.power)) {
        this.events.emit("aimChanged", {
          tank: this.index,
          angle: display.angle,
          power: display.power,
          dAngle: display.angle - last.angle,
          dPower: display.power - last.power,
        });
      }
    }

    this.barrel.setRotation(Phaser.Math.DegToRad(-display.angle));
    this.healthFill.width = HEALTH_BAR_WIDTH * (view.health / 100);
    this.healthFill.setFillStyle(view.health > 50 ? 0x33dd55 : view.health > 25 ? 0xffcc33 : 0xdd3333);
    this.nameText.setText(`${display.name}${display.connected ? "" : " (reconnecting)"}`);
    this.hull.setStrokeStyle(display.activeTurn ? 3 : 2, display.activeTurn ? 0xffffff : 0x000000);
    this.setAlpha(view.health > 0 ? 1 : 0.35);

    this.lastSynced = { y: view.y, health: view.health, angle: display.angle, power: display.power };
  }
}
