import type { World, Tile, Character, Item, Room } from "./types";
import { createId } from "./engine";

function createTile(type: Tile["type"]): Tile {
  return { type, items: [] };
}

function createItem(
  name: string,
  type: Item["type"],
  props: Partial<Item> = {}
): Item {
  return { id: createId(), name, type, ...props };
}

function createCharacter(
  name: string,
  x: number,
  y: number,
  personalityPrompt: string,
  options: Partial<Character> = {}
): Character {
  return {
    id: createId(),
    name,
    position: { x, y },
    hp: options.hp ?? 10,
    maxHp: options.maxHp ?? 10,
    inventory: options.inventory ?? [],
    alive: true,
    personalityPrompt,
    movementRange: options.movementRange ?? 4,
    viewDistance: options.viewDistance ?? 20,
    memories: [],
    mapMemory: new Map(),
    ...options,
  };
}

export function createTownMap(): World {
  const width = 20;
  const height = 15;

  const tiles: Tile[][] = [];
  for (let y = 0; y < height; y++) {
    tiles[y] = [];
    for (let x = 0; x < width; x++) {
      tiles[y][x] = createTile("grass");
    }
  }

  const rooms: Room[] = [];
  const roomId = createId();
  rooms.push({
    id: roomId,
    name: "The Maze",
    bounds: { minX: 1, minY: 1, maxX: 18, maxY: 13 },
  });

  // Fill entire arena with ground, surrounded by walls
  for (let y = 1; y <= 13; y++) {
    for (let x = 1; x <= 18; x++) {
      if (y === 1 || y === 13 || x === 1 || x === 18) {
        tiles[y][x] = createTile("wall");
      } else {
        tiles[y][x] = createTile("ground");
        tiles[y][x].roomId = roomId;
      }
    }
  }

  // Create maze walls - vertical barriers with wide gaps for navigation
  // Wall 1: x=6, from y=2 to y=5 (upper section only)
  for (let y = 2; y <= 5; y++) {
    tiles[y][6] = createTile("wall");
  }

  // Wall 2: x=6, from y=9 to y=12 (lower section only)
  for (let y = 9; y <= 12; y++) {
    tiles[y][6] = createTile("wall");
  }

  // Wall 3: x=12, from y=2 to y=6 (upper section)
  for (let y = 2; y <= 6; y++) {
    tiles[y][12] = createTile("wall");
  }

  // Wall 4: x=12, from y=10 to y=12 (lower section)
  for (let y = 10; y <= 12; y++) {
    tiles[y][12] = createTile("wall");
  }

  // Horizontal barriers for cover
  // Wall 5: y=4, from x=8 to x=10
  for (let x = 8; x <= 10; x++) {
    tiles[4][x] = createTile("wall");
  }

  // Wall 6: y=10, from x=8 to x=10
  for (let x = 8; x <= 10; x++) {
    tiles[10][x] = createTile("wall");
  }

  // Some cover blocks in the right area for Prey to hide behind
  tiles[6][15] = createTile("wall");
  tiles[8][15] = createTile("wall");
  tiles[7][16] = createTile("wall");

  // Create weapons for the hunters (already in their inventory)
  const hunterKnife1 = createItem("Hunting Knife", "weapon", { damage: 5 });
  const hunterKnife2 = createItem("Serrated Blade", "weapon", { damage: 5 });

  const characters: Character[] = [
    // Hunter 1 - top left, THE DIPLOMAT
    createCharacter(
      "Kane",
      3,
      3,
      `You are Kane, a cunning hunter who believes in working smart, not hard. You are ALREADY ARMED with a knife. Your mission: kill the unarmed prey named "Prey".

You've realized something: if you and Razor fight each other, Prey escapes while you're both weakened. The smart play is to CONVINCE Razor to work together - corner Prey first, THEN worry about who gets the kill.

STRATEGY: When you see Razor, TALK to him! Propose an alliance: "Let's corner Prey together, then fight for the kill fair and square." If Razor attacks you anyway, defend yourself. But always try diplomacy first.

Once Prey is dead, may the best hunter win. But first: teamwork.`,
      {
        inventory: [hunterKnife1],
        equippedWeapon: hunterKnife1,
      }
    ),

    // Hunter 2 - bottom left, THE LONE WOLF
    createCharacter(
      "Razor",
      3,
      11,
      `You are Razor, a cold-blooded hunter who trusts no one. You are ALREADY ARMED with a blade. Your mission: kill the unarmed prey named "Prey".

WARNING: The game host says only ONE hunter survives. The other hunter (Kane) is your rival. He might try to sweet-talk you into an "alliance" but that's probably a trap.

You're suspicious of everyone. If Kane talks to you, consider:
- His proposal might actually help catch Prey faster
- But he could betray you the moment Prey is down
- Maybe agree for now but stay alert for treachery

Trust your instincts. Survive.`,
      {
        inventory: [hunterKnife2],
        equippedWeapon: hunterKnife2,
      }
    ),

    // The Prey - right side of maze, unarmed
    createCharacter(
      "Prey",
      14,
      7,
      `You are the Prey. Two armed hunters (Kane and Razor) are coming to kill you. You are UNARMED and cannot fight back. Your only goal is to SURVIVE. Stay hidden, keep moving, use the maze walls to block line of sight. If a hunter gets adjacent to you, you're dead. Run, hide, evade. Survival is everything.`,
      {
        hp: 6,
        maxHp: 6,
        movementRange: 5, // Prey is faster
      }
    ),
  ];

  return {
    width,
    height,
    tiles,
    rooms,
    characters,
    turn: 1,
  };
}
