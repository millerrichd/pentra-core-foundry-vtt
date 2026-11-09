import { test } from "node:test";
import assert from "node:assert/strict";
import { creationBudget, creationViolations, raisesStats, nativeIndex } from "../modules/creation.js";

const r = n => ({ rank: n });
const clone = o => structuredClone(o);

/** The Face, the rulebook's example character: a legal, fully spent build. */
const face = () => ({
  attributes: { charm: r(2), finesse: r(2), intellect: r(0), knowledge: r(1), might: r(1) },
  resistances: { fortitude: r(0), mind: r(1), reflex: r(0) },
  skills: { insight: 3, intimidation: 3, persuasion: 3, driving: 3, shooting: 3, sneaking: 3,
    awareness: 3, medicine: 3, research: 3, melee_weapons: 3, athletics: 0 },
  languages: [{ name: "English", value: 4, native: true }]
});
const ctx = { ancestryBoost: "charm", hindrances: 2, talents: 2, hasAncestry: true };

test("The Face is a legal, fully spent build", () => {
  const b = creationBudget(face(), ctx);
  assert.equal(b.attributes.used, 5);
  assert.equal(b.resistances.used, 1);
  assert.equal(b.skills.used, 30);
  assert.deepEqual(b.errors, []);
  assert.deepEqual(b.warnings, []);
});

test("attribute cap d8+4 and 5-point budget", () => {
  const prev = face();
  prev.attributes.might = r(0);
  const next = clone(prev);
  next.attributes.finesse = r(3); // d6+6 at creation
  assert.ok(creationViolations(prev, next, ctx).some(e => e.key.endsWith("AttributeCap")));

  const over = clone(face());
  over.attributes.intellect = r(1); // 6th point
  assert.ok(creationViolations(face(), over, ctx).some(e => e.key.endsWith("AttributePoints")));
});

test("only one resistance raise", () => {
  const next = face();
  next.resistances.reflex = r(1);
  assert.ok(creationViolations(face(), next, ctx).some(e => e.key.endsWith("ResistancePoints")));
});

test("skills: 30 points, max 3 each; non-native languages count", () => {
  const prev = face();
  prev.skills.insight = 2;
  const capped = clone(prev);
  capped.skills.insight = 4;
  assert.ok(creationViolations(prev, capped, ctx).some(e => e.key.endsWith("SkillCap")));

  const lang = face();
  lang.languages.push({ name: "Russian", value: 1 });
  assert.ok(creationViolations(face(), lang, ctx).some(e => e.key.endsWith("SkillPoints")));

  const native = face();
  native.languages[0].value = 5;
  assert.ok(creationViolations(face(), native, ctx).some(e => e.key.endsWith("SkillCap")));
});

test("decreases are always allowed, even when already over budget", () => {
  const over = face();
  over.skills.athletics = 3; // 33 points
  const fixed = clone(over);
  fixed.skills.athletics = 1;
  assert.deepEqual(creationViolations(over, fixed, ctx), []);
});

test("ancestry boost is free and talents are limited by hindrances", () => {
  const b = creationBudget(face(), { ...ctx, hindrances: 1, talents: 2 });
  assert.ok(b.errors.some(e => e.key.endsWith("Talents")));
  const noAncestry = creationBudget(face(), { ...ctx, ancestryBoost: null, hasAncestry: false });
  assert.equal(noAncestry.attributes.used, 6);
  assert.ok(noAncestry.warnings.some(w => w.key.endsWith("NoAncestry")));
});

test("unspent points are warnings, not errors", () => {
  const s = face();
  s.skills.insight = 0;
  const b = creationBudget(s, ctx);
  assert.deepEqual(b.errors, []);
  assert.ok(b.warnings.some(w => w.key.endsWith("SkillPoints")));
});

test("post-creation raise detection", () => {
  const next = face();
  next.skills.athletics = 1;
  assert.equal(raisesStats(face(), next), true);
  const lower = face();
  lower.skills.insight = 2;
  assert.equal(raisesStats(face(), lower), false);
  const lang = face();
  lang.languages.push({ name: "Russian", value: 0 });
  assert.equal(raisesStats(face(), lang), false, "adding a 0-rank language is free");
});

test("native language falls back to the first entry", () => {
  assert.equal(nativeIndex([{ value: 4 }, { value: 2 }]), 0);
  assert.equal(nativeIndex([{ value: 1 }, { value: 4, native: true }]), 1);
});
