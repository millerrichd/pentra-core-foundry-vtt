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
  assert.equal(R.reloadRange(4), 2);
  assert.equal(R.reloadRange(10), 4);
  assert.deepEqual(R.parseCoverage("AT"), { torso: true, arms: true, legs: false, head: false });
  assert.deepEqual(R.saleValue({ costDie: 6, multiplier: 2 }), { die: 6, multiplier: 1 });
  assert.deepEqual(R.saleValue({ costDie: 6 }), { die: 4, multiplier: 1 });
});
