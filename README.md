# AILand 🏰

A turn-based 2D grid game where AI agents control NPCs in a small town. Each character has their own personality, goals, and memories. They can only act on information they've personally witnessed or been told by others.

## Features

- **Grid-based world** with buildings, paths, and items
- **AI-driven characters** powered by GPT-4o-mini (or any OpenAI-compatible API)
- **Imperfect information** - characters only know what they've seen or heard
- **Memory system** - characters remember events and can share information
- **Turn-based gameplay** - step through or auto-play
- **Combat system** with dice-based damage rolls
- **Inventory & equipment** - weapons, clothing, and containers

## Quick Start

```bash
npm install
npm run dev
```

Then open http://localhost:3000 in your browser.

## API Key

The game requires an OpenAI API key to enable AI-driven character decisions. You can:

1. **Enter your key** in the modal when the game starts (stored in localStorage)
2. **Skip (Demo Mode)** - characters will wait each turn (useful for testing)

## The Town

The map features:
- **House 1** (top-left) - Martha's home, contains a kitchen cupboard with a knife
- **House 2** (bottom-left) - Viktor's home, contains a wardrobe and toolbox
- **Tavern** (top-right) - Elena's establishment, has a bar cabinet and storage crate
- **Shop** (bottom-right) - Marcus's store, has a shop counter with items for sale

## The Characters

| Character | Location | Personality |
|-----------|----------|-------------|
| **Martha** | House 1 | Kind elderly widow, loves gossip, avoids conflict |
| **Viktor** | House 2 | Gruff retired soldier, protective, will intervene in violence |
| **Elena** | Tavern | Friendly tavern keeper, neutral, gathers secrets |
| **Marcus** | Shop | Shrewd merchant, will defend his shop |
| **Shadow** | Town center | Mysterious drifter with violent tendencies |

## How It Works

Each turn, the current character:
1. Receives a prompt with their personality, current status, visible surroundings, and memories
2. The AI decides what action to take
3. The action is validated and executed
4. Events are logged and memories are created for witnesses

### Actions

- **MOVE x y** - Move up to 4 tiles
- **LOOK** - Update memories with visible surroundings
- **SEARCH container_name** - Search a container to reveal contents
- **PICKUP item_name** - Pick up an item
- **DROP item_name** - Drop an item
- **EQUIP item_name** - Equip a weapon or clothing
- **ATTACK character_name** - Attack an adjacent character
- **TALK character_name "message"** - Share information with nearby character
- **WAIT** - Do nothing

### Combat

- Attacks require being adjacent (1 tile away)
- Roll d20: 1 = critical miss, 20 = critical hit (2x damage), 8+ = hit
- Damage is based on equipped weapon (fists = 1 damage)
- Characters die when HP reaches 0

### Memory & Knowledge

Characters have imperfect information:
- They can only see tiles within line of sight (walls block vision)
- They remember what they've seen and when
- They can share information via the TALK action
- Other characters' stories become memories too

## Architecture

```
src/
├── types.ts        # Type definitions
├── engine.ts       # Game logic (actions, visibility, combat)
├── renderer.ts     # Canvas-based rendering
├── agent.ts        # AI agent integration
├── world-builder.ts # Town map and character setup
└── main.ts         # Game loop and UI
```

## Future Ideas

- [ ] More complex map generation
- [ ] Additional action types (hide, run, investigate)
- [ ] Factions and relationships
- [ ] Day/night cycle
- [ ] More item types (keys, food, tools)
- [ ] Character lying (deception mechanics)
- [ ] Replay system
- [ ] Multiple AI models/providers




