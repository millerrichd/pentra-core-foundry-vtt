const { fields } = foundry.data;

export class PentraCharacterModel extends foundry.abstract.TypeDataModel {
  static defineSchema() {
    return {
      biography: new fields.HTMLField(),
      attributes: new fields.SchemaField({
        charm: new fields.SchemaField({
          die: new fields.IntegerField({ initial: 12 }),
          bonus: new fields.IntegerField({ initial: 0 })
        }),
        finesse: new fields.SchemaField({
          die: new fields.IntegerField({ initial: 12 }),
          bonus: new fields.IntegerField({ initial: 0 })
        }),
        intellect: new fields.SchemaField({
          die: new fields.IntegerField({ initial: 12 }),
          bonus: new fields.IntegerField({ initial: 0 })
        }),
        knowledge: new fields.SchemaField({
          die: new fields.IntegerField({ initial: 12 }),
          bonus: new fields.IntegerField({ initial: 0 })
        }),
        might: new fields.SchemaField({
          die: new fields.IntegerField({ initial: 12 }),
          bonus: new fields.IntegerField({ initial: 0 })
        })
      }),
      resistances: new fields.SchemaField({
        fortitude: new fields.SchemaField({
          die: new fields.IntegerField({ initial: 12 }),
          bonus: new fields.IntegerField({ initial: 0 })
        }),
        mind: new fields.SchemaField({
          die: new fields.IntegerField({ initial: 12 }),
          bonus: new fields.IntegerField({ initial: 0 })
        }),
        reflex: new fields.SchemaField({
          die: new fields.IntegerField({ initial: 12 }),
          bonus: new fields.IntegerField({ initial: 0 })
        })
      }),
      traits: new fields.SchemaField({
        death_die: new fields.SchemaField({
          max: new fields.IntegerField({ initial: 12 }),
          current: new fields.IntegerField({ initial: 12 })
        }),
        edge: new fields.SchemaField({
          starting: new fields.IntegerField({ initial: 2 }),
          current: new fields.IntegerField({ initial: 2 })
        }),
        evasion: new fields.SchemaField({
          starting: new fields.IntegerField({ initial: 9 }),
          current: new fields.IntegerField({ initial: 9 })
        }),
        health: new fields.SchemaField({
          starting: new fields.IntegerField({ initial: 6 }),
          current: new fields.IntegerField({ initial: 6 })
        }),
        initiative_die: new fields.SchemaField({
          max: new fields.IntegerField({ initial: 6 }),
          current: new fields.IntegerField({ initial: 6 })
        }),
        karma: new fields.SchemaField({
          total_earned: new fields.IntegerField({ initial: 0 }),
          current: new fields.IntegerField({ initial: 0 })
        }),
        resource_die: new fields.SchemaField({
          starting: new fields.IntegerField({ initial: 6 }),
          current: new fields.IntegerField({ initial: 6 })
        })
      }),
      skills: new fields.SchemaField({
        charm_skills: new fields.SchemaField({
          animal_handling: new fields.IntegerField({ initial: 0 }),
          deception: new fields.IntegerField({ initial: 0 }),
          insight: new fields.IntegerField({ initial: 0 }),
          intimidation: new fields.IntegerField({ initial: 0 }),
          leadership: new fields.IntegerField({ initial: 0 }),
          performance: new fields.IntegerField({ initial: 0 }),
          persuasion: new fields.IntegerField({ initial: 0 })
        }),
        finesse_skills: new fields.SchemaField({
          acrobatics: new fields.IntegerField({ initial: 0 }),
          boating: new fields.IntegerField({ initial: 0 }),
          driving: new fields.IntegerField({ initial: 0 }),
          heavy_weapons: new fields.IntegerField({ initial: 0 }),
          locks_traps: new fields.IntegerField({ initial: 0 }),
          piloting: new fields.IntegerField({ initial: 0 }),
          riding: new fields.IntegerField({ initial: 0 }),
          shooting: new fields.IntegerField({ initial: 0 }),
          sleight_of_hand: new fields.IntegerField({ initial: 0 }),
          sneaking: new fields.IntegerField({ initial: 0 })
        }),
        intellect_skills: new fields.SchemaField({
          assess_enemy: new fields.IntegerField({ initial: 0 }),
          awareness: new fields.IntegerField({ initial: 0 }),
          crafting: new fields.IntegerField({ initial: 0 }),
          disguise: new fields.IntegerField({ initial: 0 }),
          electronics: new fields.IntegerField({ initial: 0 }),
          etiquette: new fields.IntegerField({ initial: 0 }),
          evaluate: new fields.IntegerField({ initial: 0 }),
          hacking: new fields.IntegerField({ initial: 0 }),
          mechanics: new fields.IntegerField({ initial: 0 }),
          medicine: new fields.IntegerField({ initial: 0 }),
          survival: new fields.IntegerField({ initial: 0 })
        }),
        knowledge_skills: new fields.SchemaField({
          academics: new fields.IntegerField({ initial: 0 }),
          general_knowledge: new fields.IntegerField({ initial: 0 }),
          research: new fields.IntegerField({ initial: 0 }),
          science: new fields.IntegerField({ initial: 0 }),
          streetwise: new fields.IntegerField({ initial: 0 })
        }),
        might_skills: new fields.SchemaField({
          athletics: new fields.IntegerField({ initial: 0 }),
          martial_arts: new fields.IntegerField({ initial: 0 }),
          melee_weapons: new fields.IntegerField({ initial: 0 }),
          thrown: new fields.IntegerField({ initial: 0 })
        })
      })
    };
  }
}
