import { ServerError } from "colyseus";

export interface DiscordUser {
  id: string;
  username: string;
}

// The client sends this token when it's running outside Discord with the mock SDK
const MOCK_TOKEN = "mock_token";

// Resolve the joining user from their Discord access token, so clients can't pick someone else's identity
export async function verifyDiscordUser(options: any): Promise<DiscordUser> {
  const token = options?.accessToken;

  if (token === MOCK_TOKEN) {
    if (process.env.NODE_ENV === "production") {
      throw new ServerError(401, "Mock auth is not allowed in production");
    }
    return { id: String(options.userId ?? ""), username: String(options.username ?? "Mock user") };
  }

  if (!token) {
    throw new ServerError(401, "Missing access token");
  }

  const response = await fetch("https://discord.com/api/users/@me", {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!response.ok) {
    throw new ServerError(401, "Invalid Discord access token");
  }

  const user = (await response.json()) as { id: string; username: string; global_name?: string | null };
  return { id: user.id, username: user.global_name ?? user.username };
}
