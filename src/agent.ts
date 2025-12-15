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

  const pos = knowledge.status.position;

  lines.push(`\n⚠️ TILES YOU CAN MOVE TO (ONLY these - pick one!):`);
  if (reachable.length > 0) {
    const sortedReachable = [...reachable].sort((a, b) => {
      const distA = Math.abs(a.x - pos.x) + Math.abs(a.y - pos.y);
      const distB = Math.abs(b.x - pos.x) + Math.abs(b.y - pos.y);
      return distB - distA;
    });
    const farthest = sortedReachable.slice(0, 10);
    const reachableStr = farthest.map((p) => `(${p.x},${p.y})`).join(", ");
    lines.push(`Farthest: ${reachableStr}`);
    if (sortedReachable.length > 10) {
      lines.push(`(and ${sortedReachable.length - 10} closer tiles...)`);
    }
  } else {
    lines.push(`None - you are blocked!`);
  }

  const containers = knowledge.visible.items.filter(
    (i) => i.item.type === "container"
  );
  const groundItems = knowledge.visible.items.filter(
    (i) => i.item.type !== "container"
  );
  const isAdjacent = (p: { x: number; y: number }) =>
    Math.abs(p.x - pos.x) <= 1 &&
    Math.abs(p.y - pos.y) <= 1 &&
    (p.x !== pos.x || p.y !== pos.y);

  const adjacentContainers = containers.filter((c) => isAdjacent(c.position));
  const farContainers = containers.filter((c) => !isAdjacent(c.position));

  if (adjacentContainers.length > 0) {
    lines.push(
      `\n=== ADJACENT CONTAINERS (you can SEARCH now, no MOVE needed!) ===`
    );
    for (const { item } of adjacentContainers) {
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
        lines.push(`${item.name} - NOT SEARCHED! Use: SEARCH "${item.name}"`);
      }
    }
  }

  if (farContainers.length > 0 && !hasWeapon) {
    lines.push(`\n=== CONTAINERS FURTHER AWAY ===`);
    for (const { item, position } of farContainers) {
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
          `${item.name} at ${formatPosition(
            position
          )} - not searched (move adjacent to search)`
        );
      }
    }
  }

  if (groundItems.length > 0) {
    const weaponsOnGround = groundItems.filter((i) => i.item.type === "weapon");
    const otherItems = groundItems.filter((i) => i.item.type !== "weapon");

    if (weaponsOnGround.length > 0 && !hasWeapon) {
      lines.push(`\n⚠️ WEAPONS ON THE GROUND (you're unarmed - grab one!):`);
      for (const { item, position } of weaponsOnGround) {
        lines.push(
          `  -> ${item.name} at ${formatPosition(position)} - PICKUP this!`
        );
      }
    } else if (weaponsOnGround.length > 0) {
      lines.push(`\nWeapons on the ground:`);
      for (const { item, position } of weaponsOnGround) {
        lines.push(`  - ${item.name} at ${formatPosition(position)}`);
      }
    }

    if (otherItems.length > 0) {
      lines.push(`\nOther items on the ground:`);
      for (const { item, position } of otherItems) {
        lines.push(`  - ${item.name} at ${formatPosition(position)}`);
      }
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
  lines.push(`  - SEARCH container_name : Search adjacent container`);
  lines.push(
    `  - PICKUP item_name : Take item from adjacent searched container`
  );
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
        description:
          "MAX 15 words. Raw emotional inner monologue like talking to yourself. No coordinates.",
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
  knowledge: CharacterKnowledge,
  world: World,
  character: Character
): { actions: Action[]; errors: string[] } {
  const actions: Action[] = [];
  const errors: string[] = [];
  let hasMoved = false;
  let hasSearched = false;
  const pendingTrapPickups: { id: string; name: string }[] = [];
  const reachableTiles = getReachableTiles(world, character);

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
        } else if (jsonAction.target) {
          // MOVE TO [target name] - find best tile toward target
          const targetPos = findTargetPosition(
            jsonAction.target,
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
              action = {
                type: "move",
                targetPosition: bestTile,
              };
              hasMoved = true;
            } else {
              errors.push(
                `MOVE TO "${jsonAction.target}" failed: no reachable tiles`
              );
            }
          } else {
            errors.push(
              `MOVE TO "${jsonAction.target}" failed: target not found or not remembered`
            );
          }
        } else {
          errors.push("MOVE requires x,y coordinates OR a target name");
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
            hasSearched = true;
          } else {
            action = {
              type: "search_container",
              targetItemName: jsonAction.target,
            };
            hasSearched = true;
          }
        } else {
          errors.push("SEARCH requires a container name");
        }
        break;

      case "pickup":
        if (jsonAction.target) {
          let foundItem: { id: string; name: string; type: string } | null =
            null;
          // Check containers first
          for (const visibleTile of knowledge.visible.tiles) {
            for (const item of visibleTile.items) {
              if (
                item.name
                  .toLowerCase()
                  .includes(jsonAction.target!.toLowerCase())
              ) {
                foundItem = { id: item.id, name: item.name, type: item.type };
                action = { type: "pick_up", targetItemId: item.id };
                break;
              }
              if (item.type === "container" && item.contents) {
                for (const content of item.contents) {
                  if (
                    content.name
                      .toLowerCase()
                      .includes(jsonAction.target!.toLowerCase())
                  ) {
                    foundItem = {
                      id: content.id,
                      name: content.name,
                      type: content.type,
                    };
                    action = { type: "pick_up", targetItemId: content.id };
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
          } else if (foundItem.type === "trap") {
            pendingTrapPickups.push({ id: foundItem.id, name: foundItem.name });
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
        if (hasSearched) {
          errors.push(
            `PLACE failed: Cannot place a trap after searching a container in the same turn.`
          );
        } else if (!jsonAction.target) {
          errors.push("PLACE requires a trap name");
        } else if (jsonAction.x === null || jsonAction.y === null) {
          errors.push("PLACE requires x,y coordinates for adjacent tile");
        } else {
          const trapsInInv = knowledge.status.inventory.filter(
            (i) => i.type === "trap"
          );
          const allTraps = [
            ...trapsInInv.map((i) => ({ id: i.id, name: i.name })),
            ...pendingTrapPickups,
          ];
          if (allTraps.length === 0) {
            errors.push(
              `PLACE failed: No traps in inventory! You already placed it or never picked one up.`
            );
          } else {
            const item = allTraps.find((i) =>
              i.name.toLowerCase().includes(jsonAction.target!.toLowerCase())
            );
            if (item) {
              action = {
                type: "place",
                targetItemId: item.id,
                targetPosition: { x: jsonAction.x, y: jsonAction.y },
              };
            } else {
              errors.push(
                `PLACE failed: "${
                  jsonAction.target
                }" not found in inventory. You have: ${allTraps
                  .map((t) => t.name)
                  .join(", ")}`
              );
            }
          }
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
    situationDescription = `⚠️ YOUR LAST ACTION FAILED: ${lastFailure}

TIP: Use MOVE with a target name (e.g., {"action": "MOVE", "target": "Hunting Knife"}) to auto-navigate!

${situationDescription}`;
  }

  const systemPrompt = `You are playing a character in a turn-based game. Your CHARACTER DESCRIPTION below defines who you are, your goals, and your personality. Act accordingly.

AVAILABLE ACTIONS (use exact names in "action" field):
- MOVE: Two options:
  1. MOVE with x,y coordinates from "TILES YOU CAN MOVE TO" list
  2. MOVE with target name (e.g., "Hunting Knife", "Supply Crate", "Kane") - auto-navigates toward it!
- ATTACK: Attack an adjacent character. Requires target (character name). Works unarmed (punch)! Ends turn.
- TALK: Speak to character within 2 tiles. Requires target and message. Ends turn.
- SEARCH: Search an adjacent container (can't walk on container tiles). Requires target (container name).
- PICKUP: Pick up item from adjacent searched container or ground. Requires target (item name).
- EQUIP: Equip a weapon or clothing from inventory. Requires target (item name).
- PLACE: Place trap on ADJACENT tile. Requires x, y (adjacent coords) and target (trap name). Warning: you can trigger your own trap!
- DROP: Drop an item from inventory. Requires target (item name).
- WAIT: End turn doing nothing. No parameters needed.

RULES:
- MOVE: Use target name (easier) OR pick from "TILES YOU CAN MOVE TO" list
- "CAN ATTACK" = adjacent, attack now. "CAN TALK" = within 2 tiles.
- You can chain: MOVE → then SEARCH/PICKUP/EQUIP/PLACE → then ATTACK or TALK
- ATTACK or TALK ends your turn
- TRAPS are invisible to enemies! Place them in chokepoints

Respond with JSON containing:
- reasoning: MAX 15 WORDS. Raw inner monologue - emotional, human, like talking to yourself. NO coordinates, NO "target/mission/objective".
- actions: array of action objects

EXAMPLES:
{"reasoning": "Gotta run. NOW.", "actions": [{"action": "MOVE", "x": 12, "y": 5}]}
{"reasoning": "Need that knife!", "actions": [{"action": "MOVE", "target": "Hunting Knife"}, {"action": "PICKUP", "target": "Hunting Knife"}]}
{"reasoning": "Die.", "actions": [{"action": "ATTACK", "target": "Kane"}]}
{"reasoning": "A knife! Hell yes.", "actions": [{"action": "PICKUP", "target": "Knife"}, {"action": "EQUIP", "target": "Knife"}]}
{"reasoning": "Walk into my trap, idiots.", "actions": [{"action": "PLACE", "x": 5, "y": 6, "target": "Bear Trap"}]}`;

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
        actions: [{ type: "wait" }],
        reasoning: `(Failed to parse JSON: ${content})`,
        fullPrompt,
        fullResponse: content,
        errors: ["Invalid JSON response from AI"],
      };
    }

    const { actions, errors } = parseJsonActions(
      jsonResponse,
      knowledge,
      world,
      character
    );

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
