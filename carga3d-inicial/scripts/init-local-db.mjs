import "./sites-env.mjs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

// Only the local database is initialized. Existing records are preserved.
const result = spawnSync(process.execPath, [
  fileURLToPath(new URL("../node_modules/wrangler/bin/wrangler.js", import.meta.url)),
  "d1", "execute", "DB", "--local",
  "--config", "wrangler.local.jsonc",
  "--persist-to", ".wrangler/state",
  "--file", "drizzle/0000_chubby_skrulls.sql",
], { stdio: "inherit" });

if (result.error) throw result.error;
if (result.status !== 0) {
  throw new Error("Não foi possível preparar o banco local. Confira o erro acima e tente novamente.");
}
