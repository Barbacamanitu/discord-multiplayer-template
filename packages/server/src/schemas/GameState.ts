import { Schema, type, MapSchema, ArraySchema } from "@colyseus/schema";

export class Draggables extends Schema {
  @type("string")
  imageId = "";

  @type("number")
  x = 0;

  @type("number")
  y = 0;
}

// Everyone connected to the room, whether they hold a slot or are spectating
export class Player extends Schema {
  @type("string")
  sessionId = "";

  @type("string")
  userId = "";

  @type("string")
  username = "";

  // false while we're holding their spot during a reconnection window
  @type("boolean")
  connected = true;
}

export class Slot extends Schema {
  // sessionId of the player holding this slot, "" when open
  @type("string")
  sessionId = "";

  @type("boolean")
  ready = false;

  // AI-controlled slot: no sessionId and always ready
  @type("boolean")
  isAi = false;
}

export type Phase = "lobby" | "countdown" | "match";

// Stage dimensions are sent to clients so drawing and the server's hit detection use the same numbers
export class Stage extends Schema {
  @type("number") width = 1280;
  @type("number") height = 720;
  @type("number") groundY = 620;
  @type("number") tankWidth = 50;
  @type("number") tankHeight = 20;
  @type("number") barrelLength = 30;
}

// One tank per slot, same index as state.slots
export class Tank extends Schema {
  // center of the tank
  @type("number") x = 0;
  // bottom of the tank, i.e. the ground it sits on
  @type("number") y = 0;
  // degrees: 0 = right, 90 = up, 180 = left
  @type("number") angle = 45;
  // 0-100
  @type("number") power = 50;
  @type("number") health = 100;
}

// aiming: current player adjusts angle/power. firing: a shell is in the air. over: someone won, back to lobby soon.
export type TurnPhase = "aiming" | "firing" | "over";

export class GameState extends Schema {
  @type({ map: Draggables })
  draggables = new MapSchema<Draggables>();

  @type({ map: Player })
  players = new MapSchema<Player>();

  @type([Slot])
  slots = new ArraySchema<Slot>();

  @type("string")
  phase: Phase = "lobby";

  // seconds left while phase === "countdown"
  @type("number")
  countdown = 0;

  // --- match state, only meaningful while phase === "match" ---
  @type(Stage)
  stage = new Stage();

  @type([Tank])
  tanks = new ArraySchema<Tank>();

  // slot index whose turn it is
  @type("number")
  turn = 0;

  @type("string")
  turnPhase: TurnPhase = "aiming";

  // slot index of the winner once turnPhase === "over", -1 for a draw
  @type("number")
  winner = -1;
}
