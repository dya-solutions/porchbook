import { createHmac } from "node:crypto";

export type IceServer = {
  urls: string | string[];
  username?: string;
  credential?: string;
};

const STUN: IceServer = { urls: ["stun:stun.l.google.com:19302", "stun:stun1.l.google.com:19302"] };

function hostOf(raw: string): string {
  const first = raw.split(",")[0]?.trim() ?? "";
  if (!first) return "";
  const withoutScheme = first.replace(/^turns?:/i, "").replace(/^stuns?:/i, "");
  try {
    if (first.includes("://")) return new URL(first).hostname;
  } catch {
    /* a bare host has no scheme */
  }
  return withoutScheme.split(":")[0]?.replace(/^\/\//, "") ?? "";
}

/** ICE servers for an authenticated caller. The TURN secret never leaves the server. */
export function iceConfigFor(userId: string): { iceServers: IceServer[]; turn: boolean } {
  const host = hostOf(process.env.TURN_SERVER || "");
  const username = (process.env.TURN_USERNAME || "").trim();
  const credential = process.env.TURN_CREDENTIAL || "";
  const secret = process.env.TURN_SECRET || "";
  if (!host || (!secret && !(username && credential))) {
    return { iceServers: [STUN], turn: false };
  }
  let turnUser = username;
  let turnPass = credential;
  if (secret) {
    const expiry = Math.floor(Date.now() / 1000) + 60 * 60;
    turnUser = `${expiry}:${userId}`;
    turnPass = createHmac("sha1", secret).update(turnUser).digest("base64");
  }
  return {
    turn: true,
    iceServers: [
      STUN,
      {
        urls: [
          `turn:${host}:3478?transport=udp`,
          `turn:${host}:3478?transport=tcp`,
          `turns:${host}:5349?transport=tcp`,
        ],
        username: turnUser,
        credential: turnPass,
      },
    ],
  };
}
