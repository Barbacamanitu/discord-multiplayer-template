import { ConnectionStatus } from "../net/connection";

export type LobbyPhase = "lobby" | "countdown" | "match";

export interface LobbySlot {
  playerId: string | null;
  username: string | null;
  ready: boolean;
  // false while the server is holding the slot for a dropped player
  connected: boolean;
}

export interface LobbyState {
  connection: ConnectionStatus;
  phase: LobbyPhase;
  // seconds left while phase === "countdown"
  countdown: number;
  // slot count can vary per level, so never assume a fixed length
  slots: LobbySlot[];
  // usernames of everyone connected who isn't holding a slot
  spectators: string[];
}

export type ClaimResult = { ok: true } | { ok: false; reason: string };

// Client view of the room's lobby/match state; ColyseusLobbyService is the implementation
export interface LobbyService {
  readonly localPlayerId: string;
  getState(): LobbyState;
  onChange(listener: (state: LobbyState) => void): () => void;
  claimSlot(index: number): Promise<ClaimResult>;
  // give up your slot and go back to spectating
  releaseSlot(): void;
  setReady(ready: boolean): void;
  // placeholder until matches have a real win/lose condition
  forfeit(): void;
  dispose(): void;
}
