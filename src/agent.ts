import type {
  Character,
  CharacterKnowledge,
  Action,
  World,
  Position,
  BloodContract,
  GameEvent,
  Item,
  Effect,
  EffectAction,
} from "./types";
import {
  getCharacterKnowledge,
  getReachableTiles,
  MAX_TALK_DISTANCE,
  describeEffect,
  findPath,
} from "./engine";
import OpenAI from "openai";

const MAX_COMPLETION_TOKENS = 10_000;
export const DEFAULT_AI_MODEL = "gpt-5.2";
export const DEFAULT_REASONING_EFFORT = "none" as const;

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

// Chebyshev distance - diagonals count as 1 step
function chebyshevDistance(a: Position, b: Position): number {
  return Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));
}

function isAdjacent(a: Position, b: Position): boolean {
  return chebyshevDistance(a, b) <= 1;
}

function generateOmniscientMapJson(world: World): string {
  const tiles: Array<Record<string, unknown>> = [];

  for (let y = 0; y < world.height; y++) {
    for (let x = 0; x < world.width; x++) {
      const tile = world.tiles[y][x];

      const tileData: Record<string, unknown> = {
        x,
        y,
        terrain: tile.type,
      };

      // Feature details
      if (tile.feature) {
        const feature = tile.feature;
        const featureData: Record<string, unknown> = {
          type: feature.type,
          name: feature.name,
        };

        if (feature.type === "door") {
          featureData.locked = feature.locked;
          featureData.open = feature.open;
        }

        if (feature.type === "chest") {
          featureData.searched = feature.searched;
          if (feature.contents.length > 0) {
            featureData.contents = feature.contents.map(serializeItem);
          }
        }

        if (feature.type === "trap") {
          if (feature.appliesEffect) {
            featureData.appliesEffect = serializeEffect(feature.appliesEffect);
          }
        }

        tileData.feature = featureData;
      }

      // Items on tile
      if (tile.items.length > 0) {
        tileData.items = tile.items.map(serializeItem);
      }

      // Character on tile
      const charOnTile = world.characters.find(
        (c) => c.position.x === x && c.position.y === y
      );
      if (charOnTile) {
        tileData.character = serializeCharacter(charOnTile);
      }

      tiles.push(tileData);
    }
  }

  const mapData = {
    worldSize: { width: world.width, height: world.height },
    tiles,
  };

  return JSON.stringify(mapData, null, 2);
}

// Serialize an item with all its details
function serializeItem(item: Item): Record<string, unknown> {
  const data: Record<string, unknown> = {
    name: item.name,
    type: item.type,
  };

  if (item.damage !== undefined) {
    data.damage = item.damage;
  }
  if (item.armor !== undefined) {
    data.armor = item.armor;
  }
  if (item.useEffect) {
    data.useEffect = serializeEffectAction(item.useEffect);
  }
  if (item.trapEffect) {
    data.trapEffect = serializeEffect(item.trapEffect);
  }
  if (item.contract) {
    data.contract = {
      issuerName: item.contract.issuerName,
      targetName: item.contract.targetName,
      contents: item.contract.contents,
      expiryTurn: item.contract.expiryTurn,
      signed: item.contract.signed,
    };
  }
  if (item.unlocksFeatureId) {
    data.unlocksFeatureId = item.unlocksFeatureId;
  }

  return data;
}

// Serialize an effect action
function serializeEffectAction(action: EffectAction): Record<string, unknown> {
  if (action.type === "damage") {
    return { type: "damage", amount: action.amount };
  } else if (action.type === "heal") {
    return { type: "heal", amount: action.amount };
  } else if (action.type === "modify_stat") {
    return {
      type: "modify_stat",
      stat: action.stat,
      operation: action.operation,
      value: action.value,
    };
  } else if (action.type === "message") {
    return { type: "message", text: action.text };
  } else if (action.type === "custom") {
    return { type: "custom", prompt: action.prompt };
  } else if (action.type === "apply_effect") {
    return { type: "apply_effect", effect: serializeEffect(action.effect) };
  }
  return { type: "unknown" };
}

// Serialize an effect with all its details
function serializeEffect(effect: Effect): Record<string, unknown> {
  return {
    name: effect.name,
    duration: effect.duration,
    preventsMovement: effect.preventsMovement ?? false,
    triggers: effect.triggers.map((t) => ({
      on: t.on,
      actions: t.actions.map(serializeEffectAction),
    })),
  };
}

// Serialize a character with full details
function serializeCharacter(char: Character): Record<string, unknown> {
  const data: Record<string, unknown> = {
    name: char.name,
    alive: char.alive,
    hp: char.hp,
    maxHp: char.maxHp,
  };

  if (char.equippedWeapon) {
    data.equippedWeapon = serializeItem(char.equippedWeapon);
  }
  if (char.equippedClothing) {
    data.equippedClothing = serializeItem(char.equippedClothing);
  }
  if (char.effects.length > 0) {
    data.effects = char.effects.map(serializeEffect);
  }

  return data;
}

export function getUnexploredFrontierTiles(
  world: World,
  character: Character
): Array<{ x: number; y: number; moveToward?: { x: number; y: number } }> {
  const unexploredFrontier: Array<{
    x: number;
    y: number;
    moveToward?: { x: number; y: number };
  }> = [];
  const exploredKeys = new Set(character.mapMemory.keys());
  const frontierChecked = new Set<string>();

  for (const [key, memory] of character.mapMemory.entries()) {
    if (memory.type === "wall") continue;

    const [x, y] = key.split(",").map(Number);

    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (dx === 0 && dy === 0) continue;

        const adjX = x + dx;
        const adjY = y + dy;
        const adjKey = `${adjX},${adjY}`;

        if (exploredKeys.has(adjKey) || frontierChecked.has(adjKey)) continue;
        frontierChecked.add(adjKey);

        if (adjX < 0 || adjX >= world.width || adjY < 0 || adjY >= world.height)
          continue;

        const adjTile = world.tiles[adjY]?.[adjX];
        if (adjTile && adjTile.type !== "wall" && adjTile.type !== "water") {
          unexploredFrontier.push({ x: adjX, y: adjY });
        }
      }
    }
  }

  unexploredFrontier.sort((a, b) => {
    const distA = Math.max(
      Math.abs(a.x - character.position.x),
      Math.abs(a.y - character.position.y)
    );
    const distB = Math.max(
      Math.abs(b.x - character.position.x),
      Math.abs(b.y - character.position.y)
    );
    return distA - distB;
  });

  // For each frontier tile, find the path and determine which direction to move
  for (const frontier of unexploredFrontier) {
    // Find an explored tile adjacent to this frontier that we can path to
    let bestPath: Position[] | null = null;
    let targetPos: Position | null = null;

    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (dx === 0 && dy === 0) continue;
        const checkX = frontier.x + dx;
        const checkY = frontier.y + dy;
        const checkKey = `${checkX},${checkY}`;

        // This tile must be explored and walkable
        const memory = character.mapMemory.get(checkKey);
        if (memory && memory.type !== "wall") {
          // Find path from character to this explored tile
          const path = findPath(
            world,
            character.position,
            { x: checkX, y: checkY },
            100 // Allow long paths
          );
          if (path && (bestPath === null || path.length < bestPath.length)) {
            bestPath = path;
            targetPos = { x: checkX, y: checkY };
          }
        }
      }
    }

    // If we found a path, the first step is where to move toward
    if (bestPath && bestPath.length > 0) {
      frontier.moveToward = { x: bestPath[0].x, y: bestPath[0].y };
    } else if (targetPos) {
      // We're already adjacent to an explored tile next to the frontier
      frontier.moveToward = targetPos;
    }
  }

  return unexploredFrontier;
}

function generateMapJson(world: World, character: Character): string {
  // Build a flat list of explored tiles with full details
  const tiles: Array<Record<string, unknown>> = [];

  // Collect all characters visible in memory for enriched data
  const visibleCharacters = new Map<string, Character>();
  for (const char of world.characters) {
    const key = `${char.position.x},${char.position.y}`;
    if (character.mapMemory.has(key)) {
      visibleCharacters.set(key, char);
    }
  }

  // Get unexplored frontier tiles using the shared function
  const unexploredFrontier = getUnexploredFrontierTiles(world, character);

  for (const [key, memory] of character.mapMemory.entries()) {
    const [x, y] = key.split(",").map(Number);
    const worldTile = world.tiles[y]?.[x];

    const tileData: Record<string, unknown> = {
      x,
      y,
      terrain: memory.type,
    };

    // Feature details
    if (memory.feature && worldTile?.feature) {
      const feature = worldTile.feature;
      const featureData: Record<string, unknown> = {
        type: feature.type,
        name: feature.name,
      };

      if (feature.type === "door") {
        featureData.locked = feature.locked;
        featureData.open = feature.open;
      }

      if (feature.type === "chest") {
        featureData.searched = feature.searched;
        if (feature.contents.length > 0) {
          featureData.contents = feature.contents.map(serializeItem);
        }
      }

      if (feature.type === "trap") {
        if (feature.ownerId === character.id) {
          featureData.ownTrap = true;
        }
        if (feature.appliesEffect) {
          featureData.appliesEffect = serializeEffect(feature.appliesEffect);
        }
      }

      tileData.feature = featureData;
    }

    // Items on tile - get full item details from world
    if (worldTile?.items && worldTile.items.length > 0) {
      tileData.items = worldTile.items.map(serializeItem);
    }

    // Character on tile with full details
    if (memory.characterName) {
      const charOnTile = visibleCharacters.get(key);
      if (charOnTile && charOnTile.id !== character.id) {
        tileData.character = serializeCharacter(charOnTile);
      } else {
        tileData.character = {
          name: memory.characterName,
          alive: memory.characterAlive ?? false,
        };
      }
    }

    tiles.push(tileData);
  }

  // Sort tiles by y then x for consistent ordering
  tiles.sort((a, b) => {
    const ay = a.y as number;
    const by = b.y as number;
    const ax = a.x as number;
    const bx = b.x as number;
    return ay === by ? ax - bx : ay - by;
  });

  const mapData = {
    yourPosition: { x: character.position.x, y: character.position.y },
    worldSize: { width: world.width, height: world.height },
    exploredTiles: tiles,
    unexploredAdjacentTiles: unexploredFrontier,
  };

  return JSON.stringify(mapData, null, 2);
}

// A legal action contains both the display format (for the agent) and the actual Action object
export type LegalAction = {
  display: Record<string, unknown>;
  action: Action;
};

export function getLegalActions(
  world: World,
  character: Character,
  knowledge: CharacterKnowledge,
  hasMoved: boolean
): LegalAction[] {
  const legalActions: LegalAction[] = [];
  const pos = character.position;

  // Check movement-preventing effects
  const canMove = !character.effects.some((e) => e.preventsMovement);

  // MOVE actions - only if hasn't moved this turn and can move
  if (!hasMoved && canMove) {
    const reachable = getReachableTiles(world, character);
    for (const tile of reachable) {
      legalActions.push({
        display: { action: "MOVE", x: tile.x, y: tile.y },
        action: { type: "move", targetPosition: tile },
      });
    }

    // MOVE_TOWARD is available for ANY coordinates (not just frontier)
    // The engine will handle pathfinding and get as close as possible
    // We don't pre-generate all possible MOVE_TOWARD actions since there could be hundreds
    // Instead, we document it and validate in parseJsonAction
  }

  // Use visible characters from knowledge
  const visibleCharacters = knowledge.visible.characters;

  // ATTACK actions - adjacent visible living characters
  for (const { character: other, position } of visibleCharacters) {
    if (!other.alive) continue;
    if (isAdjacent(pos, position)) {
      legalActions.push({
        display: { action: "ATTACK", target: other.name },
        action: { type: "attack", targetCharacterId: other.id },
      });
    }
  }

  // TALK actions - visible characters within talk distance
  for (const { character: other, position } of visibleCharacters) {
    if (!other.alive) continue;
    const dist = Math.abs(pos.x - position.x) + Math.abs(pos.y - position.y);
    if (dist <= MAX_TALK_DISTANCE) {
      legalActions.push({
        display: {
          action: "TALK",
          target: other.name,
          message: "<your message>",
        },
        action: { type: "talk", targetCharacterId: other.id, message: "" }, // message filled in later
      });
    }
  }

  // Use visible items and tiles from knowledge
  const visibleTiles = knowledge.visible.tiles;
  const visibleItems = knowledge.visible.items;

  // Actually, let's iterate visibleItems properly
  for (const { item, position } of visibleItems) {
    if (isAdjacent(pos, position)) {
      legalActions.push({
        display: { action: "PICKUP", target: item.name },
        action: { type: "pick_up", targetItemName: item.name },
      });
    }
  }

  // PICKUP actions - items in searched chests on visible adjacent tiles
  for (const tile of visibleTiles) {
    if (!isAdjacent(pos, tile.position)) continue;
    if (tile.feature?.type === "chest" && tile.feature.searched) {
      for (const item of tile.feature.contents) {
        legalActions.push({
          display: { action: "PICKUP", target: item.name },
          action: { type: "pick_up", targetItemName: item.name },
        });
      }
    }
  }

  // EQUIP actions - weapons/clothing in inventory
  for (const item of character.inventory) {
    if (item.type === "weapon" && character.equippedWeapon?.id !== item.id) {
      legalActions.push({
        display: { action: "EQUIP", target: item.name },
        action: { type: "equip", targetItemId: item.id },
      });
    }
    if (
      item.type === "clothing" &&
      character.equippedClothing?.id !== item.id
    ) {
      legalActions.push({
        display: { action: "EQUIP", target: item.name },
        action: { type: "equip", targetItemId: item.id },
      });
    }
  }

  // UNEQUIP actions
  if (character.equippedWeapon) {
    legalActions.push({
      display: { action: "UNEQUIP", target: "weapon" },
      action: { type: "unequip", targetItemId: character.equippedWeapon.id },
    });
  }
  if (character.equippedClothing) {
    legalActions.push({
      display: { action: "UNEQUIP", target: "clothing" },
      action: { type: "unequip", targetItemId: character.equippedClothing.id },
    });
  }

  // USE actions - consumable items
  for (const item of character.inventory) {
    if (item.useEffect) {
      legalActions.push({
        display: { action: "USE", target: item.name },
        action: { type: "use", targetItemId: item.id },
      });
    }
  }

  // DROP actions - any item in inventory
  for (const item of character.inventory) {
    legalActions.push({
      display: { action: "DROP", target: item.name },
      action: { type: "drop", targetItemId: item.id },
    });
  }

  // SEARCH actions - visible adjacent unsearched chests
  for (const tile of visibleTiles) {
    if (!isAdjacent(pos, tile.position)) continue;
    if (tile.feature?.type === "chest" && !tile.feature.searched) {
      legalActions.push({
        display: { action: "SEARCH", target: tile.feature.name },
        action: { type: "search_container", targetFeatureId: tile.feature.id },
      });
    }
  }

  // UNLOCK actions - visible adjacent locked doors with matching key
  for (const tile of visibleTiles) {
    if (!isAdjacent(pos, tile.position)) continue;
    if (tile.feature?.type === "door" && tile.feature.locked) {
      const hasKey = character.inventory.some(
        (i) => i.type === "key" && i.unlocksFeatureId === tile.feature?.id
      );
      if (hasKey) {
        legalActions.push({
          display: { action: "UNLOCK", target: tile.feature.name },
          action: { type: "unlock", targetFeatureId: tile.feature.id },
        });
      }
    }
  }

  // PLACE actions - traps on visible adjacent walkable tiles
  const traps = character.inventory.filter((i) => i.type === "trap");
  if (traps.length > 0) {
    for (const tile of visibleTiles) {
      if (!isAdjacent(pos, tile.position)) continue;
      if (tile.type !== "wall" && tile.type !== "water" && !tile.feature) {
        for (const trap of traps) {
          legalActions.push({
            display: {
              action: "PLACE",
              x: tile.position.x,
              y: tile.position.y,
              target: trap.name,
            },
            action: {
              type: "place",
              targetPosition: tile.position,
              targetItemId: trap.id,
            },
          });
        }
      }
    }
  }

  // CONTRACT actions - offer to visible characters within talk distance
  for (const { character: other, position } of visibleCharacters) {
    if (!other.alive) continue;
    const dist = Math.abs(pos.x - position.x) + Math.abs(pos.y - position.y);
    if (dist <= MAX_TALK_DISTANCE) {
      legalActions.push({
        display: {
          action: "CONTRACT",
          target: other.name,
          terms: "<contract terms>",
          expiry: "<turns until expiry>",
        },
        action: {
          type: "issue_contract",
          targetCharacterId: other.id,
          contractContents: "",
          contractExpiry: 3,
        }, // filled in later
      });
    }
  }

  // Always available actions
  legalActions.push({
    display: { action: "WAIT" },
    action: { type: "wait" },
  });

  return legalActions;
}

// For display purposes - just returns the JSON string of display actions
export function generateLegalActionsJson(
  world: World,
  character: Character,
  knowledge: CharacterKnowledge,
  hasMoved: boolean
): string {
  const legalActions = getLegalActions(world, character, knowledge, hasMoved);
  return JSON.stringify(
    legalActions.map((la) => la.display),
    null,
    2
  );
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
  lines.push(`Gender: ${character.gender}`);
  lines.push(`HP: ${knowledge.status.hp}/${knowledge.status.maxHp}`);
  lines.push(`Position: ${formatPosition(knowledge.status.position)}`);

  // Show all active effects with their actual properties
  if (character.effects.length > 0) {
    lines.push(`\n*** ACTIVE EFFECTS ***`);
    for (const effect of character.effects) {
      const desc = describeEffect(effect);
      lines.push(`  - ${effect.name} (${effect.duration} turns): ${desc}`);
    }
  }

  // Check for attack modifiers from effects
  const hasAttackDebuff = character.effects.some((e) =>
    e.triggers.some(
      (t) =>
        t.on === "on_attack" &&
        t.actions.some(
          (a) =>
            a.type === "modify_stat" &&
            a.stat === "attack" &&
            ((a.operation === "multiply" && a.value < 1) ||
              (a.operation === "add" && a.value < 0))
        )
    )
  );

  if (hasWeapon) {
    lines.push(
      `*** YOU ARE ARMED with ${weaponName} (${weaponDamage} damage${
        hasAttackDebuff ? " - REDUCED by effect!" : ""
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

  lines.push(`\n=== YOUR MAP ===`);
  lines.push(
    `The map shows all tiles you've explored. 'unexploredAdjacentTiles' lists unexplored tiles at the edge of your explored area. Each includes 'moveToward' - the first step on the path to reach it. IMPORTANT: In mazes, the path to a frontier may require going in a different direction first (e.g., go east to eventually reach a western frontier).`
  );
  lines.push(`\n${generateMapJson(world, character)}`);

  lines.push(`\n=== LEGAL ACTIONS ===`);
  lines.push(
    `Choose one of these actions. Parameters shown as <placeholder> must be filled in by you.`
  );

  // Get legal actions to check what's available
  const legalActions = getLegalActions(world, character, knowledge, hasMoved);

  // Check if movement is available
  const canMove = !character.effects.some((e) => e.preventsMovement);
  const hasAttackActions = legalActions.some(
    (la) => la.action.type === "attack"
  );

  if (hasMoved || !canMove || !hasAttackActions) {
    lines.push(``);
    if (hasMoved) {
      lines.push(
        `⚠️ DO NOT USE MOVE OR MOVE_TOWARD - YOU ALREADY MOVED THIS TURN.`
      );
    } else if (!canMove) {
      lines.push(
        `⚠️ DO NOT USE MOVE OR MOVE_TOWARD - YOU CANNOT MOVE (movement prevented by effect).`
      );
    }

    if (!hasAttackActions) {
      lines.push(`⚠️ DO NOT USE ATTACK - NO ADJACENT ENEMIES TO ATTACK.`);
    }
  }

  lines.push(
    `\n${generateLegalActionsJson(world, character, knowledge, hasMoved)}`
  );

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
          "MOVE_TOWARD",
          "ATTACK",
          "TALK",
          "SEARCH",
          "PICKUP",
          "DROP",
          "EQUIP",
          "UNEQUIP",
          "USE",
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
  character: Character,
  hasMoved: boolean = false
): { action: Action | null; error: string | null } {
  // Generate all legal actions - this is the single source of truth
  const legalActions = getLegalActions(world, character, knowledge, hasMoved);

  // Helper to match a target name (case-insensitive, partial match)
  const matchesTarget = (legal: string, response: string): boolean => {
    const legalLower = legal.toLowerCase();
    const responseLower = response.toLowerCase();
    return legalLower === responseLower || legalLower.includes(responseLower);
  };

  switch (jsonResponse.action) {
    case "MOVE": {
      if (jsonResponse.x === null || jsonResponse.y === null) {
        return { action: null, error: "MOVE requires x and y coordinates" };
      }
      const legalMove = legalActions.find(
        (la) =>
          la.action.type === "move" &&
          la.action.targetPosition.x === jsonResponse.x &&
          la.action.targetPosition.y === jsonResponse.y
      );
      if (!legalMove) {
        return {
          action: null,
          error: `MOVE to (${jsonResponse.x}, ${jsonResponse.y}) is not a legal action`,
        };
      }
      return { action: legalMove.action, error: null };
    }

    case "MOVE_TOWARD": {
      if (jsonResponse.x == null || jsonResponse.y == null) {
        return {
          action: null,
          error: "MOVE_TOWARD requires x and y coordinates",
        };
      }
      const targetX = jsonResponse.x;
      const targetY = jsonResponse.y;

      // Check if movement is allowed
      if (hasMoved) {
        return {
          action: null,
          error: "MOVE_TOWARD not allowed - already moved this turn",
        };
      }

      const canMove = !character.effects.some((e) => e.preventsMovement);
      if (!canMove) {
        return {
          action: null,
          error: "MOVE_TOWARD not allowed - movement prevented by effect",
        };
      }

      // Validate coordinates are within world bounds
      if (
        targetX < 0 ||
        targetX >= world.width ||
        targetY < 0 ||
        targetY >= world.height
      ) {
        return {
          action: null,
          error: `MOVE_TOWARD (${targetX}, ${targetY}) is outside world bounds`,
        };
      }

      // Accept any valid coordinates - engine will handle pathfinding
      return {
        action: {
          type: "move_toward",
          targetPosition: { x: targetX, y: targetY },
        },
        error: null,
      };
    }

    case "ATTACK": {
      if (!jsonResponse.target) {
        return { action: null, error: "ATTACK requires a target" };
      }
      const legalAttack = legalActions.find(
        (la) =>
          la.action.type === "attack" &&
          matchesTarget(la.display.target as string, jsonResponse.target!)
      );
      if (!legalAttack) {
        return {
          action: null,
          error: `ATTACK target "${jsonResponse.target}" is not a legal action`,
        };
      }
      return { action: legalAttack.action, error: null };
    }

    case "TALK": {
      if (!jsonResponse.target) {
        return { action: null, error: "TALK requires a target" };
      }
      if (!jsonResponse.message) {
        return { action: null, error: "TALK requires a message" };
      }
      const legalTalk = legalActions.find(
        (la) =>
          la.action.type === "talk" &&
          matchesTarget(la.display.target as string, jsonResponse.target!)
      );
      if (!legalTalk) {
        return {
          action: null,
          error: `TALK target "${jsonResponse.target}" is not a legal action`,
        };
      }
      // Fill in the message from the AI response
      return {
        action: {
          ...legalTalk.action,
          message: jsonResponse.message,
        } as Action,
        error: null,
      };
    }

    case "SEARCH": {
      if (!jsonResponse.target) {
        return { action: null, error: "SEARCH requires a target" };
      }
      const legalSearch = legalActions.find(
        (la) =>
          la.action.type === "search_container" &&
          matchesTarget(la.display.target as string, jsonResponse.target!)
      );
      if (!legalSearch) {
        return {
          action: null,
          error: `SEARCH target "${jsonResponse.target}" is not a legal action`,
        };
      }
      return { action: legalSearch.action, error: null };
    }

    case "PICKUP": {
      if (!jsonResponse.target) {
        return { action: null, error: "PICKUP requires a target" };
      }
      const legalPickup = legalActions.find(
        (la) =>
          la.action.type === "pick_up" &&
          matchesTarget(la.display.target as string, jsonResponse.target!)
      );
      if (!legalPickup) {
        return {
          action: null,
          error: `PICKUP target "${jsonResponse.target}" is not a legal action`,
        };
      }
      return { action: legalPickup.action, error: null };
    }

    case "DROP": {
      if (!jsonResponse.target) {
        return { action: null, error: "DROP requires a target" };
      }
      const legalDrop = legalActions.find(
        (la) =>
          la.action.type === "drop" &&
          matchesTarget(la.display.target as string, jsonResponse.target!)
      );
      if (!legalDrop) {
        return {
          action: null,
          error: `DROP target "${jsonResponse.target}" is not a legal action`,
        };
      }
      return { action: legalDrop.action, error: null };
    }

    case "EQUIP": {
      if (!jsonResponse.target) {
        return { action: null, error: "EQUIP requires a target" };
      }
      const legalEquip = legalActions.find(
        (la) =>
          la.action.type === "equip" &&
          matchesTarget(la.display.target as string, jsonResponse.target!)
      );
      if (!legalEquip) {
        return {
          action: null,
          error: `EQUIP target "${jsonResponse.target}" is not a legal action`,
        };
      }
      return { action: legalEquip.action, error: null };
    }

    case "UNEQUIP": {
      if (!jsonResponse.target) {
        return { action: null, error: "UNEQUIP requires a target" };
      }
      const legalUnequip = legalActions.find(
        (la) =>
          la.action.type === "unequip" &&
          matchesTarget(la.display.target as string, jsonResponse.target!)
      );
      if (!legalUnequip) {
        return {
          action: null,
          error: `UNEQUIP target "${jsonResponse.target}" is not a legal action`,
        };
      }
      return { action: legalUnequip.action, error: null };
    }

    case "USE": {
      if (!jsonResponse.target) {
        return { action: null, error: "USE requires a target" };
      }
      const legalUse = legalActions.find(
        (la) =>
          la.action.type === "use" &&
          matchesTarget(la.display.target as string, jsonResponse.target!)
      );
      if (!legalUse) {
        return {
          action: null,
          error: `USE target "${jsonResponse.target}" is not a legal action`,
        };
      }
      return { action: legalUse.action, error: null };
    }

    case "PLACE": {
      if (jsonResponse.x === null || jsonResponse.y === null) {
        return { action: null, error: "PLACE requires x and y coordinates" };
      }
      if (!jsonResponse.target) {
        return { action: null, error: "PLACE requires a target" };
      }
      const legalPlace = legalActions.find(
        (la) =>
          la.action.type === "place" &&
          la.action.targetPosition.x === jsonResponse.x &&
          la.action.targetPosition.y === jsonResponse.y &&
          matchesTarget(la.display.target as string, jsonResponse.target!)
      );
      if (!legalPlace) {
        return {
          action: null,
          error: `PLACE "${jsonResponse.target}" at (${jsonResponse.x}, ${jsonResponse.y}) is not a legal action`,
        };
      }
      return { action: legalPlace.action, error: null };
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
      if (jsonResponse.expiry < 1 || jsonResponse.expiry > 3) {
        return {
          action: null,
          error: "CONTRACT expiry must be between 1 and 3 turns",
        };
      }
      const legalContract = legalActions.find(
        (la) =>
          la.action.type === "issue_contract" &&
          matchesTarget(la.display.target as string, jsonResponse.target!)
      );
      if (!legalContract) {
        return {
          action: null,
          error: `CONTRACT target "${jsonResponse.target}" is not a legal action`,
        };
      }
      // Fill in the contract details from the AI response
      return {
        action: {
          ...legalContract.action,
          contractContents: jsonResponse.terms,
          contractExpiry: jsonResponse.expiry,
          message: jsonResponse.message || undefined,
        } as Action,
        error: null,
      };
    }

    case "UNLOCK": {
      if (!jsonResponse.target) {
        return { action: null, error: "UNLOCK requires a door name" };
      }
      const legalUnlock = legalActions.find(
        (la) =>
          la.action.type === "unlock" &&
          matchesTarget(la.display.target as string, jsonResponse.target!)
      );
      if (!legalUnlock) {
        return {
          action: null,
          error: `UNLOCK target "${jsonResponse.target}" is not a legal action`,
        };
      }
      return { action: legalUnlock.action, error: null };
    }

    case "WAIT": {
      const legalWait = legalActions.find((la) => la.action.type === "wait");
      if (!legalWait) {
        return { action: null, error: "WAIT is not currently available" };
      }
      return { action: legalWait.action, error: null };
    }

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
  reasoningSummary?: string; // model's internal reasoning summary
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

    situationDescription = situationDescription + historySection;
  }

  // Add continuity guidance if there's history
  const continuityNote =
    turnHistory.length > 0
      ? `\nThis is a FOLLOW-UP action. Set "thought": null.`
      : "";

  const systemPrompt = `You are playing a character in a turn-based game on a 2D grid where (0,0) is in the top-left corner. Your CHARACTER DESCRIPTION below defines who you are, your goals, and your personality.

ONE ACTION PER RESPONSE. After each action, you'll see the result and can decide your next action.${continuityNote}

Things to know:

* Movement: Use MOVE for immediate destinations (listed in legal actions). You can only make one move per turn, so if you need to travel a large distance, don't just pick an adjacent tile. Use MOVE_TOWARD for any coordinate - it will pathfind and move as far as possible toward that location. If the destination is unreachable, you'll move toward it as close as possible.
* Talking: MAX 20 WORDS!!! Don't mention coordinates or HP: use general terms instead. Don't repeat something you've already said in prior turns: if you have nothing new to say, say nothing.
* If you choose to attack, it will end your turn.
* If you want to search a container, you must first step to an adjacent tile and then search it. Don't step onto the container itself.
* Unequiping an item can signal good faith to others, because you can't both equip and attack in the same turn.
* 'Use'ing an item will consume it.
* When placing a trap, place it on an adjacent tile, not your current tile. Traps are VISIBLE to anyone who witnessed you placing it (anyone who could see that tile when you placed it). They are invisible to others who weren't there to witness the placement.
* Blood contracts: You can offer a Blood Contract to any nearby character. They immediately choose to sign or decline. Requires target (character name), terms (the contract terms), expiry (1-3 turns), and optional message (your pitch). Max 2 per turn. If the contract expiry occurs and either party has violated the terms, the Great Judge will kill them. Blood contracts allow for more secure cooperation.
* 'Wait' action will end your turn.

Respond with JSON:
- thought: REQUIRED on first action (what's on your mind). Don't re-state something you already thought in the last turn. If you have nothing new to think, keep it VERY brief.
- action: The action type
- x, y: Coordinates if needed (null otherwise)
- target: Target name if needed (null otherwise)
- message: Message for TALK (null otherwise)

EXAMPLES:
${
  turnHistory.length > 0
    ? `{"thought": null, "action": "ATTACK", "x": null, "y": null, "target": "Kane", "message": null, "terms": null, "expiry": null}
{"thought": null, "action": "SEARCH", "x": null, "y": null, "target": "Supply Crate", "message": null, "terms": null, "expiry": null}
{"thought": null, "action": "CONTRACT", "x": null, "y": null, "target": "Luna", "message": "Let's team up!", "terms": "Neither party attacks the other", "expiry": 3}
{"thought": null, "action": "SIGN", "x": null, "y": null, "target": null, "message": "Deal.", "terms": null, "expiry": null}
{"thought": null, "action": "WAIT", "x": null, "y": null, "target": null, "message": null, "terms": null, "expiry": null}`
    : `{"thought": "There he is.", "action": "MOVE", "x": 12, "y": 5, "target": null, "message": null}
{"thought": "Need to reach that unexplored area.", "action": "MOVE_TOWARD", "x": 5, "y": 3, "target": null, "message": null}
{"thought": "Got him.", "action": "ATTACK", "x": null, "y": null, "target": "Kane", "message": null, "terms": null, "expiry": null}
{"thought": "Need a weapon.", "action": "SEARCH", "x": null, "y": null, "target": "Supply Crate", "message": null, "terms": null, "expiry": null}
{"thought": "An alliance could help.", "action": "CONTRACT", "x": null, "y": null, "target": "Luna", "message": "We're both in danger. Work with me.", "terms": "We protect each other until only enemies remain", "expiry": 3}`
}`;

  const userPrompt = `CHARACTER DESCRIPTION:
${character.personalityPrompt}

CURRENT SITUATION:
${situationDescription}

What do you do?`;

  try {
    const response = await openai.responses.create({
      model: character.aiModel,
      input: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      text: {
        format: {
          type: "json_schema",
          ...actionResponseSchema,
        },
      },
      max_output_tokens: MAX_COMPLETION_TOKENS,
      ...(character.reasoningEffort === "none"
        ? undefined
        : { reasoning: { effort: character.reasoningEffort } }),
    });

    // Extract reasoning summary from output
    let reasoningSummary: string | undefined;
    let content = "{}";
    for (const item of response.output) {
      if (item.type === "reasoning" && item.summary?.length > 0) {
        reasoningSummary = item.summary.map((s) => s.text).join("\n");
      }
      if (item.type === "message") {
        const textContent = item.content?.find((c) => c.type === "output_text");
        if (textContent && "text" in textContent) {
          content = textContent.text;
        }
      }
    }

    const fullPrompt = `SYSTEM:\n${systemPrompt}\n\nUSER:\n${userPrompt}`;

    let jsonResponse: JsonResponse;
    try {
      jsonResponse = JSON.parse(content) as JsonResponse;
    } catch {
      console.error("Failed to parse JSON response:", content);
      return {
        action: { type: "wait" },
        reasoning: `(Failed to parse JSON: ${content})`,
        reasoningSummary,
        fullPrompt,
        fullResponse: content,
        error: "Invalid JSON response from AI",
      };
    }

    const { action, error } = parseJsonAction(
      jsonResponse,
      knowledge,
      world,
      character,
      hasMoved
    );

    if (error) {
      console.warn("Action parsing error:", error);
    }

    if (!action) {
      console.warn(`No valid action parsed from: ${content}`);
      return {
        action: { type: "wait" },
        reasoning: jsonResponse.thought || "(No valid action)",
        reasoningSummary,
        fullPrompt,
        fullResponse: content,
        error: error || "No valid action in response",
      };
    }

    return {
      action,
      reasoning: jsonResponse.thought, // "thought" in JSON, "reasoning" externally
      reasoningSummary,
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

  const systemPrompt = `You are playing a character in a turn-based game on a 2D grid where (0,0) is in the top-left corner. Your CHARACTER DESCRIPTION below defines who you are, your goals, and your personality.

CHARACTER DESCRIPTION:
${target.personalityPrompt}

You are deciding whether to accept or reject a blood contract. Consider your goals, the current situation, and whether you can realistically comply with the terms.`;

  const userPrompt = `${situationDescription}
${contractOffer}`;

  try {
    const model = target.aiModel;
    const reasoningEffort = target.reasoningEffort;

    const response = await openai.chat.completions.create({
      model,
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
      ...(reasoningEffort !== "none"
        ? { reasoning_effort: reasoningEffort }
        : undefined),
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

  const systemPrompt = `You are playing a character in a turn-based game on a 2D grid where (0,0) is in the top-left corner. Your CHARACTER DESCRIPTION below defines who you are, your goals, and your personality.

CHARACTER DESCRIPTION:
${speaker.personalityPrompt}

This is a conversation response. You can ONLY respond with:
- TALK: Say something back (requires a message). MAX 20 WORDS!!! Don't mention coordinates or HP: use general terms instead.
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
    const model = speaker.aiModel;
    const reasoningEffort = speaker.reasoningEffort;

    const response = await openai.chat.completions.create({
      model,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      response_format: {
        type: "json_schema",
        json_schema: conversationResponseSchema,
      },
      max_completion_tokens: MAX_COMPLETION_TOKENS,
      ...(reasoningEffort !== "none"
        ? { reasoning_effort: reasoningEffort }
        : undefined),
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

function formatCharactersStatus(world: World): string {
  return world.characters
    .map((c) => {
      const weapon = c.equippedWeapon
        ? `, armed with ${c.equippedWeapon.name}`
        : ", unarmed";
      const effectsStr =
        c.effects.length > 0
          ? `, effects: [${c.effects
              .map((e) => `${e.name}(${e.duration}t)`)
              .join(", ")}]`
          : "";
      const inventory =
        c.inventory.length > 0
          ? `, inventory: [${c.inventory.map((i) => i.name).join(", ")}]`
          : "";
      if (c.alive) {
        return `- ${c.name}: Alive at (${c.position.x}, ${c.position.y}), HP ${c.hp}/${c.maxHp}${weapon}${effectsStr}${inventory}`;
      } else {
        return `- ${c.name}: DEAD at (${c.position.x}, ${c.position.y})`;
      }
    })
    .join("\n");
}

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

  const allCharactersStatus = formatCharactersStatus(world);

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

  const worldJson = generateOmniscientMapJson(world);

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

=== WORLD STATE (JSON) ===
${worldJson}

Your task: Determine if either party violated the terms of the contract.

Respond with JSON:
{
  "verdict": "Your judgment explanation (keep it brief and matter-of-fact)",
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
      model: DEFAULT_AI_MODEL,
      messages: [{ role: "user", content: prompt }],
      response_format: { type: "json_object" },
      max_completion_tokens: MAX_COMPLETION_TOKENS,
      reasoning_effort:
        DEFAULT_REASONING_EFFORT === "none"
          ? undefined
          : DEFAULT_REASONING_EFFORT,
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

export type CustomEffectResult = {
  actions: CustomEffectAction[];
  reasoning: string;
  prompt?: string;
  rawResponse?: string;
};

export type CustomEffectAction = { type: "kill"; targetName: string };

export async function processCustomEffect(
  world: World,
  character: Character,
  customPrompt: string,
  events: GameEvent[]
): Promise<CustomEffectResult> {
  const recentEvents = events.slice(-50);
  const eventLog = recentEvents
    .map((e) => `[Turn ${e.turn}] ${e.description}`)
    .join("\n");

  const allCharactersStatus = formatCharactersStatus(world);

  const worldJson = generateOmniscientMapJson(world);

  const prompt = `You are an effect processor for a game. A magical effect is being evaluated.

=== EFFECT CONDITION ===
${customPrompt}

=== TARGET CHARACTER ===
${character.name} at (${character.position.x}, ${character.position.y}), HP ${
    character.hp
  }/${character.maxHp}

=== ALL CHARACTERS STATUS ===
${allCharactersStatus}

=== RECENT EVENTS ===
${eventLog || "(No events)"}

=== WORLD STATE (JSON) ===
${worldJson}

Based on the condition above, determine what actions should occur.

Available actions:
- kill: Kill a character by name

Respond with JSON:
{
  "reasoning": "Brief explanation of your decision",
  "actions": [
    { "type": "kill", "targetName": "CharacterName" }
  ]
}

If the condition is not met, return an empty actions array.
Only include actions that the condition explicitly requires.`;

  if (!openai) {
    return {
      actions: [],
      reasoning: "No AI connection available",
      prompt,
    };
  }

  try {
    const response = await openai.chat.completions.create({
      model: DEFAULT_AI_MODEL,
      messages: [{ role: "user", content: prompt }],
      response_format: { type: "json_object" },
      max_completion_tokens: MAX_COMPLETION_TOKENS,
      reasoning_effort:
        DEFAULT_REASONING_EFFORT === "none"
          ? undefined
          : DEFAULT_REASONING_EFFORT,
    });

    const content = response.choices[0]?.message?.content;
    if (!content) {
      return {
        actions: [],
        reasoning: "No response from AI",
        prompt,
      };
    }

    const result = JSON.parse(content) as {
      reasoning: string;
      actions: CustomEffectAction[];
    };

    // Validate action target names
    const validNames = world.characters.map((c) => c.name.toLowerCase());
    result.actions = result.actions.filter((action) => {
      if (action.type === "kill") {
        return validNames.includes(action.targetName.toLowerCase());
      }
      return false;
    });

    return {
      ...result,
      prompt,
      rawResponse: content,
    };
  } catch (err) {
    console.error("Custom effect error:", err);
    return {
      actions: [],
      reasoning: "Error processing effect",
      prompt,
    };
  }
}
