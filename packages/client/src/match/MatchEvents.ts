import Phaser from "phaser";

export type AimControl = "angle" | "power";

// Everything notable that happens in a match, derived from server state and messages so every player and
// spectator sees the same events at the same moments (including AI turns). Hook audio, effects, etc. here.
// Tank indexes match slot indexes. Events that come from a place on the stage carry its x, for panning sounds.
export interface MatchEventMap {
  matchStarted: { tankCount: number; localTank: number | null };
  turnStarted: { tank: number; isLocal: boolean; isAi: boolean };
  // a tank's player started / stopped adjusting its angle or power (tracked separately, so both can be active at
  // once). For the local player these are the actual press and release of an aim key or button; for everyone else
  // (remote players, AI) they're inferred from updates starting and then pausing, since other players' input isn't
  // sent over the network.
  aimAdjustStarted: { tank: number; isLocal: boolean; control: AimControl; x: number };
  aimAdjustStopped: { tank: number; isLocal: boolean; control: AimControl; x: number };
  // fires for every tank's aim change, local or remote, often (every ~40ms while a control is held)
  aimChanged: { tank: number; angle: number; power: number; dAngle: number; dPower: number };
  // fire was pressed; the shell launches (shotFired) about half a second later
  shellLoading: { tank: number; isLocal: boolean; x: number };
  shotFired: { shooter: number; isLocal: boolean; x: number; y: number };
  shellExploded: { shooter: number; x: number; y: number };
  // the shell left the stage without hitting anything
  shellMissed: { shooter: number };
  tankDamaged: { tank: number; amount: number; health: number; x: number };
  tankDestroyed: { tank: number; x: number };
  // the ground under the tank was blown away and it dropped
  tankFell: { tank: number; distance: number; x: number };
  // winner is -1 for a draw
  matchOver: { winner: number; localWon: boolean; isDraw: boolean };
}

export type MatchEventName = keyof MatchEventMap;

export class MatchEvents {
  private emitter = new Phaser.Events.EventEmitter();

  on<K extends MatchEventName>(event: K, listener: (payload: MatchEventMap[K]) => void): () => void {
    this.emitter.on(event, listener);
    return () => this.emitter.off(event, listener);
  }

  emit<K extends MatchEventName>(event: K, payload: MatchEventMap[K]) {
    this.emitter.emit(event, payload);
  }

  destroy() {
    this.emitter.removeAllListeners();
  }
}
