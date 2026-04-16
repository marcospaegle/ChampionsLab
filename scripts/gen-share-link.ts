/**
 * Generate a share link for the best 90% team:
 * Pelipper / Basculegion-M / Incineroar / Whimsicott / Kingambit / Clefable
 * 
 * Uses USAGE_DATA for competitive sets, then encodes as compressed URL.
 * Run: npx tsx scripts/gen-share-link.ts
 */

import { POKEMON_SEED } from "../src/lib/pokemon-data";
import { USAGE_DATA } from "../src/lib/usage-data";
import { deflateRawSync } from "zlib";

const byName = (name: string) => POKEMON_SEED.find(p => !p.hidden && p.name === name)!;

// Team: Rain with Incineroar + Clefable support, Whimsicott backup tailwind, Kingambit closer
const teamNames = ["Pelipper", "Basculegion-M", "Incineroar", "Whimsicott", "Kingambit", "Clefable"];
const team = teamNames.map(byName);

// For each mon, pick the best competitive set from USAGE_DATA
function getBestSet(pokemon: typeof team[0]) {
  const sets = USAGE_DATA[pokemon.id];
  if (!sets || sets.length === 0) return null;
  // Pick first set (highest usage/best competitive set)
  return sets[0];
}

const slots = team.map(mon => {
  const set = getBestSet(mon);
  const sp = set?.sp ?? { hp: 0, attack: 0, defense: 0, spAtk: 0, spDef: 0, speed: 0 };
  return {
    p: mon.id,
    a: set?.ability ?? mon.abilities[0]?.name ?? "",
    t: set?.nature ?? "Adamant",
    m: set?.moves ?? mon.moves.slice(0, 4).map(m => m.name),
    sp: [sp.hp, sp.attack, sp.defense, sp.spAtk, sp.spDef, sp.speed],
    te: set?.teraType,
    i: set?.item,
    mg: false,
  };
});

const data = {
  n: "90% Rain Offense",
  s: slots,
};

// Print details
console.log("\n🏆 Team: 90% Rain Offense\n");
for (const s of slots) {
  const mon = POKEMON_SEED.find(p => p.id === s.p)!;
  console.log(`  ${mon.name} (${mon.tier})`);
  console.log(`    Ability: ${s.a} | Nature: ${s.t} | Item: ${s.i || "none"}`);
  console.log(`    Moves: ${s.m.join(", ")}`);
  console.log(`    SP: HP ${s.sp[0]} / Atk ${s.sp[1]} / Def ${s.sp[2]} / SpA ${s.sp[3]} / SpD ${s.sp[4]} / Spe ${s.sp[5]}`);
  console.log();
}

// Compress to URL-safe base64
const json = JSON.stringify(data);
const compressed = deflateRawSync(Buffer.from(json));
const b64 = compressed.toString("base64")
  .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

const url = `https://championslab.gg/team-builder?t=${b64}`;
console.log(`\n🔗 Share link:\n${url}\n`);
console.log(`(URL length: ${url.length} chars)`);
