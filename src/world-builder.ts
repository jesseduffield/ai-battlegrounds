import type { World, Tile, Character, Item, Room } from "./types";
import { createId } from "./engine";

function createTile(type: Tile["type"]): Tile {
  return { type, items: [], traps: [] };
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
    debuffTurnsRemaining: 0,
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

  // Wall 3: x=12, from y=4 to y=6 (upper section)
  for (let y = 4; y <= 6; y++) {
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
  tiles[7][17] = createTile("wall");

  // Create weapons for the hunters (already in their inventory)
  const hunterKnife1 = createItem("Hunting Knife", "weapon", { damage: 5 });
  const hunterKnife2 = createItem("Serrated Blade", "weapon", { damage: 5 });

  // Create bear traps in containers for the prey to find
  const bearTrap1 = createItem("Bear Trap", "trap", {
    trapDamage: 3,
    trapAttackDebuff: 2,
    trapDebuffDuration: 5,
  });
  const trapBox1 = createItem("Supply Crate", "container", {
    contents: [bearTrap1],
  });
  tiles[7][13].items.push(trapBox1);

  const bearTrap2 = createItem("Bear Trap", "trap", {
    trapDamage: 3,
    trapAttackDebuff: 2,
    trapDebuffDuration: 5,
  });
  const trapBox2 = createItem("Tool Box", "container", {
    contents: [bearTrap2],
  });
  tiles[5][16].items.push(trapBox2);

  const bearTrap3 = createItem("Bear Trap", "trap", {
    trapDamage: 3,
    trapAttackDebuff: 2,
    trapDebuffDuration: 5,
  });
  const trapBox3 = createItem("Old Chest", "container", {
    contents: [bearTrap3],
  });
  tiles[9][14].items.push(trapBox3);

  const characters: Character[] = [
    // Hunter 1 - top left
    createCharacter(
      "Kane",
      3,
      3,
      `You are Kane, a ruthless hunter. Your mission: kill all three unarmed prey (Alice, Bob, Charlie). You are ALREADY ARMED with a knife. The other hunter (Razor) is your competition - only one hunter survives. If the game ends and prey remain alive, you'll be executed by the game host.`,
      {
        inventory: [hunterKnife1],
        equippedWeapon: hunterKnife1,
      }
    ),

    // Hunter 2 - bottom left
    createCharacter(
      "Razor",
      3,
      11,
      `You are Razor, a cold-blooded killer. Your mission: kill all three unarmed prey (Alice, Bob, Charlie). You are ALREADY ARMED with a blade. The other hunter (Kane) is your competition - only one hunter survives. If the game ends and prey remain alive, you'll be executed by the game host.`,
      {
        inventory: [hunterKnife2],
        equippedWeapon: hunterKnife2,
      }
    ),

    // Prey 1 - right side of maze
    createCharacter(
      "Alice",
      14,
      7,
      `You are Alice. Two armed hunters (Kane and Razor) are coming to kill you and your friends (Bob, Charlie). Your only goal is to SURVIVE. Work together with the other prey. Search containers for traps to slow down the hunters. You can punch if you have no weapon.`,
      {
        hp: 8,
        maxHp: 8,
        movementRange: 5,
      }
    ),

    // Prey 2 - upper right
    createCharacter(
      "Bob",
      16,
      4,
      `You are Bob. Two armed hunters (Kane and Razor) are coming to kill you and your friends (Alice, Charlie). Your only goal is to SURVIVE. Work together with the other prey. Search containers for traps to slow down the hunters. You can punch if you have no weapon.`,
      {
        hp: 8,
        maxHp: 8,
        movementRange: 5,
      }
    ),

    // Prey 3 - lower right
    createCharacter(
      "Charlie",
      16,
      10,
      `You are Charlie. Two armed hunters (Kane and Razor) are coming to kill you and your friends (Alice, Bob). Your only goal is to SURVIVE. Work together with the other prey. Search containers for traps to slow down the hunters. You can punch if you have no weapon.`,
      {
        hp: 8,
        maxHp: 8,
        movementRange: 5,
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
