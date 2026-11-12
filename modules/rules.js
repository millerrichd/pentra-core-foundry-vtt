/**
 * Pure rules math for Pentra. No Foundry globals here, so it can be unit tested under plain Node.
 */
import { PENTRA } from "./config.js";

const clamp = (n, min, max) => Math.min(Math.max(n, min), max);

/** Die and bonus for an attribute/resistance rank (0-4). */
export function attributeStep(rank) {
  return PENTRA.attributeRanks[clamp(Number(rank) || 0, 0, PENTRA.maxAttributeRank)];
}

/** Format an attribute rank as "d10+2". */
export function formatAttribute(rank) {
  const { die, bonus } = attributeStep(rank);
  return `d${die}+${bonus}`;
}

/**
 * Move a usage-style die (0, d4, d6, d8, d10, d12) by a number of steps.
 * @param {number} faces   Current die faces (0 = depleted)
 * @param {number} delta   Steps to move (+ grows, - shrinks)
 * @param {object} [opts]
 * @param {number} [opts.min=0]   Smallest allowed result
 * @param {number} [opts.max=12]  Largest allowed result
 */
export function stepDie(faces, delta, { min = 0, max = 12 } = {}) {
  const ladder = PENTRA.usageDice;
  let index = ladder.indexOf(Number(faces));
  if (index < 0) index = ladder.findIndex(d => d >= faces);
  if (index < 0) index = ladder.length - 1;
  const next = ladder[clamp(index + delta, 0, ladder.length - 1)];
  return clamp(next, min, max);
}

/** Format a die value; 0 renders as an em dash-free "0". */
export function formatDie(faces) {
  return faces > 0 ? `d${faces}` : "0";
}

/** Format a Resource Die cost such as "d6x2 R.D.". */
export function formatCost(die, multiplier = 1) {
  if (!die) return "—";
  return `d${die}${multiplier > 1 ? `x${multiplier}` : ""} R.D.`;
}

/**
 * Count the wounds an attack deals.
 * Every success-type number in (tn, total] adds one wound to the base. Heavy weapons double the result.
 * @returns {number} 0 on a miss.
 */
export function countWounds({ base, increment, tn, total, heavy = false }) {
  if (total < tn) return 0;
  let extra = 0;
  for (let n = tn + 1; n <= total; n++) {
    if (increment === "every") extra++;
    else if (increment === "odd" && n % 2 === 1) extra++;
    else if (increment === "even" && n % 2 === 0) extra++;
  }
  const wounds = base + extra;
  return heavy ? wounds * 2 : wounds;
}

/** Number of actions granted by an initiative result: one per 6 points, max 3. */
export function actionsFromInitiative(initiative) {
  return clamp(Math.ceil((Number(initiative) || 0) / 6), 1, 3);
}

/**
 * Determine the usage range when buying something with the Resource Die.
 * @returns {number|null} The top of the 1-N range, or null if the item cannot be bought.
 */
export function purchaseRange({ costDie, multiplier = 1, resourceDie }) {
  if (!costDie) return 0;
  if (costDie > resourceDie) return null;
  const base = costDie === resourceDie ? 2 : 1;
  return Math.min(base * multiplier, resourceDie);
}

/**
 * Determine how a sale can raise the Resource Die.
 * Sold goods are valued one multiplier lower (or one die lower when already x1).
 * If the sale value is lower than the Resource Die, it rises only on the top `multiplier` faces;
 * if equal or greater, it rises on the top two faces and may repeat while the value still exceeds the die.
 */
export function saleValue({ costDie, multiplier = 1 }) {
  if (multiplier > 1) return { die: costDie, multiplier: multiplier - 1 };
  return { die: stepDie(costDie, -1), multiplier: 1 };
}

/** Lowest face that counts as a success when selling to raise the Resource Die. */
export function saleThreshold({ saleDie, saleMultiplier = 1, resourceDie }) {
  if (saleDie >= resourceDie) return resourceDie - 1;
  return resourceDie - (saleMultiplier - 1);
}

/** Karma to raise an attribute/resistance from `rank` to `rank+1`: 2x the next bonus. */
export function karmaCostAttribute(rank) {
  if (rank >= PENTRA.maxAttributeRank) return null;
  return 2 * attributeStep(rank + 1).bonus;
}

/** Karma to raise a skill from `value` to `value+1`: the next rank. Learning (0 -> 1) costs 1. */
export function karmaCostSkill(value) {
  if (value >= PENTRA.maxSkill) return null;
  return value + 1;
}

/** Karma to learn a new talent: 10 x talents already owned + 10. */
export function karmaCostTalent(talentCount) {
  return 10 * talentCount + 10;
}

/** Karma to buy off a hindrance. */
export const KARMA_BUY_OFF_HINDRANCE = 25;

/**
 * Resolve the advantage state of a roll. Advantage and disadvantage never stack; one of each cancels.
 * @param {number} advantages     Sources of advantage (including spending 2 Edge)
 * @param {number} disadvantages  Sources of disadvantage
 * @returns {-1|0|1}
 */
export function netAdvantage(advantages, disadvantages) {
  return Math.sign((advantages || 0) - (disadvantages || 0));
}

/**
 * Count Edge earned from a roll: each die (attribute/resistance die, plus the advantage d6) that shows its
 * minimum or maximum face earns one Edge.
 * @param {{faces: number, result: number}[]} dice
 */
export function edgeFromDice(dice) {
  return dice.reduce((n, d) => n + ((d.result === 1 || d.result === d.faces) ? 1 : 0), 0);
}

/** Wounds healed by a successful Medicine check. */
export function medicineHealing(rank) {
  return PENTRA.medicineHealing[clamp(rank, 0, PENTRA.maxSkill)];
}

/** Unarmed damage profile for a Martial Arts rank. */
export function martialArtsDamage(rank) {
  return PENTRA.martialArts[clamp(rank, 0, PENTRA.maxSkill)];
}

/** Shots per reload (core p. 21: "six shots before you need to reload"). */
export const SHOTS_PER_RELOAD = 6;

/** Reloads made: one for every full six shots fired. */
export function reloadsUsed(roundsFired) {
  return Math.floor(Math.max(0, Number(roundsFired) || 0) / SHOTS_PER_RELOAD);
}

/** Reloading Kit usage range: equal to the number of reloads made (core p. 21). One check is made per reload. */
export function reloadRange(roundsFired) {
  return reloadsUsed(roundsFired);
}

/** Parse an armor coverage code like "ALTH" into a location set. */
export function parseCoverage(code = "") {
  const upper = String(code).toUpperCase();
  return Object.fromEntries(
    Object.entries(PENTRA.hitLocations).map(([key, loc]) => [key, upper.includes(loc.code)])
  );
}

/** Most armor pieces that can be stacked at once. */
export const MAX_ARMOR_LAYERS = 3;

/**
 * Can a piece of armor be put on over what's already worn?
 * Only one outer piece (not marked "can be worn under") at a time; layerable pieces go beneath it;
 * at most three pieces in total.
 * @param {{name: string, layerable: boolean}[]} worn   Armor currently worn (excluding the candidate)
 * @param {{name: string, layerable: boolean}} candidate
 * @returns {{key: string, data: object}|null}  A problem, or null if it can be worn.
 */
export function armorLayeringProblem(worn, candidate) {
  if (worn.length >= MAX_ARMOR_LAYERS) {
    return { key: "PENTRA.Armor.TooManyLayers", data: { name: candidate.name, max: MAX_ARMOR_LAYERS } };
  }
  if (!candidate.layerable) {
    const outer = worn.find(a => !a.layerable);
    if (outer) return { key: "PENTRA.Armor.OneOuter", data: { name: candidate.name, other: outer.name } };
  }
  return null;
}

/** Weapon carry slots. */
export const WEAPON_SLOTS = ["primary", "backup", "stowed"];
/** Hands available for primary weapons: 2 one-handed or 1 two-handed. */
export const PRIMARY_HANDS = 2;

/**
 * Can a weapon go in a carry slot? Characters carry 2 one-handed weapons or 1 two-handed weapon (primary),
 * plus one backup weapon of either kind. Mounted (vehicle) weapons can't be carried.
 * @param {{name: string, hands: number, slot: string}[]} carried  The character's other weapons
 * @param {{name: string, hands: number}} weapon
 * @param {"primary"|"backup"|"stowed"} slot
 * @returns {{key: string, data: object}|null}
 */
export function weaponSlotProblem(carried, weapon, slot) {
  if (slot === "stowed") return null;
  if (!weapon.hands) return { key: "PENTRA.Weapon.Mounted", data: { name: weapon.name } };
  if (slot === "backup") {
    const backup = carried.find(w => w.slot === "backup");
    return backup ? { key: "PENTRA.Weapon.OneBackup", data: { name: weapon.name, other: backup.name } } : null;
  }
  const used = carried.filter(w => w.slot === "primary").reduce((n, w) => n + (w.hands || 0), 0);
  if (used + weapon.hands > PRIMARY_HANDS) {
    return { key: "PENTRA.Weapon.HandsFull", data: { name: weapon.name, used, hands: weapon.hands } };
  }
  return null;
}

/** The best free slot for a newly acquired weapon: primary if it fits, else backup, else stowed. */
export function autoWeaponSlot(carried, weapon) {
  for (const slot of ["primary", "backup"]) if (!weaponSlotProblem(carried, weapon, slot)) return slot;
  return "stowed";
}

/* -------------------------------------------------------------------------- */
/*  Vehicle modifications                                                     */
/* -------------------------------------------------------------------------- */

/**
 * The modifications from the rulebook. `costSteps` is how many multiplier levels each one adds to the vehicle's
 * cost (a Speed Class reduction buys back two).
 */
export const VEHICLE_MODS = {
  speedClass: { costSteps: -2 },
  armor: { costSteps: 1 },
  heavyArmor: { costSteps: 1 },
  durability: { costSteps: 1 },
  evasion: { costSteps: 1 },
  handling: { costSteps: 1 },
  health: { costSteps: 1 }
};

/** Most Armor a vehicle can have, most Handling, most Evasion increases. */
export const VEHICLE_LIMITS = { ar: 4, handling: 2, evasionMods: 3, minSpeedClass: 1 };

/** A cost's multiplier can't exceed half its die (an equal purchase's 1–N range can't pass the die): d6x3, d12x6. */
export function maxMultiplier(die) {
  return Math.max(1, Math.floor(die / 2));
}

/**
 * Move a cost up or down by multiplier levels. Going up raises the multiplier; at the die's maximum multiplier the
 * die grows a size and keeps its multiplier. Going down lowers the multiplier, then the die. Capped at d12x6 / d4x1.
 */
export function stepCost({ die, multiplier = 1 }, steps) {
  let d = die, m = multiplier;
  for (let i = 0; i < Math.abs(steps); i++) {
    if (steps > 0) {
      if (m < maxMultiplier(d)) m++;
      else if (d < 12) d = stepDie(d, 1, { min: 4 });
      else break;
    } else {
      if (m > 1) m--;
      else if (d > 4) d = stepDie(d, -1, { min: 4 });
      else break;
    }
  }
  return { die: d, multiplier: m };
}

/** True when a cost is at the top of the ladder (d12x6): no more modifications can be added. */
export const isMaxCost = cost => cost.die >= 12 && cost.multiplier >= maxMultiplier(12);

/**
 * A vehicle's stats after its modifications.
 * @param {{speedClass, ar, heavyArmor, durabilityMax, evasion, handling, healthMax, cost}} base  Stats before mods
 * @param {Record<string, number>} counts  How many of each modification are installed
 */
export function vehicleModStats(base, counts = {}) {
  const n = key => counts[key] ?? 0;
  const additions = Object.keys(VEHICLE_MODS).filter(k => VEHICLE_MODS[k].costSteps > 0).reduce((t, k) => t + n(k), 0);
  return {
    speedClass: base.speedClass - n("speedClass"),
    ar: base.ar + n("armor"),
    heavyArmor: base.heavyArmor || n("heavyArmor") > 0,
    durabilityMax: stepDie(base.durabilityMax, n("durability"), { min: 4 }),
    evasion: base.evasion + n("evasion"),
    handling: base.handling + n("handling"),
    healthMax: base.healthMax + 2 * n("health"),
    cost: stepCost(stepCost(base.cost, additions), -2 * n("speedClass"))
  };
}

/**
 * Can another modification of this kind be installed?
 * @returns {{key: string, data?: object}|null}  The problem, or null if it's allowed.
 */
export function vehicleModProblem(base, counts, mod) {
  const stats = vehicleModStats(base, counts);
  const n = counts[mod] ?? 0;
  if (VEHICLE_MODS[mod]?.costSteps > 0 && isMaxCost(stats.cost)) return { key: "PENTRA.VehicleMod.CostCap" };
  switch (mod) {
    case "speedClass":
      return stats.speedClass <= VEHICLE_LIMITS.minSpeedClass ? { key: "PENTRA.VehicleMod.SpeedFloor" } : null;
    case "armor":
      return stats.ar >= VEHICLE_LIMITS.ar ? { key: "PENTRA.VehicleMod.ArmorCap", data: { max: VEHICLE_LIMITS.ar } } : null;
    case "heavyArmor":
      return stats.heavyArmor ? { key: "PENTRA.VehicleMod.Once" } : null;
    case "durability":
      if (n >= 1) return { key: "PENTRA.VehicleMod.Once" };
      return stats.durabilityMax >= 12 ? { key: "PENTRA.VehicleMod.DieCap" } : null;
    case "evasion":
      return n >= VEHICLE_LIMITS.evasionMods ? { key: "PENTRA.VehicleMod.EvasionCap", data: { max: VEHICLE_LIMITS.evasionMods } } : null;
    case "handling":
      return stats.handling >= VEHICLE_LIMITS.handling ? { key: "PENTRA.VehicleMod.HandlingCap", data: { max: VEHICLE_LIMITS.handling } } : null;
    case "health":
      return n >= 1 ? { key: "PENTRA.VehicleMod.Once" } : null;
  }
  return { key: "PENTRA.VehicleMod.Unknown" };
}

/* -------------------------------------------------------------------------- */
/*  Attack modifiers                                                          */
/* -------------------------------------------------------------------------- */

/** Personal range bands, nearest first, with the farthest distance (yards) each covers. */
export const RANGE_BANDS = ["melee", "veryClose", "close", "far", "veryFar", "outOfRange"];
const BAND_LIMITS = { melee: 1.5, veryClose: 3, close: 6, far: 12, veryFar: 24 };

/** The range band a distance (yards / squares) falls in. */
export function bandForDistance(yards) {
  for (const band of RANGE_BANDS) if (band in BAND_LIMITS && yards <= BAND_LIMITS[band]) return band;
  return "outOfRange";
}

/** A weapon can fire at most this many bands farther / closer than its preferred band. */
export const RANGE_REACH = { farther: 1, closer: 3 };

/** The bands a weapon can fire in: one band past its preferred band, and up to three bands closer. */
export function allowedBands(preferred) {
  const p = RANGE_BANDS.indexOf(preferred);
  return RANGE_BANDS.filter((_, i) => i - p <= RANGE_REACH.farther && p - i <= RANGE_REACH.closer);
}

/**
 * Penalty for firing a weapon outside its preferred band: one band either way −1, two bands closer −2,
 * three bands closer −4.
 * Firing a ranged weapon in melee adds a further −2 (returned separately).
 * @returns {{range: number, inMelee: number}|null}  null when the weapon can't fire at that band.
 */
export function rangePenalty(preferred, actual) {
  if (!allowedBands(preferred).includes(actual)) return null;
  const steps = Math.abs(RANGE_BANDS.indexOf(actual) - RANGE_BANDS.indexOf(preferred));
  const inMelee = actual === "melee" && preferred !== "melee" ? -2 : 0;
  return { range: [0, -1, -2, -4][steps], inMelee };
}

/** Creature sizes, smallest first. */
export const SIZE_ORDER = ["tiny", "small", "medium", "large", "huge", "massive"];

/** Size modifier: smaller attacking larger is easier (+1, +2, +4 for 3+ sizes); larger attacking smaller is harder. */
export function sizeModifier(attackerSize, targetSize) {
  const a = SIZE_ORDER.indexOf(attackerSize), t = SIZE_ORDER.indexOf(targetSize);
  if (a < 0 || t < 0 || a === t) return 0;
  const diff = Math.abs(t - a);
  const value = diff >= 3 ? 4 : diff;
  return t > a ? value : -value;
}

/* -------------------------------------------------------------------------- */
/*  Movement                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * How far a character can move in one round (yards): a normal move reaches Close, a run (−2 to actions) reaches
 * Far. A Leg Wound costs one range band: Very Close and Close.
 */
export const MOVE_LIMITS = { normal: { walk: 6, run: 12 }, legWound: { walk: 3, run: 6 }, underwater: { walk: 3, run: 6 } };
/** Move limits in yards: a Leg Wound or swimming underwater drops them a band (Very Close / Close). */
export const moveLimits = (legWound, underwater = false) =>
  (underwater ? MOVE_LIMITS.underwater : legWound ? MOVE_LIMITS.legWound : MOVE_LIMITS.normal);

/* -------------------------------------------------------------------------- */
/*  Projects                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * The die a project's progress must reach. Any multiplier adds one die size (a d6x2 motorcycle needs d8); a d12
 * with a multiplier needs the mythical "d14" (a maximum roll on the d12). 0 means the GM hasn't set a value yet.
 */
export function projectTarget({ die = 0, multiplier = 1 } = {}) {
  if (!die) return 0;
  if (multiplier > 1) return die >= 12 ? 14 : stepDie(die, 1, { min: 4 });
  return die;
}

/** The next progress die: 0 → d4 (automatic on the first successful day), then up a size; d12 → "d14". */
export function nextProjectProgress(progress) {
  if (!progress) return 4;
  if (progress >= 12) return 14;
  return stepDie(progress, 1, { min: 4 });
}

/**
 * After a successful skill check, does the progress die advance? It rises on its top two faces; going from d12 to
 * the "d14" needs the maximum (12).
 */
export function projectRollAdvances(progress, roll) {
  if (progress >= 12) return roll >= 12;
  return roll >= progress - 1;
}

/* -------------------------------------------------------------------------- */
/*  Large-scale combat                                                         */
/* -------------------------------------------------------------------------- */

/** The larger army's Army Strength Counter. */
export const ARMY_MAX = 10;

/**
 * Starting Army Strength Counters from the two forces' sizes: the larger gets 10, the other its size divided by the
 * larger, times 10 (rounded, at least 1 for any force at all).
 */
export function armyCounters(sizeA, sizeB) {
  const a = Math.max(Number(sizeA) || 0, 0);
  const b = Math.max(Number(sizeB) || 0, 0);
  const larger = Math.max(a, b);
  if (!larger) return [0, 0];
  const scale = n => (n ? Math.max(Math.round((n / larger) * ARMY_MAX), 1) : 0);
  return [scale(a), scale(b)];
}

/**
 * A clash round: each leader who succeeded chose to "block" 1 damage to their own army or "deal" 1 to the other.
 * Returns the damage each side takes, [toA, toB].
 */
export function clashDamage(choiceA, choiceB) {
  const toA = Math.max((choiceB === "deal" ? 1 : 0) - (choiceA === "block" ? 1 : 0), 0);
  const toB = Math.max((choiceA === "deal" ? 1 : 0) - (choiceB === "block" ? 1 : 0), 0);
  return [toA, toB];
}

/**
 * The always-on modifiers to a leader's Leadership check: +2 in fortifications, +2 if the army is mostly fearless
 * creatures, -2 after a failed morale check; morale checks are also -1 per counter lost from the starting strength.
 * @returns {{key: string, value: number}[]}
 */
export function armyModifiers({ fortified, fearless, failedMorale, start = 0, strength = 0 }, morale = false) {
  const mods = [];
  if (fortified) mods.push({ key: "fortified", value: 2 });
  if (fearless) mods.push({ key: "fearless", value: 2 });
  if (failedMorale) mods.push({ key: "failedMorale", value: -2 });
  const lost = Math.max(start - strength, 0);
  if (morale && lost) mods.push({ key: "losses", value: -lost });
  return mods;
}

/**
 * Who won? An army wiped out (0 strength) loses outright. Otherwise the side that didn't run wins; if both ran,
 * the one with more strength left. Returns 0, 1, or null for a draw.
 */
export function battleWinner([a, b]) {
  if (a.strength <= 0 && b.strength <= 0) return null;
  if (a.strength <= 0) return 1;
  if (b.strength <= 0) return 0;
  if (a.broken !== b.broken) return a.broken ? 1 : 0;
  if (a.strength === b.strength) return null;
  return a.strength > b.strength ? 0 : 1;
}

/* -------------------------------------------------------------------------- */
/*  Vehicle chases (the swim-lane range band chart)                            */
/* -------------------------------------------------------------------------- */

/**
 * Chase range bands by distance in bands: 0 shares space (Impact / Drive-by / Fly-by), 6 is Escape. Positions on the
 * chart run from +6 (Escape, top) through 0 (the anchor's row) to -6 (Escape, bottom).
 */
export const CHASE_BANDS = ["driveBy", "veryClose", "close", "far", "veryFar", "nearEscape", "escape"];
export const CHASE_ESCAPE = CHASE_BANDS.length - 1;

/** Distance between two chart positions, in bands (capped at Escape). */
export const chaseDistance = (a, b) => Math.min(Math.abs(a - b), CHASE_ESCAPE);

/**
 * How far a weapon reaches in a chase, in bands. Personal weapons (and bombs) work only at Drive-by; mounted machine
 * guns out to Very Close, rockets/torpedoes to Close, guided missiles to Far.
 */
export function chaseReach({ category, range } = {}) {
  if (category !== "vehicle") return 0;
  return { melee: 0, veryClose: 1, close: 2, far: 3, veryFar: 4 }[range] ?? 0;
}

/**
 * Move a vehicle `bands` along its facing (up = toward Escape top). The anchor never leaves its row: when it moves,
 * everyone else shifts the other way. Anyone reaching Escape escapes the anchor.
 * @param {{uuid: string, pos: number, facing: "up"|"down", escaped?: boolean}[]} vehicles  Mutated in place
 * @returns {string[]}  The uuids that escaped with this move
 */
export function chaseMove(vehicles, anchor, uuid, bands) {
  const mover = vehicles.find(v => v.uuid === uuid);
  if (!mover || mover.escaped || !bands) return [];
  const step = (mover.facing === "up" ? 1 : -1) * bands;
  const shifted = uuid === anchor ? vehicles.filter(v => v.uuid !== anchor && !v.escaped) : [mover];
  const delta = uuid === anchor ? -step : step;
  const escaped = [];
  for (const v of shifted) {
    v.pos = clamp(v.pos + delta, -CHASE_ESCAPE, CHASE_ESCAPE);
    if (Math.abs(v.pos) >= CHASE_ESCAPE) {
      v.escaped = true;
      escaped.push(v.uuid);
    }
  }
  return escaped;
}

/** The anchor by default: the slowest vehicle (lowest speed class). */
export function slowestVehicle(entries) {
  return [...entries].sort((a, b) => a.speedClass - b.speedClass)[0]?.uuid ?? null;
}

/** Initiative die after a roll: a natural 1 drops it a size, a natural max raises it (d4–d12). */
export function nextInitiativeDie(die, natural) {
  if (natural === 1 && die > 4) return die - 2;
  if (natural === die && die < 12) return die + 2;
  return die;
}

/* -------------------------------------------------------------------------- */
/*  Underwater                                                                 */
/* -------------------------------------------------------------------------- */

/** How each weapon behaves underwater. */
export const UNDERWATER_MODES = ["reduced", "swing", "full", "none"];

/**
 * A weapon's preferred range band underwater: water friction drops it one band (melee stays melee); torpedoes
 * ("full") keep their range; fire-based weapons ("none": flamethrowers, missiles, rockets) don't work (null).
 */
export function underwaterRange(range, mode = "reduced") {
  if (mode === "none") return null;
  if (mode === "full") return range;
  const i = RANGE_BANDS.indexOf(range);
  return i <= 0 ? range : RANGE_BANDS[i - 1];
}

/** Breath: everyone holds it for 30 seconds (5 rounds) before the breath usage checks start, at d6. */
export const BREATH = { holdRounds: 5, die: 6 };
