import "./sites-env.mjs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

// Only the local database is initialized. Existing records are preserved.
const migrationFiles = [
  "drizzle/0000_chubby_skrulls.sql",
  "drizzle/0001_authz_rbac_pbac.sql",
];

for (const file of migrationFiles) {
  const result = spawnSync(process.execPath, [
    fileURLToPath(new URL("../node_modules/wrangler/bin/wrangler.js", import.meta.url)),
    "d1", "execute", "DB", "--local",
    "--config", "wrangler.local.jsonc",
    "--persist-to", ".wrangler/state",
    "--file", file,
  ], { stdio: "inherit" });

  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`Não foi possível aplicar a migração ${file} no banco local.`);
  }
}
