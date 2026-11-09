# Pentra: Five-Dice Engine — Core (Foundry VTT v14)

A Foundry VTT system for **Pentra: Five-Dice Engine**, implementing the Core Rules v0.5.

## Install for development

Symlink this folder into your Foundry data directory so the folder name matches the system id:

```sh
ln -s "$(pwd)" "$HOME/Library/Application Support/FoundryVTT/Data/systems/pentra-core-foundry-vtt"
```

Then create a world using **Pentra: Five-Dice Engine Core**.

```sh
npm install          # dev tooling (Foundry CLI for compendiums)
npm test             # rules math + derived data tests (plain Node, no Foundry needed)
npm run build:packs  # compile src/packs/*.json -> packs/ (close Foundry first)
npm run unpack       # pull compendium edits made in Foundry back into src/packs/
```

## What's implemented

| Rule | How it works in Foundry |
| --- | --- |
| **Attributes & Resistances** (d12+0 … d4+8) | Stored as a rank 0–4, so die + bonus always totals 12. |
| **Checks** | Click any attribute, skill, resistance or language. Rolls `die + bonus + skill + mods` vs TN 9 (world setting). Shift-click skips the dialog. |
| **Advantage / Disadvantage** | ±d6. They cancel one-for-one and never stack. |
| **Edge** | Gained automatically when any die shows its minimum or maximum (cap 6). Spend 2 in the roll dialog for advantage, or use **Support** (1 Edge, d6 for an ally). The ↻ button resets Edge to its starting value for a new session. |
| **Hindrances / Talents** | Items that shift one trait (die steps or points). Maximums are derived; current pools (Health, Edge, Death/Resource Die) shift when the item is added or removed. |
| **Ancestry** | Adding one raises its boosted attribute a rank (Human → Charm). |
| **Karma** | Turn on **Advance** on the Skills tab to see the cost buttons. Costs follow the rulebook (attribute: 2× next bonus; skill: next rank; talent: 10×owned+10; hindrance buy-off: 25). |
| **Attacks** | Rolled against the targeted token's Evasion, with hit location, cover, lighting, aim and push modifiers. Wounds use odd/even/every increments; heavy weapons deal double. Unarmed uses the Martial Arts table. |
| **Damage** | The chat card's **Apply** button subtracts the AR at the hit location, reduces Health, applies Shaken (and Head Wound on head hits), and makes one collective Durability usage check for the worn armor. At 0 Health, PCs become Unconscious and NPCs are marked defeated. |
| **Initiative** | Each combatant rolls their Initiative Die. A 1 drops the die and a max raises it for the rest of that combat. Everyone re-rolls each round (world setting). The tracker shows the die and the action count (1 per 6 points). Ties go to PCs. |
| **Usage dice** | Resource Die purchases (equal: 1–2, lower: 1, ×multiplier), selling, lifestyles, kit checks, Reloading Kit restock (1–2 +1 per 5 rounds fired), and kit refresh. |
| **Armor** | Coverage (A/L/T/H), Evasion penalty, an extra −1 for three stacked pieces, heavy armor (×2 AR), per-piece durability die, collective repair of all worn armor with one Crafting check (Technical Kit), and salvaging an identical suit to fix broken pieces. |
| **Death moves** | **Collapse & Risk a Scar** (Death Die vs rounds down) and **Blaze of Glory** (automatic 12 + skill, double wounds). |
| **Vehicles** | Actors with their own sheet and token. Drag one from the Vehicles compendium onto a character to buy it (or the GM gifts it). Drag characters or NPCs onto the vehicle sheet to make them the driver or passengers. The driver rolls the vehicle's skill (land: Driving, sea: Boating, air: Piloting, mount: Riding) plus Handling to **Maneuver**, **Push** or **Collide**. Mounted weapons are fired by a crew member at −1, and anyone aboard firing a ranged weapon takes the same −1. Target a vehicle's token to attack it: its AR covers the whole vehicle, and its Durability Die degrades like armor. **Repair** is a Crafting check with a Technical Kit and restores full Health. Players can mark damage on a vehicle but can't raise its Health by hand. **Modifications** come from the Vehicle Modifications compendium. Drop one on the vehicle to install it: it checks the rulebook limits, raises the cost a multiplier level (a Speed Class reduction lowers it two), stops at d12x6, and costs the owner d6 R.D. if the vehicle is already bought. Type, cost and stats are locked for players; the GM edits the base model and removes modifications. |
| **Attack modifiers** | The roll dialog adds range band (measured from your token to the target), firing in melee, allies and extra foes in melee, size difference (from the actors' sizes), surprise, smoke or fog, and drunk or drugged. **Run** on the Combat tab is −2 to everything until the end of your turn. Restrained halves Evasion and gives −2 with two-handed weapons. |
| **Movement** | Rulers label distances with their range band and color a token's drag green (move, up to Close), orange (run, up to Far, −2) or red (too far). In a running combat, moving past Close switches on Running (−2) automatically, and a player's token can't move more than Far in a turn (Close with a Leg Wound) A Restrained character's player can't move their token at all, in or out of combat; the GM can always move tokens. |
| **Hit locations** | Head: Head Wound (−2 until healed). Arm: Reflex check or drop what you're holding. Leg: Fortitude check or Leg Wound (one range band less movement until fully healed). |
| **Lingering damage** | At the end of each turn, Burning deals 1 wound. Poisoned rolls Fortitude: a success ends the poison, a failure deals 1 wound. Both ignore armor. |
| **Scars** | A failed Collapse & Risk a Scar roll lets the player choose an attribute to lower one die (from a chat button or the sheet). With nothing left to lower, the character dies. |
| **Projects** | On the Downtime tab: start any number of projects and name them; the GM sets each one's value (die × multiplier) and whether there are blueprints. Each day of work is a Research check (skipped with blueprints), then Crafting; on a success the progress die rolls and grows on its top two faces until it reaches the target (any multiplier adds a die size; d12 with a multiplier needs a 12 to reach the d14). |
| **Disease** | The GM drops a Disease item on a character (exposure): Fortitude at once, and again on every Camp rest or Day of rest; a success throws it off. While sick, the character is Diseased and the disease hampers one mechanic: −2 to all checks, −2 to one attribute's checks, or one trait (−1 die size, or −2 for numbers). |
| **Counters** | A **Counters** button at the top of the Actors sidebar. The GM adds any number of counters (1–12), each with a name, the condition that ticks it, public or GM-only, and whether it repeats. − / + tick it; every change goes to chat (whispered to the GM for private ones), and reaching 0 announces that it triggers. Players see public counters read-only. |
| **Battles** | The **Battles** tab of the Counters window. The GM sets each army's troops, leader (any character or NPC), fortifications and fearless (+2 each); starting gives the larger force an Army Strength Counter of 10 and the other its proportion. Each round both leaders roll Leadership (success: deal 1 or block 1), then a morale check at −1 per counter lost; a failure breaks the army (−2), one escape round is fought, and the winner is the side that didn't run (or the stronger, if both ran). 0 strength wipes an army out. Edge support goes in the roll's Modifier box; ✓ / ✗ record a result without a leader. Private until made public. |
| **Chase** | A **Chase** button at the top of the Actors sidebar (everyone) opens the vehicle range band chart. The GM drags vehicle actors onto a lane; the slowest is the anchor (crown to change). Each round rolls every vehicle's initiative die (1 drops it, max raises it) and gives it its speed class in movement. Owners **Move** (1 band along the facing; the anchor moving shifts everyone else), **Turn** (1 movement) or **Push** (once a round: 1 movement and a handling check, 2 bands on a success, none on a failure). Reaching Escape escapes the anchor; flying vehicles that didn't move are flagged. Range between vehicles is the bands between them: personal weapons and bombs need Drive-by, machine guns reach Very Close, rockets/torpedoes Close, missiles Far. Weapons fired from a pushed vehicle are −2, and rams need Impact / Drive-by. The crosshair picks a chase target for attacks and rams when vehicles aren't on the map. Several chases can run at once: drag a chip onto another chase, or split it off. Vehicles are hidden from players until the GM shows them. |
| **Underwater combat** | A water button in the Combat Tracker header (GM) flags the whole encounter as underwater (players see a banner). Weapon preferred ranges drop a band (melee stays melee); each weapon's **Underwater** setting marks swinging weapons (−2: swords, clubs, axes, staves), torpedoes (full range) and fire-based weapons (missiles: blocked). Swimming moves Very Close (Close as a run) on the ruler and is enforced. Without air (a SCUBA kit with usage left), after 5 rounds a breath usage check at the end of each turn from d6; at 0 the character is **Drowning** (−2 to everything but Athletics) and rolls the Death Die as a usage check each turn until it runs out and they die. NPCs use a d6 drowning die. **Surface** on the Combat tab resets breath; turning underwater off clears it for everyone. |
| **Clocks** (GM) | A **Clocks** button at the top of the Actors sidebar. Facility Raid: +10 minutes, and every 30 minutes the danger die (d4–d12). Travel: +1 hour with the mode's die (walk/horse d6, drive d8, boat d10, fly d12), and on an encounter the d4 type table. Camp: +4 hours or a full night with the setup's die (d6/d8/d10). A 1–2 means an encounter; results are whispered to the GM. |
| **Status effects** | Shaken, Burning, Poisoned, Diseased, Restrained, Head Wound, Unconscious, Prone, Dead. Shaken and Head Wound apply −2 automatically. |

## Compendiums

Every list in the rulebook ships as a compendium: Ancestries, Hindrances, Talents, Diseases (one per attribute, plus Death Die, Edge, Evasion, Health and Initiative Die), Armor, Weapons (melee, ranged and vehicle), Field Kits, Vehicles, and the Example NPCs (Security Guard, Military Soldier, Wild Dog).

## Rules interpretations

These are places where the rulebook is ambiguous or contradicts itself. Each one is easy to change.

- **Broken armor** gives no protection (main text). The quick reference says "half".
- **Layered armor**: the worn pieces covering the hit location make one collective Durability check, rolling the weakest piece's die. On a failure, every piece drops a size together.
- **Selling**: below your Resource Die, it rises on the top *multiplier* faces. At or above it, it rises on the top two faces and repeats while the sale value still exceeds the die.
- **Non-combat TN** is 9 (changelog v0.2). The quick reference still says 12.
- **Grid**: 1 square = 1 yard (Very Close = 3 squares, Close = 6, Far = 12).
- **Range bands**: a weapon fires at most one band farther than preferred (−1), and up to three bands closer (−1, −2, −4); anything else is blocked.
- **Burning and poison** deal their wound straight to Health (no armor, no durability check), and still cause Shaken.
- **Leg Wound** lasts until the character is back to full Health, like a head wound.
- **Collisions** deal wounds equal to the successes past the target's Evasion (every), with no base wound, so a roll exactly equal to Evasion is a hit for 0. Crew take half, rounded down, and their armor applies.
- **Vehicle repair** uses Crafting, the general repair skill. It restores full Health and resets the Durability Die to its maximum.
- **Vehicle initiative** uses the driver's Initiative Die (d6 with no driver).
- **Chase weapon reach**: a weapon fires at its chase band or anything closer (machine guns can fire at Drive-by), never farther. Range between two vehicles is the number of bands between them, anchor or not.
- **Flamethrower** (core, ahead of the PDF): Very Close, Shooting, 2 Wounds (even), d8x2 R.D. Its **Burning** trait sets the target on fire when the damage is applied; it doesn't work underwater.
- **Chase push** is once a round, and the −2 to hit lasts for the rest of that round whether the check succeeded or not.

## Project layout

```
system.json            manifest (documentTypes, packs)
modules/main.js        init: config, data models, sheets, settings, hooks
modules/config.js      every rulebook table and constant
modules/rules.js       pure rules math (unit tested)
modules/models.js      TypeDataModels for actors and items
modules/documents.js   Actor/Item/Combat/Combatant classes
modules/rolls.js       checks, attacks, damage, usage dice, purchases
modules/vehicles.js    vehicle crew, driving, collisions, buying/selling (GM relay)
modules/sheets/        ApplicationV2 actor and item sheets
templates/             Handlebars templates
src/packs/             compendium source JSON (source of truth)
packs/                 compiled LevelDB compendiums
tests/                 node:test suites
```
