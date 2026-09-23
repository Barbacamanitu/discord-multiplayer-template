import { Client, Delayed, Room } from "colyseus";
import { GameState, Draggables, Player, Slot } from "../schemas/GameState";
import { DiscordUser, verifyDiscordUser } from "../auth";

// TODO: derive from the selected level
const SLOT_COUNT = 2;
const READY_CHECK_INTERVAL_MS = 500;
const COUNTDOWN_SECONDS = 3;
// how long a dropped connection keeps its slot before it's released
const RECONNECT_SECONDS = 20;

type ClaimResult = { ok: true } | { ok: false; reason: string };

export class GameRoom extends Room<GameState> {
  state = new GameState();
  maxClients = 25; // Current Discord limit is 25

  private countdownTimer?: Delayed;

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

    // placeholder until the match has a real win/lose condition
    this.onMessage("forfeit", (client) => {
      if (this.state.phase === "match" && this.slotOf(client.sessionId)) {
        this.endMatch();
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

  private claimSlot(sessionId: string, index: unknown): ClaimResult {
    if (this.state.phase === "match") {
      return { ok: false, reason: "Match already in progress" };
    }
    const slot = Number.isInteger(index) ? this.state.slots[index as number] : undefined;
    if (!slot) {
      return { ok: false, reason: "No such slot" };
    }
    if (slot.sessionId) {
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
      this.state.slots.every((s) => s.sessionId && s.ready && this.state.players.get(s.sessionId)?.connected)
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
    this.state.phase = "match";
    this.state.countdown = 0;
    console.log(`Match started: ${this.state.slots.map((s) => this.state.players.get(s.sessionId)?.username).join(" vs ")}`);
  }

  private endMatch() {
    this.state.phase = "lobby";
    this.state.slots.forEach((s) => (s.ready = false));
    console.log("Match ended, back to lobby");
  }
}
