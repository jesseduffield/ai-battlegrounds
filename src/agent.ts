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

  if (hasWeapon) {
    lines.push(
      `*** YOU ARE ARMED with ${weaponName} (${weaponDamage} damage) ***`
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

      if (canAttack) {
        lines.push(
          `  *** ${other.name} is ADJACENT - CAN ATTACK or TALK! *** [HP: ${other.hp}/${other.maxHp}, ${weapon}]`
        );
      } else if (dist <= 2) {
        lines.push(
          `  ** ${other.name} at ${formatPosition(
            position
          )} - CAN TALK (distance: ${dist}) ** [HP: ${other.hp}/${
            other.maxHp
          }, ${weapon}]`
        );
      } else {
        lines.push(
          `  - ${other.name} at ${formatPosition(position)} [HP: ${other.hp}/${
            other.maxHp
          }, ${weapon}] - distance: ${dist} tiles`
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

function parseSingleAction(
  actionLine: string,
  knowledge: CharacterKnowledge
): Action | null {
  const upperAction = actionLine.toUpperCase();

  if (upperAction.startsWith("MOVE")) {
    const match = actionLine.match(/MOVE\s+(\d+)\s+(\d+)/i);
    if (match) {
      return {
        type: "move",
        targetPosition: { x: parseInt(match[1]), y: parseInt(match[2]) },
      };
    }
  }

  if (upperAction.startsWith("LOOK")) {
    return { type: "look_around" };
  }

  if (upperAction.startsWith("SEARCH")) {
    const match = actionLine.match(/SEARCH\s+(.+)/i);
    if (match) {
      const containerName = match[1].trim().toLowerCase();
      const container = knowledge.visible.items.find(
        (i) =>
          i.item.type === "container" &&
          i.item.name.toLowerCase().includes(containerName)
      );
      if (container) {
        return { type: "search_container", targetItemId: container.item.id };
      }
    }
  }

  if (upperAction.startsWith("PICKUP")) {
    const match = actionLine.match(/PICKUP\s+(.+)/i);
    if (match) {
      const itemName = match[1].trim().toLowerCase();

      for (const visibleTile of knowledge.visible.tiles) {
        for (const item of visibleTile.items) {
          if (item.name.toLowerCase().includes(itemName)) {
            return { type: "pick_up", targetItemId: item.id };
          }
          if (item.type === "container" && item.contents) {
            for (const content of item.contents) {
              if (content.name.toLowerCase().includes(itemName)) {
                return { type: "pick_up", targetItemId: content.id };
              }
            }
          }
        }
      }
    }
  }

  if (upperAction.startsWith("DROP")) {
    const match = actionLine.match(/DROP\s+(.+)/i);
    if (match) {
      const itemName = match[1].trim().toLowerCase();
      const item = knowledge.status.inventory.find((i) =>
        i.name.toLowerCase().includes(itemName)
      );
      if (item) {
        return { type: "drop", targetItemId: item.id };
      }
    }
  }

  if (upperAction.startsWith("EQUIP")) {
    const match = actionLine.match(/EQUIP\s+(.+)/i);
    if (match) {
      const itemName = match[1].trim();
      const itemNameLower = itemName.toLowerCase();
      const item = knowledge.status.inventory.find((i) =>
        i.name.toLowerCase().includes(itemNameLower)
      );
      if (item) {
        return { type: "equip", targetItemId: item.id };
      }
      for (const visibleTile of knowledge.visible.tiles) {
        for (const tileItem of visibleTile.items) {
          if (tileItem.type === "container" && tileItem.contents) {
            for (const content of tileItem.contents) {
              if (content.name.toLowerCase().includes(itemNameLower)) {
                return { type: "equip", targetItemId: content.id };
              }
            }
          }
        }
      }
      return { type: "equip", targetItemName: itemName };
    }
  }

  if (upperAction.startsWith("ATTACK")) {
    const match = actionLine.match(/ATTACK\s+(.+)/i);
    if (match) {
      const targetName = match[1].trim().toLowerCase();
      const target = knowledge.visible.characters.find((c) =>
        c.character.name.toLowerCase().includes(targetName)
      );
      if (target) {
        return { type: "attack", targetCharacterId: target.character.id };
      }
    }
  }

  if (upperAction.startsWith("TALK")) {
    const match = actionLine.match(/TALK\s+(\w+)\s+"([^"]+)"/i);
    if (match) {
      const targetName = match[1].trim().toLowerCase();
      const message = match[2];
      const target = knowledge.visible.characters.find((c) =>
        c.character.name.toLowerCase().includes(targetName)
      );
      if (target) {
        return {
          type: "talk",
          targetCharacterId: target.character.id,
          message,
        };
      }
    }
  }

  if (upperAction.startsWith("WAIT")) {
    return { type: "wait" };
  }

  return null;
}

function parseActions(
  response: string,
  knowledge: CharacterKnowledge
): Action[] {
  const lines = response.trim().split("\n");
  const actions: Action[] = [];
  let hasMoved = false;

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.length === 0) continue;

    const upper = trimmed.toUpperCase();

    if (upper.startsWith("MOVE") && hasMoved) {
      continue;
    }

    if (
      upper.startsWith("MOVE") ||
      upper.startsWith("SEARCH") ||
      upper.startsWith("PICKUP") ||
      upper.startsWith("DROP") ||
      upper.startsWith("EQUIP") ||
      upper.startsWith("ATTACK") ||
      upper.startsWith("TALK") ||
      upper.startsWith("WAIT")
    ) {
      const action = parseSingleAction(trimmed, knowledge);
      if (action) {
        actions.push(action);
        if (action.type === "move") {
          hasMoved = true;
        }
        if (
          action.type === "attack" ||
          action.type === "talk" ||
          action.type === "wait"
        ) {
          break;
        }
      }
    }
  }

  return actions;
}

export async function getAgentDecision(
  world: World,
  character: Character
): Promise<{
  actions: Action[];
  reasoning: string;
  fullPrompt?: string;
  fullResponse?: string;
}> {
  if (!openai) {
    return {
      actions: [{ type: "wait" }],
      reasoning: "AI agent not initialized (no API key)",
    };
  }

  const knowledge = getCharacterKnowledge(world, character);
  const situationDescription = formatKnowledge(world, character, knowledge);

  const systemPrompt = `You are playing a character in a turn-based game. Your CHARACTER DESCRIPTION below defines who you are, your goals, and your personality. Act accordingly.

AVAILABLE ACTIONS:
- MOVE X Y : Move to a tile from "TILES YOU CAN MOVE TO" list
- ATTACK name : Attack an adjacent character (ends turn)
- TALK name "message" : Speak to character within 2 tiles (ends turn)
- SEARCH container : Search a container at your position
- PICKUP item : Pick up an item from searched container or ground
- EQUIP item : Equip a weapon or clothing from inventory
- DROP item : Drop an item from inventory
- WAIT : End turn doing nothing

RULES:
- "CAN ATTACK" next to a name = adjacent, you can attack them
- "CAN TALK" next to a name = within 2 tiles, you can speak to them
- You can chain actions: MOVE first, then other actions
- ATTACK or TALK ends your turn (but you can MOVE before either)
- Items on corpses drop to the ground and can be picked up

RESPONSE FORMAT:
1-2 sentences of reasoning based on your character's goals and personality.
Then your action command(s), one per line.

EXAMPLES:
"I need to flee - that hunter is too close!"
MOVE 12 5

"Enemy is adjacent. Time to strike!"
ATTACK Kane

"I should get closer and try diplomacy."
MOVE 5 7
TALK Razor "Let's work together against the real threat."

"There's a knife on the ground from the corpse. I should arm myself."
PICKUP Hunting Knife
EQUIP Hunting Knife`;

  const userPrompt = `${character.personalityPrompt}

CURRENT SITUATION:
${situationDescription}

What do you do? Brief reasoning, then your actions.`;

  try {
    const response = await openai.chat.completions.create({
      model: "gpt-5.2",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      max_completion_tokens: 300,
      temperature: 0.7,
    });

    const content = response.choices[0]?.message?.content ?? "";
    const actions = parseActions(content, knowledge);
    const fullPrompt = `SYSTEM:\n${systemPrompt}\n\nUSER:\n${userPrompt}`;

    if (actions.length === 0) {
      console.warn(`Failed to parse actions from: ${content}`);
      return {
        actions: [{ type: "wait" }],
        reasoning: `(Failed to parse: ${content})`,
        fullPrompt,
        fullResponse: content,
      };
    }

    const reasoningMatch = content.match(/^(.+?)(?=\n[A-Z])/s);
    const reasoning = reasoningMatch
      ? reasoningMatch[1].trim()
      : content.split("\n")[0];

    return { actions, reasoning, fullPrompt, fullResponse: content };
  } catch (error) {
    console.error("Agent error:", error);
    return {
      actions: [{ type: "wait" }],
      reasoning: `Error: ${
        error instanceof Error ? error.message : "Unknown error"
      }`,
    };
  }
}
