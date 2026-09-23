import { ConnectionStatus } from "../net/connection";

export type LobbyPhase = "lobby" | "countdown" | "match";

export interface LobbySlot {
  playerId: string | null;
  username: string | null;
  ready: boolean;
  // false while the server is holding the slot for a dropped player
  connected: boolean;
  // AI slots have no playerId and are always ready
  isAi: boolean;
}

export interface StageView {
  width: number;
  height: number;
  // terrain can't be dug below this; the strip underneath holds the controls
  bedrockY: number;
  // width in px of each terrain column
  terrainStep: number;
  tankWidth: number;
  tankHeight: number;
  barrelLength: number;
}

export interface TankView {
  // center of the tank; y is the bottom of the tank (the terrain surface it rests on)
  x: number;
  y: number;
  // degrees: 0 = right, 90 = up, 180 = left
  angle: number;
  power: number;
  health: number;
}

// loading: fire was pressed and the tank is loading the shell (~0.5s) before it launches
export type TurnPhase = "aiming" | "loading" | "firing" | "over";

export interface MatchView {
  stage: StageView;
  // same index as slots
  tanks: TankView[];
  // surface y of each terrain column (stage.terrainStep px wide)
  terrain: number[];
  // changes whenever terrain does, so the scene only redraws it when needed
  terrainVersion: number;
  turn: number;
  turnPhase: TurnPhase;
  // slot index of the winner once turnPhase === "over", -1 for a draw
  winner: number;
}

// sent by the server when a shell is fired; the path is precomputed so clients only animate it
export interface ShotEvent {
  shooter: number;
  // flattened [x0, y0, x1, y1, ...], one position every stepMs
  points: number[];
  stepMs: number;
  impact: { x: number; y: number } | null;
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
  match: MatchView;
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
  addAi(index: number): void;
  removeAi(index: number): void;
  // placeholder until matches have a real win/lose condition; in an AI-only match anyone can use it to end the match
  forfeit(): void;
  // match controls; the server ignores them unless it's your turn
  aim(angle: number, power: number): void;
  fire(): void;
  onShot(listener: (shot: ShotEvent) => void): () => void;
  dispose(): void;
}
