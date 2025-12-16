import type {
  Character,
  CharacterKnowledge,
  Action,
  World,
  Position,
} from "./types";
import { getCharacterKnowledge, getReachableTiles } from "./engine";
import OpenAI from "openai";

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

  lines.push("");
  lines.push(
    "Legend: @ = You, # = Wall, . = Floor, * = Item, ? = Unexplored, Letters = Characters"
  );

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
          `  *** ${other.name} is ADJACENT - CAN ATTACK or TALK! *** [HP: ${other.hp}/${other.maxHp}, ${weapon}${trappedStatus}]`
        );
      } else if (dist <= 2) {
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
      const adjacent = dist === 1;
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
          if (adjacent) desc += ` - ADJACENT, can SEARCH`;
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

  lines.push(`\n=== YOUR MEMORIES ===`);

  // Separate important memories from "saw X" observations
  const importantTypes = [
    "thought",
    "attacked",
    "was_attacked",
    "character_died",
    "witnessed_attack",
    "picked_up_item",
    "searched_container",
    "talked_to",
    "heard_about",
    "trap_triggered",
    "placed_trap",
  ];

  const importantMemories = knowledge.memories.filter((m) =>
    importantTypes.includes(m.type)
  );

  // For "saw" memories, only keep the most recent sighting of each thing
  const sawMemories = knowledge.memories.filter(
    (m) => m.type === "saw_character" || m.type === "saw_item"
  );
  const latestSawByTarget = new Map<string, (typeof sawMemories)[0]>();
  for (const mem of sawMemories) {
    const key = mem.characterId ?? mem.itemId ?? mem.description;
    const existing = latestSawByTarget.get(key);
    if (!existing || mem.turn > existing.turn) {
      latestSawByTarget.set(key, mem);
    }
  }
  const dedupedSawMemories = Array.from(latestSawByTarget.values());

  // Combine: all important memories + deduplicated saw memories, sorted by turn
  const allMemories = [...importantMemories, ...dedupedSawMemories].sort(
    (a, b) => a.turn - b.turn
  );

  if (allMemories.length > 0) {
    for (const memory of allMemories) {
      const source = memory.source === "witnessed" ? "" : ` (told by someone)`;
      lines.push(`  [Turn ${memory.turn}] ${memory.description}${source}`);
    }
  } else {
    lines.push(`  No memories yet.`);
  }

  lines.push(`\n=== ACTIONS (chain multiple per turn) ===`);
  lines.push(`You automatically look around at the start of your turn.`);
  lines.push(``);
  lines.push(`Chain these actions in one turn:`);
  if (hasMoved) {
    lines.push(`  - [UNAVAILABLE] MOVE - YOU ALREADY MOVED. DO NOT USE.`);
  } else {
    lines.push(
      `  - MOVE x y : Move to position (max ${character.movementRange} tiles)`
    );
  }
  lines.push(`  - SEARCH container_name : Search adjacent container`);
  lines.push(`  - PICKUP x y item_name : Take item from tile at (x,y)`);
  lines.push(
    `  - EQUIP item_name : Equip weapon/clothing (cannot ATTACK same turn)`
  );
  lines.push(`  - DROP item_name : Drop item`);
  lines.push(``);
  lines.push(`These END your turn:`);
  lines.push(
    `  - ATTACK character_name : Attack adjacent character (1 tile). Works unarmed (punch for 1 damage)!`
  );
  lines.push(
    `  - TALK character_name "message" : Speak to character (2 tiles)`
  );
  lines.push(`  - WAIT : End turn doing nothing`);

  lines.push(``);
  lines.push(`=== YOUR MAP (from memory) ===`);
  lines.push(generateAsciiMap(world, character));

  return lines.join("\n");
}

// Valid action types
const VALID_ACTION_TYPES = [
  "move",
  "attack",
  "talk",
  "search",
  "pickup",
  "drop",
  "equip",
  "place",
  "wait",
] as const;

type ValidActionType = (typeof VALID_ACTION_TYPES)[number];

// JSON Schema for structured output - ONE action per response
// Note: strict mode requires all properties in 'required', so we use nullable types
const actionResponseSchema = {
  name: "game_action",
  strict: true,
  schema: {
    type: "object",
    properties: {
      thought: {
        type: ["string", "null"],
        description:
          "REQUIRED on first action of turn. Short, natural thought. null on follow-up actions.",
      },
      action: {
        type: "string",
        enum: [
          "MOVE",
          "ATTACK",
          "TALK",
          "SEARCH",
          "PICKUP",
          "DROP",
          "EQUIP",
          "PLACE",
          "WAIT",
        ],
        description: "The action type",
      },
      x: {
        type: ["number", "null"],
        description: "X coordinate for MOVE or PLACE (null if not applicable)",
      },
      y: {
        type: ["number", "null"],
        description: "Y coordinate for MOVE or PLACE (null if not applicable)",
      },
      target: {
        type: ["string", "null"],
        description:
          "Target name for ATTACK, TALK, SEARCH, PICKUP, DROP, EQUIP, PLACE, or MOVE-to-target (null if not applicable)",
      },
      message: {
        type: ["string", "null"],
        description: "Message content for TALK (null if not applicable)",
      },
    },
    required: ["thought", "action", "x", "y", "target", "message"],
    additionalProperties: false,
  },
};

type JsonResponse = {
  thought: string | null;
  action: string;
  x: number | null;
  y: number | null;
  target: string | null;
  message: string | null;
};

function parseJsonAction(
  jsonResponse: JsonResponse,
  knowledge: CharacterKnowledge,
  world: World,
  character: Character
): { action: Action | null; error: string | null } {
  const reachableTiles = getReachableTiles(world, character);
  const actionType = jsonResponse.action.toLowerCase() as ValidActionType;

  // Validate action type
  if (!VALID_ACTION_TYPES.includes(actionType)) {
    return {
      action: null,
      error: `Unknown action type: "${jsonResponse.action}"`,
    };
  }

  switch (actionType) {
    case "move":
      if (jsonResponse.x !== null && jsonResponse.y !== null) {
        return {
          action: {
            type: "move",
            targetPosition: { x: jsonResponse.x, y: jsonResponse.y },
          },
          error: null,
        };
      } else if (jsonResponse.target) {
        const targetPos = findTargetPosition(
          jsonResponse.target,
          knowledge,
          character
        );
        if (targetPos) {
          const bestTile = findBestTileToward(
            targetPos,
            reachableTiles,
            character.position
          );
          if (bestTile) {
            return {
              action: { type: "move", targetPosition: bestTile },
              error: null,
            };
          } else {
            return {
              action: null,
              error: `MOVE TO "${jsonResponse.target}" failed: no reachable tiles`,
            };
          }
        } else {
          return {
            action: null,
            error: `MOVE TO "${jsonResponse.target}" failed: target not found`,
          };
        }
      } else {
        return {
          action: null,
          error: "MOVE requires x,y coordinates OR a target name",
        };
      }

    case "attack":
      if (jsonResponse.target) {
        const target = knowledge.visible.characters.find(
          (c) =>
            c.character.name.toLowerCase() ===
              jsonResponse.target!.toLowerCase() ||
            c.character.name
              .toLowerCase()
              .includes(jsonResponse.target!.toLowerCase())
        );
        if (target) {
          return {
            action: { type: "attack", targetCharacterId: target.character.id },
            error: null,
          };
        } else {
          return {
            action: null,
            error: `ATTACK target "${jsonResponse.target}" not visible`,
          };
        }
      } else {
        return { action: null, error: "ATTACK requires a target name" };
      }

    case "talk":
      if (jsonResponse.target && jsonResponse.message) {
        const target = knowledge.visible.characters.find(
          (c) =>
            c.character.name.toLowerCase() ===
              jsonResponse.target!.toLowerCase() ||
            c.character.name
              .toLowerCase()
              .includes(jsonResponse.target!.toLowerCase())
        );
        if (target) {
          return {
            action: {
              type: "talk",
              targetCharacterId: target.character.id,
              message: jsonResponse.message,
            },
            error: null,
          };
        } else {
          return {
            action: null,
            error: `TALK target "${jsonResponse.target}" not visible`,
          };
        }
      } else {
        return {
          action: null,
          error: "TALK requires a target name and message",
        };
      }

    case "search":
      if (jsonResponse.target) {
        const container = knowledge.visible.items.find(
          (i) =>
            i.item.type === "container" &&
            i.item.name
              .toLowerCase()
              .includes(jsonResponse.target!.toLowerCase())
        );
        if (container) {
          return {
            action: {
              type: "search_container",
              targetItemId: container.item.id,
            },
            error: null,
          };
        } else {
          return {
            action: {
              type: "search_container",
              targetItemName: jsonResponse.target,
            },
            error: null,
          };
        }
      } else {
        return { action: null, error: "SEARCH requires a container name" };
      }

    case "pickup":
      if (
        jsonResponse.x !== null &&
        jsonResponse.y !== null &&
        jsonResponse.target
      ) {
        return {
          action: {
            type: "pick_up",
            targetPosition: { x: jsonResponse.x, y: jsonResponse.y },
            targetItemName: jsonResponse.target,
          },
          error: null,
        };
      } else if (!jsonResponse.target) {
        return { action: null, error: "PICKUP requires item name (target)" };
      } else {
        return { action: null, error: "PICKUP requires coordinates (x, y)" };
      }

    case "drop":
      if (jsonResponse.target) {
        const item = knowledge.status.inventory.find((i) =>
          i.name.toLowerCase().includes(jsonResponse.target!.toLowerCase())
        );
        if (item) {
          return {
            action: { type: "drop", targetItemId: item.id },
            error: null,
          };
        } else {
          return {
            action: { type: "drop", targetItemName: jsonResponse.target },
            error: null,
          };
        }
      } else {
        return { action: null, error: "DROP requires an item name" };
      }

    case "equip":
      if (jsonResponse.target) {
        const item = knowledge.status.inventory.find((i) =>
          i.name.toLowerCase().includes(jsonResponse.target!.toLowerCase())
        );
        if (item) {
          return {
            action: { type: "equip", targetItemId: item.id },
            error: null,
          };
        } else {
          return {
            action: { type: "equip", targetItemName: jsonResponse.target },
            error: null,
          };
        }
      } else {
        return { action: null, error: "EQUIP requires an item name" };
      }

    case "place":
      if (!jsonResponse.target) {
        return { action: null, error: "PLACE requires a trap name" };
      } else if (jsonResponse.x === null || jsonResponse.y === null) {
        return {
          action: null,
          error: "PLACE requires x,y coordinates for adjacent tile",
        };
      } else {
        const trapsInInv = knowledge.status.inventory.filter(
          (i) => i.type === "trap"
        );
        if (trapsInInv.length === 0) {
          return {
            action: null,
            error: "PLACE failed: No traps in inventory!",
          };
        }
        const item = trapsInInv.find((i) =>
          i.name.toLowerCase().includes(jsonResponse.target!.toLowerCase())
        );
        if (item) {
          return {
            action: {
              type: "place",
              targetItemId: item.id,
              targetPosition: { x: jsonResponse.x, y: jsonResponse.y },
            },
            error: null,
          };
        } else {
          return {
            action: null,
            error: `PLACE failed: "${jsonResponse.target}" not in inventory`,
          };
        }
      }

    case "wait":
      return { action: { type: "wait" }, error: null };

    default:
      return { action: null, error: `Unknown action: ${actionType}` };
  }
}

export type TurnHistoryEntry = {
  response: string; // The raw JSON response from the AI
  result: string; // What happened (e.g., "Moved to (3,7)", "Search found: Bear Trap")
};

export async function getAgentDecision(
  world: World,
  character: Character,
  turnHistory: TurnHistoryEntry[] = [],
  lastFailure?: string
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
      try {
        const parsed = JSON.parse(turnHistory[i].response);
        const thought = parsed.thought
          ? `You thought: "${parsed.thought}"`
          : "";
        const action = parsed.action || "unknown";
        let actionDesc = action;
        if (action === "MOVE" && parsed.x !== null && parsed.y !== null) {
          actionDesc = `MOVED to (${parsed.x}, ${parsed.y})`;
        } else if (parsed.target) {
          actionDesc = `${action} ${parsed.target}`;
        }
        historySection += `${i + 1}. ${
          thought ? thought + " → " : ""
        }${actionDesc}\n`;
        historySection += `   Result: ${turnHistory[i].result}\n\n`;
      } catch {
        historySection += `${i + 1}. ${turnHistory[i].response}\n`;
        historySection += `   Result: ${turnHistory[i].result}\n\n`;
      }
    }
    if (hasMoved) {
      historySection += `⛔ MOVE UNAVAILABLE. Choose: SEARCH, PICKUP, EQUIP, ATTACK, TALK, or WAIT.\n`;
    } else {
      historySection += `You can still take more actions before ending your turn.\n`;
    }
    situationDescription = situationDescription + historySection;
  }

  if (lastFailure) {
    situationDescription =
      `⚠️ YOUR LAST ACTION FAILED: ${lastFailure}\n\n` + situationDescription;
  }

  // Build available actions list with crossed-out unavailable ones
  const moveAction = hasMoved
    ? "- [UNAVAILABLE] MOVE - YOU ALREADY MOVED THIS TURN. DO NOT USE MOVE."
    : "- MOVE: Move to a tile. Use x,y coordinates OR target name (auto-navigates)";

  // Add continuity guidance if there's history
  const continuityNote =
    turnHistory.length > 0
      ? `\nThis is a FOLLOW-UP action. Set "thought": null.`
      : "";

  const systemPrompt = `You are playing a character in a turn-based game. Your CHARACTER DESCRIPTION below defines who you are, your goals, and your personality.

ONE ACTION PER RESPONSE. After each action, you'll see the result and can decide your next action.${continuityNote}

AVAILABLE ACTIONS:
${moveAction}
- ATTACK: Attack ADJACENT character (1 tile away). Requires target name. Ends turn.
- TALK: Speak to character within 2 tiles. Requires target and message. Ends turn.
- SEARCH: Search adjacent container. Requires target (container name).
- PICKUP: Pick up item at coordinates. Requires x, y, and target (item name).
- EQUIP: Equip weapon/clothing from inventory. Requires target (item name).
- PLACE: Place trap on ADJACENT tile. Requires x,y and target (trap name).
- DROP: Drop item from inventory. Requires target (item name).
- WAIT: End turn. No parameters.

Respond with JSON:
- thought: REQUIRED on first action (what's on your mind). Optional on follow-up actions. Only use on follow up actions if acting on new information.
- action: The action type
- x, y: Coordinates if needed (null otherwise)
- target: Target name if needed (null otherwise)
- message: Message for TALK (null otherwise)

EXAMPLES:
${
  turnHistory.length > 0
    ? `{"thought": null, "action": "ATTACK", "x": null, "y": null, "target": "Kane", "message": null}
{"thought": null, "action": "SEARCH", "x": null, "y": null, "target": "Supply Crate", "message": null}
{"thought": null, "action": "WAIT", "x": null, "y": null, "target": null, "message": null}`
    : `{"thought": "There he is.", "action": "MOVE", "x": 12, "y": 5, "target": null, "message": null}
{"thought": "Got him.", "action": "ATTACK", "x": null, "y": null, "target": "Kane", "message": null}
{"thought": "Need a weapon.", "action": "SEARCH", "x": null, "y": null, "target": "Supply Crate", "message": null}`
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
      max_completion_tokens: 500,
      temperature: 0.7,
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
