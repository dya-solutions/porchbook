import { createServerFn } from "@tanstack/react-start";

export const readSessionHint = createServerFn({ method: "GET" }).handler(async () => {
  const { getCookie } = await import("@tanstack/react-start/server");
  return Boolean(getCookie("__Host-grok-auth.session_token") || getCookie("better-auth.session_token"));
});
