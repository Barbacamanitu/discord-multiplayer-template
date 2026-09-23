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
}

export type Phase = "lobby" | "countdown" | "match";

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
}
