import { Client, Room } from "colyseus.js";
import { discordSdk, getAuthOptions } from "../utils/discordSDK";

const RECONNECT_TOKEN_KEY = "colyseus_reconnection_token";
// close code Colyseus uses when the client called room.leave() itself
const CLOSE_CODE_CONSENTED = 4000;
// keep in sync with RECONNECT_SECONDS on the server
const RECONNECT_ATTEMPTS = 10;
const RECONNECT_INTERVAL_MS = 2000;

export type ConnectionStatus = "connected" | "reconnecting" | "disconnected";
type RoomListener = (room: Room | undefined, status: ConnectionStatus) => void;

let client: Client | undefined;
let room: Room | undefined;
let status: ConnectionStatus = "disconnected";
const listeners = new Set<RoomListener>();

function serverUrl() {
  return location.host === "localhost:3000" ? `ws://localhost:3001` : `wss://${location.host}/.proxy/api/colyseus`;
}

function notify() {
  listeners.forEach((listener) => listener(room, status));
}

function setRoom(next: Room | undefined) {
  room = next;
  status = room ? "connected" : "disconnected";
  if (room) {
    // lets a page refresh rejoin the same session (and keep its slot) within the server's reconnection window
    sessionStorage.setItem(RECONNECT_TOKEN_KEY, room.reconnectionToken);
    room.onLeave((code) => handleLeave(code));
  } else {
    sessionStorage.removeItem(RECONNECT_TOKEN_KEY);
  }
  notify();
}

async function tryReconnect(): Promise<Room | undefined> {
  const token = sessionStorage.getItem(RECONNECT_TOKEN_KEY);
  if (!token || !client) {
    return undefined;
  }
  try {
    return await client.reconnect(token);
  } catch {
    return undefined;
  }
}

async function handleLeave(code: number) {
  if (code === CLOSE_CODE_CONSENTED) {
    setRoom(undefined);
    return;
  }
  console.warn(`Connection lost (code ${code}), trying to reconnect...`);
  room = undefined;
  status = "reconnecting";
  notify();
  for (let attempt = 0; attempt < RECONNECT_ATTEMPTS; attempt++) {
    await new Promise((resolve) => setTimeout(resolve, RECONNECT_INTERVAL_MS));
    const reconnected = await tryReconnect();
    if (reconnected) {
      console.log("Reconnected");
      setRoom(reconnected);
      return;
    }
  }
  console.warn("Could not reconnect");
  setRoom(undefined);
}

// Call after authorizeDiscordUser(). Rejoins the previous session if this tab has one, otherwise joins the channel's room.
export async function connectToGame(screenWidth: number, screenHeight: number): Promise<Room> {
  if (room) {
    return room;
  }
  client ??= new Client(serverUrl());
  const rejoined = await tryReconnect();
  if (!rejoined) {
    // e.g. the server restarted and the old room is gone; don't try this token again
    sessionStorage.removeItem(RECONNECT_TOKEN_KEY);
  }
  const joined =
    rejoined ??
    (await client.joinOrCreate("game", {
      // the server filters rooms by channelId, so everyone in the same voice channel shares a room
      channelId: discordSdk.channelId,
      screenWidth,
      screenHeight,
      ...getAuthOptions(),
    }));
  // the join resolves before the first state patch arrives; scenes expect room.state to be populated
  if (!joined.state?.phase) {
    await Promise.race([
      new Promise((resolve) => joined.onStateChange.once(resolve)),
      new Promise((_, reject) => setTimeout(() => reject(new Error("Joined the room but never received its state")), 10000)),
    ]);
  }
  setRoom(joined);
  return joined;
}

export function getRoom(): Room | undefined {
  return room;
}

export function getConnectionStatus(): ConnectionStatus {
  return status;
}

// Fires whenever the connection changes. A reconnect produces a new Room instance, so re-bind room listeners here.
export function onRoomChange(listener: RoomListener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export async function leaveGame() {
  await room?.leave(true);
}
