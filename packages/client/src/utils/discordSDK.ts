/// <reference types="vite/client" />
import { CommandResponse, DiscordSDK, DiscordSDKMock } from "@discord/embedded-app-sdk";
type Auth = CommandResponse<"authenticate">;
let auth: Auth;

const queryParams = new URLSearchParams(window.location.search);
const isEmbedded = queryParams.get("frame_id") != null;

let discordSdk: DiscordSDK | DiscordSDKMock;

const SDK_READY_TIMEOUT_MS = 10000;

const setupDiscordSDK = async () => {
  if (isEmbedded) {
    // without a client id the SDK's ready() never resolves, so fail loudly instead of hanging
    if (!import.meta.env.VITE_CLIENT_ID) {
      throw new Error("VITE_CLIENT_ID is not set. Vite reads .env from the repo root (envDir in vite.config.ts).");
    }
    discordSdk = new DiscordSDK(import.meta.env.VITE_CLIENT_ID);
    await Promise.race([
      discordSdk.ready(),
      new Promise((_, reject) => setTimeout(() => reject(new Error("Timed out waiting for the Discord SDK")), SDK_READY_TIMEOUT_MS)),
    ]);
  } else {
    // We're using session storage for user_id, guild_id, and channel_id
    // This way the user/guild/channel will be maintained until the tab is closed, even if you refresh
    // Session storage will generate new unique mocks for each tab you open
    // Any of these values can be overridden via query parameters
    // i.e. if you set https://my-tunnel-url.com/?user_id=test_user_id
    // this will override this will override the session user_id value
    const mockUserId = getOverrideOrRandomSessionValue("user_id");
    const mockGuildId = getOverrideOrRandomSessionValue("guild_id");
    const mockChannelId = getOverrideOrRandomSessionValue("channel_id");

    discordSdk = new DiscordSDKMock(import.meta.env.VITE_CLIENT_ID, mockGuildId, mockChannelId,"usa");
    const discriminator = String(mockUserId.charCodeAt(0) % 5);

    discordSdk._updateCommandMocks({
      authenticate: async () => {
        return await {
          access_token: "mock_token",
          user: {
            username: mockUserId,
            discriminator,
            id: mockUserId,
            avatar: null,
            public_flags: 1,
          },
          scopes: [],
          expires: new Date(2112, 1, 1).toString(),
          application: {
            description: "mock_app_description",
            icon: "mock_app_icon",
            id: "mock_app_id",
            name: "mock_app_name",
          },
        };
      },
    });
  }
};

// Idempotent, so callers can await it to be sure the SDK is ready before sending commands
let sdkReady: Promise<void> | undefined;
const initiateDiscordSDK = () =>
  (sdkReady ??= setupDiscordSDK().catch((e) => {
    // allow a retry (e.g. pressing Start again) instead of caching the failure
    sdkReady = undefined;
    throw e;
  }));

// Pop open the OAuth permission modal and request for access to scopes listed in scope array below
const authorizeDiscordUser = async () => {
  await initiateDiscordSDK();

  if (!isEmbedded) {
    // Outside Discord, use the mocked authenticate command so each tab gets its own mock user
    auth = await discordSdk.commands.authenticate({ access_token: "mock_token" });
    return;
  }

  const { code } = await discordSdk.commands.authorize({
    client_id: import.meta.env.VITE_CLIENT_ID,
    response_type: "code",
    state: "",
    prompt: "none",
    scope: ["identify", "applications.commands"],
  });

  // Retrieve an access_token from your application's server
  const response = await fetch("/.proxy/api/token", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      code,
    }),
  });
  if (!response.ok) {
    throw new Error(`Token exchange failed: /.proxy/api/token returned ${response.status}`);
  }
  const { access_token } = await response.json();
  if (!access_token) {
    throw new Error("Token exchange returned no access_token. Check VITE_CLIENT_ID and CLIENT_SECRET in .env");
  }

  // Authenticate with Discord client (using the access_token)
  auth = await discordSdk.commands.authenticate({
    access_token,
  });
};

const getUserName = () => {
  if (!auth) {
    return "User";
  }

  return auth.user.username;
};

// Options the server's onAuth uses to verify who's joining
const getAuthOptions = () => {
  if (!auth) {
    throw new Error("authorizeDiscordUser() must be called before joining a room");
  }
  return {
    accessToken: auth.access_token,
    userId: auth.user.id,
    username: auth.user.username,
  };
};

enum SessionStorageQueryParam {
  user_id = "user_id",
  guild_id = "guild_id",
  channel_id = "channel_id",
}

function getOverrideOrRandomSessionValue(queryParam: `${SessionStorageQueryParam}`) {
  const overrideValue = queryParams.get(queryParam);
  if (overrideValue != null) {
    return overrideValue;
  }

  const currentStoredValue = sessionStorage.getItem(queryParam);
  if (currentStoredValue != null) {
    return currentStoredValue;
  }

  // Set queryParam to a random 8-character string
  const randomString = Math.random().toString(36).slice(2, 10);
  sessionStorage.setItem(queryParam, randomString);
  return randomString;
}

export { discordSdk, initiateDiscordSDK, authorizeDiscordUser, getUserName, getAuthOptions };
