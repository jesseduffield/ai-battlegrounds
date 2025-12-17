import type {
  World,
  Character,
  Position,
  Action,
  ActionResult,
  GameEvent,
  VisibleState,
  Tile,
  Item,
  Memory,
  CharacterKnowledge,
} from "./types";

export const MAX_TALK_DISTANCE = 6;

export function createId(): string {
  return Math.random().toString(36).substring(2, 11);
}

let memoryOrderCounter = 0;
export function getNextMemoryOrder(): number {
  return memoryOrderCounter++;
}

export function distance(a: Position, b: Position): number {
  return Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
}

export function positionsEqual(a: Position, b: Position): boolean {
  return a.x === b.x && a.y === b.y;
}

function blocksVision(tile: Tile): boolean {
  return tile.type === "wall";
}

function hasContainer(tile: Tile): boolean {
  return tile.items.some((item) => item.type === "container");
}

function canWalkThrough(tile: Tile): boolean {
  const walkableTiles = ["ground", "door", "grass"];
  if (!walkableTiles.includes(tile.type)) {
    return false;
  }
  return !hasContainer(tile);
}

// Shadowcasting visibility algorithm
// Produces smooth, natural-looking visibility without Bresenham artifacts

type ShadowLine = { start: number; end: number }[];

function addShadow(shadows: ShadowLine, start: number, end: number): void {
  // Find where this shadow fits in the list
  let i = 0;
  while (i < shadows.length && shadows[i].end < start) {
    i++;
  }

  // Merge overlapping shadows
  let newStart = start;
  let newEnd = end;

  while (i < shadows.length && shadows[i].start <= newEnd) {
    newStart = Math.min(newStart, shadows[i].start);
    newEnd = Math.max(newEnd, shadows[i].end);
    shadows.splice(i, 1);
  }

  shadows.splice(i, 0, { start: newStart, end: newEnd });
}

function isInShadow(shadows: ShadowLine, start: number, end: number): boolean {
  for (const shadow of shadows) {
    if (shadow.start <= start && shadow.end >= end) {
      return true;
    }
  }
  return false;
}

function isFullyShadowed(shadows: ShadowLine): boolean {
  return shadows.length === 1 && shadows[0].start <= 0 && shadows[0].end >= 1;
}

// Compute visible tiles using shadowcasting
function computeVisibleTiles(
  world: World,
  origin: Position,
  maxRange: number
): Set<string> {
  const visible = new Set<string>();
  visible.add(`${origin.x},${origin.y}`);

  // Process each octant
  for (let octant = 0; octant < 8; octant++) {
    castShadowsInOctant(world, origin, maxRange, octant, visible);
  }

  return visible;
}

// Transform coordinates based on octant
function transformOctant(
  octant: number,
  row: number,
  col: number
): { dx: number; dy: number } {
  switch (octant) {
    case 0:
      return { dx: col, dy: -row };
    case 1:
      return { dx: row, dy: -col };
    case 2:
      return { dx: row, dy: col };
    case 3:
      return { dx: col, dy: row };
    case 4:
      return { dx: -col, dy: row };
    case 5:
      return { dx: -row, dy: col };
    case 6:
      return { dx: -row, dy: -col };
    case 7:
      return { dx: -col, dy: -row };
    default:
      return { dx: 0, dy: 0 };
  }
}

function castShadowsInOctant(
  world: World,
  origin: Position,
  maxRange: number,
  octant: number,
  visible: Set<string>
): void {
  const shadows: ShadowLine = [];

  for (let row = 1; row <= maxRange; row++) {
    for (let col = 0; col <= row; col++) {
      const { dx, dy } = transformOctant(octant, row, col);
      const x = origin.x + dx;
      const y = origin.y + dy;

      // Check bounds
      if (x < 0 || x >= world.width || y < 0 || y >= world.height) {
        continue;
      }

      // Check distance
      if (Math.sqrt(dx * dx + dy * dy) > maxRange) {
        continue;
      }

      // Calculate the slope range for this tile
      const tileStart = col / (row + 1);
      const tileEnd = (col + 1) / row;

      // Check if this tile is in shadow
      if (isInShadow(shadows, tileStart, tileEnd)) {
        continue;
      }

      // This tile is visible
      visible.add(`${x},${y}`);

      // If this tile blocks vision, add it to shadows
      if (blocksVision(world.tiles[y][x])) {
        addShadow(shadows, tileStart, tileEnd);
      }
    }

    // Early exit if fully shadowed
    if (isFullyShadowed(shadows)) {
      break;
    }
  }
}

export function lineOfSight(
  world: World,
  from: Position,
  to: Position
): boolean {
  // Simple distance check first
  const dist = distance(from, to);
  const maxRange = 20;
  if (dist > maxRange) {
    return false;
  }

  // Use shadowcasting for visibility
  const visibleSet = computeVisibleTiles(world, from, maxRange);
  return visibleSet.has(`${to.x},${to.y}`);
}

export function getVisibleTiles(
  world: World,
  character: Character
): VisibleState {
  const visible: VisibleState = {
    tiles: [],
    characters: [],
    items: [],
  };

  const range = character.viewDistance;

  // Compute visible tiles using shadowcasting
  const visibleSet = computeVisibleTiles(world, character.position, range);

  // Iterate through visible tiles
  for (const key of visibleSet) {
    const [xStr, yStr] = key.split(",");
    const x = parseInt(xStr, 10);
    const y = parseInt(yStr, 10);
    const pos = { x, y };

    const tile = world.tiles[y][x];
    visible.tiles.push({ ...tile, position: pos });

    for (const item of tile.items) {
      visible.items.push({ item, position: pos });
    }
  }

  for (const other of world.characters) {
    if (other.id === character.id) continue;
    if (visibleSet.has(`${other.position.x},${other.position.y}`)) {
      visible.characters.push({ character: other, position: other.position });
    }
  }

  return visible;
}

export function findPath(
  world: World,
  from: Position,
  to: Position,
  maxSteps: number
): Position[] | null {
  if (positionsEqual(from, to)) return [];

  const queue: { pos: Position; path: Position[] }[] = [
    { pos: from, path: [] },
  ];
  const visited = new Set<string>();
  visited.add(`${from.x},${from.y}`);

  while (queue.length > 0) {
    const current = queue.shift()!;

    const neighbors = [
      { x: current.pos.x - 1, y: current.pos.y },
      { x: current.pos.x + 1, y: current.pos.y },
      { x: current.pos.x, y: current.pos.y - 1 },
      { x: current.pos.x, y: current.pos.y + 1 },
    ];

    for (const next of neighbors) {
      if (
        next.x < 0 ||
        next.x >= world.width ||
        next.y < 0 ||
        next.y >= world.height
      )
        continue;

      const key = `${next.x},${next.y}`;
      if (visited.has(key)) continue;

      const tile = world.tiles[next.y][next.x];

      // Containers are never walkable, even as destination
      if (hasContainer(tile)) continue;

      // Walls/non-ground tiles are NEVER walkable
      if (!canWalkThrough(tile)) continue;

      // Characters always block - you can't move onto another character
      const hasCharacter = world.characters.some(
        (c) => c.alive && positionsEqual(c.position, next)
      );
      if (hasCharacter) continue;

      const newPath = [...current.path, next];

      if (positionsEqual(next, to)) {
        return newPath.length <= maxSteps ? newPath : null;
      }

      if (newPath.length < maxSteps) {
        visited.add(key);
        queue.push({ pos: next, path: newPath });
      }
    }
  }

  return null;
}

export function getReachableTiles(
  world: World,
  character: Character
): Position[] {
  const reachable: Position[] = [];
  const from = character.position;
  const maxSteps = character.movementRange;

  const queue: { pos: Position; steps: number }[] = [{ pos: from, steps: 0 }];
  const visited = new Set<string>();
  visited.add(`${from.x},${from.y}`);

  while (queue.length > 0) {
    const current = queue.shift()!;

    if (current.steps > 0) {
      reachable.push(current.pos);
    }

    if (current.steps >= maxSteps) continue;

    const neighbors = [
      { x: current.pos.x - 1, y: current.pos.y },
      { x: current.pos.x + 1, y: current.pos.y },
      { x: current.pos.x, y: current.pos.y - 1 },
      { x: current.pos.x, y: current.pos.y + 1 },
    ];

    for (const next of neighbors) {
      if (
        next.x < 0 ||
        next.x >= world.width ||
        next.y < 0 ||
        next.y >= world.height
      )
        continue;

      const key = `${next.x},${next.y}`;
      if (visited.has(key)) continue;

      const tile = world.tiles[next.y][next.x];
      const hasCharacter = world.characters.some(
        (c) =>
          c.alive && c.id !== character.id && positionsEqual(c.position, next)
      );

      if (!canWalkThrough(tile) || hasCharacter) continue;

      visited.add(key);
      queue.push({ pos: next, steps: current.steps + 1 });
    }
  }

  return reachable;
}

export function rollDice(sides: number, count: number = 1): number {
  let total = 0;
  for (let i = 0; i < count; i++) {
    total += Math.floor(Math.random() * sides) + 1;
  }
  return total;
}

export function calculateDamage(attacker: Character): {
  damage: number;
  roll: number;
  isDebuffed: boolean;
} {
  const baseDamage = attacker.equippedWeapon?.damage ?? 1;
  const isDebuffed = (attacker.debuffTurnsRemaining ?? 0) > 0;
  const roll = rollDice(20);

  if (roll === 20) {
    // Critical hit - double damage, but still halved if debuffed
    const finalDamage = isDebuffed ? Math.floor(baseDamage) : baseDamage * 2;
    return { damage: finalDamage, roll, isDebuffed };
  }
  if (roll === 1) {
    return { damage: 0, roll, isDebuffed };
  }

  const hitThreshold = 8;
  if (roll >= hitThreshold) {
    // Halve damage if debuffed (trapped)
    const finalDamage = isDebuffed ? Math.floor(baseDamage / 2) : baseDamage;
    return { damage: Math.max(1, finalDamage), roll, isDebuffed };
  }

  return { damage: 0, roll, isDebuffed };
}

export function addMemory(
  character: Character,
  memory: Omit<Memory, "id" | "order">
): void {
  character.memories.push({
    ...memory,
    id: createId(),
    order: getNextMemoryOrder(),
  });
}

export function executeAction(
  world: World,
  character: Character,
  action: Action
): ActionResult {
  const events: GameEvent[] = [];

  switch (action.type) {
    case "move": {
      if (character.debuffTurnsRemaining > 0) {
        return {
          success: false,
          message: `${character.name} is trapped and cannot move! (${character.debuffTurnsRemaining} turns remaining)`,
          events,
        };
      }

      if (!action.targetPosition) {
        return {
          success: false,
          message: "No target position specified",
          events,
        };
      }

      const path = findPath(
        world,
        character.position,
        action.targetPosition,
        character.movementRange
      );
      if (!path) {
        return {
          success: false,
          message: "Cannot reach that position",
          events,
        };
      }

      // Check if destination is occupied by another character
      const occupant = world.characters.find(
        (c) =>
          c.alive &&
          c.id !== character.id &&
          positionsEqual(c.position, action.targetPosition!)
      );
      if (occupant) {
        return {
          success: false,
          message: `Cannot move onto ${occupant.name}'s position`,
          events,
        };
      }

      const startPos = { ...character.position };
      let finalPosition = action.targetPosition;
      let trapTriggered = false;
      let actualPath = [startPos, ...path];

      // Check each tile along the path for enemy traps
      for (let i = 0; i < path.length; i++) {
        const stepPos = path[i];
        const stepTile = world.tiles[stepPos.y][stepPos.x];

        // Find any trap on this tile (owner can trigger their own trap!)
        const trap = stepTile.traps[0];

        if (trap) {
          // Trap triggered! Stop movement here
          finalPosition = stepPos;
          actualPath = [startPos, ...path.slice(0, i + 1)];
          trapTriggered = true;

          // Apply trap damage
          character.hp -= trap.damage;

          // Apply trap effects: debuff for N turns (can't move, attack halved)
          character.trapped = true;
          character.attackDebuff = trap.attackDebuff;
          character.debuffTurnsRemaining = trap.debuffDuration;

          const ownTrap = trap.ownerId === character.id;
          events.push({
            turn: world.turn,
            type: "trap_triggered",
            actorId: character.id,
            position: stepPos,
            description: `${character.name} stepped on ${
              ownTrap ? "their own" : "a"
            } ${trap.name}! Took ${trap.damage} damage! TRAPPED for ${
              trap.debuffDuration
            } turns (can't move, attack reduced)!`,
          });

          // Remove the trap after it triggers
          const trapIndex = stepTile.traps.findIndex((t) => t.id === trap.id);
          if (trapIndex >= 0) {
            stepTile.traps.splice(trapIndex, 1);
          }

          break;
        }
      }

      character.position = finalPosition;

      events.push({
        turn: world.turn,
        type: "move",
        actorId: character.id,
        position: finalPosition,
        description: trapTriggered
          ? `${character.name} moved toward (${action.targetPosition.x}, ${action.targetPosition.y}) but was caught in a trap at (${finalPosition.x}, ${finalPosition.y})!`
          : `${character.name} moved to (${finalPosition.x}, ${finalPosition.y})`,
      });

      // Notify witnesses who can see the final position
      for (const witness of world.characters) {
        if (witness.id === character.id) continue;
        if (!witness.alive) continue;
        const canSeeEnd =
          lineOfSight(world, witness.position, finalPosition) &&
          distance(witness.position, finalPosition) <= witness.viewDistance;
        if (canSeeEnd) {
          addMemory(witness, {
            turn: world.turn,
            type: "saw_move",
            description: `Saw ${character.name} move to (${finalPosition.x}, ${finalPosition.y})`,
            location: finalPosition,
            characterId: character.id,
            source: "witnessed",
          });
        }
      }

      return {
        success: true,
        message: trapTriggered ? "Trapped!" : "Moved successfully",
        events,
        animationData: {
          type: "move",
          path: actualPath,
        },
      };
    }

    case "look_around": {
      const visible = getVisibleTiles(world, character);

      for (const visibleTile of visible.tiles) {
        const pos = visibleTile.position;
        const key = `${pos.x},${pos.y}`;
        const charAtTile = visible.characters.find(
          (c) => c.position.x === pos.x && c.position.y === pos.y
        );
        const itemsAtTile = visible.items
          .filter((i) => i.position.x === pos.x && i.position.y === pos.y)
          .map((i) => i.item.name);

        character.mapMemory.set(key, {
          type: visibleTile.type,
          lastSeenTurn: world.turn,
          items: itemsAtTile.length > 0 ? itemsAtTile : undefined,
          characterName: charAtTile?.character.name,
          characterAlive: charAtTile?.character.alive,
        });
      }

      for (const { character: other, position } of visible.characters) {
        if (other.alive) {
          addMemory(character, {
            turn: world.turn,
            type: "saw_character",
            description: `Saw ${other.name} at (${position.x}, ${position.y})`,
            location: position,
            characterId: other.id,
            source: "witnessed",
          });
        } else {
          addMemory(character, {
            turn: world.turn,
            type: "saw_corpse",
            description: `Saw ${other.name}'s corpse at (${position.x}, ${position.y})`,
            location: position,
            characterId: other.id,
            source: "witnessed",
          });
        }
      }

      for (const { item, position } of visible.items) {
        addMemory(character, {
          turn: world.turn,
          type: "saw_item",
          description: `Saw ${item.name} at (${position.x}, ${position.y})`,
          location: position,
          itemId: item.id,
          source: "witnessed",
        });
      }

      return {
        success: true,
        message: `Looked around. Saw ${visible.characters.length} characters and ${visible.items.length} items.`,
        events,
      };
    }

    case "search_container": {
      if (!action.targetItemId && !action.targetItemName) {
        return { success: false, message: "No container specified", events };
      }

      const adjacentPositions = [
        character.position,
        { x: character.position.x - 1, y: character.position.y },
        { x: character.position.x + 1, y: character.position.y },
        { x: character.position.x, y: character.position.y - 1 },
        { x: character.position.x, y: character.position.y + 1 },
      ];

      let container: Item | undefined;
      let containerPosition: Position | undefined;

      // Helper to match container by ID or name
      const matchesContainer = (item: Item): boolean => {
        if (item.type !== "container") return false;
        if (action.targetItemId && item.id === action.targetItemId) return true;
        if (action.targetItemName) {
          return item.name
            .toLowerCase()
            .includes(action.targetItemName.toLowerCase());
        }
        return false;
      };

      for (const pos of adjacentPositions) {
        if (
          pos.x < 0 ||
          pos.x >= world.width ||
          pos.y < 0 ||
          pos.y >= world.height
        ) {
          continue;
        }
        const tile = world.tiles[pos.y][pos.x];
        const found = tile.items.find(matchesContainer);
        if (found) {
          container = found;
          containerPosition = pos;
          break;
        }
      }

      if (!container || !containerPosition) {
        const targetName = action.targetItemName || "container";
        return {
          success: false,
          message: `${targetName} not adjacent - must be within 1 tile to search`,
          events,
        };
      }

      container.searched = true;
      const contents = container.contents ?? [];

      addMemory(character, {
        turn: world.turn,
        type: "searched_container",
        description: `Searched ${container.name}. Found: ${
          contents.length > 0
            ? contents.map((i) => i.name).join(", ")
            : "nothing"
        }`,
        location: containerPosition,
        itemId: container.id,
        source: "witnessed",
      });

      events.push({
        turn: world.turn,
        type: "search",
        actorId: character.id,
        itemId: container.id,
        position: containerPosition,
        description: `${character.name} searched ${container.name}`,
      });

      return {
        success: true,
        message: `Found ${contents.length} items`,
        events,
      };
    }

    case "pick_up": {
      // Require both coordinates and item name
      if (!action.targetPosition) {
        return {
          success: false,
          message: "PICKUP requires coordinates (x, y)",
          events,
        };
      }
      if (!action.targetItemId && !action.targetItemName) {
        return { success: false, message: "PICKUP requires item name", events };
      }

      const pos = action.targetPosition;

      // Must be adjacent or on same tile
      const dist =
        Math.abs(pos.x - character.position.x) +
        Math.abs(pos.y - character.position.y);
      if (dist > 1) {
        return {
          success: false,
          message: "Too far to pick up - must be adjacent",
          events,
        };
      }

      if (
        pos.x < 0 ||
        pos.x >= world.width ||
        pos.y < 0 ||
        pos.y >= world.height
      ) {
        return { success: false, message: "Invalid position", events };
      }

      const tile = world.tiles[pos.y][pos.x];

      // Helper to match item by ID or name
      const matchesItem = (i: Item) => {
        if (action.targetItemId) return i.id === action.targetItemId;
        if (action.targetItemName) {
          return i.name
            .toLowerCase()
            .includes(action.targetItemName.toLowerCase());
        }
        return false;
      };

      let item: Item | undefined;
      let fromContainer: Item | undefined;

      // Check items on tile
      const tileItemIndex = tile.items.findIndex(matchesItem);
      if (tileItemIndex >= 0) {
        item = tile.items[tileItemIndex];
        tile.items.splice(tileItemIndex, 1);
      }

      // Check inside searched containers on tile
      if (!item) {
        for (const container of tile.items.filter(
          (i) => i.type === "container" && i.searched
        )) {
          const containerItemIndex = (container.contents ?? []).findIndex(
            matchesItem
          );
          if (containerItemIndex >= 0) {
            item = container.contents![containerItemIndex];
            container.contents!.splice(containerItemIndex, 1);
            fromContainer = container;
            break;
          }
        }
      }

      if (!item) {
        return { success: false, message: "Item not found", events };
      }

      character.inventory.push(item);

      addMemory(character, {
        turn: world.turn,
        type: "picked_up_item",
        description: `Picked up ${item.name}${
          fromContainer ? ` from ${fromContainer.name}` : ""
        }`,
        location: character.position,
        itemId: item.id,
        source: "witnessed",
      });

      // Add memories for witnesses who see this pickup
      for (const other of world.characters) {
        if (other.id === character.id || !other.alive) continue;
        if (lineOfSight(world, other.position, character.position)) {
          addMemory(other, {
            turn: world.turn,
            type: "picked_up_item",
            description: `Saw ${character.name} pick up ${item.name}${
              fromContainer ? ` from ${fromContainer.name}` : ""
            }`,
            characterId: character.id,
            source: "witnessed",
          });
        }
      }

      events.push({
        turn: world.turn,
        type: "pickup",
        actorId: character.id,
        itemId: item.id,
        position: character.position,
        description: `${character.name} picked up ${item.name}`,
      });

      return {
        success: true,
        message: `Picked up ${item.name}`,
        events,
        animationData: {
          type: "pickup",
          targetPosition: character.position,
          itemName: item.name,
        },
      };
    }

    case "drop": {
      if (!action.targetItemId && !action.targetItemName) {
        return { success: false, message: "No item specified", events };
      }

      let itemIndex = -1;
      if (action.targetItemId) {
        itemIndex = character.inventory.findIndex(
          (i) => i.id === action.targetItemId
        );
      } else if (action.targetItemName) {
        itemIndex = character.inventory.findIndex((i) =>
          i.name.toLowerCase().includes(action.targetItemName!.toLowerCase())
        );
      }
      if (itemIndex < 0) {
        return {
          success: false,
          message: `"${
            action.targetItemName || action.targetItemId
          }" not in inventory`,
          events,
        };
      }

      const item = character.inventory[itemIndex];
      character.inventory.splice(itemIndex, 1);

      if (character.equippedWeapon?.id === item.id) {
        character.equippedWeapon = undefined;
      }
      if (character.equippedClothing?.id === item.id) {
        character.equippedClothing = undefined;
      }

      const tile = world.tiles[character.position.y][character.position.x];
      tile.items.push(item);

      events.push({
        turn: world.turn,
        type: "drop",
        actorId: character.id,
        itemId: item.id,
        position: character.position,
        description: `${character.name} dropped ${item.name}`,
      });

      return { success: true, message: `Dropped ${item.name}`, events };
    }

    case "equip": {
      if (!action.targetItemId && !action.targetItemName) {
        return { success: false, message: "No item specified", events };
      }

      let item = action.targetItemId
        ? character.inventory.find((i) => i.id === action.targetItemId)
        : undefined;

      if (!item && action.targetItemName) {
        const nameLower = action.targetItemName.toLowerCase();
        item = character.inventory.find((i) =>
          i.name.toLowerCase().includes(nameLower)
        );
      }

      if (!item) {
        return { success: false, message: "Item not in inventory", events };
      }

      if (item.type === "weapon") {
        character.equippedWeapon = item;
      } else if (item.type === "clothing") {
        character.equippedClothing = item;
      } else {
        return {
          success: false,
          message: "Cannot equip this item type",
          events,
        };
      }

      events.push({
        turn: world.turn,
        type: "equip",
        actorId: character.id,
        itemId: item.id,
        description: `${character.name} equipped ${item.name}`,
      });

      return { success: true, message: `Equipped ${item.name}`, events };
    }

    case "attack": {
      if (!action.targetCharacterId) {
        return { success: false, message: "No target specified", events };
      }

      const target = world.characters.find(
        (c) => c.id === action.targetCharacterId
      );
      if (!target) {
        return { success: false, message: "Target not found", events };
      }

      if (!target.alive) {
        return { success: false, message: "Target is already dead", events };
      }

      if (distance(character.position, target.position) > 1) {
        return { success: false, message: "Target too far away", events };
      }

      const { damage, roll } = calculateDamage(character);
      const weaponName = character.equippedWeapon?.name ?? "fists";

      if (damage === 0) {
        events.push({
          turn: world.turn,
          type: "miss",
          actorId: character.id,
          targetId: target.id,
          description:
            roll === 1
              ? `${character.name} critically missed attacking ${target.name}!`
              : `${character.name} missed ${target.name} with ${weaponName} (rolled ${roll})`,
        });

        addMemory(character, {
          turn: world.turn,
          type: "attacked",
          description: `Attacked ${target.name} with ${weaponName} but missed`,
          characterId: target.id,
          source: "witnessed",
        });

        addMemory(target, {
          turn: world.turn,
          type: "was_attacked",
          description: `${character.name} attacked me with ${weaponName} but missed`,
          characterId: character.id,
          source: "witnessed",
        });
      } else {
        target.hp -= damage;
        const isCrit = roll === 20;

        events.push({
          turn: world.turn,
          type: "damage",
          actorId: character.id,
          targetId: target.id,
          damage,
          description: isCrit
            ? `${character.name} CRITICAL HIT ${target.name} with ${weaponName} for ${damage} damage!`
            : `${character.name} hit ${target.name} with ${weaponName} for ${damage} damage`,
        });

        addMemory(character, {
          turn: world.turn,
          type: "attacked",
          description: `Attacked ${
            target.name
          } with ${weaponName}, dealt ${damage} damage${
            isCrit ? " (critical hit!)" : ""
          }`,
          characterId: target.id,
          source: "witnessed",
        });

        addMemory(target, {
          turn: world.turn,
          type: "was_attacked",
          description: `${character.name} hit me with ${weaponName} for ${damage} damage`,
          characterId: character.id,
          source: "witnessed",
        });

        if (target.hp <= 0) {
          target.hp = 0;
          target.alive = false;

          // Drop all items from the dead character onto the ground
          const tile = world.tiles[target.position.y][target.position.x];
          for (const item of target.inventory) {
            tile.items.push(item);
          }
          if (target.inventory.length > 0) {
            const itemNames = target.inventory.map((i) => i.name).join(", ");
            events.push({
              turn: world.turn,
              type: "drop",
              actorId: target.id,
              position: target.position,
              description: `${target.name}'s items fell to the ground: ${itemNames}`,
            });
          }
          target.inventory = [];
          target.equippedWeapon = undefined;
          target.equippedClothing = undefined;

          events.push({
            turn: world.turn,
            type: "death",
            actorId: character.id,
            targetId: target.id,
            description: `${target.name} has been killed by ${character.name}!`,
          });

          addMemory(character, {
            turn: world.turn,
            type: "character_died",
            description: `Killed ${target.name}`,
            characterId: target.id,
            location: target.position,
            source: "witnessed",
          });

          // Notify witnesses about the kill and dropped items
          for (const witness of world.characters) {
            if (witness.id === character.id || witness.id === target.id)
              continue;
            if (!witness.alive) continue;
            if (
              lineOfSight(world, witness.position, target.position) &&
              distance(witness.position, target.position) <=
                witness.viewDistance
            ) {
              addMemory(witness, {
                turn: world.turn,
                type: "witnessed_attack",
                description: `Witnessed ${character.name} kill ${target.name}`,
                characterId: target.id,
                location: target.position,
                source: "witnessed",
              });
              // Also remember dropped items
              for (const item of tile.items) {
                addMemory(witness, {
                  turn: world.turn,
                  type: "saw_item",
                  description: `${target.name} dropped ${item.name} at (${target.position.x}, ${target.position.y})`,
                  location: target.position,
                  source: "witnessed",
                });
              }
            }
          }

          // The killer also knows about dropped items
          for (const item of tile.items) {
            addMemory(character, {
              turn: world.turn,
              type: "saw_item",
              description: `${target.name} dropped ${item.name} at (${target.position.x}, ${target.position.y})`,
              location: target.position,
              source: "witnessed",
            });
          }
        }
      }

      for (const witness of world.characters) {
        if (witness.id === character.id || witness.id === target.id) continue;
        if (!witness.alive) continue;
        if (
          lineOfSight(world, witness.position, character.position) &&
          distance(witness.position, character.position) <= witness.viewDistance
        ) {
          addMemory(witness, {
            turn: world.turn,
            type: "witnessed_attack",
            description: `Witnessed ${character.name} attack ${target.name}`,
            characterId: character.id,
            location: character.position,
            source: "witnessed",
          });
        }
      }

      return {
        success: true,
        message: damage > 0 ? `Hit for ${damage} damage` : "Missed",
        events,
        animationData: {
          type: "attack",
          targetPosition: target.position,
          damage,
          missed: damage === 0,
        },
      };
    }

    case "talk": {
      if (!action.targetCharacterId || !action.message) {
        return {
          success: false,
          message: "No target or message specified",
          events,
        };
      }

      const target = world.characters.find(
        (c) => c.id === action.targetCharacterId
      );
      if (!target) {
        return { success: false, message: "Target not found", events };
      }

      if (!target.alive) {
        return { success: false, message: "Cannot talk to the dead", events };
      }

      if (distance(character.position, target.position) > MAX_TALK_DISTANCE) {
        return {
          success: false,
          message: "Target too far away to talk",
          events,
        };
      }

      addMemory(target, {
        turn: world.turn,
        type: "heard_about",
        description: `${character.name} told me: "${action.message}"`,
        characterId: character.id,
        source: character.id,
      });

      addMemory(character, {
        turn: world.turn,
        type: "talked_to",
        description: `Told ${target.name}: "${action.message}"`,
        characterId: target.id,
        source: "witnessed",
      });

      events.push({
        turn: world.turn,
        type: "talk",
        actorId: character.id,
        targetId: target.id,
        message: action.message,
        description: `${character.name} to ${target.name}: "${action.message}"`,
      });

      return { success: true, message: "Message delivered", events };
    }

    case "place": {
      if (!action.targetItemId && !action.targetItemName) {
        return { success: false, message: "No item specified", events };
      }

      if (!action.targetPosition) {
        return {
          success: false,
          message: "Must specify adjacent tile to place trap",
          events,
        };
      }

      // Check target is adjacent
      const dx = Math.abs(action.targetPosition.x - character.position.x);
      const dy = Math.abs(action.targetPosition.y - character.position.y);
      if (dx > 1 || dy > 1 || (dx === 0 && dy === 0)) {
        return {
          success: false,
          message: "Can only place trap on adjacent tile (not current tile)",
          events,
        };
      }

      // Check target tile is valid
      if (
        action.targetPosition.x < 0 ||
        action.targetPosition.x >= world.width ||
        action.targetPosition.y < 0 ||
        action.targetPosition.y >= world.height
      ) {
        return { success: false, message: "Target tile out of bounds", events };
      }

      const targetTile =
        world.tiles[action.targetPosition.y][action.targetPosition.x];

      if (!canWalkThrough(targetTile)) {
        return {
          success: false,
          message: "Cannot place trap on non-walkable tile",
          events,
        };
      }

      if (hasContainer(targetTile)) {
        return {
          success: false,
          message: "Cannot place trap on a tile with a container",
          events,
        };
      }

      let trapItem = action.targetItemId
        ? character.inventory.find((i) => i.id === action.targetItemId)
        : undefined;

      if (!trapItem && action.targetItemName) {
        const nameLower = action.targetItemName.toLowerCase();
        trapItem = character.inventory.find(
          (i) => i.name.toLowerCase().includes(nameLower) && i.type === "trap"
        );
      }

      if (!trapItem) {
        return { success: false, message: "Trap not in inventory", events };
      }

      if (trapItem.type !== "trap") {
        return { success: false, message: "Item is not a trap", events };
      }

      // Remove trap from inventory
      const itemIndex = character.inventory.findIndex(
        (i) => i.id === trapItem!.id
      );
      character.inventory.splice(itemIndex, 1);

      // Place trap on target tile
      targetTile.traps.push({
        id: trapItem.id,
        name: trapItem.name,
        ownerId: character.id,
        damage: trapItem.trapDamage ?? 3,
        attackDebuff: trapItem.trapAttackDebuff ?? 2,
        debuffDuration: trapItem.trapDebuffDuration ?? 5,
      });

      addMemory(character, {
        turn: world.turn,
        type: "placed_trap",
        description: `Placed ${trapItem.name} at (${action.targetPosition.x}, ${action.targetPosition.y})`,
        location: { ...action.targetPosition },
        itemId: trapItem.id,
        source: "witnessed",
      });

      events.push({
        turn: world.turn,
        type: "place_trap",
        actorId: character.id,
        itemId: trapItem.id,
        position: { ...action.targetPosition },
        description: `${character.name} placed a ${trapItem.name} at (${action.targetPosition.x}, ${action.targetPosition.y})`,
      });

      return {
        success: true,
        message: `Placed ${trapItem.name} at (${action.targetPosition.x}, ${action.targetPosition.y}) - invisible to enemies!`,
        events,
        animationData: {
          type: "place",
          targetPosition: character.position,
          itemName: trapItem.name,
        },
      };
    }

    case "issue_contract": {
      // Validate contract parameters - actual contract creation happens in main.ts
      if (!action.targetCharacterId) {
        return {
          success: false,
          message: "Must specify target character for contract",
          events,
        };
      }

      if (!action.contractContents) {
        return {
          success: false,
          message: "Must specify contract contents/terms",
          events,
        };
      }

      if (
        !action.contractExpiry ||
        action.contractExpiry < 1 ||
        action.contractExpiry > 20
      ) {
        return {
          success: false,
          message: "Contract expiry must be between 1 and 5 turns",
          events,
        };
      }

      const targetChar = world.characters.find(
        (c) => c.id === action.targetCharacterId
      );
      if (!targetChar) {
        return {
          success: false,
          message: "Target character not found",
          events,
        };
      }

      if (targetChar.id === character.id) {
        return {
          success: false,
          message: "Cannot issue contract to yourself",
          events,
        };
      }

      if (!targetChar.alive) {
        return {
          success: false,
          message: "Target character is dead",
          events,
        };
      }

      // Check target is within talking distance
      const contractDist = distance(character.position, targetChar.position);
      if (contractDist > MAX_TALK_DISTANCE) {
        return {
          success: false,
          message: `${targetChar.name} is too far away (${contractDist} tiles, max ${MAX_TALK_DISTANCE})`,
          events,
        };
      }

      addMemory(character, {
        turn: world.turn,
        type: "issued_contract",
        description: `Offered Blood Contract to ${targetChar.name}: "${
          action.contractContents
        }" (expires turn ${world.turn + action.contractExpiry})`,
        characterId: targetChar.id,
        source: "witnessed",
      });

      const pitchPart = action.message ? ` saying "${action.message}"` : "";
      events.push({
        turn: world.turn,
        type: "contract_issued",
        actorId: character.id,
        targetId: targetChar.id,
        message: action.contractContents,
        description: `${character.name} offers a Blood Contract to ${targetChar.name}${pitchPart}: "${action.contractContents}" (${action.contractExpiry} turns)`,
      });

      return {
        success: true,
        message: `Blood Contract offered to ${targetChar.name}`,
        events,
      };
    }

    case "sign_contract": {
      // This action is used during contract negotiation to indicate willingness to sign
      // The actual contract creation is handled in main.ts handleContractNegotiation
      return {
        success: true,
        message: "Agreed to sign the contract",
        events,
      };
    }

    case "decline_contract": {
      // This action is used during contract negotiation to decline
      return {
        success: true,
        message: "Declined the contract",
        events,
      };
    }

    case "unlock": {
      if (!action.targetPosition) {
        return {
          success: false,
          message: "No target position specified",
          events,
        };
      }

      const { x, y } = action.targetPosition;

      // Check if adjacent
      const dx = Math.abs(x - character.position.x);
      const dy = Math.abs(y - character.position.y);
      if (dx + dy !== 1) {
        return {
          success: false,
          message: "Door must be adjacent to unlock",
          events,
        };
      }

      const tile = world.tiles[y][x];
      if (tile.type !== "blue_door") {
        return {
          success: false,
          message: "There's no locked door there",
          events,
        };
      }

      // Check for blue key in inventory
      const keyIndex = character.inventory.findIndex(
        (item) =>
          item.type === "key" && item.name.toLowerCase().includes("blue")
      );
      if (keyIndex === -1) {
        return {
          success: false,
          message: "You need a Blue Key to unlock this door",
          events,
        };
      }

      // Consume the key
      const keyName = character.inventory[keyIndex].name;
      character.inventory.splice(keyIndex, 1);

      // Change tile to ground
      tile.type = "ground";

      const keyConsumedEvent: GameEvent = {
        turn: world.turn,
        type: "drop",
        actorId: character.id,
        description: `🔑 ${character.name} uses ${keyName} (key consumed)`,
      };
      events.push(keyConsumedEvent);

      const unlockEvent: GameEvent = {
        turn: world.turn,
        type: "search",
        actorId: character.id,
        position: action.targetPosition,
        description: `🔓 ${character.name} unlocks the blue door at (${x}, ${y})!`,
      };
      events.push(unlockEvent);

      // Add memory for the actor
      addMemory(character, {
        turn: world.turn,
        type: "searched_container",
        description: `Unlocked the blue door at (${x}, ${y}) using ${keyName} - the door is now open!`,
        source: "witnessed",
      });

      // Add memories for witnesses
      for (const other of world.characters) {
        if (other.id === character.id || !other.alive) continue;
        if (lineOfSight(world, other.position, action.targetPosition)) {
          addMemory(other, {
            turn: world.turn,
            type: "searched_container",
            description: `Saw ${character.name} use ${keyName} to unlock the blue door at (${x}, ${y}) - the key was consumed and the door is now open!`,
            characterId: character.id,
            source: "witnessed",
          });
        }
      }

      // Update map memory for all characters who can see this tile
      for (const c of world.characters) {
        if (!c.alive) continue;
        if (lineOfSight(world, c.position, action.targetPosition)) {
          c.mapMemory.set(`${x},${y}`, {
            type: "ground",
            lastSeenTurn: world.turn,
          });
        }
      }

      return {
        success: true,
        message: `Unlocked the door at (${x}, ${y})`,
        events,
      };
    }

    case "wait": {
      return { success: true, message: `${character.name} waits`, events };
    }

    default:
      return { success: false, message: "Unknown action type", events };
  }
}

export function getCharacterKnowledge(
  world: World,
  character: Character
): CharacterKnowledge {
  const visible = getVisibleTiles(world, character);

  const possibleActions: Action[] = [{ type: "look_around" }, { type: "wait" }];

  const { x, y } = character.position;
  const moveTargets: Position[] = [];
  for (let dy = -character.movementRange; dy <= character.movementRange; dy++) {
    for (
      let dx = -character.movementRange;
      dx <= character.movementRange;
      dx++
    ) {
      if (dx === 0 && dy === 0) continue;
      const target = { x: x + dx, y: y + dy };
      if (
        target.x >= 0 &&
        target.x < world.width &&
        target.y >= 0 &&
        target.y < world.height
      ) {
        if (
          findPath(world, character.position, target, character.movementRange)
        ) {
          moveTargets.push(target);
        }
      }
    }
  }
  for (const target of moveTargets) {
    possibleActions.push({ type: "move", targetPosition: target });
  }

  const tile = world.tiles[y][x];
  for (const item of tile.items) {
    if (item.type === "container") {
      possibleActions.push({ type: "search_container", targetItemId: item.id });
      if (item.searched && item.contents) {
        for (const content of item.contents) {
          possibleActions.push({ type: "pick_up", targetItemId: content.id });
        }
      }
    } else {
      possibleActions.push({ type: "pick_up", targetItemId: item.id });
    }
  }

  for (const item of character.inventory) {
    possibleActions.push({ type: "drop", targetItemId: item.id });
    if (item.type === "weapon" || item.type === "clothing") {
      possibleActions.push({ type: "equip", targetItemId: item.id });
    }
  }

  if (character.equippedWeapon) {
    possibleActions.push({
      type: "unequip",
      targetItemId: character.equippedWeapon.id,
    });
  }
  if (character.equippedClothing) {
    possibleActions.push({
      type: "unequip",
      targetItemId: character.equippedClothing.id,
    });
  }

  for (const { character: other } of visible.characters) {
    if (distance(character.position, other.position) <= 1) {
      possibleActions.push({ type: "attack", targetCharacterId: other.id });
    }
  }

  // Talk works through bars/doors - based on distance only, not vision
  for (const other of world.characters) {
    if (other.id === character.id || !other.alive) continue;
    if (distance(character.position, other.position) <= MAX_TALK_DISTANCE) {
      possibleActions.push({
        type: "talk",
        targetCharacterId: other.id,
        message: "",
      });
    }
  }

  return {
    status: {
      hp: character.hp,
      maxHp: character.maxHp,
      position: character.position,
      inventory: character.inventory,
      equippedWeapon: character.equippedWeapon,
      equippedClothing: character.equippedClothing,
    },
    visible,
    memories: character.memories,
    possibleActions,
  };
}
