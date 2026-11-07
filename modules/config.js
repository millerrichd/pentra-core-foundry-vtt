/**
 * Static rules data for Pentra: Five-Dice Engine (Core v0.4).
 * Everything the rest of the system needs to know about the rulebook's tables lives here.
 */
export const PENTRA = {};

/** Default target number for non-combat checks (rulebook v0.2 changed this from 12 to 9). */
PENTRA.defaultTN = 9;

/** Maximum Edge a character can hold in a session. */
PENTRA.maxEdge = 6;

/**
 * Attribute / Resistance ladder. The stored value is a rank 0-4; the die and bonus always sum to 12.
 * d12+0 -> d10+2 -> d8+4 -> d6+6 -> d4+8
 */
PENTRA.attributeRanks = [
  { die: 12, bonus: 0 },
  { die: 10, bonus: 2 },
  { die: 8, bonus: 4 },
  { die: 6, bonus: 6 },
  { die: 4, bonus: 8 }
];
PENTRA.maxAttributeRank = 4;
/** No attribute may start higher than d8+4 at character creation. */
PENTRA.maxStartingAttributeRank = 2;

/** Usage-die ladder (0 means depleted / broken). */
PENTRA.usageDice = [0, 4, 6, 8, 10, 12];

PENTRA.attributes = {
  charm: "PENTRA.Attribute.charm",
  finesse: "PENTRA.Attribute.finesse",
  intellect: "PENTRA.Attribute.intellect",
  knowledge: "PENTRA.Attribute.knowledge",
  might: "PENTRA.Attribute.might"
};

PENTRA.resistances = {
  fortitude: "PENTRA.Resistance.fortitude",
  mind: "PENTRA.Resistance.mind",
  reflex: "PENTRA.Resistance.reflex"
};

/** Skills keyed by id, each mapped to its governing attribute. Languages are handled separately. */
PENTRA.skills = {
  // Charm
  animal_handling: { attribute: "charm", label: "PENTRA.Skill.animal_handling" },
  deception: { attribute: "charm", label: "PENTRA.Skill.deception" },
  insight: { attribute: "charm", label: "PENTRA.Skill.insight" },
  intimidation: { attribute: "charm", label: "PENTRA.Skill.intimidation" },
  leadership: { attribute: "charm", label: "PENTRA.Skill.leadership" },
  performance: { attribute: "charm", label: "PENTRA.Skill.performance" },
  persuasion: { attribute: "charm", label: "PENTRA.Skill.persuasion" },
  // Finesse
  acrobatics: { attribute: "finesse", label: "PENTRA.Skill.acrobatics" },
  boating: { attribute: "finesse", label: "PENTRA.Skill.boating" },
  driving: { attribute: "finesse", label: "PENTRA.Skill.driving" },
  heavy_weapons: { attribute: "finesse", label: "PENTRA.Skill.heavy_weapons" },
  locks_traps: { attribute: "finesse", label: "PENTRA.Skill.locks_traps" },
  piloting: { attribute: "finesse", label: "PENTRA.Skill.piloting" },
  riding: { attribute: "finesse", label: "PENTRA.Skill.riding" },
  shooting: { attribute: "finesse", label: "PENTRA.Skill.shooting" },
  sleight_of_hand: { attribute: "finesse", label: "PENTRA.Skill.sleight_of_hand" },
  sneaking: { attribute: "finesse", label: "PENTRA.Skill.sneaking" },
  // Intellect
  assess_enemy: { attribute: "intellect", label: "PENTRA.Skill.assess_enemy" },
  awareness: { attribute: "intellect", label: "PENTRA.Skill.awareness" },
  crafting: { attribute: "intellect", label: "PENTRA.Skill.crafting" },
  disguise: { attribute: "intellect", label: "PENTRA.Skill.disguise" },
  electronics: { attribute: "intellect", label: "PENTRA.Skill.electronics" },
  etiquette: { attribute: "intellect", label: "PENTRA.Skill.etiquette" },
  evaluate: { attribute: "intellect", label: "PENTRA.Skill.evaluate" },
  hacking: { attribute: "intellect", label: "PENTRA.Skill.hacking" },
  mechanics: { attribute: "intellect", label: "PENTRA.Skill.mechanics" },
  medicine: { attribute: "intellect", label: "PENTRA.Skill.medicine" },
  survival: { attribute: "intellect", label: "PENTRA.Skill.survival" },
  // Knowledge
  academics: { attribute: "knowledge", label: "PENTRA.Skill.academics" },
  general_knowledge: { attribute: "knowledge", label: "PENTRA.Skill.general_knowledge" },
  research: { attribute: "knowledge", label: "PENTRA.Skill.research" },
  science: { attribute: "knowledge", label: "PENTRA.Skill.science" },
  streetwise: { attribute: "knowledge", label: "PENTRA.Skill.streetwise" },
  // Might
  athletics: { attribute: "might", label: "PENTRA.Skill.athletics" },
  martial_arts: { attribute: "might", label: "PENTRA.Skill.martial_arts" },
  melee_weapons: { attribute: "might", label: "PENTRA.Skill.melee_weapons" },
  thrown: { attribute: "might", label: "PENTRA.Skill.thrown" }
};
PENTRA.maxSkill = 6;
PENTRA.startingSkillPoints = 30;
PENTRA.maxStartingSkill = 3;
PENTRA.nativeLanguageRank = 4;

/** Skills that can be used to make attacks. */
PENTRA.attackSkills = ["melee_weapons", "martial_arts", "shooting", "thrown", "heavy_weapons"];

/** Skills used for the Socialize downtime action. */
PENTRA.socialSkills = ["deception", "intimidation", "leadership", "persuasion"];

/**
 * Traits that hindrances and talents can modify. `type: "die"` deltas are die steps, `"number"` deltas are points.
 * `base` is the rulebook default.
 */
PENTRA.traits = {
  deathDie: { label: "PENTRA.Trait.deathDie", type: "die", base: 12 },
  durabilityDie: { label: "PENTRA.Trait.durabilityDie", type: "die", base: 8 },
  edge: { label: "PENTRA.Trait.edge", type: "number", base: 2 },
  evasion: { label: "PENTRA.Trait.evasion", type: "number", base: 9 },
  health: { label: "PENTRA.Trait.health", type: "number", base: 6 },
  initiativeDie: { label: "PENTRA.Trait.initiativeDie", type: "die", base: 6 },
  resourceDie: { label: "PENTRA.Trait.resourceDie", type: "die", base: 6 },
  drainDie: { label: "PENTRA.Trait.drainDie", type: "die", base: 8 }
};

/** Weapon damage increments. */
PENTRA.increments = {
  odd: "PENTRA.Increment.odd",
  even: "PENTRA.Increment.even",
  every: "PENTRA.Increment.every"
};

/** Personal range bands, in order. */
PENTRA.rangeBands = {
  melee: "PENTRA.Range.melee",
  veryClose: "PENTRA.Range.veryClose",
  close: "PENTRA.Range.close",
  far: "PENTRA.Range.far",
  veryFar: "PENTRA.Range.veryFar",
  outOfRange: "PENTRA.Range.outOfRange"
};

PENTRA.weaponCategories = {
  melee: "PENTRA.WeaponCategory.melee",
  ranged: "PENTRA.WeaponCategory.ranged",
  vehicle: "PENTRA.WeaponCategory.vehicle"
};

PENTRA.vehicleCategories = {
  air: "PENTRA.VehicleCategory.air",
  land: "PENTRA.VehicleCategory.land",
  sea: "PENTRA.VehicleCategory.sea"
};

/** Item sizes and how many "normal" carry slots each consumes. */
PENTRA.sizes = {
  tiny: { label: "PENTRA.Size.tiny", slots: 0.25 },
  small: { label: "PENTRA.Size.small", slots: 0.5 },
  normal: { label: "PENTRA.Size.normal", slots: 1 },
  large: { label: "PENTRA.Size.large", slots: 2 }
};
PENTRA.carrySlots = 6;

/** Creature / vehicle size classes. */
PENTRA.creatureSizes = {
  tiny: "PENTRA.CreatureSize.tiny",
  small: "PENTRA.CreatureSize.small",
  medium: "PENTRA.CreatureSize.medium",
  large: "PENTRA.CreatureSize.large",
  huge: "PENTRA.CreatureSize.huge",
  massive: "PENTRA.CreatureSize.massive"
};

/** Hit locations: attack modifier, and the letter used by armor coverage codes (ALTH). */
PENTRA.hitLocations = {
  torso: { label: "PENTRA.Location.torso", modifier: 0, code: "T" },
  arms: { label: "PENTRA.Location.arms", modifier: -1, code: "A" },
  legs: { label: "PENTRA.Location.legs", modifier: -2, code: "L" },
  head: { label: "PENTRA.Location.head", modifier: -4, code: "H" }
};

/** Martial Arts unarmed damage by skill rank (index = rank). */
PENTRA.martialArts = [
  { wounds: 1, increment: "odd" },
  { wounds: 1, increment: "odd" },
  { wounds: 1, increment: "even" },
  { wounds: 1, increment: "even" },
  { wounds: 2, increment: "odd" },
  { wounds: 2, increment: "even" },
  { wounds: 2, increment: "every" }
];

/** Wounds healed by a successful Medicine check, by Medicine rank (index = rank). */
PENTRA.medicineHealing = [1, 1, 1, 1, 2, 2, 3];

/** Downtime lifestyles and their Resource Die cost. */
PENTRA.lifestyles = {
  street: { label: "PENTRA.Lifestyle.street", die: 0 },
  low: { label: "PENTRA.Lifestyle.low", die: 4 },
  middle: { label: "PENTRA.Lifestyle.middle", die: 6 },
  high: { label: "PENTRA.Lifestyle.high", die: 8 },
  luxury: { label: "PENTRA.Lifestyle.luxury", die: 10 },
  extremeLuxury: { label: "PENTRA.Lifestyle.extremeLuxury", die: 12 }
};

/** Common attack modifiers offered as quick picks in the roll dialog. */
PENTRA.situationalModifiers = {
  cover: {
    label: "PENTRA.Modifier.cover",
    options: {
      0: "PENTRA.Modifier.none",
      "-1": "PENTRA.Modifier.partialSoft",
      "-2": "PENTRA.Modifier.partialHard",
      "-3": "PENTRA.Modifier.fullSoft",
      "-4": "PENTRA.Modifier.fullHard"
    }
  },
  light: {
    label: "PENTRA.Modifier.light",
    options: {
      0: "PENTRA.Modifier.none",
      "-1": "PENTRA.Modifier.dim",
      "-2": "PENTRA.Modifier.darkness",
      "-3": "PENTRA.Modifier.blind"
    }
  }
};

/** Status effects from the rulebook. */
PENTRA.statusEffects = [
  { id: "shaken", name: "PENTRA.Status.shaken", img: "icons/svg/daze.svg" },
  { id: "burning", name: "PENTRA.Status.burning", img: "icons/svg/fire.svg" },
  { id: "poisoned", name: "PENTRA.Status.poisoned", img: "icons/svg/poison.svg" },
  { id: "diseased", name: "PENTRA.Status.diseased", img: "icons/svg/biohazard.svg" },
  { id: "restrained", name: "PENTRA.Status.restrained", img: "icons/svg/net.svg" },
  { id: "headWound", name: "PENTRA.Status.headWound", img: "icons/svg/blood.svg" },
  { id: "unconscious", name: "PENTRA.Status.unconscious", img: "icons/svg/unconscious.svg" },
  { id: "prone", name: "PENTRA.Status.prone", img: "icons/svg/falling.svg" },
  { id: "dead", name: "PENTRA.Status.dead", img: "icons/svg/skull.svg" }
];

/** Statuses that impose a flat -2 on all checks. */
PENTRA.penaltyStatuses = { shaken: -2, headWound: -2 };
