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
  DoorFeature,
  ChestFeature,
  Effect,
  EffectTrigger,
  EffectAction,
} from "./types";

export const MAX_TALK_DISTANCE = 15;

export function applyEffect(character: Character, effect: Effect): boolean {
  if (character.effects.some((e) => e.id === effect.id)) {
    return false;
  }
  character.effects.push({ ...effect });
  return true;
}

export function removeEffect(character: Character, effectId: string): void {
  character.effects = character.effects.filter((e) => e.id !== effectId);
}

export type EffectActionResult = {
  description: string;
  events: GameEvent[];
  pendingCustom?: { prompt: string };
  died?: boolean;
};

export function applyEffectAction(
  action: EffectAction,
  character: Character,
  world: World,
  source: string
): EffectActionResult {
  const events: GameEvent[] = [];

  switch (action.type) {
    case "damage": {
      character.hp -= action.amount;
      events.push({
        turn: world.turn,
        actorId: character.id,
        damage: action.amount,
        description: `${character.name} takes ${action.amount} damage from ${source}!`,
        sound: "attack",
        witnessIds: getWitnessIds(world, [character.position]),
      });
      if (character.hp <= 0) {
        character.hp = 0;
        character.alive = false;

        // Drop all items from the dead character onto the ground
        const tile = world.tiles[character.position.y][character.position.x];
        for (const item of character.inventory) {
          tile.items.push(item);
        }
        if (character.inventory.length > 0) {
          const itemNames = character.inventory.map((i) => i.name).join(", ");
          events.push({
            turn: world.turn,
            sound: "drop",
            actorId: character.id,
            position: character.position,
            description: `${character.name}'s items fell to the ground: ${itemNames}`,
            witnessIds: getWitnessIds(world, [character.position]),
          });
        }
        character.inventory = [];
        character.equippedWeapon = undefined;
        character.equippedClothing = undefined;

        events.push({
          turn: world.turn,
          actorId: character.id,
          description: `${character.name} died from ${source}!`,
          sound: "death",
          witnessIds: getWitnessIds(world, [character.position]),
        });
        return {
          description: `took ${action.amount} damage`,
          events,
          died: true,
        };
      }
      return { description: `took ${action.amount} damage`, events };
    }
    case "heal": {
      const healAmount = Math.min(
        action.amount,
        character.maxHp - character.hp
      );
      character.hp += healAmount;
      if (healAmount > 0) {
        events.push({
          turn: world.turn,
          actorId: character.id,
          damage: -healAmount,
          description: `${character.name} heals ${healAmount} HP from ${source}!`,
          witnessIds: getWitnessIds(world, [character.position]),
        });
      }
      return { description: `restored ${healAmount} HP`, events };
    }
    case "apply_effect": {
      applyEffect(character, { ...action.effect });
      events.push({
        turn: world.turn,
        actorId: character.id,
        description: `${character.name} gains ${action.effect.name} from ${source}!`,
        witnessIds: getWitnessIds(world, [character.position]),
      });
      return { description: `gained ${action.effect.name} effect`, events };
    }
    case "message": {
      events.push({
        turn: world.turn,
        actorId: character.id,
        description: `${source}: ${action.text}`,
        witnessIds: getWitnessIds(world, [character.position]),
      });
      return { description: action.text, events };
    }
    case "modify_stat": {
      const desc =
        action.operation === "multiply"
          ? `${action.stat} ×${Math.round(action.value * 100)}%`
          : `${action.stat} ${action.value >= 0 ? "+" : ""}${action.value}`;
      events.push({
        turn: world.turn,
        actorId: character.id,
        description: `${character.name}'s ${desc} from ${source}!`,
        witnessIds: getWitnessIds(world, [character.position]),
      });
      return { description: `${action.stat} modified`, events };
    }
    case "custom": {
      return {
        description: `custom effect pending`,
        events,
        pendingCustom: { prompt: action.prompt },
      };
    }
  }
}

export type PendingCustomAction = {
  characterId: string;
  effectName: string;
  prompt: string;
};

export type ProcessEffectsResult = {
  events: GameEvent[];
  pendingCustomActions: PendingCustomAction[];
};

export function processEffects(
  character: Character,
  trigger: EffectTrigger,
  world: World
): ProcessEffectsResult {
  const events: GameEvent[] = [];
  const pendingCustomActions: PendingCustomAction[] = [];

  for (const effect of character.effects) {
    for (const t of effect.triggers) {
      if (t.on === trigger) {
        for (const action of t.actions) {
          const result = applyEffectAction(
            action,
            character,
            world,
            effect.name
          );
          events.push(...result.events);
          if (result.pendingCustom) {
            pendingCustomActions.push({
              characterId: character.id,
              effectName: effect.name,
              prompt: result.pendingCustom.prompt,
            });
          }
        }
      }
    }
  }

  return { events, pendingCustomActions };
}

export function tickEffectDurations(character: Character): Effect[] {
  const expiredEffects: Effect[] = [];

  for (const effect of character.effects) {
    if (effect.duration > 0) {
      effect.duration--;
      if (effect.duration === 0) {
        expiredEffects.push(effect);
      }
    }
  }

  character.effects = character.effects.filter((e) => e.duration !== 0);
  return expiredEffects;
}

export function hasEffect(character: Character, effectName: string): boolean {
  return character.effects.some((e) => e.name === effectName);
}

export function getEffectStatModifier(
  character: Character,
  trigger: EffectTrigger,
  stat: "attack" | "defense" | "speed"
): { additive: number; multiplicative: number } {
  let additive = 0;
  let multiplicative = 1;

  for (const effect of character.effects) {
    for (const t of effect.triggers) {
      if (t.on === trigger) {
        for (const action of t.actions) {
          if (action.type === "modify_stat" && action.stat === stat) {
            if (action.operation === "add") {
              additive += action.value;
            } else if (action.operation === "multiply") {
              multiplicative *= action.value;
            }
          }
        }
      }
    }
  }

  return { additive, multiplicative };
}

export function describeEffect(effect: Effect): string {
  const parts: string[] = [];

  if (effect.preventsMovement) {
    parts.push("prevents movement");
  }

  for (const trigger of effect.triggers) {
    for (const action of trigger.actions) {
      if (action.type === "damage") {
        parts.push(`${action.amount} damage/${trigger.on.replace("_", " ")}`);
      } else if (action.type === "heal") {
        parts.push(`${action.amount} heal/${trigger.on.replace("_", " ")}`);
      } else if (action.type === "modify_stat") {
        const statName = action.stat;
        if (action.operation === "multiply") {
          const percent = Math.round(action.value * 100);
          parts.push(`${statName} ×${percent}%`);
        } else {
          const sign = action.value >= 0 ? "+" : "";
          parts.push(`${statName} ${sign}${action.value}`);
        }
      } else if (action.type === "custom") {
        parts.push(`custom: "${action.prompt}"`);
      } else if (action.type === "apply_effect") {
        parts.push(`applies ${action.effect.name}`);
      } else if (action.type === "message") {
        parts.push(`message: "${action.text}"`);
      }
    }
  }

  return parts.length > 0 ? parts.join(", ") : "no effects";
}

export function createId(): string {
  return Math.random().toString(36).substring(2, 11);
}

// Manhattan distance (for range calculations like talk distance)
export function distance(a: Position, b: Position): number {
  return Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
}

// Chebyshev distance (for movement - diagonal = 1 step)
export function chebyshevDistance(a: Position, b: Position): number {
  return Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));
}

export function positionsEqual(a: Position, b: Position): boolean {
  return a.x === b.x && a.y === b.y;
}

// Get all 8 adjacent positions (including diagonals)
// Cardinal directions first for more natural pathfinding
export function getAdjacentPositions(pos: Position): Position[] {
  return [
    // Cardinal directions first (preferred for natural-looking paths)
    { x: pos.x, y: pos.y - 1 }, // N
    { x: pos.x + 1, y: pos.y }, // E
    { x: pos.x, y: pos.y + 1 }, // S
    { x: pos.x - 1, y: pos.y }, // W
    // Diagonals second
    { x: pos.x - 1, y: pos.y - 1 }, // NW
    { x: pos.x + 1, y: pos.y - 1 }, // NE
    { x: pos.x - 1, y: pos.y + 1 }, // SW
    { x: pos.x + 1, y: pos.y + 1 }, // SE
  ];
}

// Check if position is adjacent (including diagonals)
export function isAdjacent(a: Position, b: Position): boolean {
  return chebyshevDistance(a, b) === 1;
}

function blocksVision(tile: Tile): boolean {
  return tile.type === "wall";
}

function hasChest(tile: Tile): boolean {
  return tile.feature?.type === "chest";
}

function hasClosedDoor(tile: Tile): boolean {
  return tile.feature?.type === "door" && !tile.feature.open;
}

function canWalkThrough(tile: Tile): boolean {
  const walkableTiles: TileType[] = ["ground", "grass"];
  if (!walkableTiles.includes(tile.type)) {
    return false;
  }
  if (hasClosedDoor(tile)) {
    return false;
  }
  if (hasChest(tile)) {
    return false;
  }
  return true;
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

  // Add corner walls: walls not directly visible but with 2+ adjacent visible walls
  addCornerWallsToVisibleSet(world, visibleSet);

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

function addCornerWallsToVisibleSet(
  world: World,
  visibleSet: Set<string>
): void {
  // Find walls adjacent to visible positions that aren't already visible
  const candidateWalls = new Set<string>();

  for (const visibleKey of visibleSet) {
    const [x, y] = visibleKey.split(",").map(Number);
    const neighbors = [
      { x: x + 1, y },
      { x: x - 1, y },
      { x, y: y + 1 },
      { x, y: y - 1 },
    ];

    for (const neighbor of neighbors) {
      if (
        neighbor.x < 0 ||
        neighbor.x >= world.width ||
        neighbor.y < 0 ||
        neighbor.y >= world.height
      ) {
        continue;
      }

      const neighborKey = `${neighbor.x},${neighbor.y}`;
      if (visibleSet.has(neighborKey)) continue;

      const neighborTile = world.tiles[neighbor.y][neighbor.x];
      if (neighborTile.type === "wall") {
        candidateWalls.add(neighborKey);
      }
    }
  }

  // Add walls that have 2+ adjacent visible walls (corner walls)
  for (const wallKey of candidateWalls) {
    const [x, y] = wallKey.split(",").map(Number);
    const neighbors = [
      { x: x + 1, y },
      { x: x - 1, y },
      { x, y: y + 1 },
      { x, y: y - 1 },
    ];

    let visibleAdjacentWallCount = 0;
    for (const neighbor of neighbors) {
      if (
        neighbor.x < 0 ||
        neighbor.x >= world.width ||
        neighbor.y < 0 ||
        neighbor.y >= world.height
      ) {
        continue;
      }

      const neighborKey = `${neighbor.x},${neighbor.y}`;
      const neighborTile = world.tiles[neighbor.y][neighbor.x];

      if (neighborTile.type === "wall" && visibleSet.has(neighborKey)) {
        visibleAdjacentWallCount++;
      }
    }

    if (visibleAdjacentWallCount >= 2) {
      visibleSet.add(wallKey);
    }
  }
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

    const featureMemory = visibleTile.feature
      ? { type: visibleTile.feature.type, name: visibleTile.feature.name }
      : undefined;

    character.mapMemory.set(key, {
      type: visibleTile.type,
      lastSeenTurn: world.turn,
      items: itemsAtTile.length > 0 ? itemsAtTile : undefined,
      characterName: charAtTile?.character.name,
      characterAlive: charAtTile?.character.alive,
      feature: featureMemory,
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

    // 8-directional movement (including diagonals)
    const neighbors = getAdjacentPositions(current.pos);

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

      // Chests are never walkable, even as destination
      if (hasChest(tile)) continue;

      // Walls/non-ground tiles are NEVER walkable (includes closed doors)
      if (!canWalkThrough(tile)) continue;

      // Check for diagonal blocking (can't squeeze between two walls)
      const dx = next.x - current.pos.x;
      const dy = next.y - current.pos.y;
      if (dx !== 0 && dy !== 0) {
        // Diagonal move - check both adjacent tiles
        const tile1 = world.tiles[current.pos.y][next.x];
        const tile2 = world.tiles[next.y][current.pos.x];
        if (!canWalkThrough(tile1) && !canWalkThrough(tile2)) {
          continue; // Can't squeeze between two blocking tiles
        }
      }

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

    // 8-directional movement (including diagonals)
    const neighbors = getAdjacentPositions(current.pos);

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

      if (!canWalkThrough(tile)) continue;

      // Check for diagonal blocking (can't squeeze between two walls)
      const dx = next.x - current.pos.x;
      const dy = next.y - current.pos.y;
      if (dx !== 0 && dy !== 0) {
        const tile1 = world.tiles[current.pos.y][next.x];
        const tile2 = world.tiles[next.y][current.pos.x];
        if (!canWalkThrough(tile1) && !canWalkThrough(tile2)) {
          continue;
        }
      }

      const hasCharacter = world.characters.some(
        (c) =>
          c.alive && c.id !== character.id && positionsEqual(c.position, next)
      );
      if (hasCharacter) continue;

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
  const attackMod = getEffectStatModifier(attacker, "on_attack", "attack");
  const isDebuffed = attackMod.multiplicative < 1 || attackMod.additive < 0;
  const roll = rollDice(20);

  if (roll === 20) {
    // Critical hit - double base damage, then apply modifiers
    let finalDamage = baseDamage * 2;
    finalDamage = (finalDamage + attackMod.additive) * attackMod.multiplicative;
    return { damage: Math.max(1, Math.floor(finalDamage)), roll, isDebuffed };
  }
  if (roll === 1) {
    return { damage: 0, roll, isDebuffed };
  }

  const hitThreshold = 8;
  if (roll >= hitThreshold) {
    let finalDamage = baseDamage;
    finalDamage = (finalDamage + attackMod.additive) * attackMod.multiplicative;
    return { damage: Math.max(1, Math.floor(finalDamage)), roll, isDebuffed };
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
      const movementBlockingEffect = character.effects.find(
        (e) => e.preventsMovement
      );
      if (movementBlockingEffect) {
        return {
          success: false,
          message: `${character.name} cannot move due to ${movementBlockingEffect.name}! (${movementBlockingEffect.duration} turns remaining)`,
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

        // Check if there's a trap feature on this tile
        if (stepTile.feature?.type === "trap" && !stepTile.feature.triggered) {
          const trap = stepTile.feature;
          const effect = trap.appliesEffect;

          // Trap triggered! Stop movement here
          finalPosition = stepPos;
          actualPath = [startPos, ...path.slice(0, i + 1)];
          trapTriggered = true;

          // Apply the trap's effect to the character
          applyEffect(character, { ...effect, sourceId: trap.ownerId });

          const ownTrap = trap.ownerId === character.id;
          events.push({
            turn: world.turn,
            actorId: character.id,
            position: stepPos,
            description: `${character.name} stepped on ${
              ownTrap ? "their own" : "a"
            } ${trap.name}! ${effect.name} for ${effect.duration} turns!`,
            sound: "trap",
            witnessIds: getWitnessIds(world, [stepPos]),
          });

          // Mark the trap as triggered and remove it
          trap.triggered = true;
          stepTile.feature = undefined;

          break;
        }
      }

      character.position = finalPosition;

      events.push({
        turn: world.turn,
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

    case "move_toward": {
      const movementBlockingEffect = character.effects.find(
        (e) => e.preventsMovement
      );
      if (movementBlockingEffect) {
        return {
          success: false,
          message: `${character.name} cannot move due to ${movementBlockingEffect.name}! (${movementBlockingEffect.duration} turns remaining)`,
          events,
        };
      }

      // Find path to destination (allow long paths)
      const fullPath = findPath(
        world,
        character.position,
        action.targetPosition,
        1000 // Allow very long paths
      );
      if (!fullPath || fullPath.length === 0) {
        return {
          success: false,
          message: `Cannot find path to (${action.targetPosition.x}, ${action.targetPosition.y})`,
          events,
        };
      }

      // Take only as many steps as movementRange allows
      const stepsToTake = Math.min(fullPath.length, character.movementRange);
      const pathThisTurn = fullPath.slice(0, stepsToTake);
      const targetThisTurn = pathThisTurn[pathThisTurn.length - 1];

      // Check if destination is occupied by another character
      const occupant = world.characters.find(
        (c) =>
          c.alive &&
          c.id !== character.id &&
          positionsEqual(c.position, targetThisTurn)
      );
      if (occupant) {
        // Stop one tile before the occupant
        if (pathThisTurn.length > 1) {
          pathThisTurn.pop();
        } else {
          return {
            success: false,
            message: `Path blocked by ${occupant.name}`,
            events,
          };
        }
      }

      const startPos = { ...character.position };
      let finalPosition = pathThisTurn[pathThisTurn.length - 1];
      let trapTriggered = false;
      let actualPath = [startPos, ...pathThisTurn];

      // Check each tile along the path for enemy traps
      for (let i = 0; i < pathThisTurn.length; i++) {
        const stepPos = pathThisTurn[i];
        const stepTile = world.tiles[stepPos.y][stepPos.x];

        if (stepTile.feature?.type === "trap" && !stepTile.feature.triggered) {
          const trap = stepTile.feature;
          const effect = trap.appliesEffect;

          finalPosition = stepPos;
          actualPath = [startPos, ...pathThisTurn.slice(0, i + 1)];
          trapTriggered = true;

          applyEffect(character, { ...effect, sourceId: trap.ownerId });

          const ownTrap = trap.ownerId === character.id;
          events.push({
            turn: world.turn,
            actorId: character.id,
            position: stepPos,
            description: `${character.name} stepped on ${
              ownTrap ? "their own" : "a"
            } ${trap.name}! ${effect.name} for ${effect.duration} turns!`,
            sound: "trap",
            witnessIds: getWitnessIds(world, [stepPos]),
          });

          trap.triggered = true;
          stepTile.feature = undefined;
          break;
        }
      }

      character.position = finalPosition;

      const remainingDistance = fullPath.length - stepsToTake;
      const arrivedAtDestination = positionsEqual(finalPosition, action.targetPosition);

      events.push({
        turn: world.turn,
        actorId: character.id,
        position: finalPosition,
        description: trapTriggered
          ? `${character.name} was caught in a trap at (${finalPosition.x}, ${finalPosition.y})!`
          : arrivedAtDestination
          ? `${character.name} arrived at destination (${finalPosition.x}, ${finalPosition.y})`
          : `${character.name} moved toward (${action.targetPosition.x}, ${action.targetPosition.y}), now at (${finalPosition.x}, ${finalPosition.y}) - ${remainingDistance} tiles remaining`,
        witnessIds: getWitnessIds(world, [finalPosition]),
      });

      return {
        success: true,
        message: trapTriggered
          ? "Trapped!"
          : arrivedAtDestination
          ? "Arrived at destination"
          : `Moving toward destination (${remainingDistance} tiles remaining)`,
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

        const featureMemory = visibleTile.feature
          ? { type: visibleTile.feature.type, name: visibleTile.feature.name }
          : undefined;

        character.mapMemory.set(key, {
          type: visibleTile.type,
          lastSeenTurn: world.turn,
          items: itemsAtTile.length > 0 ? itemsAtTile : undefined,
          characterName: charAtTile?.character.name,
          characterAlive: charAtTile?.character.alive,
          feature: featureMemory,
        });
      }

      return {
        success: true,
        message: `Looked around. Saw ${visible.characters.length} characters and ${visible.items.length} items.`,
        events,
      };
    }

    case "search_container": {
      // Include current tile and all 8 adjacent tiles
      const adjacentPositions = [
        character.position,
        ...getAdjacentPositions(character.position),
      ];

      let chest: ChestFeature | undefined;
      let chestPosition: Position | undefined;

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
        if (
          tile.feature?.type === "chest" &&
          tile.feature.id === action.targetFeatureId
        ) {
          chest = tile.feature;
          chestPosition = pos;
          break;
        }
      }

      if (!chest || !chestPosition) {
        return {
          success: false,
          message: "Chest not adjacent - must be within 1 tile to search",
          events,
        };
      }

      chest.searched = true;
      const contents = chest.contents ?? [];

      events.push({
        turn: world.turn,
        sound: "search",
        actorId: character.id,
        position: chestPosition,
        description: `${character.name} searched ${chest.name}`,
        witnessIds: getWitnessIds(world, [chestPosition]),
      });

      return {
        success: true,
        message: `Found ${contents.length} items`,
        events,
      };
    }

    case "pick_up": {
      // Search current tile and all 8 adjacent tiles for the item
      const adjacentPositions = [
        character.position,
        ...getAdjacentPositions(character.position),
      ];

      let item: Item | undefined;
      let foundPosition: Position | undefined;
      const searchName = action.targetItemName.toLowerCase();

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

        // Check items on tile (exact match)
        const tileItemIndex = tile.items.findIndex(
          (i) => i.name.toLowerCase() === searchName
        );
        if (tileItemIndex >= 0) {
          item = tile.items[tileItemIndex];
          tile.items.splice(tileItemIndex, 1);
          foundPosition = pos;
          break;
        }

        // Check inside searched chests on tile (exact match)
        if (tile.feature?.type === "chest" && tile.feature.searched) {
          const chestItemIndex = (tile.feature.contents ?? []).findIndex(
            (i) => i.name.toLowerCase() === searchName
          );
          if (chestItemIndex >= 0) {
            item = tile.feature.contents![chestItemIndex];
            tile.feature.contents!.splice(chestItemIndex, 1);
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
        sound: "pickup",
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
        sound: "drop",
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
        sound: "equip",
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
        sound: "equip",
        actorId: character.id,
        itemId: item.id,
        description: `${character.name} unequipped ${item.name}`,
        witnessIds: getWitnessIds(world, [character.position]),
      });

      return { success: true, message: `Unequipped ${item.name}`, events };
    }

    case "use": {
      const item = character.inventory.find(
        (i) => i.id === action.targetItemId
      );
      if (!item) {
        return { success: false, message: "Item not in inventory", events };
      }

      if (!item.useEffect) {
        return {
          success: false,
          message: `${item.name} cannot be used`,
          events,
        };
      }

      const result = applyEffectAction(
        item.useEffect,
        character,
        world,
        item.name
      );
      events.push(...result.events);

      // Remove consumable from inventory after use
      const itemIndex = character.inventory.findIndex(
        (i) => i.id === action.targetItemId
      );
      if (itemIndex >= 0) {
        character.inventory.splice(itemIndex, 1);
      }

      events.push({
        turn: world.turn,
        sound: "use",
        actorId: character.id,
        itemId: item.id,
        description: `${character.name} used ${item.name} and ${result.description}`,
        witnessIds: getWitnessIds(world, [character.position]),
      });

      return { success: true, message: `Used ${item.name}`, events };
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

      if (!isAdjacent(character.position, target.position)) {
        return { success: false, message: "Target too far away", events };
      }

      const { damage, roll } = calculateDamage(character);
      const weaponName = character.equippedWeapon?.name ?? "fists";

      if (damage === 0) {
        events.push({
          turn: world.turn,
          sound: "miss",
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
          sound: "attack",
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
              sound: "drop",
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
            sound: "death",
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

      if (targetTile.feature) {
        return {
          success: false,
          message: "Cannot place trap on a tile with a feature",
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

      // Place trap as feature on target tile
      const defaultTrapEffect: Effect = {
        id: createId(),
        name: "Trapped",
        duration: 5,
        preventsMovement: true,
        triggers: [
          { on: "turn_start", actions: [{ type: "damage", amount: 3 }] },
          {
            on: "on_attack",
            actions: [
              {
                type: "modify_stat",
                stat: "attack",
                operation: "multiply",
                value: 0.5,
              },
            ],
          },
        ],
      };
      targetTile.feature = {
        type: "trap",
        id: trapItem.id,
        name: trapItem.name,
        ownerId: character.id,
        witnessIds: getWitnessIds(world, [action.targetPosition]),
        appliesEffect: trapItem.trapEffect ?? defaultTrapEffect,
        triggered: false,
      };

      events.push({
        turn: world.turn,

        actorId: character.id,
        itemId: trapItem.id,
        position: { ...action.targetPosition },
        description: `${character.name} placed a ${trapItem.name} at (${action.targetPosition.x}, ${action.targetPosition.y})`,
        witnessIds: getWitnessIds(world, [action.targetPosition]),
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
      // Find adjacent door feature with matching ID (8 directions)
      const adjacentPositions = getAdjacentPositions(character.position);

      let doorPosition: Position | undefined;
      let doorTile: Tile | undefined;
      let doorFeature: DoorFeature | undefined;

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
        if (
          tile.feature?.type === "door" &&
          tile.feature.id === action.targetFeatureId
        ) {
          doorPosition = pos;
          doorTile = tile;
          doorFeature = tile.feature;
          break;
        }
      }

      if (!doorPosition || !doorTile || !doorFeature) {
        return {
          success: false,
          message: "No matching door adjacent to unlock",
          events,
        };
      }

      if (!doorFeature.locked) {
        return {
          success: false,
          message: "This door is not locked",
          events,
        };
      }

      if (doorFeature.open) {
        return {
          success: false,
          message: "This door is already open",
          events,
        };
      }

      // Check for matching key in inventory
      const keyIndex = character.inventory.findIndex(
        (item) =>
          item.type === "key" && item.unlocksFeatureId === doorFeature!.id
      );
      if (keyIndex === -1) {
        return {
          success: false,
          message: `You need the correct key to unlock ${doorFeature.name}`,
          events,
        };
      }

      // Consume the key
      const keyName = character.inventory[keyIndex].name;
      character.inventory.splice(keyIndex, 1);

      // Unlock and open the door
      doorFeature.locked = false;
      doorFeature.open = true;

      const keyConsumedEvent: GameEvent = {
        turn: world.turn,
        sound: "drop",
        actorId: character.id,
        description: `🔑 ${character.name} uses ${keyName} (key consumed)`,
        witnessIds: getWitnessIds(world, [character.position]),
      };
      events.push(keyConsumedEvent);

      const unlockEvent: GameEvent = {
        turn: world.turn,
        sound: "unlock",
        actorId: character.id,
        position: doorPosition,
        description: `🔓 ${character.name} unlocks ${doorFeature.name} at (${doorPosition.x}, ${doorPosition.y})!`,
        witnessIds: getWitnessIds(world, [doorPosition]),
      };
      events.push(unlockEvent);

      // Update map memory for all characters who can see this tile
      for (const c of world.characters) {
        if (!c.alive) continue;
        if (lineOfSight(world, c.position, doorPosition)) {
          c.mapMemory.set(`${doorPosition.x},${doorPosition.y}`, {
            type: doorTile.type,
            lastSeenTurn: world.turn,
            feature: { type: "door", name: doorFeature.name },
          });
        }
      }

      return {
        success: true,
        message: `Unlocked ${doorFeature.name}`,
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

  // Handle items on tile
  for (const item of tile.items) {
    possibleActions.push({
      type: "pick_up",
      targetItemName: item.name,
    });
  }

  // Handle chest feature
  if (tile.feature?.type === "chest") {
    possibleActions.push({
      type: "search_container",
      targetFeatureId: tile.feature.id,
    });
    if (tile.feature.searched && tile.feature.contents) {
      for (const content of tile.feature.contents) {
        possibleActions.push({
          type: "pick_up",
          targetItemName: content.name,
        });
      }
    }
  }

  // Handle door feature
  if (tile.feature?.type === "door" && tile.feature.locked) {
    possibleActions.push({
      type: "unlock",
      targetFeatureId: tile.feature.id,
    });
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
    if (isAdjacent(character.position, other.position)) {
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
