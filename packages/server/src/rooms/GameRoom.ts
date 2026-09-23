import { Client, Delayed, Room } from "colyseus";
import { GameState, Draggables, Player, Slot, Tank } from "../schemas/GameState";
import { DiscordUser, verifyDiscordUser } from "../auth";
import { EXPLOSION_RADIUS, chooseAiShot, clamp, explosionDamage, simulateShot } from "../game/ballistics";
import { Terrain, carveCrater, flattenPad, generateHeights, restingY } from "../game/terrain";

// TODO: derive from the selected level
const SLOT_COUNT = 2;
const READY_CHECK_INTERVAL_MS = 500;
const COUNTDOWN_SECONDS = 3;
// how long a dropped connection keeps its slot before it's released
const RECONNECT_SECONDS = 20;
// how long clients get to show the explosion before damage is applied and the turn passes
const EXPLOSION_MS = 700;
const GAME_OVER_MS = 5000;
const AI_THINK_MS = 1200;
const AI_AIM_STEP_MS = 30;
const TANK_MARGIN = 160;
// random shift of each tank's starting x, so every match plays differently
const TANK_POSITION_JITTER = 60;
// generated terrain surface stays between these (y grows downward)
const TERRAIN_TOP_Y = 280;
const TERRAIN_BOTTOM_Y = 600;

type ClaimResult = { ok: true } | { ok: false; reason: string };

export class GameRoom extends Room<GameState> {
  state = new GameState();
  maxClients = 25; // Current Discord limit is 25

  private countdownTimer?: Delayed;
  // the one pending match event: an AI move, a shell landing, or returning to the lobby
  private matchTimer?: Delayed;

  onCreate(options: any): void | Promise<any> {
    const draggableList = [
      "smile",
      "alien",
      "a",
      "b",
      "c",
      "d",
      "cross_1",
      "cross_2",
      "cross_3",
      "nought_1",
      "nought_2",
      "nought_3",
    ];
    draggableList.forEach((draggable, index) => {
      const draggableObject = new Draggables();

      const offset = 500;
      const minWidth = offset;
      const maxWidth = options.screenWidth / 2 + 250;
      const minHeight = offset;
      const maxHeight = options.screenHeight / 2;

      draggableObject.x =
        Math.floor(Math.random() * (maxWidth - minWidth + 1)) + minWidth;
      draggableObject.y =
        Math.floor(Math.random() * (maxHeight - minHeight + 1)) + minHeight;
      draggableObject.imageId = draggable;

      this.state.draggables.set(draggable, draggableObject);
    });

    this.onMessage("move", (client, message) => {
      // Update image position based on data received
      const image = this.state.draggables.get(message.imageId);
      if (image) {
        image.x = message.x;
        image.y = message.y;
        this.broadcast("move", this.state.draggables);
      }
    });

    for (let i = 0; i < SLOT_COUNT; i++) {
      this.state.slots.push(new Slot());
    }

    this.onMessage("claimSlot", (client, message: { requestId: number; index: number }) => {
      const result = this.claimSlot(client.sessionId, message?.index);
      client.send("claimResult", { requestId: message?.requestId, ...result });
    });

    this.onMessage("releaseSlot", (client) => {
      this.releaseSlot(client.sessionId);
    });

    this.onMessage("setReady", (client, message: { ready: boolean }) => {
      const slot = this.slotOf(client.sessionId);
      if (slot && this.state.phase !== "match") {
        slot.ready = !!message?.ready;
      }
    });

    // anyone connected (players or spectators) can fill an open slot with an AI, including AI vs AI
    this.onMessage("addAi", (client, message: { index: number }) => {
      const slot = this.slotAt(message?.index);
      if (slot && this.state.phase === "lobby" && !slot.sessionId && !slot.isAi) {
        slot.isAi = true;
        slot.ready = true;
      }
    });

    this.onMessage("removeAi", (client, message: { index: number }) => {
      const slot = this.slotAt(message?.index);
      if (slot?.isAi && this.state.phase !== "match") {
        slot.isAi = false;
        slot.ready = false;
      }
    });

    // placeholder until the match has a real win/lose condition. With no humans in the match (AI vs AI),
    // anyone can end it, otherwise nobody could.
    this.onMessage("forfeit", (client) => {
      const hasHumanPlayers = this.state.slots.some((s) => s.sessionId);
      if (this.state.phase === "match" && (this.slotOf(client.sessionId) || !hasHumanPlayers)) {
        this.endMatch();
      }
    });

    // the current player adjusting their shot; synced so everyone sees the barrel move
    this.onMessage("aim", (client, message: { angle: number; power: number }) => {
      const tank = this.currentHumanTank(client.sessionId);
      if (tank && Number.isFinite(message?.angle) && Number.isFinite(message?.power)) {
        tank.angle = clamp(Math.round(message.angle), 0, 180);
        tank.power = clamp(Math.round(message.power), 0, 100);
      }
    });

    this.onMessage("fire", (client) => {
      if (this.currentHumanTank(client.sessionId)) {
        this.fire();
      }
    });

    this.clock.setInterval(() => this.checkAllReady(), READY_CHECK_INTERVAL_MS);
  }

  onAuth(client: Client, options: any): Promise<DiscordUser> {
    return verifyDiscordUser(options);
  }

  onJoin(client: Client, options: any, auth: DiscordUser): void | Promise<any> {
    const player = new Player();
    player.sessionId = client.sessionId;
    player.userId = auth.id;
    player.username = auth.username;
    this.state.players.set(client.sessionId, player);
    console.log(`Client joined: ${client.sessionId} (${auth.username})`);
  }

  async onLeave(client: Client, consented: boolean): Promise<void> {
    const player = this.state.players.get(client.sessionId);
    if (!player) {
      return;
    }

    if (!consented) {
      player.connected = false;
      // a disconnected player can't be ready; this also cancels a running countdown
      const slot = this.slotOf(client.sessionId);
      if (slot && this.state.phase !== "match") {
        slot.ready = false;
      }
      try {
        await this.allowReconnection(client, RECONNECT_SECONDS);
        player.connected = true;
        console.log(`Client reconnected: ${client.sessionId}`);
        return;
      } catch {
        // reconnection window expired, fall through and remove them
      }
    }

    this.releaseSlot(client.sessionId);
    this.state.players.delete(client.sessionId);
    console.log(`Client left: ${client.sessionId}`);
  }

  private slotOf(sessionId: string): Slot | undefined {
    return this.state.slots.find((s) => s.sessionId === sessionId);
  }

  private slotAt(index: unknown): Slot | undefined {
    return Number.isInteger(index) ? this.state.slots[index as number] : undefined;
  }

  private claimSlot(sessionId: string, index: unknown): ClaimResult {
    if (this.state.phase === "match") {
      return { ok: false, reason: "Match already in progress" };
    }
    const slot = this.slotAt(index);
    if (!slot) {
      return { ok: false, reason: "No such slot" };
    }
    if (slot.sessionId || slot.isAi) {
      return { ok: false, reason: "Slot already taken" };
    }
    if (this.slotOf(sessionId)) {
      return { ok: false, reason: "You already have a slot" };
    }
    slot.sessionId = sessionId;
    slot.ready = false;
    return { ok: true };
  }

  private releaseSlot(sessionId: string) {
    const slot = this.slotOf(sessionId);
    if (!slot) {
      return;
    }
    slot.sessionId = "";
    slot.ready = false;
    // a match can't continue with a missing player
    if (this.state.phase === "match") {
      this.endMatch();
    }
  }

  private allSlotsReady(): boolean {
    return (
      this.state.slots.length > 0 &&
      this.state.slots.every((s) => s.isAi || (s.sessionId && s.ready && this.state.players.get(s.sessionId)?.connected))
    );
  }

  private checkAllReady() {
    if (this.state.phase === "lobby" && this.allSlotsReady()) {
      this.startCountdown();
    } else if (this.state.phase === "countdown" && !this.allSlotsReady()) {
      this.cancelCountdown();
    }
  }

  private startCountdown() {
    this.state.phase = "countdown";
    this.state.countdown = COUNTDOWN_SECONDS;
    this.countdownTimer = this.clock.setInterval(() => {
      // re-check here too, since someone may have unreadied since the last periodic check
      if (!this.allSlotsReady()) {
        this.cancelCountdown();
        return;
      }
      this.state.countdown--;
      if (this.state.countdown <= 0) {
        this.startMatch();
      }
    }, 1000);
  }

  private cancelCountdown() {
    this.countdownTimer?.clear();
    this.countdownTimer = undefined;
    this.state.phase = "lobby";
    this.state.countdown = 0;
  }

  private startMatch() {
    this.countdownTimer?.clear();
    this.countdownTimer = undefined;
    this.setupTanks();
    this.state.phase = "match";
    this.state.countdown = 0;
    this.beginTurn(0);
    console.log(`Match started: ${this.state.slots.map((s) => (s.isAi ? "AI" : this.state.players.get(s.sessionId)?.username)).join(" vs ")}`);
  }

  private endMatch() {
    this.matchTimer?.clear();
    this.matchTimer = undefined;
    this.state.tanks.clear();
    this.state.terrain.clear();
    this.state.turnPhase = "aiming";
    this.state.winner = -1;
    this.state.phase = "lobby";
    // AI slots stay ready
    this.state.slots.forEach((s) => (s.ready = s.isAi));
    console.log("Match ended, back to lobby");
  }

  // --- match ---

  // plain-array view of the synced heightmap, for the terrain helpers
  private terrain(): Terrain {
    return { heights: this.state.terrain.toArray(), step: this.state.stage.terrainStep, bedrockY: this.state.stage.bedrockY };
  }

  private writeTerrain(terrain: Terrain, columns?: number[]) {
    // only touch changed columns so the patch sent to clients stays small
    const indices = columns ?? terrain.heights.map((_, i) => i);
    indices.forEach((i) => (this.state.terrain[i] = terrain.heights[i]));
    this.state.terrainVersion++;
  }

  // new random hills each match, tanks spread along them (with some jitter) on flattened pads, aimed toward the middle
  private setupTanks() {
    const { stage } = this.state;
    const count = this.state.slots.length;
    const columns = Math.ceil(stage.width / stage.terrainStep) + 1;
    const terrain: Terrain = {
      heights: generateHeights(columns, TERRAIN_TOP_Y, TERRAIN_BOTTOM_Y),
      step: stage.terrainStep,
      bedrockY: stage.bedrockY,
    };

    const positions = Array.from({ length: count }, (_, i) => {
      const even = count === 1 ? stage.width / 2 : TANK_MARGIN + (i * (stage.width - 2 * TANK_MARGIN)) / (count - 1);
      return Math.round(even + (Math.random() * 2 - 1) * TANK_POSITION_JITTER);
    });
    positions.forEach((x) => flattenPad(terrain, x, stage.tankWidth));

    this.state.terrain.clear();
    terrain.heights.forEach((h) => this.state.terrain.push(h));
    this.state.terrainVersion++;

    this.state.tanks.clear();
    for (let i = 0; i < count; i++) {
      const tank = new Tank();
      tank.x = positions[i];
      tank.y = restingY(terrain, tank.x, stage.tankWidth / 2);
      tank.angle = tank.x < stage.width / 2 ? 45 : 135;
      tank.power = 50;
      tank.health = 100;
      this.state.tanks.push(tank);
    }
    this.state.winner = -1;
  }

  // the caller's tank if it's their turn and they're allowed to act, otherwise undefined
  private currentHumanTank(sessionId: string): Tank | undefined {
    const slot = this.state.slots[this.state.turn];
    if (this.state.phase !== "match" || this.state.turnPhase !== "aiming" || !slot || slot.sessionId !== sessionId) {
      return undefined;
    }
    return this.state.tanks[this.state.turn];
  }

  private beginTurn(index: number) {
    this.state.turn = index;
    this.state.turnPhase = "aiming";
    if (this.state.slots[index]?.isAi) {
      this.matchTimer = this.clock.setTimeout(() => this.playAiTurn(), AI_THINK_MS);
    }
  }

  private playAiTurn() {
    const shooter = this.state.turn;
    const tanks = this.state.tanks.toArray();
    // aim at the nearest living opponent
    const target = tanks
      .map((tank, i) => ({ tank, i }))
      .filter(({ tank, i }) => i !== shooter && tank.health > 0)
      .sort((a, b) => Math.abs(a.tank.x - tanks[shooter].x) - Math.abs(b.tank.x - tanks[shooter].x))[0];
    if (!target) {
      return;
    }
    const shot = chooseAiShot(this.state.stage, this.terrain(), tanks, shooter, target.i);

    // move the barrel toward the chosen shot a step at a time so spectators can see the AI aim
    const tank = this.state.tanks[shooter];
    this.matchTimer = this.clock.setInterval(() => {
      tank.angle += Math.sign(shot.angle - tank.angle);
      tank.power += Math.sign(shot.power - tank.power);
      if (tank.angle === shot.angle && tank.power === shot.power) {
        this.matchTimer?.clear();
        this.fire();
      }
    }, AI_AIM_STEP_MS);
  }

  private fire() {
    const shooter = this.state.turn;
    const tank = this.state.tanks[shooter];
    const tanks = this.state.tanks.toArray();
    const shot = simulateShot(this.state.stage, this.terrain(), tanks, shooter, tank.angle, tank.power);

    this.state.turnPhase = "firing";
    this.broadcast("shot", { shooter, ...shot });

    const flightMs = (shot.points.length / 2) * shot.stepMs;
    this.matchTimer = this.clock.setTimeout(() => this.resolveShot(shot.impact), flightMs + EXPLOSION_MS);
  }

  private resolveShot(impact: { x: number; y: number } | null) {
    if (impact) {
      const damage = explosionDamage(this.state.stage, this.state.tanks.toArray(), impact);
      this.state.tanks.forEach((tank, i) => (tank.health = Math.max(0, tank.health - damage[i])));

      const terrain = this.terrain();
      const changed = carveCrater(terrain, impact.x, impact.y, EXPLOSION_RADIUS);
      if (changed.length) {
        this.writeTerrain(terrain, changed);
        // tanks whose ground was blown away drop onto whatever is left under them
        this.state.tanks.forEach((tank) => (tank.y = restingY(terrain, tank.x, this.state.stage.tankWidth / 2)));
      }
    }

    const alive = this.state.tanks.toArray().flatMap((tank, i) => (tank.health > 0 ? [i] : []));
    if (alive.length <= 1) {
      this.state.winner = alive.length === 1 ? alive[0] : -1;
      this.state.turnPhase = "over";
      this.matchTimer = this.clock.setTimeout(() => this.endMatch(), GAME_OVER_MS);
      return;
    }

    // next living tank after the current one
    const count = this.state.tanks.length;
    let next = this.state.turn;
    do {
      next = (next + 1) % count;
    } while (this.state.tanks[next].health <= 0);
    this.beginTurn(next);
  }
}
