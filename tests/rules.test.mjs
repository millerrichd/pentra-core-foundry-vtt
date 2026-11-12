import { test } from "node:test";
import assert from "node:assert/strict";
import * as R from "../modules/rules.js";

test("attribute ladder always totals 12", () => {
  for (let r = 0; r <= 4; r++) {
    const { die, bonus } = R.attributeStep(r);
    assert.equal(die + bonus, 12);
  }
  assert.equal(R.formatAttribute(2), "d8+4");
});

test("wound counting matches the rulebook example (TN 7, roll 12)", () => {
  assert.equal(R.countWounds({ base: 0, increment: "odd", tn: 7, total: 12 }), 2);
  assert.equal(R.countWounds({ base: 0, increment: "even", tn: 7, total: 12 }), 3);
  assert.equal(R.countWounds({ base: 0, increment: "every", tn: 7, total: 12 }), 5);
  assert.equal(R.countWounds({ base: 1, increment: "odd", tn: 9, total: 9 }), 1, "meeting TN deals base");
  assert.equal(R.countWounds({ base: 1, increment: "odd", tn: 9, total: 8 }), 0, "miss");
  assert.equal(R.countWounds({ base: 4, increment: "odd", tn: 9, total: 10, heavy: true }), 8, "heavy doubles");
});

test("usage die stepping", () => {
  assert.equal(R.stepDie(6, -1), 4);
  assert.equal(R.stepDie(4, -1), 0);
  assert.equal(R.stepDie(0, 1), 4);
  assert.equal(R.stepDie(12, 1), 12);
  assert.equal(R.stepDie(4, -1, { min: 4 }), 4, "initiative floor");
});

test("actions from initiative", () => {
  assert.equal(R.actionsFromInitiative(1), 1);
  assert.equal(R.actionsFromInitiative(6), 1);
  assert.equal(R.actionsFromInitiative(7), 2);
  assert.equal(R.actionsFromInitiative(13), 3);
  assert.equal(R.actionsFromInitiative(30), 3);
});

test("purchase ranges match the multiplier table", () => {
  assert.equal(R.purchaseRange({ costDie: 8, resourceDie: 6 }), null, "too expensive");
  assert.equal(R.purchaseRange({ costDie: 6, resourceDie: 6 }), 2);
  assert.equal(R.purchaseRange({ costDie: 4, resourceDie: 6 }), 1);
  assert.equal(R.purchaseRange({ costDie: 6, multiplier: 3, resourceDie: 6 }), 6);
  assert.equal(R.purchaseRange({ costDie: 6, multiplier: 2, resourceDie: 8 }), 2);
});

test("karma costs match the rulebook examples", () => {
  assert.equal(R.karmaCostAttribute(1), 8, "d10+2 -> d8+4 costs 8");
  assert.equal(R.karmaCostAttribute(4), null);
  assert.equal(R.karmaCostSkill(4), 5, "4 -> 5 costs 5");
  assert.equal(R.karmaCostTalent(2), 30);
});

test("advantage nets out", () => {
  assert.equal(R.netAdvantage(2, 1), 1);
  assert.equal(R.netAdvantage(1, 1), 0);
  assert.equal(R.netAdvantage(0, 3), -1);
});

test("edge gain on min or max faces", () => {
  assert.equal(R.edgeFromDice([{ faces: 6, result: 1 }, { faces: 6, result: 6 }]), 2);
  assert.equal(R.edgeFromDice([{ faces: 12, result: 5 }]), 0);
});

test("misc tables", () => {
  assert.deepEqual(R.martialArtsDamage(5), { wounds: 2, increment: "even" });
  assert.equal(R.medicineHealing(4), 2);
  assert.equal(R.reloadRange(0), 0);
  assert.equal(R.reloadRange(5), 0);
  assert.equal(R.reloadRange(6), 1);
  assert.equal(R.reloadRange(11), 1);
  assert.equal(R.reloadRange(12), 2);
  assert.equal(R.reloadRange(18), 3);
  assert.deepEqual(R.parseCoverage("AT"), { torso: true, arms: true, legs: false, head: false });
  assert.deepEqual(R.saleValue({ costDie: 6, multiplier: 2 }), { die: 6, multiplier: 1 });
  assert.deepEqual(R.saleValue({ costDie: 6 }), { die: 4, multiplier: 1 });
});

test("armor layering: one outer piece, layerable pieces beneath, max 3", () => {
  const jacket = { name: "Leather Jacket", layerable: false };
  const coat = { name: "Leather Long Coat", layerable: false };
  const vest = { name: "Bulletproof Vest", layerable: true };
  assert.equal(R.armorLayeringProblem([], jacket), null);
  assert.equal(R.armorLayeringProblem([jacket], coat).key, "PENTRA.Armor.OneOuter");
  assert.equal(R.armorLayeringProblem([jacket], vest), null, "vest goes under the jacket");
  assert.equal(R.armorLayeringProblem([vest], coat), null, "coat goes over the vest");
  assert.equal(R.armorLayeringProblem([vest, vest, jacket], vest).key, "PENTRA.Armor.TooManyLayers");
});

test("weapon carry limits: 2 one-handed or 1 two-handed, plus one backup", () => {
  const longSword = { name: "Long Sword", hands: 1 };
  const shortSword = { name: "Short Sword", hands: 1 };
  const spear = { name: "Spear", hands: 2 };
  const axe = { name: "Woodchopping Axe", hands: 2 };
  const p = (w, slot) => ({ ...w, slot });

  assert.equal(R.weaponSlotProblem([p(longSword, "primary")], shortSword, "primary"), null, "two one-handers");
  assert.equal(R.weaponSlotProblem([p(longSword, "primary"), p(shortSword, "primary")], spear, "primary").key, "PENTRA.Weapon.HandsFull");
  assert.equal(R.weaponSlotProblem([p(spear, "primary")], axe, "primary").key, "PENTRA.Weapon.HandsFull");
  assert.equal(R.weaponSlotProblem([p(spear, "primary")], longSword, "primary").key, "PENTRA.Weapon.HandsFull", "1h + 2h is 3 hands");
  assert.equal(R.weaponSlotProblem([p(spear, "primary")], axe, "backup"), null, "a two-hander can be the backup");
  assert.equal(R.weaponSlotProblem([p(spear, "primary"), p(axe, "backup")], longSword, "backup").key, "PENTRA.Weapon.OneBackup");
  assert.equal(R.weaponSlotProblem([p(spear, "primary"), p(axe, "backup")], longSword, "stowed"), null, "stowing is always fine");
  assert.equal(R.weaponSlotProblem([], { name: "Machine Gun", hands: 0 }, "primary").key, "PENTRA.Weapon.Mounted");

  // Corrin's loadout: Long Sword, Short Sword, Spear, Woodchopping Axe
  const carried = [];
  for (const w of [longSword, shortSword, spear, axe]) carried.push(p(w, R.autoWeaponSlot(carried, w)));
  assert.deepEqual(carried.map(w => w.slot), ["primary", "primary", "backup", "stowed"]);
});

/* ---------- Vehicle modifications ---------- */
import { stepCost, maxMultiplier, vehicleModProblem, vehicleModStats } from "../modules/rules.js";

test("maxMultiplier: half the die (d6x3 ... d12x6)", () => {
  assert.deepEqual([4, 6, 8, 10, 12].map(maxMultiplier), [2, 3, 4, 5, 6]);
});

test("stepCost: multiplier rises to the die's max, then the die grows and keeps its multiplier", () => {
  assert.deepEqual(stepCost({ die: 6, multiplier: 2 }, 1), { die: 6, multiplier: 3 });
  assert.deepEqual(stepCost({ die: 6, multiplier: 3 }, 1), { die: 8, multiplier: 3 });
  assert.deepEqual(stepCost({ die: 12, multiplier: 6 }, 1), { die: 12, multiplier: 6 });
  assert.deepEqual(stepCost({ die: 8, multiplier: 2 }, -2), { die: 6, multiplier: 1 });
  assert.deepEqual(stepCost({ die: 4, multiplier: 1 }, -2), { die: 4, multiplier: 1 });
});

test("vehicleModProblem: rulebook limits", () => {
  const base = { speedClass: 2, ar: 3, heavyArmor: false, durabilityMax: 6, evasion: 8, handling: 1, healthMax: 10, cost: { die: 8, multiplier: 2 } };
  assert.equal(vehicleModProblem(base, {}, "armor"), null);
  assert.equal(vehicleModProblem(base, { armor: 1 }, "armor").key, "PENTRA.VehicleMod.ArmorCap");
  assert.equal(vehicleModProblem(base, { handling: 1 }, "handling").key, "PENTRA.VehicleMod.HandlingCap");
  assert.equal(vehicleModProblem(base, { evasion: 3 }, "evasion").key, "PENTRA.VehicleMod.EvasionCap");
  assert.equal(vehicleModProblem(base, { health: 1 }, "health").key, "PENTRA.VehicleMod.Once");
  assert.equal(vehicleModProblem(base, { durability: 1 }, "durability").key, "PENTRA.VehicleMod.Once");
  assert.equal(vehicleModProblem(base, { heavyArmor: 1 }, "heavyArmor").key, "PENTRA.VehicleMod.Once");
  assert.equal(vehicleModProblem(base, { speedClass: 1 }, "speedClass").key, "PENTRA.VehicleMod.SpeedFloor");
  const maxed = { ...base, cost: { die: 12, multiplier: 6 } };
  assert.equal(vehicleModProblem(maxed, {}, "evasion").key, "PENTRA.VehicleMod.CostCap");
  assert.equal(vehicleModProblem(maxed, {}, "speedClass"), null);
  assert.equal(vehicleModStats(base, { durability: 1 }).durabilityMax, 8);
});

/* ---------- Attack modifiers ---------- */
import { rangePenalty, sizeModifier, bandForDistance, allowedBands } from "../modules/rules.js";

test("rangePenalty: one band farther, up to three closer; anything else can't fire", () => {
  assert.deepEqual(rangePenalty("close", "melee"), { range: -2, inMelee: -2 });     // pistol
  assert.deepEqual(rangePenalty("veryClose", "melee"), { range: -1, inMelee: -2 }); // shotgun
  assert.deepEqual(rangePenalty("far", "veryFar"), { range: -1, inMelee: 0 });
  assert.deepEqual(rangePenalty("far", "close"), { range: -1, inMelee: 0 });
  assert.deepEqual(rangePenalty("far", "veryClose"), { range: -2, inMelee: 0 });
  assert.deepEqual(rangePenalty("melee", "melee"), { range: 0, inMelee: 0 });
  assert.deepEqual(rangePenalty("far", "melee"), { range: -4, inMelee: -2 });       // rifle
  assert.equal(rangePenalty("veryFar", "melee"), null);      // four bands closer
  assert.equal(rangePenalty("close", "veryFar"), null);      // two bands farther
  assert.deepEqual(allowedBands("far"), ["melee", "veryClose", "close", "far", "veryFar"]);
});

test("sizeModifier: smaller vs larger is easier", () => {
  assert.equal(sizeModifier("medium", "large"), 1);
  assert.equal(sizeModifier("large", "medium"), -1);
  assert.equal(sizeModifier("small", "large"), 2);
  assert.equal(sizeModifier("tiny", "huge"), 4);
  assert.equal(sizeModifier("massive", "medium"), -4);
  assert.equal(sizeModifier("medium", "medium"), 0);
});

test("bandForDistance: yards to range band", () => {
  assert.equal(bandForDistance(1), "melee");
  assert.equal(bandForDistance(3), "veryClose");
  assert.equal(bandForDistance(6), "close");
  assert.equal(bandForDistance(10), "far");
  assert.equal(bandForDistance(20), "veryFar");
  assert.equal(bandForDistance(40), "outOfRange");
});

/* ---------- Projects ---------- */
import { projectTarget, nextProjectProgress, projectRollAdvances } from "../modules/rules.js";

test("projectTarget: multipliers add one die size; a d12 with a multiplier is a d14", () => {
  assert.equal(projectTarget({ die: 6, multiplier: 2 }), 8);   // the rulebook's motorcycle
  assert.equal(projectTarget({ die: 6, multiplier: 1 }), 6);
  assert.equal(projectTarget({ die: 6, multiplier: 5 }), 8);   // any multiplier is one step
  assert.equal(projectTarget({ die: 12, multiplier: 3 }), 14);
  assert.equal(projectTarget({ die: 0 }), 0);
});

test("project progress: 0 → d4 → … → d12 → d14, rising on the top two faces (max only for d14)", () => {
  assert.equal(nextProjectProgress(0), 4);
  assert.equal(nextProjectProgress(4), 6);
  assert.equal(nextProjectProgress(12), 14);
  assert.equal(projectRollAdvances(4, 3), true);
  assert.equal(projectRollAdvances(4, 2), false);
  assert.equal(projectRollAdvances(8, 7), true);
  assert.equal(projectRollAdvances(12, 11), false);
  assert.equal(projectRollAdvances(12, 12), true);
});

test("army counters: larger force is 10, the other scales", () => {
  assert.deepEqual(R.armyCounters(1000, 500), [10, 5]);
  assert.deepEqual(R.armyCounters(300, 1200), [3, 10]);
  assert.deepEqual(R.armyCounters(1000, 10), [10, 1], "any force gets at least 1");
  assert.deepEqual(R.armyCounters(200, 200), [10, 10]);
  assert.deepEqual(R.armyCounters(0, 0), [0, 0]);
});

test("clash damage: deal 1 or block 1", () => {
  assert.deepEqual(R.clashDamage("deal", "deal"), [1, 1]);
  assert.deepEqual(R.clashDamage("deal", "block"), [0, 0]);
  assert.deepEqual(R.clashDamage("block", null), [0, 0]);
  assert.deepEqual(R.clashDamage(null, "deal"), [1, 0]);
});

test("army modifiers: fortifications, fearless, failed morale, losses on morale", () => {
  const side = { fortified: true, fearless: false, failedMorale: true, start: 10, strength: 7 };
  assert.deepEqual(R.armyModifiers(side), [{ key: "fortified", value: 2 }, { key: "failedMorale", value: -2 }]);
  assert.deepEqual(R.armyModifiers(side, true).at(-1), { key: "losses", value: -3 });
});

test("battle winner", () => {
  assert.equal(R.battleWinner([{ strength: 0 }, { strength: 2 }]), 1, "wiped out");
  assert.equal(R.battleWinner([{ strength: 5, broken: true }, { strength: 2, broken: false }]), 1, "the one who didn't run");
  assert.equal(R.battleWinner([{ strength: 5, broken: true }, { strength: 2, broken: true }]), 0, "both ran: more strength");
  assert.equal(R.battleWinner([{ strength: 3, broken: true }, { strength: 3, broken: true }]), null);
});

test("chase: distance bands and weapon reach", () => {
  assert.equal(R.CHASE_BANDS[R.chaseDistance(2, -1)], "far");
  assert.equal(R.chaseDistance(6, -6), R.CHASE_ESCAPE);
  assert.equal(R.chaseReach({ category: "ranged", range: "far" }), 0, "personal weapons: Drive-by only");
  assert.equal(R.chaseReach({ category: "vehicle", range: "veryClose" }), 1, "machine guns");
  assert.equal(R.chaseReach({ category: "vehicle", range: "close" }), 2, "rockets");
  assert.equal(R.chaseReach({ category: "vehicle", range: "far" }), 3, "missiles");
  assert.equal(R.chaseReach({ category: "vehicle", range: "melee" }), 0, "bombs");
});

test("chase: moving, the anchor shifting everyone, and escape", () => {
  // The rulebook's van example: the van (anchor) pushes 3 toward the top; everyone else drops 3.
  const vs = [
    { uuid: "van", pos: 0, facing: "up" },
    { uuid: "bike", pos: 0, facing: "up" },
    { uuid: "corpBike", pos: 0, facing: "up" },
    { uuid: "sedan", pos: -2, facing: "up" }
  ];
  assert.deepEqual(R.chaseMove(vs, "van", "van", 3), []);
  assert.deepEqual(vs.map(v => v.pos), [0, -3, -3, -5]);
  assert.deepEqual(R.chaseMove(vs, "van", "bike", 3), []);
  assert.equal(vs[1].pos, 0);
  assert.deepEqual(R.chaseMove(vs, "van", "van", 1), ["sedan"], "pushed into Escape (bottom)");
  assert.equal(vs[3].escaped, true);
  // A vehicle facing down moves toward the bottom.
  const jet = [{ uuid: "d", pos: 0, facing: "down" }, { uuid: "j", pos: -5, facing: "up" }];
  R.chaseMove(jet, "d", "j", 3);
  assert.equal(jet[1].pos, -2);
});

test("chase: anchor is the slowest; initiative die progression", () => {
  assert.equal(R.slowestVehicle([{ uuid: "jet", speedClass: 5 }, { uuid: "ship", speedClass: 2 }]), "ship");
  assert.equal(R.nextInitiativeDie(6, 1), 4);
  assert.equal(R.nextInitiativeDie(6, 6), 8);
  assert.equal(R.nextInitiativeDie(4, 1), 4);
  assert.equal(R.nextInitiativeDie(12, 12), 12);
  assert.equal(R.nextInitiativeDie(8, 5), 8);
});

test("underwater: ranges drop a band, torpedoes keep theirs, fire weapons fail", () => {
  assert.equal(R.underwaterRange("close"), "veryClose", "pistols");
  assert.equal(R.underwaterRange("far"), "close", "rifles, bows");
  assert.equal(R.underwaterRange("veryClose"), "melee", "shotguns");
  assert.equal(R.underwaterRange("melee"), "melee");
  assert.equal(R.underwaterRange("close", "full"), "close", "torpedoes");
  assert.equal(R.underwaterRange("far", "none"), null, "missiles");
  assert.deepEqual(R.moveLimits(false, true), { walk: 3, run: 6 }, "swim Very Close / Close");
  assert.deepEqual(R.moveLimits(false), { walk: 6, run: 12 });
});
