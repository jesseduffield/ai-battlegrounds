import type {
  Character,
  CharacterKnowledge,
  Action,
  World,
  Position,
  BloodContract,
  GameEvent,
} from "./types";
import {
  getCharacterKnowledge,
  getReachableTiles,
  MAX_TALK_DISTANCE,
} from "./engine";
import OpenAI from "openai";

const MAX_COMPLETION_TOKENS = 10_000;

let openai: OpenAI | null = null;

export function initializeAgent(apiKey: string): void {
  openai = new OpenAI({
    apiKey,
    dangerouslyAllowBrowser: true,
  });
}

export function isAgentInitialized(): boolean {
  return openai !== null;
}

function formatPosition(pos: Position): string {
  return `(${pos.x}, ${pos.y})`;
}

function manhattanDistance(a: Position, b: Position): number {
  return Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
}

function findTargetPosition(
  targetName: string,
  knowledge: CharacterKnowledge,
  character: Character
): Position | null {
  const nameLower = targetName.toLowerCase();

  // Check visible characters
  for (const { character: c, position } of knowledge.visible.characters) {
    if (c.name.toLowerCase().includes(nameLower)) {
      return position;
    }
  }

  // Check visible items (including container contents)
  for (const { item, position } of knowledge.visible.items) {
    if (item.name.toLowerCase().includes(nameLower)) {
      return position;
    }
    if (item.type === "container" && item.contents) {
      for (const content of item.contents) {
        if (content.name.toLowerCase().includes(nameLower)) {
          return position;
        }
      }
    }
  }

  // Check map memory for remembered locations
  for (const [key, memory] of character.mapMemory) {
    const [x, y] = key.split(",").map(Number);
    if (memory.items) {
      for (const itemName of memory.items) {
        if (itemName.toLowerCase().includes(nameLower)) {
          return { x, y };
        }
      }
    }
    if (memory.characterName?.toLowerCase().includes(nameLower)) {
      return { x, y };
    }
  }

  return null;
}

function findBestTileToward(
  targetPos: Position,
  reachableTiles: Position[],
  currentPos: Position
): Position | null {
  if (reachableTiles.length === 0) return null;

  // Sort by distance to target (closest first)
  const sorted = [...reachableTiles].sort((a, b) => {
    const distA = manhattanDistance(a, targetPos);
    const distB = manhattanDistance(b, targetPos);
    return distA - distB;
  });

  // Return the reachable tile closest to the target
  // But only if it's closer than our current position
  const bestTile = sorted[0];
  const currentDist = manhattanDistance(currentPos, targetPos);
  const bestDist = manhattanDistance(bestTile, targetPos);

  if (bestDist < currentDist) {
    return bestTile;
  }

  // If we can't get closer, return the tile anyway (might need to go around)
  return bestTile;
}

function generateOmniscientMap(world: World): string {
  const lines: string[] = [];

  const header =
    "   " +
    Array.from({ length: world.width }, (_, i) => (i % 10).toString()).join("");
  lines.push(header);

  for (let y = 0; y < world.height; y++) {
    let row = y.toString().padStart(2, " ") + " ";
    for (let x = 0; x < world.width; x++) {
      const tile = world.tiles[y][x];
      const charAtTile = world.characters.find(
        (c) => c.alive && c.position.x === x && c.position.y === y
      );

      if (charAtTile) {
        row += charAtTile.name.charAt(0).toUpperCase();
      } else if (tile.type === "wall") {
        row += "#";
      } else if (tile.type === "bars") {
        row += "|";
      } else if (tile.type === "blue_door") {
        row += "D";
      } else if (tile.type === "door") {
        row += "+";
      } else if (tile.items.length > 0) {
        row += "*";
      } else {
        row += ".";
      }
    }
    lines.push(row);
  }

  return lines.join("\n");
}

function generateAsciiMap(world: World, character: Character): string {
  const lines: string[] = [];

  let minX = world.width,
    maxX = 0,
    minY = world.height,
    maxY = 0;
  for (const key of character.mapMemory.keys()) {
    const [x, y] = key.split(",").map(Number);
    minX = Math.min(minX, x);
    maxX = Math.max(maxX, x);
    minY = Math.min(minY, y);
    maxY = Math.max(maxY, y);
  }

  if (minX > maxX) {
    return "No map explored yet.";
  }

  const pad = 2;
  minX = Math.max(0, minX - pad);
  maxX = Math.min(world.width - 1, maxX + pad);
  minY = Math.max(0, minY - pad);
  maxY = Math.min(world.height - 1, maxY + pad);

  const header =
    "   " +
    Array.from({ length: maxX - minX + 1 }, (_, i) =>
      ((minX + i) % 10).toString()
    ).join("");
  lines.push(header);

  for (let y = minY; y <= maxY; y++) {
    let row = y.toString().padStart(2, " ") + " ";
    for (let x = minX; x <= maxX; x++) {
      const key = `${x},${y}`;
      const memory = character.mapMemory.get(key);

      if (x === character.position.x && y === character.position.y) {
        row += "@";
      } else if (memory) {
        if (memory.characterName && memory.characterAlive) {
          row += memory.characterName.charAt(0).toUpperCase();
        } else if (memory.type === "wall") {
          row += "#";
        } else if (memory.type === "bars") {
          row += "|";
        } else if (memory.type === "blue_door") {
          row += "D";
        } else if (memory.type === "door") {
          row += "+";
        } else if (memory.items && memory.items.length > 0) {
          row += "*";
        } else {
          row += ".";
        }
      } else {
        row += "?";
      }
    }
    lines.push(row);
  }

  return lines.join("\n");
}

function formatKnowledge(
  world: World,
  character: Character,
  knowledge: CharacterKnowledge,
  hasMoved: boolean = false
): string {
  const lines: string[] = [];

  const hasWeapon = !!knowledge.status.equippedWeapon;
  const weaponName = knowledge.status.equippedWeapon?.name;
  const weaponDamage = knowledge.status.equippedWeapon?.damage ?? 1;

  lines.push(`=== CURRENT TURN: ${world.turn} ===`);
  lines.push(``);
  lines.push(`=== YOUR STATUS ===`);
  lines.push(`Name: ${character.name}`);
  lines.push(`HP: ${knowledge.status.hp}/${knowledge.status.maxHp}`);
  lines.push(`Position: ${formatPosition(knowledge.status.position)}`);

  if (character.debuffTurnsRemaining > 0) {
    lines.push(
      `*** TRAPPED! Cannot move, attack halved! (${character.debuffTurnsRemaining} turns remaining) ***`
    );
  }

  if (hasWeapon) {
    lines.push(
      `*** YOU ARE ARMED with ${weaponName} (${weaponDamage} damage${
        character.debuffTurnsRemaining > 0 ? " - HALVED while trapped!" : ""
      }) ***`
    );
  } else {
    lines.push(`*** YOU ARE UNARMED (fists only, 1 damage) ***`);
  }

  lines.push(
    `\nInventory: ${
      knowledge.status.inventory.length > 0
        ? knowledge.status.inventory.map((i) => i.name).join(", ")
        : "(empty)"
    }`
  );

  // Check for traps in inventory
  const trapsInInventory = knowledge.status.inventory.filter(
    (i) => i.type === "trap"
  );
  if (trapsInInventory.length > 0) {
    lines.push(
      `  -> You have a trap! Use PLACE to set it where enemies will walk.`
    );
  }

  const visibleChars = knowledge.visible.characters;
  const livingEnemies = visibleChars.filter(({ character: c }) => c.alive);
  const deadEnemies = visibleChars.filter(({ character: c }) => !c.alive);

  lines.push(`\n=== ENEMIES ===`);
  if (livingEnemies.length > 0) {
    for (const { character: other, position } of livingEnemies) {
      const dist = manhattanDistance(character.position, position);
      const canAttack = dist === 1;
      const weapon = other.equippedWeapon
        ? `armed with ${other.equippedWeapon.name}`
        : "unarmed";
      const trappedStatus =
        other.debuffTurnsRemaining > 0
          ? `, TRAPPED (${other.debuffTurnsRemaining} turns, attack halved!)`
          : "";

      if (canAttack) {
        lines.push(
          `  *** ${other.name} at ${formatPosition(
            position
          )} is ADJACENT - CAN ATTACK or TALK! *** [HP: ${other.hp}/${
            other.maxHp
          }, ${weapon}${trappedStatus}]`
        );
      } else if (dist <= MAX_TALK_DISTANCE) {
        lines.push(
          `  ** ${other.name} at ${formatPosition(
            position
          )} - CAN TALK (distance: ${dist}) ** [HP: ${other.hp}/${
            other.maxHp
          }, ${weapon}${trappedStatus}]`
        );
      } else {
        lines.push(
          `  - ${other.name} at ${formatPosition(position)} [HP: ${other.hp}/${
            other.maxHp
          }, ${weapon}${trappedStatus}] - distance: ${dist} tiles`
        );
      }
    }
  } else {
    lines.push(`  No living enemies visible`);
  }

  // Show corpses separately
  if (deadEnemies.length > 0) {
    lines.push(`\n=== CORPSES ===`);
    for (const { character: other, position } of deadEnemies) {
      lines.push(`  - ${other.name}'s corpse at ${formatPosition(position)}`);
    }
  }

  const reachable = getReachableTiles(world, character);
  const pos = knowledge.status.position;

  if (!hasMoved) {
    lines.push(`\n=== TILES YOU CAN MOVE TO ===`);
    if (reachable.length > 0) {
      const reachableStr = reachable.map((p) => `(${p.x},${p.y})`).join(", ");
      lines.push(reachableStr);
    } else {
      lines.push(`None - you are blocked!`);
    }
  }

  // Show all known objects
  const allItems = knowledge.visible.items;
  if (allItems.length > 0) {
    lines.push(`\n=== KNOWN OBJECTS ===`);
    for (const { item, position } of allItems) {
      const dist = manhattanDistance(pos, position);
      const adjacent = dist <= 1;
      let desc = `${item.name} at ${formatPosition(position)}`;

      if (item.type === "container") {
        if (item.searched) {
          if (item.contents && item.contents.length > 0) {
            desc += ` [searched, contains: ${item.contents
              .map((c) => c.name)
              .join(", ")}]`;
            if (adjacent)
              desc += ` - can PICKUP ${position.x} ${position.y} "ItemName"`;
          } else {
            desc += ` [searched, empty]`;
          }
        } else {
          desc += ` [not searched]`;
          if (adjacent) desc += ` - can SEARCH`;
        }
      } else if (item.type === "weapon") {
        desc += ` [weapon, ${item.damage} damage]`;
        if (adjacent)
          desc += ` - can PICKUP ${position.x} ${position.y} "${item.name}"`;
      } else if (item.type === "trap") {
        desc += ` [trap]`;
        if (adjacent)
          desc += ` - can PICKUP ${position.x} ${position.y} "${item.name}"`;
      } else {
        if (adjacent) desc += ` - ADJACENT`;
      }

      lines.push(`  - ${desc}`);
    }
  }

  // Show active contracts the character is party to
  const myContracts = world.activeContracts.filter(
    (c) => c.issuerId === character.id || c.targetId === character.id
  );
  if (myContracts.length > 0) {
    lines.push(`\n=== YOUR BLOOD CONTRACTS ===`);
    lines.push(`⚠️ VIOLATING A CONTRACT MEANS DEATH when it expires!`);
    for (const contract of myContracts) {
      const otherParty =
        contract.issuerId === character.id
          ? contract.targetName
          : contract.issuerName;
      const turnsLeft = contract.expiryTurn - world.turn;
      lines.push(
        `  - Contract with ${otherParty}: "${contract.contents}" (${turnsLeft} turns remaining, expires turn ${contract.expiryTurn})`
      );
    }
  }

  lines.push(`\n=== YOUR MEMORIES ===`);

  if (knowledge.witnessedEvents.length > 0) {
    for (const event of knowledge.witnessedEvents) {
      lines.push(`  [Turn ${event.turn}] ${event.description}`);
    }
  } else {
    lines.push(`  No memories yet.`);
  }

  // Check who can be talked to (within 4 tiles) - for context
  const talkableChars = knowledge.visible.characters.filter(({ position }) => {
    const dist = manhattanDistance(character.position, position);
    return dist <= MAX_TALK_DISTANCE;
  });
  if (talkableChars.length > 0) {
    const talkTargets = talkableChars
      .map(({ character: c, position }) => {
        const dist = manhattanDistance(character.position, position);
        return `${c.name} (${dist} tiles)`;
      })
      .join(", ");
    lines.push(`\n=== WHO YOU CAN TALK TO (4 tiles) ===`);
    lines.push(`  ${talkTargets}`);
  }

  // Show special tiles like locked doors from memory
  const specialTiles: { type: string; x: number; y: number; dist: number }[] =
    [];
  const hasKey = knowledge.status.inventory.some(
    (i) => i.type === "key" && i.name.toLowerCase().includes("blue")
  );
  for (const [key, memory] of character.mapMemory) {
    if (memory.type === "blue_door") {
      const [x, y] = key.split(",").map(Number);
      const dist = manhattanDistance(pos, { x, y });
      specialTiles.push({ type: "Blue Door (locked)", x, y, dist });
    }
  }

  lines.push(`\n=== YOUR MAP (from memory) ===`);
  lines.push(
    `Legend: @ = you, # = wall, | = bars, D = locked door, . = floor, * = item`
  );
  lines.push(generateAsciiMap(world, character));

  if (specialTiles.length > 0) {
    lines.push(`\nLOCKED DOORS:`);
    for (const tile of specialTiles) {
      let desc = `  - ${tile.type} at (${tile.x}, ${tile.y}) - distance: ${tile.dist}`;
      if (tile.dist === 1 && hasKey) {
        desc += ` *** ADJACENT - can UNLOCK ${tile.x} ${tile.y} ***`;
      } else if (tile.dist === 1) {
        desc += ` - ADJACENT but you need a Blue Key`;
      } else if (hasKey) {
        desc += ` - you have the key!`;
      }
      lines.push(desc);
    }
  }

  return lines.join("\n");
}

// JSON Schema for structured output - flat object with nullable fields
// OpenAI doesn't support anyOf at top level, so we use nullable types
// TypeScript discriminated union + parseJsonAction provide the type safety
const actionResponseSchema = {
  name: "game_action",
  strict: true,
  schema: {
    type: "object",
    properties: {
      thought: {
        type: ["string", "null"],
        description: "Brief thought (required on first action of turn)",
      },
      action: {
        type: "string",
        enum: [
          "MOVE",
          "MOVE_TO",
          "ATTACK",
          "TALK",
          "SEARCH",
          "PICKUP",
          "DROP",
          "EQUIP",
          "UNEQUIP",
          "PLACE",
          "CONTRACT",
          "UNLOCK",
          "WAIT",
        ],
      },
      x: { type: ["number", "null"] },
      y: { type: ["number", "null"] },
      target: { type: ["string", "null"] },
      message: { type: ["string", "null"] },
      terms: { type: ["string", "null"] },
      expiry: { type: ["number", "null"] },
    },
    required: [
      "thought",
      "action",
      "x",
      "y",
      "target",
      "message",
      "terms",
      "expiry",
    ],
    additionalProperties: false,
  },
};

// Separate schema for contract negotiation - only SIGN or DECLINE allowed
const contractNegotiationSchema = {
  name: "contract_response",
  strict: true,
  schema: {
    type: "object",
    properties: {
      thought: {
        type: ["string", "null"],
        description: "Your reasoning for signing or declining",
      },
      action: {
        type: "string",
        enum: ["SIGN", "DECLINE"],
        description: "SIGN to accept the contract, DECLINE to reject it",
      },
      message: {
        type: ["string", "null"],
        description: "Optional message to the other party",
      },
    },
    required: ["thought", "action", "message"],
    additionalProperties: false,
  },
};

// Separate schema for conversation responses - only TALK or WAIT allowed
const conversationResponseSchema = {
  name: "conversation_response",
  strict: true,
  schema: {
    type: "object",
    properties: {
      thought: {
        type: ["string", "null"],
        description: "Brief thought about what to say (or null)",
      },
      action: {
        type: "string",
        enum: ["TALK", "WAIT"],
        description: "TALK to respond, WAIT to end the conversation",
      },
      message: {
        type: ["string", "null"],
        description: "What you say (required for TALK, null for WAIT)",
      },
    },
    required: ["thought", "action", "message"],
    additionalProperties: false,
  },
};

// Flat response type matching the JSON schema - all optional fields nullable
type JsonResponse = {
  thought: string | null;
  action: string;
  x: number | null;
  y: number | null;
  target: string | null;
  message: string | null;
  terms: string | null;
  expiry: number | null;
};

function parseJsonAction(
  jsonResponse: JsonResponse,
  knowledge: CharacterKnowledge,
  world: World,
  character: Character
): { action: Action | null; error: string | null } {
  const reachableTiles = getReachableTiles(world, character);

  switch (jsonResponse.action) {
    case "MOVE": {
      if (jsonResponse.x === null || jsonResponse.y === null) {
        return { action: null, error: "MOVE requires x and y coordinates" };
      }
      return {
        action: {
          type: "move",
          targetPosition: { x: jsonResponse.x, y: jsonResponse.y },
        },
        error: null,
      };
    }

    case "MOVE_TO": {
      if (!jsonResponse.target) {
        return { action: null, error: "MOVE_TO requires a target" };
      }
      const targetPos = findTargetPosition(
        jsonResponse.target,
        knowledge,
        character
      );
      if (!targetPos) {
        return {
          action: null,
          error: `MOVE_TO "${jsonResponse.target}" failed: target not found`,
        };
      }
      const bestTile = findBestTileToward(
        targetPos,
        reachableTiles,
        character.position
      );
      if (!bestTile) {
        return {
          action: null,
          error: `MOVE_TO "${jsonResponse.target}" failed: no reachable tiles`,
        };
      }
      return {
        action: { type: "move", targetPosition: bestTile },
        error: null,
      };
    }

    case "ATTACK": {
      if (!jsonResponse.target) {
        return { action: null, error: "ATTACK requires a target" };
      }
      const target = knowledge.visible.characters.find(
        (c) =>
          c.character.name.toLowerCase() ===
            jsonResponse.target!.toLowerCase() ||
          c.character.name
            .toLowerCase()
            .includes(jsonResponse.target!.toLowerCase())
      );
      if (!target) {
        return {
          action: null,
          error: `ATTACK target "${jsonResponse.target}" not visible`,
        };
      }
      return {
        action: { type: "attack", targetCharacterId: target.character.id },
        error: null,
      };
    }

    case "TALK": {
      if (!jsonResponse.target) {
        return { action: null, error: "TALK requires a target" };
      }
      if (!jsonResponse.message) {
        return { action: null, error: "TALK requires a message" };
      }
      const target = knowledge.visible.characters.find(
        (c) =>
          c.character.name.toLowerCase() ===
            jsonResponse.target!.toLowerCase() ||
          c.character.name
            .toLowerCase()
            .includes(jsonResponse.target!.toLowerCase())
      );
      if (!target) {
        return {
          action: null,
          error: `TALK target "${jsonResponse.target}" not visible`,
        };
      }
      return {
        action: {
          type: "talk",
          targetCharacterId: target.character.id,
          message: jsonResponse.message,
        },
        error: null,
      };
    }

    case "SEARCH": {
      if (!jsonResponse.target) {
        return { action: null, error: "SEARCH requires a target" };
      }
      const container = knowledge.visible.items.find(
        (i) =>
          i.item.type === "container" &&
          i.item.name.toLowerCase().includes(jsonResponse.target!.toLowerCase())
      );
      if (!container) {
        return {
          action: null,
          error: `SEARCH failed: Container "${jsonResponse.target}" not found`,
        };
      }
      return {
        action: { type: "search_container", targetItemId: container.item.id },
        error: null,
      };
    }

    case "PICKUP": {
      if (!jsonResponse.target) {
        return { action: null, error: "PICKUP requires a target" };
      }
      const visibleItem = knowledge.visible.items.find((i) =>
        i.item.name.toLowerCase().includes(jsonResponse.target!.toLowerCase())
      );
      if (!visibleItem) {
        return {
          action: null,
          error: `PICKUP failed: "${jsonResponse.target}" not found nearby`,
        };
      }
      return {
        action: {
          type: "pick_up",
          targetItemId: visibleItem.item.id,
        },
        error: null,
      };
    }

    case "DROP": {
      if (!jsonResponse.target) {
        return { action: null, error: "DROP requires a target" };
      }
      const item = knowledge.status.inventory.find((i) =>
        i.name.toLowerCase().includes(jsonResponse.target!.toLowerCase())
      );
      if (!item) {
        return {
          action: null,
          error: `DROP failed: "${jsonResponse.target}" not in inventory`,
        };
      }
      return { action: { type: "drop", targetItemId: item.id }, error: null };
    }

    case "EQUIP": {
      if (!jsonResponse.target) {
        return { action: null, error: "EQUIP requires a target" };
      }
      const item = knowledge.status.inventory.find((i) =>
        i.name.toLowerCase().includes(jsonResponse.target!.toLowerCase())
      );
      if (!item) {
        return {
          action: null,
          error: `EQUIP failed: "${jsonResponse.target}" not in inventory`,
        };
      }
      return {
        action: { type: "equip", targetItemId: item.id },
        error: null,
      };
    }

    case "UNEQUIP": {
      if (!jsonResponse.target) {
        return { action: null, error: "UNEQUIP requires a target" };
      }
      const item = knowledge.status.inventory.find((i) =>
        i.name.toLowerCase().includes(jsonResponse.target!.toLowerCase())
      );
      if (!item) {
        return {
          action: null,
          error: `UNEQUIP failed: "${jsonResponse.target}" not in inventory`,
        };
      }
      return {
        action: { type: "unequip", targetItemId: item.id },
        error: null,
      };
    }

    case "PLACE": {
      if (jsonResponse.x === null || jsonResponse.y === null) {
        return { action: null, error: "PLACE requires x and y coordinates" };
      }
      if (!jsonResponse.target) {
        return { action: null, error: "PLACE requires a target" };
      }
      const trapsInInv = knowledge.status.inventory.filter(
        (i) => i.type === "trap"
      );
      if (trapsInInv.length === 0) {
        return { action: null, error: "PLACE failed: No traps in inventory!" };
      }
      const item = trapsInInv.find((i) =>
        i.name.toLowerCase().includes(jsonResponse.target!.toLowerCase())
      );
      if (!item) {
        return {
          action: null,
          error: `PLACE failed: "${jsonResponse.target}" not in inventory`,
        };
      }
      return {
        action: {
          type: "place",
          targetItemId: item.id,
          targetPosition: { x: jsonResponse.x, y: jsonResponse.y },
        },
        error: null,
      };
    }

    case "CONTRACT": {
      if (!jsonResponse.target) {
        return { action: null, error: "CONTRACT requires a target" };
      }
      if (!jsonResponse.terms) {
        return { action: null, error: "CONTRACT requires terms" };
      }
      if (jsonResponse.expiry === null) {
        return { action: null, error: "CONTRACT requires expiry" };
      }
      if (jsonResponse.expiry < 1 || jsonResponse.expiry > 5) {
        return {
          action: null,
          error: "CONTRACT expiry must be between 1 and 5 turns",
        };
      }
      const contractTarget = world.characters.find(
        (c) => c.name.toLowerCase() === jsonResponse.target!.toLowerCase()
      );
      if (!contractTarget) {
        return {
          action: null,
          error: `CONTRACT failed: Character "${jsonResponse.target}" not found`,
        };
      }
      return {
        action: {
          type: "issue_contract",
          targetCharacterId: contractTarget.id,
          contractContents: jsonResponse.terms!,
          contractExpiry: jsonResponse.expiry,
          message: jsonResponse.message || undefined,
        },
        error: null,
      };
    }

    case "UNLOCK": {
      if (!jsonResponse.target) {
        return { action: null, error: "UNLOCK requires a door name" };
      }
      return {
        action: {
          type: "unlock",
          targetDoorName: jsonResponse.target,
        },
        error: null,
      };
    }

    case "WAIT":
      return { action: { type: "wait" }, error: null };

    default:
      return { action: null, error: `Unknown action: ${jsonResponse.action}` };
  }
}

export type TurnHistoryEntry = {
  response: string; // The raw JSON response from the AI
  result: string; // What happened (e.g., "Moved to (3,7)", "Search found: Bear Trap")
};

export async function getAgentDecision(
  world: World,
  character: Character,
  turnHistory: TurnHistoryEntry[] = []
): Promise<{
  action: Action;
  reasoning: string | null; // kept as "reasoning" externally for compatibility
  fullPrompt?: string;
  fullResponse?: string;
  error?: string;
}> {
  if (!openai) {
    return {
      action: { type: "wait" },
      reasoning: "AI agent not initialized (no API key)",
    };
  }

  const knowledge = getCharacterKnowledge(world, character);

  // Check what's already been done this turn
  const hasMoved = turnHistory.some((h) => {
    try {
      const r = JSON.parse(h.response);
      return r.action === "MOVE" && h.result.includes("successfully");
    } catch {
      return false;
    }
  });

  let situationDescription = formatKnowledge(
    world,
    character,
    knowledge,
    hasMoved
  );

  // Add turn history at the bottom so AI sees current state first
  if (turnHistory.length > 0) {
    let historySection = `\n=== WHAT YOU'VE DONE THIS TURN ===\n`;
    for (let i = 0; i < turnHistory.length; i++) {
      const rawJson = turnHistory[i].response;
      const result = turnHistory[i].result;
      historySection += `${i + 1}. Your response: ${rawJson}\n`;
      historySection += `   Result: ${result}\n\n`;
    }
    if (hasMoved) {
      historySection += `⛔ MOVE UNAVAILABLE. Choose: SEARCH, PICKUP, EQUIP, ATTACK, TALK, or WAIT.\n`;
    } else {
      historySection += `You can still take more actions before ending your turn.\n`;
    }
    situationDescription = situationDescription + historySection;
  }

  // Build available actions list with crossed-out unavailable ones
  const moveAction = hasMoved
    ? "- [UNAVAILABLE] MOVE - YOU ALREADY MOVED THIS TURN. DO NOT USE MOVE."
    : "- MOVE: Move to a tile. Use x,y coordinates OR target name (auto-navigates)";

  // Build PICKUP action - list adjacent items that can be picked up
  const adjacentPickupItems: { name: string; x: number; y: number }[] = [];
  for (const { item, position } of knowledge.visible.items) {
    const dist = manhattanDistance(character.position, position);
    if (dist === 1 && item.type !== "container") {
      adjacentPickupItems.push({
        name: item.name,
        x: position.x,
        y: position.y,
      });
    } else if (
      dist === 1 &&
      item.type === "container" &&
      item.searched &&
      item.contents
    ) {
      for (const content of item.contents) {
        adjacentPickupItems.push({
          name: content.name,
          x: position.x,
          y: position.y,
        });
      }
    }
  }
  const pickupAction =
    adjacentPickupItems.length > 0
      ? `- PICKUP: Pick up adjacent item. Available: ${adjacentPickupItems
          .map((i) => `"${i.name}" at (${i.x},${i.y})`)
          .join(", ")}`
      : "- [UNAVAILABLE] PICKUP - No items adjacent to pick up.";

  // Build UNLOCK action - list adjacent locked doors if has key
  const hasKey = knowledge.status.inventory.some((i) => i.type === "key");
  const adjacentLockedDoors: { x: number; y: number }[] = [];
  for (let dx = -1; dx <= 1; dx++) {
    for (let dy = -1; dy <= 1; dy++) {
      if (Math.abs(dx) + Math.abs(dy) !== 1) continue;
      const nx = character.position.x + dx;
      const ny = character.position.y + dy;
      if (nx >= 0 && ny >= 0 && nx < world.width && ny < world.height) {
        const tile = world.tiles[ny][nx];
        if (tile.type === "blue_door") {
          adjacentLockedDoors.push({ x: nx, y: ny });
        }
      }
    }
  }
  let unlockAction: string;
  if (adjacentLockedDoors.length > 0 && hasKey) {
    unlockAction = `- UNLOCK: Unlock adjacent door. Requires target (door name). Available: ${adjacentLockedDoors
      .map((d) => `Blue Door (${d.x},${d.y})`)
      .join(", ")}`;
  } else if (adjacentLockedDoors.length > 0) {
    unlockAction = `- [UNAVAILABLE] UNLOCK - Adjacent door at ${adjacentLockedDoors
      .map((d) => `(${d.x},${d.y})`)
      .join(", ")} but you need a key.`;
  } else if (hasKey) {
    unlockAction =
      "- [UNAVAILABLE] UNLOCK - You have a key but no locked doors are adjacent.";
  } else {
    unlockAction =
      "- [UNAVAILABLE] UNLOCK - No adjacent locked doors and no key.";
  }

  // Build TALK action - list characters within talk distance (works through bars/doors)
  const talkableCharacters = world.characters
    .filter(
      (c) =>
        c.id !== character.id &&
        c.alive &&
        manhattanDistance(character.position, c.position) <= MAX_TALK_DISTANCE
    )
    .map((c) => ({
      name: c.name,
      dist: manhattanDistance(character.position, c.position),
    }));
  const talkAction =
    talkableCharacters.length > 0
      ? `- TALK: Speak to character within ${MAX_TALK_DISTANCE} tiles (works through bars). Available: ${talkableCharacters
          .map((c) => `${c.name} (${c.dist} tiles)`)
          .join(", ")}. Does NOT end turn (max 1 conversation per turn).`
      : `- [UNAVAILABLE] TALK - No characters within ${MAX_TALK_DISTANCE} tiles.`;

  // Add continuity guidance if there's history
  const continuityNote =
    turnHistory.length > 0
      ? `\nThis is a FOLLOW-UP action. Set "thought": null.`
      : "";

  const systemPrompt = `You are playing a character in a turn-based game on a 2D grid where (0,0) is in the top-left corner. Your CHARACTER DESCRIPTION below defines who you are, your goals, and your personality.

ONE ACTION PER RESPONSE. After each action, you'll see the result and can decide your next action.${continuityNote}

AVAILABLE ACTIONS:
${moveAction}
- ATTACK: Attack ADJACENT character (1 tile away, diagonal not allowed). Requires target name. Ends turn.
${talkAction}
- SEARCH: Search adjacent container. Requires target (container name).
${pickupAction}
- EQUIP: Equip weapon/clothing from inventory. Requires target (item name). You cannot equip and attack in the same turn.
- UNEQUIP: Unequip weapon/clothing. Requires target (item name). Can signal good faith to others.
- PLACE: Place trap on ADJACENT tile. Requires x,y and target (trap name).
${unlockAction}
- DROP: Drop item from inventory. Requires target (item name).
- CONTRACT: Offer a Blood Contract to character within 4 tiles. They immediately choose to sign or decline. Requires target (character name), terms (the contract terms), expiry (1-5 turns), and optional message (your pitch). Max 2 per turn. If the contract expiry occurs and either party has violated the terms, the Great Judge will kill them. Blood contracts allow for more secure cooperation.
- SIGN: Accept a Blood Contract being offered to you. Use during contract negotiation.
- WAIT: End turn. No parameters.

Respond with JSON:
- thought: REQUIRED on first action (what's on your mind). Optional on follow-up actions. Only use on follow up actions if acting on new information. Don't re-state something you already thought in the last turn. If you have nothing new to think, keep it VERY brief.
- action: The action type
- x, y: Coordinates if needed (null otherwise)
- target: Target name if needed (null otherwise)
- message: Message for TALK (null otherwise)

EXAMPLES:
${
  turnHistory.length > 0
    ? `{"thought": null, "action": "ATTACK", "x": null, "y": null, "target": "Kane", "message": null, "terms": null, "expiry": null}
{"thought": null, "action": "SEARCH", "x": null, "y": null, "target": "Supply Crate", "message": null, "terms": null, "expiry": null}
{"thought": null, "action": "CONTRACT", "x": null, "y": null, "target": "Luna", "message": "Let's team up!", "terms": "Neither party attacks the other", "expiry": 5}
{"thought": null, "action": "SIGN", "x": null, "y": null, "target": null, "message": "Deal.", "terms": null, "expiry": null}
{"thought": null, "action": "WAIT", "x": null, "y": null, "target": null, "message": null, "terms": null, "expiry": null}`
    : `{"thought": "There he is.", "action": "MOVE", "x": 12, "y": 5, "target": null, "message": null}
{"thought": "Got him.", "action": "ATTACK", "x": null, "y": null, "target": "Kane", "message": null, "terms": null, "expiry": null}
{"thought": "Need a weapon.", "action": "SEARCH", "x": null, "y": null, "target": "Supply Crate", "message": null, "terms": null, "expiry": null}
{"thought": "An alliance could help.", "action": "CONTRACT", "x": null, "y": null, "target": "Luna", "message": "We're both in danger. Work with me.", "terms": "We protect each other until only enemies remain", "expiry": 5}`
}`;

  const userPrompt = `${character.personalityPrompt}

CURRENT SITUATION:
${situationDescription}

What do you do?`;

  try {
    const response = await openai.chat.completions.create({
      model: "gpt-5.2",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      response_format: {
        type: "json_schema",
        json_schema: actionResponseSchema,
      },
      max_completion_tokens: MAX_COMPLETION_TOKENS,
      reasoning_effort: "low",
    });

    const content = response.choices[0]?.message?.content ?? "{}";
    const fullPrompt = `SYSTEM:\n${systemPrompt}\n\nUSER:\n${userPrompt}`;

    let jsonResponse: JsonResponse;
    try {
      jsonResponse = JSON.parse(content) as JsonResponse;
    } catch {
      console.error("Failed to parse JSON response:", content);
      return {
        action: { type: "wait" },
        reasoning: `(Failed to parse JSON: ${content})`,
        fullPrompt,
        fullResponse: content,
        error: "Invalid JSON response from AI",
      };
    }

    const { action, error } = parseJsonAction(
      jsonResponse,
      knowledge,
      world,
      character
    );

    if (error) {
      console.warn("Action parsing error:", error);
    }

    if (!action) {
      console.warn(`No valid action parsed from: ${content}`);
      return {
        action: { type: "wait" },
        reasoning: jsonResponse.thought || "(No valid action)",
        fullPrompt,
        fullResponse: content,
        error: error || "No valid action in response",
      };
    }

    return {
      action,
      reasoning: jsonResponse.thought, // "thought" in JSON, "reasoning" externally
      fullPrompt,
      fullResponse: content,
      error: error || undefined,
    };
  } catch (err) {
    console.error("Agent error:", err);
    return {
      action: { type: "wait" },
      reasoning: `Error: ${
        err instanceof Error ? err.message : "Unknown error"
      }`,
      error: err instanceof Error ? err.message : "Unknown error",
    };
  }
}

export type ContractNegotiationResult = {
  signed: boolean;
  thought: string | null;
  message: string | null;
  fullPrompt: string;
  fullResponse: string;
};

export async function getContractDecision(
  world: World,
  target: Character,
  issuerName: string,
  contents: string,
  expiry: number,
  pitch?: string
): Promise<ContractNegotiationResult> {
  if (!openai) {
    return {
      signed: false,
      thought: "No AI connection",
      message: null,
      fullPrompt: "",
      fullResponse: "",
    };
  }

  const knowledge = getCharacterKnowledge(world, target);
  const situationDescription = formatKnowledge(world, target, knowledge, false);

  const pitchLine = pitch ? `\n${issuerName} says: "${pitch}"\n` : "";
  const contractOffer = `
=== BLOOD CONTRACT OFFER ===
${issuerName} offers you a BLOOD CONTRACT:
${pitchLine}
Terms: "${contents}"
Duration: ${expiry} turns (expires turn ${world.turn + expiry})

⚠️ WARNING: If you sign and violate the terms, the Great Judge will KILL YOU when it expires! On the flip side, if the other party violates the terms, the Great Judge will KILL THEM when it expires! Blood contracts allow for more secure cooperation.

Respond with SIGN to accept or DECLINE to reject. You may include a message.`;

  const systemPrompt = `You are ${target.name}. ${target.personalityPrompt}

You are deciding whether to accept or reject a blood contract. Consider your goals, the current situation, and whether you can realistically comply with the terms.`;

  const userPrompt = `${situationDescription}
${contractOffer}`;

  try {
    const response = await openai.chat.completions.create({
      model: "gpt-5.2",
      messages: [
        {
          role: "system",
          content: systemPrompt,
        },
        { role: "user", content: userPrompt },
      ],
      response_format: {
        type: "json_schema",
        json_schema: contractNegotiationSchema,
      },
      max_completion_tokens: MAX_COMPLETION_TOKENS,
      reasoning_effort: "low",
    });

    const content = response.choices[0]?.message?.content ?? "{}";
    const parsed = JSON.parse(content) as {
      thought: string | null;
      action: string;
      message: string | null;
    };

    const fullPrompt = `SYSTEM:\n${systemPrompt}\n\nUSER:\n${userPrompt}`;
    return {
      signed: parsed.action.toUpperCase() === "SIGN",
      thought: parsed.thought,
      message: parsed.message,
      fullPrompt,
      fullResponse: content,
    };
  } catch (err) {
    console.error("Contract decision error:", err);
    const fullPrompt = `SYSTEM:\n${systemPrompt}\n\nUSER:\n${userPrompt}`;
    return {
      signed: false,
      thought: "Error processing decision",
      message: null,
      fullPrompt,
      fullResponse: "",
    };
  }
}

export type ConversationResponse = {
  wantsToRespond: boolean;
  thought: string | null;
  message: string | null;
  fullPrompt: string;
  fullResponse: string;
};

export async function getConversationResponse(
  world: World,
  speaker: Character,
  listenerName: string,
  lastMessage: string
): Promise<ConversationResponse> {
  if (!openai) {
    return {
      wantsToRespond: false,
      thought: "No AI connection",
      message: null,
      fullPrompt: "",
      fullResponse: "",
    };
  }

  // Get full knowledge context for the speaker
  const knowledge = getCharacterKnowledge(world, speaker);
  const situationDescription = formatKnowledge(world, speaker, knowledge, true);

  const systemPrompt = `You are ${speaker.name}. ${speaker.personalityPrompt}

This is a conversation response. You can ONLY respond with:
- TALK: Say something back (requires a message)
- WAIT: End the conversation (say nothing more)

No other actions are allowed.

Respond with JSON:
- thought: Brief thought (or null)
- action: "TALK" or "WAIT"
- message: What you say (required for TALK, null for WAIT)`;

  const userPrompt = `${listenerName} just said to you: "${lastMessage}"

${situationDescription}

How do you respond?`;

  try {
    const response = await openai.chat.completions.create({
      model: "gpt-5.2",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      response_format: {
        type: "json_schema",
        json_schema: conversationResponseSchema,
      },
      max_completion_tokens: MAX_COMPLETION_TOKENS,
      reasoning_effort: "low",
    });

    const content = response.choices[0]?.message?.content ?? "{}";
    const parsed = JSON.parse(content) as {
      thought: string | null;
      action: string;
      message: string | null;
    };

    return {
      wantsToRespond: parsed.action.toUpperCase() === "TALK",
      thought: parsed.thought,
      message: parsed.message,
      fullPrompt: `SYSTEM:\n${systemPrompt}\n\nUSER:\n${userPrompt}`,
      fullResponse: content,
    };
  } catch (err) {
    console.error("Conversation response error:", err);
    return {
      wantsToRespond: false,
      thought: "Error processing response",
      message: null,
      fullPrompt: `SYSTEM:\n${systemPrompt}\n\nUSER:\n${userPrompt}`,
      fullResponse: "",
    };
  }
}

export type JudgeVerdict = {
  verdict: string;
  violators: string[]; // Character names who violated the contract
  prompt?: string; // The full prompt sent to the judge (for debugging)
  rawResponse?: string; // The raw JSON response from the judge
};

export async function judgeContract(
  contract: BloodContract,
  events: GameEvent[],
  world: World
): Promise<JudgeVerdict> {
  // Filter events to only those that happened during the contract period
  const relevantEvents = events.filter(
    (e) => e.turn >= contract.createdTurn && e.turn <= contract.expiryTurn
  );

  const eventLog = relevantEvents
    .map((e) => `[Turn ${e.turn}] ${e.description}`)
    .join("\n");

  const allCharactersStatus = world.characters
    .map((c) => {
      const weapon = c.equippedWeapon
        ? `, armed with ${c.equippedWeapon.name}`
        : ", unarmed";
      const trapped =
        c.debuffTurnsRemaining > 0
          ? `, TRAPPED (${c.debuffTurnsRemaining} turns)`
          : "";
      const inventory =
        c.inventory.length > 0
          ? `, inventory: [${c.inventory.map((i) => i.name).join(", ")}]`
          : "";
      if (c.alive) {
        return `- ${c.name}: Alive at (${c.position.x}, ${c.position.y}), HP ${c.hp}/${c.maxHp}${weapon}${trapped}${inventory}`;
      } else {
        return `- ${c.name}: DEAD at (${c.position.x}, ${c.position.y})`;
      }
    })
    .join("\n");

  const allItems: string[] = [];
  for (let y = 0; y < world.height; y++) {
    for (let x = 0; x < world.width; x++) {
      for (const item of world.tiles[y][x].items) {
        allItems.push(`- ${item.name} at (${x}, ${y}) [${item.type}]`);
      }
    }
  }
  const itemsList =
    allItems.length > 0 ? allItems.join("\n") : "(No items on map)";

  const asciiMap = generateOmniscientMap(world);

  const prompt = `You are the Great Judge, an all-seeing divine entity who enforces Blood Contracts.

A Blood Contract has expired and you must render judgment.

=== CONTRACT DETAILS ===
- Between: ${contract.issuerName} and ${contract.targetName}
- Terms: "${contract.contents}"
- Created: Turn ${contract.createdTurn}
- Expired: Turn ${contract.expiryTurn}

=== ALL EVENTS DURING CONTRACT PERIOD ===
${eventLog || "(No events recorded)"}

=== ALL CHARACTERS STATUS ===
${allCharactersStatus}

=== ALL ITEMS ON MAP ===
${itemsList}

=== MAP (Legend: # = wall, | = bars, D = locked door, . = floor, * = item, Letter = character) ===
${asciiMap}

Your task: Determine if either party violated the terms of the contract.

Respond with JSON:
{
  "verdict": "Your judgment explanation (1-2 sentences, dramatic)",
  "violators": ["Name1", "Name2"] // Empty array if no violations, or names of violators
}

Be fair but strict. If someone clearly violated the terms, they must be punished.
If the terms are ambiguous and both parties acted in good faith, find no violation.
If a party died during the contract period, they cannot be a violator (death releases them).`;

  if (!openai) {
    return {
      verdict:
        "The Great Judge cannot render judgment - no connection to the divine.",
      violators: [],
      prompt,
    };
  }

  try {
    const response = await openai.chat.completions.create({
      model: "gpt-5.2",
      messages: [{ role: "user", content: prompt }],
      response_format: { type: "json_object" },
      max_completion_tokens: MAX_COMPLETION_TOKENS,
      reasoning_effort: "low",
    });

    const content = response.choices[0]?.message?.content;
    if (!content) {
      return {
        verdict: "The Great Judge is silent. No judgment can be rendered.",
        violators: [],
        prompt,
      };
    }

    const result = JSON.parse(content) as JudgeVerdict;

    // Validate violator names
    const validNames = [contract.issuerName, contract.targetName];
    result.violators = result.violators.filter((name) =>
      validNames.some((v) => v.toLowerCase() === name.toLowerCase())
    );

    return {
      ...result,
      prompt,
      rawResponse: content,
    };
  } catch (err) {
    console.error("Judge error:", err);
    return {
      verdict:
        "The Great Judge encountered an error. Mercy is granted to all parties.",
      violators: [],
      prompt,
    };
  }
}
