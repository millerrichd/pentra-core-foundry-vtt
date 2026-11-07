/**
 * Compile src/packs/<name>/*.json into Foundry LevelDB compendiums at packs/<name>.
 * Run with: npm run build:packs   (close Foundry first — it locks the pack databases)
 */
import fs from "node:fs";
import path from "node:path";
import { compilePack } from "@foundryvtt/foundryvtt-cli";

const SRC = "src/packs";
const DEST = "packs";

for (const name of fs.readdirSync(SRC)) {
  const src = path.join(SRC, name);
  if (!fs.statSync(src).isDirectory()) continue;
  const dest = path.join(DEST, name);
  fs.rmSync(dest, { recursive: true, force: true });
  await compilePack(src, dest, { log: false });
  console.log(`Packed ${name} (${fs.readdirSync(src).length} documents)`);
}
