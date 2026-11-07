/**
 * Extract packs/<name> back into editable JSON at src/packs/<name>.
 * Use after editing compendium content inside Foundry. Close Foundry first.
 */
import fs from "node:fs";
import path from "node:path";
import { extractPack } from "@foundryvtt/foundryvtt-cli";

const SRC = "src/packs";
const DEST = "packs";

for (const name of fs.readdirSync(DEST)) {
  const pack = path.join(DEST, name);
  if (!fs.statSync(pack).isDirectory()) continue;
  await extractPack(pack, path.join(SRC, name), { clean: true, omitVolatile: true });
  console.log(`Unpacked ${name}`);
}
