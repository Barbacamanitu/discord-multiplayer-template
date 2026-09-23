import { Scene } from "phaser";
import { LobbyService, LobbyState, MatchView, ShotEvent, TankView, TurnPhase } from "../lobby/LobbyService";
import { ColyseusLobbyService } from "../lobby/ColyseusLobbyService";
import { Button, createButton } from "../ui/widgets";
import { AimControl, MatchEvents } from "../match/MatchEvents";
import { Tank } from "../match/Tank";
import { Shell } from "../match/Shell";
import { MatchAudio } from "../audio/MatchAudio";

const AIM_REPEAT_MS = 40;
// don't flood the server with aim updates while a key or button is held
const AIM_SEND_INTERVAL_MS = 60;
// other players' key presses aren't sent over the network, so their angle/power adjusting counts as stopped once updates
// pause this long. Updates arrive every ~50-60ms while someone holds a control, so this must stay comfortably above that.
const REMOTE_ADJUST_IDLE_MS = 150;
// which keyboard keys adjust which part of the aim (the keys object maps these names to A/D/W/S)
const AIM_KEYS = [
  { name: "left", control: "angle" },
  { name: "right", control: "angle" },
  { name: "up", control: "power" },
  { name: "down", control: "power" },
] as const;
const DIRT_COLOR = 0x7a5a3a;
const GRASS_COLOR = 0x5b8c3a;
const BEDROCK_COLOR = 0x3a3a3a;

// Turn-based artillery match: players take turns setting angle and power, then firing at each other.
// The server runs the rules and physics; this scene draws the state, sends aim/fire for the local player,
// and turns state changes into MatchEvents (which MatchAudio, and anything else, can listen to).
export class ScorchMatch extends Scene {
  constructor() {
    super("ScorchMatch");
  }

  private lobby!: LobbyService;
  private matchEvents!: MatchEvents;
  private audio!: MatchAudio;
  private transitioning = false;
  private tanks: Tank[] = [];
  private shell!: Shell;
  private terrainGfx!: Phaser.GameObjects.Graphics;
  private drawnTerrainVersion = -1;
  // previous turn phase, to detect turn starts and the end of the match; null before the first render
  private lastTurnPhase: TurnPhase | null = null;

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
  // aim controls (keys/buttons) the local player is holding right now, per control; aimAdjustStarted/Stopped fire as
  // each set fills/empties
  private heldControls: Record<AimControl, Set<string>> = { angle: new Set(), power: new Set() };
  // other players' tanks that are adjusting, keyed "tank:control", each with the timer that will mark it stopped
  private remoteAdjustTimers = new Map<string, Phaser.Time.TimerEvent>();

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

  // dirt polygon from the heightmap down to the bottom of the screen, with a grass line along the surface
  private drawTerrain(match: MatchView) {
    const { terrain, stage } = match;
    this.terrainGfx.clear();
    if (!terrain.length) {
      return;
    }
    const surface = terrain.map((y, i) => new Phaser.Math.Vector2(i * stage.terrainStep, y));
    this.terrainGfx.fillStyle(DIRT_COLOR, 1);
    this.terrainGfx.fillPoints([new Phaser.Math.Vector2(0, stage.height), ...surface, new Phaser.Math.Vector2(stage.width, stage.height)], true);
    this.terrainGfx.lineStyle(4, GRASS_COLOR, 1);
    this.terrainGfx.strokePoints(surface, false);
    this.drawnTerrainVersion = match.terrainVersion;
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
      // the turn ended mid-press (e.g. fired while holding a key): drop the held controls without an aimAdjustStopped,
      // since the shot/turn events already cover what happened
      this.heldControls.angle.clear();
      this.heldControls.power.clear();
    }

    if (match.terrainVersion !== this.drawnTerrainVersion) {
      this.drawTerrain(match);
    }

    // tanks emit their own events (damaged, fell, destroyed, aimChanged) from sync()
    while (this.tanks.length < match.tanks.length) {
      this.tanks.push(new Tank(this, this.tanks.length, match.stage, this.matchEvents));
    }
    match.tanks.forEach((view, i) => {
      const slot = state.slots[i];
      this.tanks[i].sync(view, {
        ...this.tankAim(state, i, view),
        name: slot?.username ?? "?",
        connected: slot?.connected ?? true,
        activeTurn: i === match.turn && match.turnPhase !== "over",
        aiming: i === match.turn && match.turnPhase === "aiming",
      });
    });

    this.emitMatchEvents(state);
    this.renderHud(state);
  }

  // match-level events, detected from turn phase changes. Runs after tank sync, so damage from the last shot
  // is reported before the next turn starts (the server sends both in the same update).
  private emitMatchEvents(state: LobbyState) {
    const { match } = state;
    const me = this.localIndex(state);
    if (this.lastTurnPhase === null && match.tanks.length) {
      this.matchEvents.emit("matchStarted", { tankCount: match.tanks.length, localTank: me >= 0 ? me : null });
    }
    if (match.turnPhase === "aiming" && this.lastTurnPhase !== "aiming") {
      this.matchEvents.emit("turnStarted", { tank: match.turn, isLocal: match.turn === me, isAi: !!state.slots[match.turn]?.isAi });
    }
    if (match.turnPhase === "loading" && this.lastTurnPhase !== "loading") {
      // aiming is over for this turn: end any inferred remote adjusting silently (the AI fires the instant it
      // finishes aiming), matching how the local player's held controls are dropped when their turn ends
      this.clearRemoteAdjusting();
      this.matchEvents.emit("shellLoading", { tank: match.turn, isLocal: match.turn === me, x: this.tankX(state, match.turn) });
    }
    if (match.turnPhase === "over" && this.lastTurnPhase !== "over") {
      this.matchEvents.emit("matchOver", { winner: match.winner, localWon: match.winner >= 0 && match.winner === me, isDraw: match.winner < 0 });
    }
    this.lastTurnPhase = match.turnPhase;
  }

  private renderHud(state: LobbyState) {
    const { match } = state;
    const me = this.localIndex(state);
    const myTurn = this.isMyTurn(state);

    const current = state.slots[match.turn];
    const currentName = current?.username ?? `Player ${match.turn + 1}`;
    if (match.turnPhase === "over") {
      this.turnText.setText("");
      const winner = state.slots[match.winner];
      this.bannerText.setText(match.winner < 0 ? "Draw!" : match.winner === me ? "You win!" : `${winner?.username ?? "?"} wins!`).setVisible(true);
    } else {
      this.bannerText.setVisible(false);
      const mine = match.turn === me;
      const text =
        myTurn ? "Your turn!"
        : match.turnPhase === "loading" ? (mine ? "Loading shell..." : `${currentName} is loading...`)
        : match.turnPhase === "firing" ? (mine ? "Fire!" : `${currentName} fired!`)
        : `${currentName}'s turn`;
      this.turnText.setText(text);
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

  private tankX(state: LobbyState, tank: number): number {
    return state.match.tanks[tank]?.x ?? state.match.stage.width / 2;
  }

  // local aim press/release, from keys and on-screen buttons. Ignored when it isn't our turn.
  private pressAimControl(control: AimControl, id: string) {
    const state = this.lobby.getState();
    const held = this.heldControls[control];
    if (!this.isMyTurn(state) || held.has(id)) {
      return;
    }
    held.add(id);
    if (held.size === 1) {
      const tank = this.localIndex(state);
      this.matchEvents.emit("aimAdjustStarted", { tank, isLocal: true, control, x: this.tankX(state, tank) });
    }
  }

  private releaseAimControl(control: AimControl, id: string) {
    const held = this.heldControls[control];
    if (held.delete(id) && held.size === 0) {
      const state = this.lobby.getState();
      const tank = this.localIndex(state);
      this.matchEvents.emit("aimAdjustStopped", { tank, isLocal: true, control, x: this.tankX(state, tank) });
    }
  }

  // infer aimAdjustStarted/Stopped for tanks controlled by other players or the AI from their aim updates
  private trackRemoteAdjust(tank: number, control: AimControl) {
    const state = this.lobby.getState();
    if (tank === this.localIndex(state)) {
      return;
    }
    const timerKey = `${tank}:${control}`;
    const x = this.tankX(state, tank);
    const timer = this.remoteAdjustTimers.get(timerKey);
    if (timer) {
      timer.remove();
    } else {
      this.matchEvents.emit("aimAdjustStarted", { tank, isLocal: false, control, x });
    }
    this.remoteAdjustTimers.set(timerKey, this.time.delayedCall(REMOTE_ADJUST_IDLE_MS, () => {
      this.remoteAdjustTimers.delete(timerKey);
      this.matchEvents.emit("aimAdjustStopped", { tank, isLocal: false, control, x });
    }));
  }

  private clearRemoteAdjusting() {
    this.remoteAdjustTimers.forEach((timer) => timer.remove());
    this.remoteAdjustTimers.clear();
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

  private onShot(shot: ShotEvent) {
    const me = this.localIndex(this.lobby.getState());
    // normally already cleared when loading started; this covers a shot arriving before that state update
    this.clearRemoteAdjusting();
    this.tanks[shot.shooter]?.puffMuzzleSmoke();
    this.matchEvents.emit("shotFired", { shooter: shot.shooter, isLocal: shot.shooter === me, x: shot.points[0], y: shot.points[1] });
    this.shell.play(shot);
  }

  update(time: number) {
    this.shell?.update(time);

    // keyboard aiming: A/D adjust angle, W/S adjust power, space fires. Presses are picked up here (so a key already
    // held when our turn starts still counts); releasing comes from each key's "up" event.
    if (this.keys) {
      AIM_KEYS.forEach(({ name, control }) => {
        if (this.keys[name].isDown) {
          this.pressAimControl(control, `key:${name}`);
        }
      });
    }
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
    this.tanks = [];
    this.controls = [];
    this.localAim = null;
    this.drawnTerrainVersion = -1;
    this.lastTurnPhase = null;
    this.aimSendTimer = null;
    this.lastAimSentAt = 0;
    this.keyRepeatAt = 0;
    this.heldControls = { angle: new Set(), power: new Set() };
    this.remoteAdjustTimers = new Map();

    this.lobby = new ColyseusLobbyService();
    this.matchEvents = new MatchEvents();
    this.audio = new MatchAudio(this, this.matchEvents);
    const { stage } = this.lobby.getState().match;
    const w = this.cameras.main.width;
    const hW = w/2;

    // sky, then terrain (drawn from state in render()), then the bedrock strip that holds the controls
    const sky = this.add.graphics();
    sky.fillGradientStyle(0x1a1a40,0x1a1a40,0x7a4c93,0x7a4c93,1);
    sky.fillRect(0,0,stage.width,stage.height);
    this.terrainGfx = this.add.graphics();
    this.add.rectangle(0,stage.bedrockY,stage.width,stage.height-stage.bedrockY,BEDROCK_COLOR).setOrigin(0,0);

    this.shell = new Shell(this, this.matchEvents);

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

    this.bannerText = this.add.text(hW,200,"",{
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

    // on-screen controls in the bedrock strip, for mouse/touch (keyboard works too)
    const controlsY = stage.bedrockY + (stage.height - stage.bedrockY)/2;
    // aim buttons repeat while held and report press/release, so the aim sounds follow them exactly
    const aimButton = (x: number, label: string, dAngle: number, dPower: number) => {
      const id = `button:${label}`;
      const control: AimControl = dAngle !== 0 ? "angle" : "power";
      return createButton(this,x,controlsY,label,() => {
        this.pressAimControl(control, id);
        this.adjustAim(dAngle,dPower);
      },140,56,{ fontSize: 22, repeatMs: AIM_REPEAT_MS, onRelease: () => this.releaseAimControl(control, id) });
    };
    this.controls = [
      aimButton(hW-420,"Angle ◀",1,0),
      aimButton(hW-270,"Angle ▶",-1,0),
      createButton(this,hW,controlsY,"FIRE",() => this.fire(),180,64,{ fontSize: 30 }),
      aimButton(hW+270,"Power −",0,-1),
      aimButton(hW+420,"Power +",0,1),
    ];

    const keyboard = this.input.keyboard;
    if (keyboard) {
      const K = Phaser.Input.Keyboard.KeyCodes;
      this.keys = {
        left: keyboard.addKey(K.A),
        right: keyboard.addKey(K.D),
        up: keyboard.addKey(K.W),
        down: keyboard.addKey(K.S),
        space: keyboard.addKey(K.SPACE),
      };
      this.keys.space.on("down", () => this.fire());
      AIM_KEYS.forEach(({ name, control }) => {
        this.keys[name].on("up", () => this.releaseAimControl(control, `key:${name}`));
      });
    }
    this.matchEvents.on("aimChanged", ({ tank, dAngle, dPower }) => {
      if (dAngle !== 0) {
        this.trackRemoteAdjust(tank, "angle");
      }
      if (dPower !== 0) {
        this.trackRemoteAdjust(tank, "power");
      }
    });

    const unsubscribe = this.lobby.onChange((state) => this.render(state));
    const unsubscribeShot = this.lobby.onShot((shot) => this.onShot(shot));
    this.render(this.lobby.getState());

    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      unsubscribe();
      unsubscribeShot();
      this.lobby.dispose();
      this.audio.destroy();
      this.matchEvents.destroy();
      // addKey() returns the same Key objects on the next match, so drop them (and the space listener) here
      this.input.keyboard?.removeAllKeys(true);
    });
  }
}
