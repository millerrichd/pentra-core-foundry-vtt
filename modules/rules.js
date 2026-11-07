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

/** Usage range for restocking ammunition: 1-2, plus 1 per 5 rounds of combat fired. */
export function reloadRange(roundsFired) {
  return 2 + Math.floor((Number(roundsFired) || 0) / 5);
}

/** Parse an armor coverage code like "ALTH" into a location set. */
export function parseCoverage(code = "") {
  const upper = String(code).toUpperCase();
  return Object.fromEntries(
    Object.entries(PENTRA.hitLocations).map(([key, loc]) => [key, upper.includes(loc.code)])
  );
}
