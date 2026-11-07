# Pentra: Five-Dice Engine — Core (Foundry VTT v14)

A Foundry VTT system for **Pentra: Five-Dice Engine**, implementing the Core Rules v0.4.

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
| **Damage** | The chat card's **Apply** button subtracts the AR at the hit location, reduces Health, applies Shaken (and Head Wound on head hits), and rolls a Durability usage check for each armor piece. At 0 Health, PCs become Unconscious and NPCs are marked defeated. |
| **Initiative** | Each combatant rolls their Initiative Die. A 1 drops the die and a max raises it for the rest of that combat. Everyone re-rolls each round (world setting). The tracker shows the die and the action count (1 per 6 points). Ties go to PCs. |
| **Usage dice** | Resource Die purchases (equal: 1–2, lower: 1, ×multiplier), selling, lifestyles, kit checks, Reloading Kit restock (1–2 +1 per 5 rounds fired), and kit refresh. |
| **Armor** | Coverage (A/L/T/H), Evasion penalty, an extra −1 for three stacked pieces, heavy armor (×2 AR), per-piece durability die, and repair with a Crafting check. |
| **Death moves** | **Collapse & Risk a Scar** (Death Die vs rounds down) and **Blaze of Glory** (automatic 12 + skill, double wounds). |
| **Status effects** | Shaken, Burning, Poisoned, Diseased, Restrained, Head Wound, Unconscious, Prone, Dead. Shaken and Head Wound apply −2 automatically. |

## Compendiums

Every list in the rulebook ships as a compendium: Ancestries, Hindrances, Talents, Armor, Weapons (melee, ranged and vehicle), Field Kits, Vehicles, and the Example NPCs (Security Guard, Military Soldier, Wild Dog).

## Rules interpretations

These are places where the rulebook is ambiguous or contradicts itself. Each one is easy to change.

- **Broken armor** gives no protection (main text). The quick reference says "half".
- **Layered armor**: each piece covering the hit location makes its own durability check against the full wound total.
- **Selling**: below your Resource Die, it rises on the top *multiplier* faces. At or above it, it rises on the top two faces and repeats while the sale value still exceeds the die.
- **Non-combat TN** is 9 (changelog v0.2). The quick reference still says 12.
- **Grid**: 1 square = 1 yard (Very Close = 3 squares, Close = 6, Far = 12).
- **Large-scale combat, vehicle chase lanes and Counters** are left to the GM and are not automated yet.

## Project layout

```
system.json            manifest (documentTypes, packs)
modules/main.js        init: config, data models, sheets, settings, hooks
modules/config.js      every rulebook table and constant
modules/rules.js       pure rules math (unit tested)
modules/models.js      TypeDataModels for actors and items
modules/documents.js   Actor/Item/Combat/Combatant classes
modules/rolls.js       checks, attacks, damage, usage dice, purchases
modules/sheets/        ApplicationV2 actor and item sheets
templates/             Handlebars templates
src/packs/             compendium source JSON (source of truth)
packs/                 compiled LevelDB compendiums
tests/                 node:test suites
```
