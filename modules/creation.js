/**
 * Character-creation budgets and limits (pure, no Foundry globals).
 *
 * Rulebook, Character Creation:
 *  - Attributes: 5 points on top of the ancestry's free boost; none may start above d8+4 (rank 2).
 *  - Resistances: raise one to d10+2 (1 point, rank cap 1).
 *  - Skills: 30 points, no more than 3 in a single skill. Languages are Knowledge skills and count,
 *    except one native language known for free at rank 4.
 *  - Up to 2 hindrances; one talent per hindrance taken.
 */
export const CREATION = {
  attributePoints: 5,
  maxAttributeRank: 2,
  resistancePoints: 1,
  maxResistanceRank: 1,
  skillPoints: 30,
  maxSkill: 3,
  nativeLanguageRank: 4,
  maxHindrances: 2
};

/** The index of the native language: the one flagged native, else the first. */
export function nativeIndex(languages = []) {
  const flagged = languages.findIndex(l => l.native);
  return flagged >= 0 ? flagged : (languages.length ? 0 : -1);
}

/**
 * Summarize a character's creation spending.
 * @param {object} system   Plain system data: attributes, resistances, skills, languages
 * @param {object} ctx
 * @param {string|null} ctx.ancestryBoost  Attribute key boosted by the ancestry, if any
 * @param {number} ctx.hindrances          Hindrances owned
 * @param {number} ctx.talents             Talents owned
 * @param {boolean} ctx.hasAncestry
 * @returns {{attributes, resistances, skills, hindrances, talents, errors: {key:string,data?:object}[], warnings: {key:string,data?:object}[]}}
 */
export function creationBudget(system, { ancestryBoost = null, hindrances = 0, talents = 0, hasAncestry = false } = {}) {
  const errors = [];
  const warnings = [];

  // Attributes: the ancestry boost is free.
  const attrRanks = Object.entries(system.attributes ?? {}).map(([k, v]) => [k, v.rank ?? 0]);
  const attrUsed = attrRanks.reduce((n, [, r]) => n + r, 0) - (ancestryBoost ? 1 : 0);
  const attrOverCap = attrRanks.filter(([, r]) => r > CREATION.maxAttributeRank).map(([k]) => k);
  const attributes = { used: attrUsed, budget: CREATION.attributePoints, overCap: attrOverCap };

  // Resistances
  const resRanks = Object.entries(system.resistances ?? {}).map(([k, v]) => [k, v.rank ?? 0]);
  const resUsed = resRanks.reduce((n, [, r]) => n + r, 0);
  const resOverCap = resRanks.filter(([, r]) => r > CREATION.maxResistanceRank).map(([k]) => k);
  const resistances = { used: resUsed, budget: CREATION.resistancePoints, overCap: resOverCap };

  // Skills + non-native languages
  const languages = system.languages ?? [];
  const native = nativeIndex(languages);
  const skillEntries = Object.entries(system.skills ?? {});
  const langEntries = languages.map((l, i) => [`language:${i}`, l.value ?? 0, i === native]);
  const skillUsed = skillEntries.reduce((n, [, v]) => n + v, 0)
    + langEntries.filter(([, , isNative]) => !isNative).reduce((n, [, v]) => n + v, 0);
  const skillOverCap = [
    ...skillEntries.filter(([, v]) => v > CREATION.maxSkill).map(([k]) => k),
    ...langEntries.filter(([, v, isNative]) => v > (isNative ? CREATION.nativeLanguageRank : CREATION.maxSkill)).map(([k]) => k)
  ];
  const skills = { used: skillUsed, budget: CREATION.skillPoints, overCap: skillOverCap };

  const hindranceInfo = { used: hindrances, max: CREATION.maxHindrances };
  const talentInfo = { used: talents, max: Math.min(hindrances, CREATION.maxHindrances) };

  // Errors: anything over a limit.
  if (attributes.used > attributes.budget) errors.push({ key: "PENTRA.Creation.Error.AttributePoints", data: attributes });
  if (attrOverCap.length) errors.push({ key: "PENTRA.Creation.Error.AttributeCap", data: { keys: attrOverCap } });
  if (resistances.used > resistances.budget) errors.push({ key: "PENTRA.Creation.Error.ResistancePoints", data: resistances });
  if (resOverCap.length) errors.push({ key: "PENTRA.Creation.Error.ResistanceCap", data: { keys: resOverCap } });
  if (skills.used > skills.budget) errors.push({ key: "PENTRA.Creation.Error.SkillPoints", data: skills });
  if (skillOverCap.length) errors.push({ key: "PENTRA.Creation.Error.SkillCap", data: { keys: skillOverCap } });
  if (hindrances > CREATION.maxHindrances) errors.push({ key: "PENTRA.Creation.Error.Hindrances", data: hindranceInfo });
  if (talents > talentInfo.max) errors.push({ key: "PENTRA.Creation.Error.Talents", data: talentInfo });

  // Warnings: points left on the table.
  if (!hasAncestry) warnings.push({ key: "PENTRA.Creation.Warn.NoAncestry" });
  if (attributes.used < attributes.budget) warnings.push({ key: "PENTRA.Creation.Warn.AttributePoints", data: { left: attributes.budget - attributes.used } });
  if (resistances.used < resistances.budget) warnings.push({ key: "PENTRA.Creation.Warn.ResistancePoints", data: { left: resistances.budget - resistances.used } });
  if (skills.used < skills.budget) warnings.push({ key: "PENTRA.Creation.Warn.SkillPoints", data: { left: skills.budget - skills.used } });

  return { attributes, resistances, skills, hindrances: hindranceInfo, talents: talentInfo, errors, warnings };
}

/**
 * During creation: which limit does a proposed change break? Only increases are judged, so a character
 * that is already over budget can always be brought back down.
 * @returns {{key:string, data?:object}[]}  Empty when the change is allowed.
 */
export function creationViolations(prev, next, ctx) {
  const before = creationBudget(prev, ctx);
  const after = creationBudget(next, ctx);
  const out = [];
  const raised = (group, key) => (next[group]?.[key]?.rank ?? 0) > (prev[group]?.[key]?.rank ?? 0);

  // Attributes
  const attrUp = Object.keys(next.attributes ?? {}).filter(k => raised("attributes", k));
  if (attrUp.some(k => after.attributes.overCap.includes(k))) out.push({ key: "PENTRA.Creation.Error.AttributeCap", data: { keys: attrUp } });
  if (attrUp.length && after.attributes.used > after.attributes.budget) out.push({ key: "PENTRA.Creation.Error.AttributePoints", data: after.attributes });

  // Resistances
  const resUp = Object.keys(next.resistances ?? {}).filter(k => raised("resistances", k));
  if (resUp.some(k => after.resistances.overCap.includes(k))) out.push({ key: "PENTRA.Creation.Error.ResistanceCap", data: { keys: resUp } });
  if (resUp.length && after.resistances.used > after.resistances.budget) out.push({ key: "PENTRA.Creation.Error.ResistancePoints", data: after.resistances });

  // Skills and languages
  const skillUp = Object.keys(next.skills ?? {}).filter(k => (next.skills[k] ?? 0) > (prev.skills?.[k] ?? 0));
  const newCaps = after.skills.overCap.filter(k => !before.skills.overCap.includes(k) || skillUp.includes(k));
  if (newCaps.length) out.push({ key: "PENTRA.Creation.Error.SkillCap", data: { keys: newCaps } });
  if (after.skills.used > after.skills.budget && after.skills.used > before.skills.used) {
    out.push({ key: "PENTRA.Creation.Error.SkillPoints", data: after.skills });
  }
  return out;
}

/**
 * After creation: does a change raise any attribute, resistance, skill, or language?
 * (Those may only go up by spending Karma.)
 */
export function raisesStats(prev, next) {
  for (const group of ["attributes", "resistances"]) {
    for (const [k, v] of Object.entries(next[group] ?? {})) {
      if ((v?.rank ?? 0) > (prev[group]?.[k]?.rank ?? 0)) return true;
    }
  }
  for (const [k, v] of Object.entries(next.skills ?? {})) {
    if ((v ?? 0) > (prev.skills?.[k] ?? 0)) return true;
  }
  const langTotal = langs => (langs ?? []).reduce((n, l) => n + (l.value ?? 0), 0);
  return langTotal(next.languages) > langTotal(prev.languages);
}
