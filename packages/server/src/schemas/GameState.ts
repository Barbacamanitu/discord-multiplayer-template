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
  // terrain can never be dug below this; the strip underneath holds the on-screen controls
  @type("number") bedrockY = 640;
  // width in px of each terrain column
  @type("number") terrainStep = 4;
  @type("number") tankWidth = 50;
  @type("number") tankHeight = 20;
  @type("number") barrelLength = 30;
}

// One tank per slot, same index as state.slots
export class Tank extends Schema {
  // center of the tank
  @type("number") x = 0;
  // bottom of the tank, i.e. the terrain surface it rests on
  @type("number") y = 0;
  // degrees: 0 = right, 90 = up, 180 = left
  @type("number") angle = 45;
  // 0-100
  @type("number") power = 50;
  @type("number") health = 100;
}

// aiming: current player adjusts angle/power. loading: fire was pressed, the tank is loading the shell.
// firing: a shell is in the air. over: someone won, back to lobby soon.
export type TurnPhase = "aiming" | "loading" | "firing" | "over";

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

  // terrain heightmap: surface y of each column (stage.terrainStep px wide); only changed columns are sent
  @type(["uint16"])
  terrain = new ArraySchema<number>();

  // bumped whenever terrain changes, so clients know to redraw it
  @type("number")
  terrainVersion = 0;

  // slot index whose turn it is
  @type("number")
  turn = 0;

  @type("string")
  turnPhase: TurnPhase = "aiming";

  // slot index of the winner once turnPhase === "over", -1 for a draw
  @type("number")
  winner = -1;
}
