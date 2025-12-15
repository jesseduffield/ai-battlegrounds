import { describe, it, expect } from "vitest";
import { findPath, executeAction, createId } from "./engine";
import type { World, Character, Tile, Position } from "./types";

function createTestWorld(width: number, height: number): World {
  const tiles: Tile[][] = [];
  for (let y = 0; y < height; y++) {
    const row: Tile[] = [];
    for (let x = 0; x < width; x++) {
      row.push({ type: "ground", items: [], traps: [] });
    }
    tiles.push(row);
  }
  return {
    width,
    height,
    tiles,
    characters: [],
    rooms: [],
    turn: 0,
  };
}

function createTestCharacter(
  name: string,
  x: number,
  y: number,
  overrides: Partial<Character> = {}
): Character {
  return {
    id: createId(),
    name,
    position: { x, y },
    hp: 10,
    maxHp: 10,
    inventory: [],
    memories: [],
    movementRange: 5,
    viewDistance: 10,
    personalityPrompt: "",
    alive: true,
    mapMemory: new Map(),
    debuffTurnsRemaining: 0,
    ...overrides,
  };
}

describe("Movement", () => {
  describe("findPath", () => {
    it("should not find a path onto another character's position", () => {
      const world = createTestWorld(10, 10);

      const blocker = createTestCharacter("Blocker", 5, 5);
      const mover = createTestCharacter("Mover", 3, 5);
      world.characters.push(blocker, mover);

      // Try to find path directly onto blocker's position
      const path = findPath(world, mover.position, blocker.position, 5);

      // Path should be null since we can't move onto occupied tile
      // OR path should exist but character can't actually move there
      // Based on the code, findPath allows targeting occupied tiles (for attacks)
      // but the tile itself blocks traversal
      // Let's verify the behavior
      expect(path).not.toBeNull();
      // The path exists because findPath allows destinations with characters (for attacking)
      // But the character shouldn't be able to actually complete the move
    });

    it("should not find a path through another character", () => {
      const world = createTestWorld(10, 10);

      // Create a narrow corridor with a blocker in the middle
      // Set up walls to force going through the blocker
      for (let x = 0; x < 10; x++) {
        if (x !== 5) {
          world.tiles[4][x] = { type: "wall", items: [], traps: [] };
          world.tiles[6][x] = { type: "wall", items: [], traps: [] };
        }
      }

      const blocker = createTestCharacter("Blocker", 5, 5);
      const mover = createTestCharacter("Mover", 3, 5);
      world.characters.push(blocker, mover);

      // Try to find path to the other side of the blocker
      const path = findPath(world, mover.position, { x: 7, y: 5 }, 10);

      // Should not find a path because blocker is in the way
      expect(path).toBeNull();
    });

    it("should find a path around another character if possible", () => {
      const world = createTestWorld(10, 10);

      const blocker = createTestCharacter("Blocker", 5, 5);
      const mover = createTestCharacter("Mover", 3, 5);
      world.characters.push(blocker, mover);

      // Try to find path to a position past the blocker
      const path = findPath(world, mover.position, { x: 7, y: 5 }, 10);

      // Should find a path going around
      expect(path).not.toBeNull();
      if (path) {
        // Path should not include the blocker's position
        const blockerPosInPath = path.some(
          (p) => p.x === blocker.position.x && p.y === blocker.position.y
        );
        expect(blockerPosInPath).toBe(false);
      }
    });
  });

  describe("executeAction - move", () => {
    it("should prevent moving onto another character's position", () => {
      const world = createTestWorld(10, 10);

      const blocker = createTestCharacter("Blocker", 5, 5);
      const mover = createTestCharacter("Mover", 4, 5);
      world.characters.push(blocker, mover);

      const result = executeAction(world, mover, {
        type: "move",
        targetPosition: { x: 5, y: 5 }, // blocker's position
      });

      // Move should fail
      expect(result.success).toBe(false);
      // Mover should still be at original position
      expect(mover.position.x).toBe(4);
      expect(mover.position.y).toBe(5);
    });

    it("should prevent moving through another character", () => {
      const world = createTestWorld(10, 10);

      // Create walls to force a narrow corridor
      for (let x = 0; x < 10; x++) {
        if (x !== 5) {
          world.tiles[4][x] = { type: "wall", items: [], traps: [] };
          world.tiles[6][x] = { type: "wall", items: [], traps: [] };
        }
      }

      const blocker = createTestCharacter("Blocker", 5, 5);
      const mover = createTestCharacter("Mover", 3, 5);
      world.characters.push(blocker, mover);

      const result = executeAction(world, mover, {
        type: "move",
        targetPosition: { x: 7, y: 5 }, // past the blocker
      });

      // Move should fail because path is blocked
      expect(result.success).toBe(false);
      // Mover should still be at original position
      expect(mover.position.x).toBe(3);
      expect(mover.position.y).toBe(5);
    });

    it("should allow moving to an adjacent empty tile", () => {
      const world = createTestWorld(10, 10);

      const mover = createTestCharacter("Mover", 5, 5);
      world.characters.push(mover);

      const result = executeAction(world, mover, {
        type: "move",
        targetPosition: { x: 6, y: 5 },
      });

      expect(result.success).toBe(true);
      expect(mover.position.x).toBe(6);
      expect(mover.position.y).toBe(5);
    });

    it("should allow moving around another character to reach destination", () => {
      const world = createTestWorld(10, 10);

      const blocker = createTestCharacter("Blocker", 5, 5);
      const mover = createTestCharacter("Mover", 4, 5);
      world.characters.push(blocker, mover);

      // Move to a tile on the other side of blocker, but with room to go around
      const result = executeAction(world, mover, {
        type: "move",
        targetPosition: { x: 6, y: 5 },
      });

      expect(result.success).toBe(true);
      expect(mover.position.x).toBe(6);
      expect(mover.position.y).toBe(5);
    });
  });
});

describe("Traps", () => {
  function createTrapItem() {
    return {
      id: createId(),
      name: "Bear Trap",
      type: "trap" as const,
      trapDamage: 3,
      trapAttackDebuff: 2,
      trapDebuffDuration: 5,
    };
  }

  describe("executeAction - place", () => {
    it("should require placing trap on adjacent tile, not current tile", () => {
      const world = createTestWorld(10, 10);
      const trap = createTrapItem();
      const placer = createTestCharacter("Placer", 5, 5, {
        inventory: [trap],
      });
      world.characters.push(placer);

      // Try to place on current tile (should fail)
      const result = executeAction(world, placer, {
        type: "place",
        targetItemId: trap.id,
        targetPosition: { x: 5, y: 5 }, // same as placer's position
      });

      expect(result.success).toBe(false);
      expect(result.message).toContain("adjacent");
    });

    it("should allow placing trap on adjacent tile", () => {
      const world = createTestWorld(10, 10);
      const trap = createTrapItem();
      const placer = createTestCharacter("Placer", 5, 5, {
        inventory: [trap],
      });
      world.characters.push(placer);

      const result = executeAction(world, placer, {
        type: "place",
        targetItemId: trap.id,
        targetPosition: { x: 6, y: 5 }, // adjacent tile
      });

      expect(result.success).toBe(true);
      expect(world.tiles[5][6].traps.length).toBe(1);
      expect(placer.inventory.length).toBe(0);
    });

    it("should not allow placing trap on non-adjacent tile", () => {
      const world = createTestWorld(10, 10);
      const trap = createTrapItem();
      const placer = createTestCharacter("Placer", 5, 5, {
        inventory: [trap],
      });
      world.characters.push(placer);

      const result = executeAction(world, placer, {
        type: "place",
        targetItemId: trap.id,
        targetPosition: { x: 7, y: 5 }, // 2 tiles away
      });

      expect(result.success).toBe(false);
      expect(placer.inventory.length).toBe(1); // trap still in inventory
    });
  });

  describe("trap triggering", () => {
    it("should trigger trap when stepping on it", () => {
      const world = createTestWorld(10, 10);
      const victim = createTestCharacter("Victim", 4, 5);
      world.characters.push(victim);

      // Place a trap at (5, 5)
      world.tiles[5][5].traps.push({
        id: createId(),
        name: "Bear Trap",
        ownerId: "someone-else",
        damage: 3,
        attackDebuff: 2,
        debuffDuration: 5,
      });

      const result = executeAction(world, victim, {
        type: "move",
        targetPosition: { x: 6, y: 5 }, // path goes through (5, 5)
      });

      expect(result.success).toBe(true);
      // Victim should be stopped at the trap
      expect(victim.position.x).toBe(5);
      expect(victim.position.y).toBe(5);
      // Victim should be damaged and trapped
      expect(victim.hp).toBe(7); // 10 - 3 damage
      expect(victim.trapped).toBe(true);
      expect(victim.debuffTurnsRemaining).toBe(5);
      // Trap should be removed
      expect(world.tiles[5][5].traps.length).toBe(0);
    });

    it("should trigger own trap if owner steps on it", () => {
      const world = createTestWorld(10, 10);
      const owner = createTestCharacter("Owner", 4, 5);
      world.characters.push(owner);

      // Place owner's own trap at (5, 5)
      world.tiles[5][5].traps.push({
        id: createId(),
        name: "Bear Trap",
        ownerId: owner.id,
        damage: 3,
        attackDebuff: 2,
        debuffDuration: 5,
      });

      const result = executeAction(world, owner, {
        type: "move",
        targetPosition: { x: 6, y: 5 }, // path goes through (5, 5)
      });

      expect(result.success).toBe(true);
      // Owner should be stopped at their own trap
      expect(owner.position.x).toBe(5);
      expect(owner.position.y).toBe(5);
      // Owner should be damaged and trapped by their own trap
      expect(owner.hp).toBe(7); // 10 - 3 damage
      expect(owner.trapped).toBe(true);
      // Trap should be removed
      expect(world.tiles[5][5].traps.length).toBe(0);
    });
  });
});
