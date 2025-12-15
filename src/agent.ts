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
  knowledge: CharacterKnowledge
): string {
  const lines: string[] = [];

  const hasWeapon = !!knowledge.status.equippedWeapon;
  const weaponName = knowledge.status.equippedWeapon?.name;
  const weaponDamage = knowledge.status.equippedWeapon?.damage ?? 1;

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
    lines.push(
      `*** YOU ARE UNARMED (fists only, 1 damage) - find a weapon! ***`
    );
  }

  if (knowledge.status.inventory.length > 0) {
    lines.push(
      `\nInventory: ${knowledge.status.inventory.map((i) => i.name).join(", ")}`
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
  } else if (deadEnemies.length > 0) {
    lines.push(`*** ALL ENEMIES ARE DEAD - YOU WON! ***`);
    for (const { character: other } of deadEnemies) {
      lines.push(`  - ${other.name}: DEAD`);
    }
  } else {
    lines.push(`No enemies visible - move to find them!`);
  }

  const reachable = getReachableTiles(world, character);

  // Find tiles that are adjacent to enemies (for MOVE+ATTACK combo)
  const tilesAdjacentToEnemies: { tile: Position; enemy: string }[] = [];
  for (const tile of reachable) {
    for (const { character: enemy, position: enemyPos } of livingEnemies) {
      if (manhattanDistance(tile, enemyPos) === 1) {
        tilesAdjacentToEnemies.push({ tile, enemy: enemy.name });
      }
    }
  }

  if (tilesAdjacentToEnemies.length > 0) {
    lines.push(`\n=== ATTACK OPPORTUNITIES (move here then attack!) ===`);
    for (const { tile, enemy } of tilesAdjacentToEnemies) {
      lines.push(`  MOVE ${tile.x} ${tile.y} then ATTACK ${enemy}`);
    }
  }

  lines.push(
    `\n=== TILES YOU CAN MOVE TO (max ${character.movementRange} tiles) ===`
  );
  if (reachable.length > 0) {
    const reachableStr = reachable.map((p) => `(${p.x},${p.y})`).join(", ");
    lines.push(reachableStr);
  } else {
    lines.push(`None - you are blocked!`);
  }

  const containers = knowledge.visible.items.filter(
    (i) => i.item.type === "container"
  );
  const groundItems = knowledge.visible.items.filter(
    (i) => i.item.type !== "container"
  );

  const containersAtPosition = containers.filter(
    (c) =>
      c.position.x === knowledge.status.position.x &&
      c.position.y === knowledge.status.position.y
  );
  const containersNearby = containers.filter(
    (c) =>
      c.position.x !== knowledge.status.position.x ||
      c.position.y !== knowledge.status.position.y
  );

  if (containersAtPosition.length > 0) {
    lines.push(`\n=== CONTAINERS AT YOUR POSITION ===`);
    for (const { item } of containersAtPosition) {
      if (item.searched) {
        if (item.contents && item.contents.length > 0) {
          lines.push(`${item.name} (searched) - still contains:`);
          for (const content of item.contents) {
            lines.push(`  -> ${content.name} - you can PICKUP this!`);
          }
        } else {
          lines.push(`${item.name} (searched) - EMPTY, nothing left`);
        }
      } else {
        lines.push(`${item.name} (not searched) - SEARCH it to see contents!`);
      }
    }
  }

  if (containersNearby.length > 0 && !hasWeapon) {
    lines.push(`\n=== CONTAINERS NEARBY (need weapon?) ===`);
    for (const { item, position } of containersNearby) {
      if (item.searched) {
        if (item.contents && item.contents.length > 0) {
          lines.push(
            `${item.name} at ${formatPosition(
              position
            )} contains: ${item.contents.map((c) => c.name).join(", ")}`
          );
        } else {
          lines.push(`${item.name} at ${formatPosition(position)} - EMPTY`);
        }
      } else {
        lines.push(
          `${item.name} at ${formatPosition(position)} - not searched`
        );
      }
    }
  }

  if (groundItems.length > 0) {
    lines.push(`\nItems on the ground:`);
    for (const { item, position } of groundItems) {
      lines.push(`  - ${item.name} at ${formatPosition(position)}`);
    }
  }

  lines.push(`\n=== YOUR MEMORIES ===`);
  const recentMemories = knowledge.memories.slice(-15);
  if (recentMemories.length > 0) {
    for (const memory of recentMemories) {
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
  lines.push(
    `  - MOVE x y : Move to position (max ${character.movementRange} tiles)`
  );
  lines.push(`  - SEARCH container_name : Search container at your position`);
  lines.push(`  - PICKUP item_name : Take item from searched container`);
  lines.push(
    `  - EQUIP item_name : Equip weapon/clothing (cannot ATTACK same turn)`
  );
  lines.push(`  - DROP item_name : Drop item`);
  lines.push(``);
  lines.push(`These END your turn:`);
  lines.push(`  - ATTACK character_name : Attack adjacent character (1 tile)`);
  lines.push(
    `  - TALK character_name "message" : Speak to character (2 tiles)`
  );
  lines.push(`  - WAIT : End turn doing nothing`);
  lines.push(``);
  lines.push(`Write actions on SEPARATE LINES. Example:`);
  lines.push(`MOVE 2 2`);
  lines.push(`SEARCH Kitchen Cupboard`);
  lines.push(`PICKUP Kitchen Knife`);
  lines.push(`EQUIP Kitchen Knife`);

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

// JSON Schema for structured output
// Note: strict mode requires all properties in 'required', so we use nullable types
const actionResponseSchema = {
  name: "game_actions",
  strict: true,
  schema: {
    type: "object",
    properties: {
      reasoning: {
        type: "string",
        description: "1-2 sentences explaining your decision",
      },
      actions: {
        type: "array",
        items: {
          type: "object",
          properties: {
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
              description: "X coordinate for MOVE (null if not applicable)",
            },
            y: {
              type: ["number", "null"],
              description: "Y coordinate for MOVE (null if not applicable)",
            },
            target: {
              type: ["string", "null"],
              description:
                "Target name for ATTACK, TALK, SEARCH, PICKUP, DROP, EQUIP, PLACE (null if not applicable)",
            },
            message: {
              type: ["string", "null"],
              description: "Message content for TALK (null if not applicable)",
            },
          },
          required: ["action", "x", "y", "target", "message"],
          additionalProperties: false,
        },
        description: "List of actions to perform this turn",
      },
    },
    required: ["reasoning", "actions"],
    additionalProperties: false,
  },
};

type JsonAction = {
  action: string;
  x: number | null;
  y: number | null;
  target: string | null;
  message: string | null;
};

type JsonResponse = {
  reasoning: string;
  actions: JsonAction[];
};

function parseJsonActions(
  jsonResponse: JsonResponse,
  knowledge: CharacterKnowledge
): { actions: Action[]; errors: string[] } {
  const actions: Action[] = [];
  const errors: string[] = [];
  let hasMoved = false;

  for (const jsonAction of jsonResponse.actions) {
    const actionType = jsonAction.action.toLowerCase() as ValidActionType;

    // Validate action type
    if (!VALID_ACTION_TYPES.includes(actionType)) {
      errors.push(`Unknown action type: "${jsonAction.action}"`);
      continue;
    }

    // Skip duplicate moves
    if (actionType === "move" && hasMoved) {
      errors.push("Duplicate MOVE ignored - only one move per turn");
      continue;
    }

    let action: Action | null = null;

    switch (actionType) {
      case "move":
        if (jsonAction.x !== null && jsonAction.y !== null) {
          action = {
            type: "move",
            targetPosition: { x: jsonAction.x!, y: jsonAction.y! },
          };
          hasMoved = true;
        } else {
          errors.push("MOVE requires x and y coordinates");
        }
        break;

      case "attack":
        if (jsonAction.target) {
          const target = knowledge.visible.characters.find(
            (c) =>
              c.character.name.toLowerCase() ===
                jsonAction.target!.toLowerCase() ||
              c.character.name
                .toLowerCase()
                .includes(jsonAction.target!.toLowerCase())
          );
          if (target) {
            action = { type: "attack", targetCharacterId: target.character.id };
          } else {
            errors.push(`ATTACK target "${jsonAction.target}" not visible`);
          }
        } else {
          errors.push("ATTACK requires a target name");
        }
        break;

      case "talk":
        if (jsonAction.target && jsonAction.message) {
          const target = knowledge.visible.characters.find(
            (c) =>
              c.character.name.toLowerCase() ===
                jsonAction.target!.toLowerCase() ||
              c.character.name
                .toLowerCase()
                .includes(jsonAction.target!.toLowerCase())
          );
          if (target) {
            action = {
              type: "talk",
              targetCharacterId: target.character.id,
              message: jsonAction.message,
            };
          } else {
            errors.push(`TALK target "${jsonAction.target}" not visible`);
          }
        } else {
          errors.push("TALK requires a target name and message");
        }
        break;

      case "search":
        if (jsonAction.target) {
          const container = knowledge.visible.items.find(
            (i) =>
              i.item.type === "container" &&
              i.item.name
                .toLowerCase()
                .includes(jsonAction.target!.toLowerCase())
          );
          if (container) {
            action = {
              type: "search_container",
              targetItemId: container.item.id,
            };
          } else {
            action = {
              type: "search_container",
              targetItemName: jsonAction.target,
            };
          }
        } else {
          errors.push("SEARCH requires a container name");
        }
        break;

      case "pickup":
        if (jsonAction.target) {
          let foundItem = false;
          // Check containers first
          for (const visibleTile of knowledge.visible.tiles) {
            for (const item of visibleTile.items) {
              if (
                item.name
                  .toLowerCase()
                  .includes(jsonAction.target!.toLowerCase())
              ) {
                action = { type: "pick_up", targetItemId: item.id };
                foundItem = true;
                break;
              }
              if (item.type === "container" && item.contents) {
                for (const content of item.contents) {
                  if (
                    content.name
                      .toLowerCase()
                      .includes(jsonAction.target!.toLowerCase())
                  ) {
                    action = { type: "pick_up", targetItemId: content.id };
                    foundItem = true;
                    break;
                  }
                }
              }
              if (foundItem) break;
            }
            if (foundItem) break;
          }
          if (!foundItem) {
            action = { type: "pick_up", targetItemName: jsonAction.target };
          }
        } else {
          errors.push("PICKUP requires an item name");
        }
        break;

      case "drop":
        if (jsonAction.target) {
          const item = knowledge.status.inventory.find((i) =>
            i.name.toLowerCase().includes(jsonAction.target!.toLowerCase())
          );
          if (item) {
            action = { type: "drop", targetItemId: item.id };
          } else {
            action = { type: "drop", targetItemName: jsonAction.target };
          }
        } else {
          errors.push("DROP requires an item name");
        }
        break;

      case "equip":
        if (jsonAction.target) {
          const item = knowledge.status.inventory.find((i) =>
            i.name.toLowerCase().includes(jsonAction.target!.toLowerCase())
          );
          if (item) {
            action = { type: "equip", targetItemId: item.id };
          } else {
            action = { type: "equip", targetItemName: jsonAction.target };
          }
        } else {
          errors.push("EQUIP requires an item name");
        }
        break;

      case "place":
        if (jsonAction.target) {
          const item = knowledge.status.inventory.find(
            (i) =>
              i.name.toLowerCase().includes(jsonAction.target!.toLowerCase()) &&
              i.type === "trap"
          );
          if (item) {
            action = { type: "place", targetItemId: item.id };
          } else {
            action = { type: "place", targetItemName: jsonAction.target };
          }
        } else {
          errors.push("PLACE requires a trap name");
        }
        break;

      case "wait":
        action = { type: "wait" };
        break;
    }

    if (action) {
      actions.push(action);
      // Turn-ending actions
      if (
        action.type === "attack" ||
        action.type === "talk" ||
        action.type === "wait"
      ) {
        break;
      }
    }
  }

  return { actions, errors };
}

export async function getAgentDecision(
  world: World,
  character: Character,
  lastFailure?: string
): Promise<{
  actions: Action[];
  reasoning: string;
  fullPrompt?: string;
  fullResponse?: string;
  errors?: string[];
}> {
  if (!openai) {
    return {
      actions: [{ type: "wait" }],
      reasoning: "AI agent not initialized (no API key)",
    };
  }

  const knowledge = getCharacterKnowledge(world, character);
  let situationDescription = formatKnowledge(world, character, knowledge);

  if (lastFailure) {
    situationDescription = `⚠️ YOUR LAST ACTION FAILED: ${lastFailure}\nYou must choose a DIFFERENT action. Check the "TILES YOU CAN MOVE TO" list carefully!\n\n${situationDescription}`;
  }

  const systemPrompt = `You are playing a character in a turn-based game. Your CHARACTER DESCRIPTION below defines who you are, your goals, and your personality. Act accordingly.

AVAILABLE ACTIONS (use exact names in "action" field):
- MOVE: Move to a tile. Requires x and y coordinates from "TILES YOU CAN MOVE TO" list.
- ATTACK: Attack an adjacent character. Requires target (character name). Ends turn.
- TALK: Speak to character within 2 tiles. Requires target and message. Ends turn.
- SEARCH: Search a container at your position. Requires target (container name).
- PICKUP: Pick up an item from searched container or ground. Requires target (item name).
- EQUIP: Equip a weapon or clothing from inventory. Requires target (item name).
- PLACE: Place a trap from your inventory onto your current tile. Requires target (trap name).
- DROP: Drop an item from inventory. Requires target (item name).
- WAIT: End turn doing nothing. No parameters needed.

RULES:
- "CAN ATTACK" next to a name = adjacent, you can attack them
- "CAN TALK" next to a name = within 2 tiles, you can speak to them
- You can chain actions: MOVE first, then other actions
- ATTACK or TALK ends your turn (but you can MOVE before either)
- Items on corpses drop to the ground and can be picked up
- TRAPS are invisible to enemies! Place them where enemies will walk, then attack when they're trapped

Respond with JSON containing:
- reasoning: 1-2 sentences explaining your decision
- actions: array of action objects

EXAMPLES:
{"reasoning": "I need to flee!", "actions": [{"action": "MOVE", "x": 12, "y": 5}]}
{"reasoning": "Enemy adjacent. Strike!", "actions": [{"action": "ATTACK", "target": "Kane"}]}
{"reasoning": "Move and negotiate.", "actions": [{"action": "MOVE", "x": 5, "y": 7}, {"action": "TALK", "target": "Razor", "message": "Let's work together!"}]}
{"reasoning": "Arm myself from corpse.", "actions": [{"action": "PICKUP", "target": "Hunting Knife"}, {"action": "EQUIP", "target": "Hunting Knife"}]}
{"reasoning": "Set a trap for the hunter.", "actions": [{"action": "MOVE", "x": 8, "y": 5}, {"action": "PLACE", "target": "Bear Trap"}]}`;

  const userPrompt = `${character.personalityPrompt}

CURRENT SITUATION:
${situationDescription}

What do you do?`;

  try {
    const response = await openai.chat.completions.create({
      model: "gpt-4o",
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
        actions: [{ type: "wait" }],
        reasoning: `(Failed to parse JSON: ${content})`,
        fullPrompt,
        fullResponse: content,
        errors: ["Invalid JSON response from AI"],
      };
    }

    const { actions, errors } = parseJsonActions(jsonResponse, knowledge);

    if (errors.length > 0) {
      console.warn("Action parsing errors:", errors);
    }

    if (actions.length === 0) {
      console.warn(`No valid actions parsed from: ${content}`);
      return {
        actions: [{ type: "wait" }],
        reasoning: jsonResponse.reasoning || "(No valid actions)",
        fullPrompt,
        fullResponse: content,
        errors: errors.length > 0 ? errors : ["No valid actions in response"],
      };
    }

    return {
      actions,
      reasoning: jsonResponse.reasoning,
      fullPrompt,
      fullResponse: content,
      errors: errors.length > 0 ? errors : undefined,
    };
  } catch (error) {
    console.error("Agent error:", error);
    return {
      actions: [{ type: "wait" }],
      reasoning: `Error: ${
        error instanceof Error ? error.message : "Unknown error"
      }`,
      errors: [error instanceof Error ? error.message : "Unknown error"],
    };
  }
}
