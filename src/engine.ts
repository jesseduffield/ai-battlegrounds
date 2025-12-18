import type {
  World,
  Character,
  Position,
  Action,
  ActionResult,
  GameEvent,
  VisibleState,
  Tile,
  TileType,
  Item,
  CharacterKnowledge,
} from "./types";

export const MAX_TALK_DISTANCE = 15;

export function createId(): string {
  return Math.random().toString(36).substring(2, 11);
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

export function initializeCharacterMemory(
  world: World,
  character: Character
): void {
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
          positionsEqual(c.position, action.targetPosition)
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
            witnessIds: getWitnessIds(world, [stepPos]),
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
        witnessIds: getWitnessIds(world, [finalPosition]),
      });

      // Notify witnesses who can see the final position
      for (const witness of world.characters) {
        if (witness.id === character.id) continue;
        if (!witness.alive) continue;
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

      return {
        success: true,
        message: `Looked around. Saw ${visible.characters.length} characters and ${visible.items.length} items.`,
        events,
      };
    }

    case "search_container": {
      const adjacentPositions = [
        character.position,
        { x: character.position.x - 1, y: character.position.y },
        { x: character.position.x + 1, y: character.position.y },
        { x: character.position.x, y: character.position.y - 1 },
        { x: character.position.x, y: character.position.y + 1 },
      ];

      let container: Item | undefined;
      let containerPosition: Position | undefined;

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
        const found = tile.items.find(
          (item) => item.type === "container" && item.id === action.targetItemId
        );
        if (found) {
          container = found;
          containerPosition = pos;
          break;
        }
      }

      if (!container || !containerPosition) {
        return {
          success: false,
          message: "Container not adjacent - must be within 1 tile to search",
          events,
        };
      }

      container.searched = true;
      const contents = container.contents ?? [];

      events.push({
        turn: world.turn,
        type: "search",
        actorId: character.id,
        itemId: container.id,
        position: containerPosition,
        description: `${character.name} searched ${container.name}`,
        witnessIds: getWitnessIds(world, [containerPosition]),
      });

      return {
        success: true,
        message: `Found ${contents.length} items`,
        events,
      };
    }

    case "pick_up": {
      // Search current tile and adjacent tiles for the item
      const adjacentPositions = [
        character.position,
        { x: character.position.x - 1, y: character.position.y },
        { x: character.position.x + 1, y: character.position.y },
        { x: character.position.x, y: character.position.y - 1 },
        { x: character.position.x, y: character.position.y + 1 },
      ];

      let item: Item | undefined;
      let foundPosition: Position | undefined;

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

        // Check items on tile
        const tileItemIndex = tile.items.findIndex(
          (i) => i.id === action.targetItemId
        );
        if (tileItemIndex >= 0) {
          item = tile.items[tileItemIndex];
          tile.items.splice(tileItemIndex, 1);
          foundPosition = pos;
          break;
        }

        // Check inside searched containers on tile
        for (const container of tile.items.filter(
          (i) => i.type === "container" && i.searched
        )) {
          const containerItemIndex = (container.contents ?? []).findIndex(
            (i) => i.id === action.targetItemId
          );
          if (containerItemIndex >= 0) {
            item = container.contents![containerItemIndex];
            container.contents!.splice(containerItemIndex, 1);
            foundPosition = pos;
            break;
          }
        }

        if (item) break;
      }

      if (!item || !foundPosition) {
        return { success: false, message: "Item not found nearby", events };
      }

      character.inventory.push(item);

      events.push({
        turn: world.turn,
        type: "pickup",
        actorId: character.id,
        itemId: item.id,
        position: character.position,
        description: `${character.name} picked up ${item.name}`,
        witnessIds: getWitnessIds(world, [character.position]),
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
      const itemIndex = character.inventory.findIndex(
        (i) => i.id === action.targetItemId
      );
      if (itemIndex < 0) {
        return {
          success: false,
          message: "Item not in inventory",
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
        witnessIds: getWitnessIds(world, [character.position]),
      });

      return { success: true, message: `Dropped ${item.name}`, events };
    }

    case "equip": {
      const item = character.inventory.find(
        (i) => i.id === action.targetItemId
      );
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
        witnessIds: getWitnessIds(world, [character.position]),
      });

      return { success: true, message: `Equipped ${item.name}`, events };
    }

    case "unequip": {
      const item = character.inventory.find(
        (i) => i.id === action.targetItemId
      );
      if (!item) {
        return { success: false, message: "Item not in inventory", events };
      }

      if (item.type === "weapon" && character.equippedWeapon?.id === item.id) {
        character.equippedWeapon = undefined;
      } else if (
        item.type === "clothing" &&
        character.equippedClothing?.id === item.id
      ) {
        character.equippedClothing = undefined;
      } else {
        return {
          success: false,
          message: "Item is not equipped",
          events,
        };
      }

      events.push({
        turn: world.turn,
        type: "equip",
        actorId: character.id,
        itemId: item.id,
        description: `${character.name} unequipped ${item.name}`,
        witnessIds: getWitnessIds(world, [character.position]),
      });

      return { success: true, message: `Unequipped ${item.name}`, events };
    }

    case "attack": {
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
          witnessIds: getWitnessIds(world, [target.position]),
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
          witnessIds: getWitnessIds(world, [target.position]),
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
              witnessIds: getWitnessIds(world, [target.position]),
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
            witnessIds: getWitnessIds(world, [target.position]),
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

      events.push({
        turn: world.turn,
        type: "talk",
        actorId: character.id,
        targetId: target.id,
        message: action.message,
        description: `${character.name} to ${
          target.name
        }: "${action.message.replace(/\n/g, " ")}"`,
        witnessIds: getWitnessIds(world, [character.position, target.position]),
      });

      return { success: true, message: "Message delivered", events };
    }

    case "place": {
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

      const trapItem = character.inventory.find(
        (i) => i.id === action.targetItemId
      );
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

      events.push({
        turn: world.turn,
        type: "place_trap",
        actorId: character.id,
        itemId: trapItem.id,
        position: { ...action.targetPosition },
        description: `${character.name} placed a ${trapItem.name} at (${action.targetPosition.x}, ${action.targetPosition.y})`,
        witnessIds: [character.id],
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
      if (action.contractExpiry < 1 || action.contractExpiry > 20) {
        return {
          success: false,
          message: "Contract expiry must be between 1 and 20 turns",
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

      const pitchPart = action.message ? ` saying "${action.message}"` : "";
      events.push({
        turn: world.turn,
        type: "contract_issued",
        actorId: character.id,
        targetId: targetChar.id,
        message: action.contractContents,
        description: `${character.name} offers a Blood Contract to ${targetChar.name}${pitchPart}: "${action.contractContents}" (${action.contractExpiry} turns)`,
        witnessIds: [character.id, targetChar.id],
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
      const doorName = action.targetDoorName.toLowerCase();

      // Map door names to tile types and required keys
      const doorConfig: Record<
        string,
        { tileType: TileType; keyName: string }
      > = {
        "blue door": { tileType: "blue_door", keyName: "blue" },
      };

      const config = Object.entries(doorConfig).find(([name]) =>
        doorName.includes(name)
      )?.[1];

      if (!config) {
        return {
          success: false,
          message: `Unknown door type: "${action.targetDoorName}"`,
          events,
        };
      }

      // Find adjacent door of this type
      const adjacentPositions = [
        { x: character.position.x - 1, y: character.position.y },
        { x: character.position.x + 1, y: character.position.y },
        { x: character.position.x, y: character.position.y - 1 },
        { x: character.position.x, y: character.position.y + 1 },
      ];

      let doorPosition: Position | undefined;
      let doorTile: Tile | undefined;

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
        if (tile.type === config.tileType) {
          doorPosition = pos;
          doorTile = tile;
          break;
        }
      }

      if (!doorPosition || !doorTile) {
        return {
          success: false,
          message: `No ${action.targetDoorName} adjacent to unlock`,
          events,
        };
      }

      // Check for matching key in inventory
      const keyIndex = character.inventory.findIndex(
        (item) =>
          item.type === "key" &&
          item.name.toLowerCase().includes(config.keyName)
      );
      if (keyIndex === -1) {
        return {
          success: false,
          message: `You need a ${
            config.keyName.charAt(0).toUpperCase() + config.keyName.slice(1)
          } Key to unlock this door`,
          events,
        };
      }

      // Consume the key
      const keyName = character.inventory[keyIndex].name;
      character.inventory.splice(keyIndex, 1);

      // Change tile to ground
      doorTile.type = "ground";

      const keyConsumedEvent: GameEvent = {
        turn: world.turn,
        type: "drop",
        actorId: character.id,
        description: `🔑 ${character.name} uses ${keyName} (key consumed)`,
        witnessIds: getWitnessIds(world, [character.position]),
      };
      events.push(keyConsumedEvent);

      const unlockEvent: GameEvent = {
        turn: world.turn,
        type: "unlock",
        actorId: character.id,
        position: doorPosition,
        description: `🔓 ${character.name} unlocks the ${action.targetDoorName} at (${doorPosition.x}, ${doorPosition.y})!`,
        witnessIds: getWitnessIds(world, [doorPosition]),
      };
      events.push(unlockEvent);

      // Update map memory for all characters who can see this tile
      for (const c of world.characters) {
        if (!c.alive) continue;
        if (lineOfSight(world, c.position, doorPosition)) {
          c.mapMemory.set(`${doorPosition.x},${doorPosition.y}`, {
            type: "ground",
            lastSeenTurn: world.turn,
          });
        }
      }

      return {
        success: true,
        message: `Unlocked the ${action.targetDoorName}`,
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

// Returns true if the position is visible to the character
function isVisible(
  world: World,
  character: Character,
  position: Position
): boolean {
  return (
    lineOfSight(world, character.position, position) &&
    distance(character.position, position) <= character.viewDistance
  );
}

// Returns the IDs of the characters who can see ANY of the given positions.
export function getWitnessIds(world: World, positions: Position[]): string[] {
  return world.characters
    .filter(
      (character) =>
        character.alive &&
        positions.some((pos) => isVisible(world, character, pos))
    )
    .map((character) => character.id);
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
          possibleActions.push({
            type: "pick_up",
            targetItemId: content.id,
          });
        }
      }
    } else {
      possibleActions.push({
        type: "pick_up",
        targetItemId: item.id,
      });
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
    witnessedEvents: world.events.filter((e) =>
      e.witnessIds.includes(character.id)
    ),
    possibleActions,
  };
}
