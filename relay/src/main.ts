import { createRelay } from "./relay.js";

const secret = process.env.WALKIE_RELAY_SECRET ?? "";
const adminSecret = process.env.WALKIE_RELAY_ADMIN_SECRET ?? "";
if (secret.length < 32 || adminSecret.length < 32) {
  console.error("WALKIE_RELAY_SECRET and WALKIE_RELAY_ADMIN_SECRET must be set (at least 32 characters)");
  process.exit(1);
}

const relay = createRelay({ secret, adminSecret });
const port = Number(process.env.PORT ?? 8080);
relay.server.listen(port, () => console.log(`voice relay listening on ${port}`));

for (const signal of ["SIGTERM", "SIGINT"] as const) {
  process.on(signal, () => void relay.close().finally(() => process.exit(0)));
}
