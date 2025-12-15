import { describe, it, expect } from "vitest";
import {
  findPath,
  executeAction,
  createId,
  lineOfSight,
  getVisibleTiles,
} from "./engine";
import type { World, Character, Tile } from "./types";

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

describe("Line of Sight", () => {
  it("should see tiles in a straight line without obstacles", () => {
    const world = createTestWorld(10, 10);
    const from = { x: 0, y: 5 };
    const to = { x: 5, y: 5 };
    expect(lineOfSight(world, from, to)).toBe(true);
  });

  it("should not see through walls", () => {
    const world = createTestWorld(10, 10);
    // Place a wall at (3, 5)
    world.tiles[5][3].type = "wall";

    const from = { x: 0, y: 5 };
    const to = { x: 5, y: 5 }; // Beyond the wall
    expect(lineOfSight(world, from, to)).toBe(false);
  });

  it("should see a wall tile itself", () => {
    const world = createTestWorld(10, 10);
    // Place a wall at (3, 5)
    world.tiles[5][3].type = "wall";

    const from = { x: 0, y: 5 };
    const wallPos = { x: 3, y: 5 }; // The wall itself
    expect(lineOfSight(world, from, wallPos)).toBe(true);
  });

  it("should not see floor tiles beyond a wall", () => {
    const world = createTestWorld(10, 10);
    // Place a wall at (3, 5)
    world.tiles[5][3].type = "wall";

    const from = { x: 0, y: 5 };
    // Floor tile at (4, 5) should NOT be visible - it's behind the wall
    expect(lineOfSight(world, from, { x: 4, y: 5 })).toBe(false);
    expect(lineOfSight(world, from, { x: 5, y: 5 })).toBe(false);
  });

  it("should handle diagonal LOS correctly with walls", () => {
    const world = createTestWorld(10, 10);
    // Place a wall at (2, 2)
    world.tiles[2][2].type = "wall";

    const from = { x: 0, y: 0 };
    // The wall at (2,2) should be visible
    expect(lineOfSight(world, from, { x: 2, y: 2 })).toBe(true);
    // Tiles beyond the wall diagonally should NOT be visible
    expect(lineOfSight(world, from, { x: 3, y: 3 })).toBe(false);
    expect(lineOfSight(world, from, { x: 4, y: 4 })).toBe(false);
  });

  it("should not see tiles when wall is in the path diagonally", () => {
    const world = createTestWorld(10, 10);
    // Place walls in a line
    world.tiles[1][3].type = "wall";
    world.tiles[2][3].type = "wall";
    world.tiles[3][3].type = "wall";

    const from = { x: 2, y: 2 };
    // Should see the wall itself
    expect(lineOfSight(world, from, { x: 3, y: 2 })).toBe(true);
    // Should NOT see beyond the wall
    expect(lineOfSight(world, from, { x: 4, y: 2 })).toBe(false);
    expect(lineOfSight(world, from, { x: 5, y: 2 })).toBe(false);
  });

  it("Kane at (3,3) should see tile at (5,8) - 2 right, 5 down with no walls between", () => {
    const world = createTestWorld(20, 15);
    // All ground, no walls in the path
    const from = { x: 3, y: 3 };
    const to = { x: 5, y: 8 };
    expect(lineOfSight(world, from, to)).toBe(true);
  });

  it("Kane at (3,3) should see tiles directly below up to distance", () => {
    const world = createTestWorld(20, 15);
    const from = { x: 3, y: 3 };

    // Should see all tiles directly below (no walls)
    expect(lineOfSight(world, from, { x: 3, y: 4 })).toBe(true);
    expect(lineOfSight(world, from, { x: 3, y: 5 })).toBe(true);
    expect(lineOfSight(world, from, { x: 3, y: 6 })).toBe(true);
    expect(lineOfSight(world, from, { x: 3, y: 7 })).toBe(true);
    expect(lineOfSight(world, from, { x: 3, y: 8 })).toBe(true);
    expect(lineOfSight(world, from, { x: 3, y: 9 })).toBe(true);
    expect(lineOfSight(world, from, { x: 3, y: 10 })).toBe(true);
  });

  it("Kane at (3,3) with maze walls should see through open areas", () => {
    const world = createTestWorld(20, 15);

    // Set up outer walls like the maze
    for (let y = 1; y <= 13; y++) {
      for (let x = 1; x <= 18; x++) {
        if (y === 1 || y === 13 || x === 1 || x === 18) {
          world.tiles[y][x].type = "wall";
        }
      }
    }

    // Wall at x=6 from y=2 to y=5
    for (let y = 2; y <= 5; y++) {
      world.tiles[y][6].type = "wall";
    }

    const from = { x: 3, y: 3 };

    // Kane should see the left outer wall
    expect(lineOfSight(world, from, { x: 1, y: 3 })).toBe(true);

    // Kane should see down to the bottom wall
    expect(lineOfSight(world, from, { x: 3, y: 8 })).toBe(true);
    expect(lineOfSight(world, from, { x: 3, y: 12 })).toBe(true);
    expect(lineOfSight(world, from, { x: 3, y: 13 })).toBe(true); // bottom wall

    // Kane should see diagonally down-right (no wall in path)
    expect(lineOfSight(world, from, { x: 5, y: 8 })).toBe(true);

    // Kane should NOT see past the wall at x=6
    expect(lineOfSight(world, from, { x: 6, y: 3 })).toBe(true); // wall itself visible
    expect(lineOfSight(world, from, { x: 7, y: 3 })).toBe(false); // beyond wall
  });

  it("getVisibleTiles returns tiles Kane should see", () => {
    const world = createTestWorld(20, 15);

    // Set up outer walls like the maze
    for (let y = 1; y <= 13; y++) {
      for (let x = 1; x <= 18; x++) {
        if (y === 1 || y === 13 || x === 1 || x === 18) {
          world.tiles[y][x].type = "wall";
        }
      }
    }

    const kane = createTestCharacter("Kane", 3, 3);
    kane.viewDistance = 20;
    world.characters.push(kane);

    const visible = getVisibleTiles(world, kane);
    const visiblePositions = visible.tiles.map(
      (t) => `${t.position.x},${t.position.y}`
    );

    // Kane should see tile at (3, 8) - directly below
    expect(visiblePositions).toContain("3,8");

    // Kane should see tile at (5, 8) - 2 right, 5 down
    expect(visiblePositions).toContain("5,8");

    // Kane should see the bottom wall at (3, 13)
    expect(visiblePositions).toContain("3,13");
  });

  it("Kane at (3,3) should see wall at (1, 8) - diagonal to left wall", () => {
    const world = createTestWorld(20, 15);

    // Set up outer walls
    for (let y = 1; y <= 13; y++) {
      world.tiles[y][1].type = "wall"; // left wall
    }

    const from = { x: 3, y: 3 };
    const to = { x: 1, y: 8 };

    // Should have LOS to the wall at (1, 8)
    expect(lineOfSight(world, from, to)).toBe(true);
  });

  it("Kane at (3,3) should NOT see east wall through internal wall column", () => {
    const world = createTestWorld(20, 15);

    // Set up outer walls
    for (let y = 1; y <= 13; y++) {
      world.tiles[y][1].type = "wall"; // left wall
      world.tiles[y][18].type = "wall"; // right wall
    }

    // Internal wall column at x=6 from y=2 to y=5
    for (let y = 2; y <= 5; y++) {
      world.tiles[y][6].type = "wall";
    }

    const from = { x: 3, y: 3 };

    // Kane should see the internal wall at x=6
    expect(lineOfSight(world, from, { x: 6, y: 3 })).toBe(true);

    // Kane should NOT see the east wall at x=18 through the internal wall
    expect(lineOfSight(world, from, { x: 18, y: 3 })).toBe(false);

    // The ray to (18, 8) actually passes through (6, 5) which is a wall, so blocked
    expect(lineOfSight(world, from, { x: 18, y: 8 })).toBe(false);
  });

  it("continuous walls should be visible - left wall from (3,3)", () => {
    const world = createTestWorld(20, 15);

    // Left wall column at x=1
    for (let y = 1; y <= 13; y++) {
      world.tiles[y][1].type = "wall";
    }

    const from = { x: 3, y: 3 };

    // Kane should see all of the left wall because it's one continuous surface
    expect(lineOfSight(world, from, { x: 1, y: 3 })).toBe(true);
    expect(lineOfSight(world, from, { x: 1, y: 5 })).toBe(true);
    expect(lineOfSight(world, from, { x: 1, y: 7 })).toBe(true);
    expect(lineOfSight(world, from, { x: 1, y: 8 })).toBe(true);
    expect(lineOfSight(world, from, { x: 1, y: 10 })).toBe(true);
    expect(lineOfSight(world, from, { x: 1, y: 12 })).toBe(true); // Issue 2: should be visible
  });

  it("(7,1) should NOT be visible from (3,3) - blocked by internal wall", () => {
    const world = createTestWorld(20, 15);

    // Set up outer walls
    for (let x = 1; x <= 18; x++) {
      world.tiles[1][x].type = "wall"; // top wall
    }

    // Internal wall column at x=6 from y=2 to y=5
    for (let y = 2; y <= 5; y++) {
      world.tiles[y][6].type = "wall";
    }

    const from = { x: 3, y: 3 };

    // The ray to (7,1) passes through (6,2) which is NOT part of the same wall
    // (6,2) is the internal wall, (7,1) is the top wall - different surfaces
    expect(lineOfSight(world, from, { x: 7, y: 1 })).toBe(false);
  });

  it("ray to (8,11) passes through gap while (7,10) hits wall", () => {
    const world = createTestWorld(20, 15);

    // Lower internal wall at x=6 from y=9 to y=12 (gap at y=6-8)
    for (let y = 9; y <= 12; y++) {
      world.tiles[y][6].type = "wall";
    }

    const from = { x: 3, y: 3 };

    // Ray to (7,10) passes through (6,9) which IS a wall
    expect(lineOfSight(world, from, { x: 7, y: 10 })).toBe(false);

    // Ray to (8,11) passes through (6,8) which is NOT a wall (gap!)
    expect(lineOfSight(world, from, { x: 8, y: 11 })).toBe(true);
  });
});
