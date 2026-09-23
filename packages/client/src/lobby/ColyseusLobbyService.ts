import { Room } from "colyseus.js";
import { ConnectionStatus, getConnectionStatus, getRoom, onRoomChange } from "../net/connection";
import { ClaimResult, LobbyService, LobbySlot, LobbyState } from "./LobbyService";

const CLAIM_TIMEOUT_MS = 5000;

export class ColyseusLobbyService implements LobbyService {
  private room: Room | undefined;
  private connection: ConnectionStatus;
  private listeners = new Set<(state: LobbyState) => void>();
  private unbindRoom: (() => void) | undefined;
  private unsubscribeConnection: () => void;
  private nextRequestId = 1;
  private pendingClaims = new Map<number, (result: ClaimResult) => void>();

  constructor() {
    this.connection = getConnectionStatus();
    this.bind(getRoom());
    this.unsubscribeConnection = onRoomChange((room, status) => {
      this.connection = status;
      this.bind(room);
      this.emit();
    });
  }

  // sessionId survives reconnects, so this stays valid for the whole session
  get localPlayerId(): string {
    return this.room?.sessionId ?? "";
  }

  getState(): LobbyState {
    const state = this.room?.state;
    if (!state) {
      return { connection: this.connection, phase: "lobby", countdown: 0, slots: [], spectators: [] };
    }

    const slots: LobbySlot[] = state.slots.map((slot: any) => {
      const player = slot.sessionId ? state.players.get(slot.sessionId) : undefined;
      return {
        playerId: slot.sessionId || null,
        username: player?.username ?? null,
        ready: slot.ready,
        connected: player?.connected ?? false,
      };
    });

    const slotted = new Set(slots.map((s) => s.playerId));
    const spectators: string[] = [];
    state.players.forEach((player: any, sessionId: string) => {
      if (!slotted.has(sessionId)) {
        spectators.push(player.username);
      }
    });

    return { connection: this.connection, phase: state.phase, countdown: state.countdown, slots, spectators };
  }

  onChange(listener: (state: LobbyState) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  claimSlot(index: number): Promise<ClaimResult> {
    if (!this.room) {
      return Promise.resolve({ ok: false, reason: "Not connected" });
    }
    const requestId = this.nextRequestId++;
    return new Promise((resolve) => {
      const timeout = setTimeout(() => this.resolveClaim(requestId, { ok: false, reason: "Server did not respond" }), CLAIM_TIMEOUT_MS);
      this.pendingClaims.set(requestId, (result) => {
        clearTimeout(timeout);
        resolve(result);
      });
      this.room!.send("claimSlot", { requestId, index });
    });
  }

  releaseSlot(): void {
    this.room?.send("releaseSlot");
  }

  setReady(ready: boolean): void {
    this.room?.send("setReady", { ready });
  }

  forfeit(): void {
    this.room?.send("forfeit");
  }

  dispose(): void {
    this.unbindRoom?.();
    this.unsubscribeConnection();
    this.listeners.clear();
    this.pendingClaims.forEach((resolve) => resolve({ ok: false, reason: "Lobby closed" }));
    this.pendingClaims.clear();
  }

  private bind(room: Room | undefined) {
    if (room === this.room) {
      return;
    }
    this.unbindRoom?.();
    this.unbindRoom = undefined;
    this.room = room;
    if (!room) {
      // requests sent on the old connection will never be answered
      this.pendingClaims.forEach((resolve) => resolve({ ok: false, reason: "Connection lost" }));
      this.pendingClaims.clear();
      return;
    }

    const onStateChange = () => this.emit();
    room.onStateChange(onStateChange);
    const removeClaimHandler = room.onMessage("claimResult", (message: { requestId: number } & ClaimResult) => {
      const { requestId, ...result } = message;
      this.resolveClaim(requestId, result as ClaimResult);
    });
    this.unbindRoom = () => {
      room.onStateChange.remove(onStateChange);
      removeClaimHandler();
    };
  }

  private resolveClaim(requestId: number, result: ClaimResult) {
    const resolve = this.pendingClaims.get(requestId);
    if (resolve) {
      this.pendingClaims.delete(requestId);
      resolve(result);
    }
  }

  private emit() {
    const snapshot = this.getState();
    this.listeners.forEach((listener) => listener(snapshot));
  }
}
