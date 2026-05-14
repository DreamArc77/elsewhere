import { loadSaasConfig } from "./config.js";
import { createSaasRuntime } from "./runtime.js";
import { createSaasServer } from "./server.js";
import { JsonSaasDataStore } from "./store.js";

const config = loadSaasConfig();
const store = new JsonSaasDataStore(config.stateDir);
const runtime = await createSaasRuntime({ config, store });
const server = createSaasServer({ config, store, runtime });

server.listen(config.port, () => {
  console.log(`Elsewhere SaaS MVP listening on ${config.publicBaseUrl}`);
});

const interval = setInterval(() => {
  void runtime.tick().catch((error) => {
    console.error("SaaS background tick failed", error);
  });
}, Math.max(5, config.pollIntervalSeconds) * 1000);

process.once("SIGINT", () => shutdown());
process.once("SIGTERM", () => shutdown());

function shutdown(): void {
  clearInterval(interval);
  server.close(() => process.exit(0));
}

