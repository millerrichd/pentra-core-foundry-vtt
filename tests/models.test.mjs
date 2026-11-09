/**
 * Derived-data tests for the character model, with minimal Foundry stubs.
 * Oracle: "The Face", the rulebook's example character (Grim, Slow, Lucky, Rich).
 */
import { test } from "node:test";
import assert from "node:assert/strict";

// --- Minimal Foundry stubs ---------------------------------------------------
class Field { constructor(...args) { this.args = args; } }
globalThis.foundry = {
  data: {
    fields: Object.fromEntries(["NumberField", "StringField", "BooleanField", "HTMLField", "SchemaField", "ArrayField"]
      .map(n => [n, class extends Field {}]))
  },
  abstract: { TypeDataModel: class {} }
};
Math.clamp ??= (n, min, max) => Math.min(Math.max(n, min), max);

const { PentraCharacterModel, PentraNPCModel, PentraVehicleActorModel } = await import("../modules/models.js");

const item = (type, system) => ({ type, system });
const trait = (type, t, delta) => item(type, { trait: t, delta });

function character(items, overrides = {}) {
  const m = Object.create(PentraCharacterModel.prototype);
  const rank = r => ({ rank: r });
  Object.assign(m, {
    attributes: { charm: rank(2), finesse: rank(2), intellect: rank(0), knowledge: rank(1), might: rank(1) },
    resistances: { fortitude: rank(0), mind: rank(1), reflex: rank(0) },
    skills: {}, languages: [],
    health: { value: 12 }, edge: { value: 2 }, karma: { value: 0, earned: 0 },
    deathDie: { value: 12 }, resourceDie: { value: 6 }, drainDie: { value: 8 },
    parent: { items },
    ...overrides
  });
  m.prepareDerivedData();
  return m;
}

test("The Face derives the rulebook's trait values", () => {
  const face = character([
    trait("hindrance", "deathDie", -1),     // Grim
    trait("hindrance", "initiativeDie", -1), // Slow
    trait("talent", "edge", 2),              // Lucky
    trait("talent", "resourceDie", 1),       // Rich
    item("armor", { equipped: true, evasion: 0, ar: 1, heavy: false, isBroken: false,
      coverage: { torso: true, arms: false, legs: false, head: false } })  // Bulletproof Vest
  ]);
  assert.equal(face.deathDie.max, 10);
  assert.equal(face.initiativeDie.value, 4);
  assert.equal(face.edge.start, 4);
  assert.equal(face.resourceDie.start, 8);
  assert.equal(face.durabilityDie.value, 8);
  assert.equal(face.evasion.value, 9);
  assert.equal(face.health.max, 12);
  assert.equal(face.talentCount, 2);
  assert.deepEqual(face.armor, { torso: 1, arms: 0, legs: 0, head: 0 });
  assert.equal(face.attributes.charm.formatted, "d8+4");
  assert.equal(face.attributes.charm.die, 8);
  assert.equal(face.attributes.charm.bonus, 4);
});

test("armor: evasion penalties, heavy AR, broken armor, 3-piece stacking", () => {
  const piece = (o) => item("armor", { equipped: true, heavy: false, isBroken: false, ar: 1, evasion: 0,
    coverage: { torso: true, arms: false, legs: false, head: false }, ...o });
  const c = character([
    piece({ evasion: -1, coverage: { torso: true, arms: true, legs: false, head: false } }),
    piece({ heavy: true }),
    piece({ isBroken: true, ar: 4 })
  ]);
  assert.equal(c.armor.torso, 1 + 2, "heavy doubles; broken gives nothing");
  assert.equal(c.armor.arms, 1);
  assert.equal(c.evasion.value, 9 - 1 - 1, "-1 from jacket, -1 for stacking three pieces");
});

test("talent and hindrance numeric traits", () => {
  const c = character([trait("hindrance", "evasion", -2), trait("talent", "health", 2), trait("hindrance", "edge", -2)]);
  assert.equal(c.evasion.value, 7);
  assert.equal(c.health.max, 14);
  assert.equal(c.edge.start, 0);
});

test("carry slots count field kits by size", () => {
  const c = character([
    item("fieldkit", { size: "normal", quantity: 1 }),
    item("fieldkit", { size: "large", quantity: 2 }),
    item("fieldkit", { size: "small", quantity: 2 }),
    item("armor", { equipped: false, evasion: 0, ar: 1, coverage: {} }),
    item("weapon", {})
  ]);
  assert.equal(c.carry.used, 1 + 4 + 1);
  assert.equal(c.carry.over, false);
});

test("NPC evasion includes armor", () => {
  const m = Object.create(PentraNPCModel.prototype);
  Object.assign(m, {
    attributes: { charm: { rank: 1 }, finesse: { rank: 1 }, intellect: { rank: 1 }, knowledge: { rank: 1 }, might: { rank: 1 } },
    resistances: { fortitude: { rank: 0 }, mind: { rank: 0 }, reflex: { rank: 0 } },
    evasion: { base: 9 },
    parent: { items: [item("armor", { equipped: true, evasion: -2, ar: 2, heavy: false, isBroken: false,
      coverage: { torso: true, arms: true, legs: true, head: true } })] }
  });
  m.prepareDerivedData();
  assert.equal(m.evasion.value, 7);
  assert.equal(m.armor.head, 2);
  assert.equal(m.attributes.might.formatted, "d10+2");
});

/* -------------------------------------------------------------------------- */

function vehicle(overrides = {}) {
  const m = Object.create(PentraVehicleActorModel.prototype);
  Object.assign(m, {
    category: "land", evasion: { base: 10 }, ar: 1, heavyArmor: false, speedClass: 3, handling: 1,
    cost: { die: 6, multiplier: 2 }, durability: { value: 6, max: 6 }, health: { value: 6, max: 6 }, ...overrides
  });
  m.prepareDerivedData();
  return m;
}

test("vehicle: the driver's skill follows the vehicle type", () => {
  assert.equal(vehicle({ category: "land" }).skill, "driving");
  assert.equal(vehicle({ category: "sea" }).skill, "boating");
  assert.equal(vehicle({ category: "air" }).skill, "piloting");
  assert.equal(vehicle({ category: "mount" }).skill, "riding");
});

test("vehicle: armor covers every location, heavy doubles it, broken gives none", () => {
  assert.deepEqual(vehicle({ ar: 2 }).armor, { torso: 2, arms: 2, legs: 2, head: 2 });
  assert.equal(vehicle({ ar: 2, heavyArmor: true }).armor.torso, 4);
  const wreck = vehicle({ ar: 2, durability: { value: 0, max: 6 } });
  assert.equal(wreck.isBroken, true);
  assert.equal(wreck.armor.torso, 0);
  assert.equal(vehicle().evasion.value, 10);
});

test("vehicle: installed modifications change its stats and cost", () => {
  const mod = m => ({ type: "vehiclemod", system: { mod: m } });
  const v = vehicle({ parent: { items: [mod("armor"), mod("health"), mod("evasion"), mod("speedClass")] } });
  assert.equal(v.ar, 2);
  assert.equal(v.health.max, 8);
  assert.equal(v.evasion.value, 11);
  assert.equal(v.speedClass, 2);
  // d6x2 +3 levels (d6x3, d8x3, d8x4) then -2 for the speed reduction (d8x3, d8x2)
  assert.deepEqual(v.cost, { die: 8, multiplier: 2 });
  assert.equal(v.base.ar, 1);
});

test("character size comes from ancestry (default Medium)", () => {
  assert.equal(character([], { size: "medium" }).size, "medium");
  assert.equal(character([item("ancestry", { size: "small", attributeBoost: "" })], { size: "medium" }).size, "small");
});

test("a disease that lowers a trait shifts it (Initiative Die d6 → d4)", () => {
  const sick = character([item("disease", { trait: "initiativeDie", traitDelta: -1 })]);
  assert.equal(sick.initiativeDie.value, 4);
});
