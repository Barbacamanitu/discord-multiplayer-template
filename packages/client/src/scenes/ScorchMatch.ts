import { Scene } from "phaser";
import { LobbyService, LobbyState, ShotEvent, TankView } from "../lobby/LobbyService";
import { ColyseusLobbyService } from "../lobby/ColyseusLobbyService";
import { Button, createButton } from "../ui/widgets";

const TANK_COLORS = [0xff5555, 0x55aaff, 0xffcc33, 0x66dd66, 0xcc77ff, 0xff9955];
// keep in sync with EXPLOSION_RADIUS in the server's ballistics.ts (visual only)
const EXPLOSION_RADIUS = 50;
const AIM_REPEAT_MS = 40;
// don't flood the server with aim updates while a key or button is held
const AIM_SEND_INTERVAL_MS = 60;

interface TankSprite {
  container: Phaser.GameObjects.Container;
  barrel: Phaser.GameObjects.Rectangle;
  healthFill: Phaser.GameObjects.Rectangle;
  name: Phaser.GameObjects.Text;
  body: Phaser.GameObjects.Rectangle;
}

interface ShotAnimation {
  shot: ShotEvent;
  startedAt: number;
}

// Turn-based artillery match: players take turns setting angle and power, then firing at each other.
// The server runs the rules and physics; this scene draws the state and sends aim/fire for the local player.
export class ScorchMatch extends Scene {
  constructor() {
    super("ScorchMatch");
  }

  private lobby!: LobbyService;
  private transitioning = false;
  private tankSprites: TankSprite[] = [];
  private projectile!: Phaser.GameObjects.Arc;
  private trail!: Phaser.GameObjects.Graphics;
  private shotAnim: ShotAnimation | null = null;

  private turnText!: Phaser.GameObjects.Text;
  private aimText!: Phaser.GameObjects.Text;
  private spectatorText!: Phaser.GameObjects.Text;
  private statusText!: Phaser.GameObjects.Text;
  private bannerText!: Phaser.GameObjects.Text;
  private forfeitButton!: Button;
  private controls: Button[] = [];

  // the local player's aim while it's their turn, so the barrel responds instantly instead of waiting on the server
  private localAim: { angle: number; power: number } | null = null;
  private lastAimSentAt = 0;
  private aimSendTimer: Phaser.Time.TimerEvent | null = null;
  private keys!: {
    left: Phaser.Input.Keyboard.Key;
    right: Phaser.Input.Keyboard.Key;
    up: Phaser.Input.Keyboard.Key;
    down: Phaser.Input.Keyboard.Key;
    space: Phaser.Input.Keyboard.Key;
  };
  private keyRepeatAt = 0;

  private goTo(key: string, data?: object) {
    this.transitioning = true;
    this.scene.start(key, data);
  }

  private localIndex(state: LobbyState): number {
    return state.slots.findIndex((s) => s.playerId === this.lobby.localPlayerId);
  }

  private isMyTurn(state: LobbyState): boolean {
    const me = this.localIndex(state);
    return me >= 0 && state.match.turn === me && state.match.turnPhase === "aiming" && state.connection === "connected";
  }

  private createTank(index: number, stage: LobbyState["match"]["stage"]): TankSprite {
    const color = TANK_COLORS[index % TANK_COLORS.length];
    const body = this.add.rectangle(0,0,stage.tankWidth,stage.tankHeight,color).setOrigin(0.5,1).setStrokeStyle(2,0x000000);
    // barrel pivots at the top-center of the body; rotation is set from the angle in render()
    const barrel = this.add.rectangle(0,-stage.tankHeight,stage.barrelLength,6,color).setOrigin(0,0.5).setStrokeStyle(1,0x000000);
    const healthBg = this.add.rectangle(-25,-stage.tankHeight-45,50,6,0x000000).setOrigin(0,0.5);
    const healthFill = this.add.rectangle(-25,-stage.tankHeight-45,50,6,0x33dd55).setOrigin(0,0.5);
    const name = this.add.text(0,-stage.tankHeight-62,"",{
      fontFamily: "Arial Black",
      fontSize: 16,
      color: "#ffffff",
      stroke: "#000000",
      strokeThickness: 3,
    }).setOrigin(0.5);
    const container = this.add.container(0,0,[barrel,body,healthBg,healthFill,name]);
    return { container, barrel, healthFill, name, body };
  }

  private tankAim(state: LobbyState, index: number, tank: TankView) {
    if (this.localAim && this.isMyTurn(state) && index === state.match.turn) {
      return this.localAim;
    }
    return { angle: tank.angle, power: tank.power };
  }

  private render(state: LobbyState) {
    if (this.transitioning) {
      return;
    }
    if (state.connection === "disconnected") {
      this.goTo("Title", { message: "Lost connection to the server" });
      return;
    }
    if (state.phase !== "match" && state.connection === "connected") {
      this.goTo("MainMenu");
      return;
    }

    const { match } = state;
    const me = this.localIndex(state);
    const myTurn = this.isMyTurn(state);

    // start local aiming from the tank's current values when our turn begins; drop it when the turn ends
    if (myTurn && !this.localAim) {
      const tank = match.tanks[me];
      this.localAim = tank ? { angle: tank.angle, power: tank.power } : null;
    } else if (!myTurn) {
      this.localAim = null;
    }

    while (this.tankSprites.length < match.tanks.length) {
      this.tankSprites.push(this.createTank(this.tankSprites.length, match.stage));
    }
    match.tanks.forEach((tank, i) => {
      const sprite = this.tankSprites[i];
      const aim = this.tankAim(state, i, tank);
      const alive = tank.health > 0;
      sprite.container.setPosition(tank.x, tank.y).setAlpha(alive ? 1 : 0.35);
      sprite.barrel.setRotation(Phaser.Math.DegToRad(-aim.angle));
      sprite.healthFill.width = 50 * (tank.health / 100);
      sprite.healthFill.setFillStyle(tank.health > 50 ? 0x33dd55 : tank.health > 25 ? 0xffcc33 : 0xdd3333);
      const slot = state.slots[i];
      sprite.name.setText(`${slot?.username ?? "?"}${slot && !slot.connected ? " (reconnecting)" : ""}`);
      // highlight whose turn it is
      sprite.body.setStrokeStyle(i === match.turn && match.turnPhase !== "over" ? 3 : 2, i === match.turn ? 0xffffff : 0x000000);
    });

    const current = state.slots[match.turn];
    const currentName = current?.username ?? `Player ${match.turn + 1}`;
    if (match.turnPhase === "over") {
      this.turnText.setText("");
      const winner = state.slots[match.winner];
      this.bannerText.setText(match.winner < 0 ? "Draw!" : match.winner === me ? "You win!" : `${winner?.username ?? "?"} wins!`).setVisible(true);
    } else {
      this.bannerText.setVisible(false);
      this.turnText.setText(myTurn ? "Your turn!" : match.turnPhase === "firing" ? `${currentName} fired!` : `${currentName}'s turn`);
    }

    const currentTank = match.tanks[match.turn];
    if (currentTank && match.turnPhase !== "over") {
      const aim = this.tankAim(state, match.turn, currentTank);
      this.aimText.setText(`Angle ${aim.angle}°   Power ${aim.power}`);
    } else {
      this.aimText.setText("");
    }

    this.controls.forEach((button) => {
      button.container.setVisible(me >= 0);
      button.setEnabled(myTurn);
    });

    this.spectatorText.setText(
      me < 0 ? `Spectating${state.spectators.length > 1 ? ` with ${state.spectators.length - 1} others` : ""}` : ""
    );
    this.statusText.setText(state.connection === "reconnecting" ? "Reconnecting..." : "");

    // in an AI-only match there's nobody to forfeit, so anyone watching can end it
    const aiOnly = state.slots.every((s) => s.isAi);
    const canEnd = (me >= 0 || aiOnly) && match.turnPhase !== "over";
    this.forfeitButton.setLabel(aiOnly ? "End" : "Forfeit");
    this.forfeitButton.container.setVisible(canEnd);
    this.forfeitButton.setEnabled(canEnd && state.connection === "connected");
  }

  private adjustAim(dAngle: number, dPower: number) {
    const state = this.lobby.getState();
    if (!this.isMyTurn(state) || !this.localAim) {
      return;
    }
    this.localAim = {
      angle: Phaser.Math.Clamp(this.localAim.angle + dAngle, 0, 180),
      power: Phaser.Math.Clamp(this.localAim.power + dPower, 0, 100),
    };
    this.render(state);
    this.queueAimSend();
  }

  // send at most every AIM_SEND_INTERVAL_MS, always ending with the latest value
  private queueAimSend() {
    if (this.aimSendTimer) {
      return;
    }
    const wait = Math.max(0, this.lastAimSentAt + AIM_SEND_INTERVAL_MS - this.time.now);
    this.aimSendTimer = this.time.delayedCall(wait, () => {
      this.aimSendTimer = null;
      this.sendAim();
    });
  }

  private sendAim() {
    if (this.localAim) {
      this.lobby.aim(this.localAim.angle, this.localAim.power);
      this.lastAimSentAt = this.time.now;
    }
  }

  private fire() {
    if (!this.isMyTurn(this.lobby.getState())) {
      return;
    }
    // make sure the server has our final aim before the fire message (messages arrive in order)
    this.aimSendTimer?.remove();
    this.aimSendTimer = null;
    this.sendAim();
    this.lobby.fire();
  }

  private playShot(shot: ShotEvent) {
    this.shotAnim = { shot, startedAt: this.time.now };
    this.trail.clear();
    this.projectile.setPosition(shot.points[0], shot.points[1]).setVisible(true);
  }

  private explode(x: number, y: number) {
    const blast = this.add.circle(x,y,EXPLOSION_RADIUS,0xffaa33,0.9).setScale(0.2);
    this.tweens.add({
      targets: blast,
      scale: 1,
      alpha: 0,
      duration: 600,
      ease: "Cubic.easeOut",
      onComplete: () => blast.destroy(),
    });
  }

  update(time: number) {
    if (this.shotAnim) {
      const { shot, startedAt } = this.shotAnim;
      const count = shot.points.length / 2;
      const progress = (time - startedAt) / shot.stepMs;
      const i = Math.floor(progress);
      if (i >= count - 1) {
        this.projectile.setVisible(false);
        if (shot.impact) {
          this.explode(shot.impact.x, shot.impact.y);
        }
        this.shotAnim = null;
      } else {
        // interpolate between samples so the shell moves smoothly at any frame rate
        const t = progress - i;
        const x = Phaser.Math.Linear(shot.points[i*2], shot.points[i*2+2], t);
        const y = Phaser.Math.Linear(shot.points[i*2+1], shot.points[i*2+3], t);
        this.projectile.setPosition(x, y);
        this.trail.lineStyle(2, 0xffffff, 0.5).lineBetween(shot.points[i*2], shot.points[i*2+1], x, y);
      }
    }

    // keyboard aiming: arrows adjust (left/right = angle, up/down = power), space fires
    if (this.keys && time >= this.keyRepeatAt) {
      const dAngle = (this.keys.left.isDown ? 1 : 0) - (this.keys.right.isDown ? 1 : 0);
      const dPower = (this.keys.up.isDown ? 1 : 0) - (this.keys.down.isDown ? 1 : 0);
      if (dAngle || dPower) {
        this.adjustAim(dAngle, dPower);
        this.keyRepeatAt = time + AIM_REPEAT_MS;
      }
    }
  }

  create() {
    this.transitioning = false;
    this.tankSprites = [];
    this.controls = [];
    this.shotAnim = null;
    this.localAim = null;
    this.aimSendTimer = null;
    this.lastAimSentAt = 0;
    this.keyRepeatAt = 0;

    this.lobby = new ColyseusLobbyService();
    const { stage } = this.lobby.getState().match;
    const w = this.cameras.main.width;
    const hW = w/2;

    // sky and flat ground
    const sky = this.add.graphics();
    sky.fillGradientStyle(0x1a1a40,0x1a1a40,0x7a4c93,0x7a4c93,1);
    sky.fillRect(0,0,stage.width,stage.groundY);
    this.add.rectangle(0,stage.groundY,stage.width,stage.height-stage.groundY,0x5b8c3a).setOrigin(0,0);
    this.add.rectangle(0,stage.groundY,stage.width,4,0x3d6b25).setOrigin(0,0);

    this.trail = this.add.graphics();
    this.projectile = this.add.circle(0,0,5,0xffffff).setStrokeStyle(1,0x000000).setVisible(false);

    this.turnText = this.add.text(hW,24,"",{
      fontFamily: "Arial Black",
      fontSize: 30,
      color: "#ffe066",
      stroke: "#000000",
      strokeThickness: 5,
    }).setOrigin(0.5,0);

    this.aimText = this.add.text(hW,66,"",{
      fontFamily: "Arial Black",
      fontSize: 20,
      color: "#ffffff",
      stroke: "#000000",
      strokeThickness: 3,
    }).setOrigin(0.5,0);

    this.bannerText = this.add.text(hW,stage.groundY/2,"",{
      fontFamily: "Arial Black",
      fontSize: 64,
      color: "#fffafa",
      stroke: "#00cc00",
      strokeThickness: 10,
    }).setOrigin(0.5).setVisible(false);

    this.spectatorText = this.add.text(20,20,"",{
      fontFamily: "Arial",
      fontSize: 18,
      color: "#cccccc",
    });

    this.statusText = this.add.text(hW,100,"",{
      fontFamily: "Arial",
      fontSize: 20,
      color: "#ffcc66",
    }).setOrigin(0.5,0);

    this.forfeitButton = createButton(this,w-90,40,"Forfeit",() => this.lobby.forfeit(),150,50,{ fontSize: 22 });

    // on-screen controls in the ground strip, for mouse/touch (keyboard works too)
    const controlsY = stage.groundY + (stage.height - stage.groundY)/2;
    const small = { fontSize: 22, repeatMs: AIM_REPEAT_MS };
    this.controls = [
      createButton(this,hW-420,controlsY,"Angle ◀",() => this.adjustAim(1,0),140,56,small),
      createButton(this,hW-270,controlsY,"Angle ▶",() => this.adjustAim(-1,0),140,56,small),
      createButton(this,hW,controlsY,"FIRE",() => this.fire(),180,64,{ fontSize: 30 }),
      createButton(this,hW+270,controlsY,"Power −",() => this.adjustAim(0,-1),140,56,small),
      createButton(this,hW+420,controlsY,"Power +",() => this.adjustAim(0,1),140,56,small),
    ];

    const keyboard = this.input.keyboard;
    if (keyboard) {
      const K = Phaser.Input.Keyboard.KeyCodes;
      this.keys = {
        left: keyboard.addKey(K.LEFT),
        right: keyboard.addKey(K.RIGHT),
        up: keyboard.addKey(K.UP),
        down: keyboard.addKey(K.DOWN),
        space: keyboard.addKey(K.SPACE),
      };
      this.keys.space.on("down", () => this.fire());
    }

    const unsubscribe = this.lobby.onChange((state) => this.render(state));
    const unsubscribeShot = this.lobby.onShot((shot) => this.playShot(shot));
    this.render(this.lobby.getState());

    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      unsubscribe();
      unsubscribeShot();
      this.lobby.dispose();
      // addKey() returns the same Key objects on the next match, so drop them (and the space listener) here
      this.input.keyboard?.removeAllKeys(true);
    });
  }
}
