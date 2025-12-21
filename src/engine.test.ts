import { describe, it, expect } from "vitest";
import {
  findPath,
  executeAction,
  createId,
  lineOfSight,
  getVisibleTiles,
  getCharacterKnowledge,
} from "./engine";
import type { World, Character, Tile, Item } from "./types";

function createTestWorld(width: number, height: number): World {
  const tiles: Tile[][] = [];
  for (let y = 0; y < height; y++) {
    const row: Tile[] = [];
    for (let x = 0; x < width; x++) {
      row.push({ type: "ground", items: [] });
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
    activeContracts: [],
    events: [],
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
    gender: "male",
    position: { x, y },
    hp: 10,
    maxHp: 10,
    inventory: [],
    movementRange: 5,
    viewDistance: 10,
    personalityPrompt: "",
    alive: true,
    mapMemory: new Map(),
    effects: [],
    aiModel: "gpt-5.2",
    reasoningEffort: "medium",
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

      // Path should be null since we can't move onto an occupied tile
      expect(path).toBeNull();
    });

    it("should not find a path through another character", () => {
      const world = createTestWorld(10, 10);

      // Create a truly blocking corridor (walls at y=4 and y=6, including x=5)
      // This prevents diagonal movement around the blocker
      for (let x = 0; x < 10; x++) {
        world.tiles[4][x] = { type: "wall", items: [] };
        world.tiles[6][x] = { type: "wall", items: [] };
      }

      const blocker = createTestCharacter("Blocker", 5, 5);
      const mover = createTestCharacter("Mover", 3, 5);
      world.characters.push(blocker, mover);

      // Try to find path to the other side of the blocker
      const path = findPath(world, mover.position, { x: 7, y: 5 }, 10);

      // Should not find a path because blocker is in the way and walls prevent diagonal
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
      // Create walls that block diagonal movement around blocker
      for (let x = 0; x < 10; x++) {
        world.tiles[4][x] = { type: "wall", items: [] };
        world.tiles[6][x] = { type: "wall", items: [] };
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

    it("should prevent moving directly into a wall", () => {
      const world = createTestWorld(10, 10);

      // Place a wall at (5, 5)
      world.tiles[5][5] = { type: "wall", items: [] };

      const mover = createTestCharacter("Mover", 4, 5);
      world.characters.push(mover);

      const result = executeAction(world, mover, {
        type: "move",
        targetPosition: { x: 5, y: 5 }, // wall position
      });

      // Move should fail
      expect(result.success).toBe(false);
      // Mover should still be at original position
      expect(mover.position.x).toBe(4);
      expect(mover.position.y).toBe(5);
    });

    it("should prevent moving through walls", () => {
      const world = createTestWorld(10, 10);

      // Create a wall barrier
      for (let y = 0; y < 10; y++) {
        world.tiles[y][5] = { type: "wall", items: [] };
      }

      const mover = createTestCharacter("Mover", 3, 5);
      world.characters.push(mover);

      const result = executeAction(world, mover, {
        type: "move",
        targetPosition: { x: 7, y: 5 }, // other side of wall
      });

      // Move should fail because wall blocks path
      expect(result.success).toBe(false);
      // Mover should still be at original position
      expect(mover.position.x).toBe(3);
      expect(mover.position.y).toBe(5);
    });

    it("should not find a path into a wall tile", () => {
      const world = createTestWorld(10, 10);

      // Place a wall at (5, 5)
      world.tiles[5][5] = { type: "wall", items: [] };

      const path = findPath(world, { x: 3, y: 5 }, { x: 5, y: 5 }, 10);

      // Should not find a path to a wall
      expect(path).toBeNull();
    });

    it("should find a path around walls", () => {
      const world = createTestWorld(10, 10);

      // Create a small wall with a gap - wall at (5,5), gap at (5,6)
      world.tiles[5][5] = { type: "wall", items: [] };

      // Mover at (4,5) wants to get to (6,5) - must go around via (5,6)
      const mover = createTestCharacter("Mover", 4, 5, { movementRange: 10 });
      world.characters.push(mover);

      const result = executeAction(world, mover, {
        type: "move",
        targetPosition: { x: 6, y: 5 },
      });

      // Should find a path around the wall (4,5) -> (4,6) -> (5,6) -> (6,6) -> (6,5)
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
      trapEffect: {
        id: createId(),
        name: "Trapped",
        duration: 5,
        preventsMovement: true,
        triggers: [
          {
            on: "turn_start" as const,
            actions: [{ type: "damage" as const, amount: 3 }],
          },
          {
            on: "on_attack" as const,
            actions: [
              {
                type: "modify_stat" as const,
                stat: "attack" as const,
                operation: "multiply" as const,
                value: 0.5,
              },
            ],
          },
        ],
      },
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
      expect(world.tiles[5][6].feature?.type).toBe("trap");
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

    it("should only add witnesses who can see the trap placement location", () => {
      const world = createTestWorld(10, 10);
      const trap = createTrapItem();

      const placer = createTestCharacter("Placer", 5, 5, {
        inventory: [trap],
        viewDistance: 10,
      });
      const witness = createTestCharacter("Witness", 7, 5, {
        viewDistance: 10,
      });
      const behindWall = createTestCharacter("BehindWall", 9, 5, {
        viewDistance: 10,
      });

      world.characters.push(placer, witness, behindWall);

      // Place a wall between witness and behindWall
      world.tiles[5][8].type = "wall";

      // Placer places trap at (6, 5)
      const result = executeAction(world, placer, {
        type: "place",
        targetItemId: trap.id,
        targetPosition: { x: 6, y: 5 },
      });

      expect(result.success).toBe(true);
      const trapFeature = world.tiles[5][6].feature;
      expect(trapFeature?.type).toBe("trap");

      if (trapFeature?.type === "trap") {
        // Placer and Witness should be in witnessIds (they can see position 6,5)
        expect(trapFeature.witnessIds).toContain(placer.id);
        expect(trapFeature.witnessIds).toContain(witness.id);

        // BehindWall should NOT be in witnessIds (wall blocks view)
        expect(trapFeature.witnessIds).not.toContain(behindWall.id);
      }
    });
  });

  describe("trap triggering", () => {
    function createTrapFeature(ownerId: string) {
      return {
        type: "trap" as const,
        id: createId(),
        name: "Bear Trap",
        ownerId,
        witnessIds: [ownerId],
        appliesEffect: {
          id: createId(),
          name: "Trapped",
          duration: 5,
          preventsMovement: true,
          triggers: [
            {
              on: "turn_start" as const,
              actions: [{ type: "damage" as const, amount: 3 }],
            },
            {
              on: "on_attack" as const,
              actions: [
                {
                  type: "modify_stat" as const,
                  stat: "attack" as const,
                  operation: "multiply" as const,
                  value: 0.5,
                },
              ],
            },
          ],
        },
        triggered: false,
      };
    }

    it("should trigger trap when stepping on it", () => {
      const world = createTestWorld(10, 10);
      const victim = createTestCharacter("Victim", 4, 5);
      world.characters.push(victim);

      // Place a trap feature at (5, 5)
      world.tiles[5][5].feature = createTrapFeature("someone-else");

      // Move directly to the trap tile
      const result = executeAction(world, victim, {
        type: "move",
        targetPosition: { x: 5, y: 5 }, // move onto the trap
      });

      expect(result.success).toBe(true);
      // Victim should be stopped at the trap
      expect(victim.position.x).toBe(5);
      expect(victim.position.y).toBe(5);
      // Victim should have the "Trapped" effect
      const trappedEffect = victim.effects.find((e) => e.name === "Trapped");
      expect(trappedEffect).toBeDefined();
      expect(trappedEffect?.duration).toBe(5);
      // Trap should be removed
      expect(world.tiles[5][5].feature).toBeUndefined();
    });

    it("should trigger own trap if owner steps on it", () => {
      const world = createTestWorld(10, 10);
      const owner = createTestCharacter("Owner", 4, 5);
      world.characters.push(owner);

      // Place owner's own trap feature at (5, 5)
      world.tiles[5][5].feature = createTrapFeature(owner.id);

      // Move directly to the trap tile
      const result = executeAction(world, owner, {
        type: "move",
        targetPosition: { x: 5, y: 5 }, // move onto own trap
      });

      expect(result.success).toBe(true);
      // Owner should be stopped at their own trap
      expect(owner.position.x).toBe(5);
      expect(owner.position.y).toBe(5);
      // Owner should have the "Trapped" effect
      const trappedEffect = owner.effects.find((e) => e.name === "Trapped");
      expect(trappedEffect).toBeDefined();
      // Trap should be removed
      expect(world.tiles[5][5].feature).toBeUndefined();
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

  it("shadowcasting provides consistent visibility through gaps", () => {
    const world = createTestWorld(20, 15);

    // Lower internal wall at x=6 from y=9 to y=12 (gap at y=6-8)
    for (let y = 9; y <= 12; y++) {
      world.tiles[y][6].type = "wall";
    }

    const from = { x: 3, y: 3 };

    // With shadowcasting, both tiles should be consistently visible through the gap
    // (unlike Bresenham which had odd near/far visibility differences)
    expect(lineOfSight(world, from, { x: 7, y: 10 })).toBe(true);
    expect(lineOfSight(world, from, { x: 8, y: 11 })).toBe(true);

    // But tiles directly behind the wall section should be blocked
    expect(lineOfSight(world, from, { x: 7, y: 11 })).toBe(false);
  });
});

describe("Talk through bars", () => {
  it("should be able to talk through bars", () => {
    const world = createTestWorld(15, 10);

    // Create a cage with bars at x=5
    for (let y = 3; y <= 7; y++) {
      world.tiles[y][5] = { type: "bars", items: [] };
    }

    // Character inside cage at (3, 5)
    const insider = createTestCharacter("Insider", 3, 5);
    // Character outside cage at (7, 5) - distance is 4 tiles
    const outsider = createTestCharacter("Outsider", 7, 5);
    world.characters.push(insider, outsider);

    // Try to talk from insider to outsider (through the bars)
    const result = executeAction(world, insider, {
      type: "talk",
      targetCharacterId: outsider.id,
      message: "Hello through the bars!",
    });

    expect(result.success).toBe(true);
  });

  it("should be able to talk through bars at MAX_TALK_DISTANCE", () => {
    const world = createTestWorld(20, 10);

    // Create bars at x=5
    for (let y = 3; y <= 7; y++) {
      world.tiles[y][5] = { type: "bars", items: [] };
    }

    // Character inside at (3, 5)
    const insider = createTestCharacter("Insider", 3, 5);
    // Character outside at (9, 5) - distance is 6 tiles (MAX_TALK_DISTANCE)
    const outsider = createTestCharacter("Outsider", 9, 5);
    world.characters.push(insider, outsider);

    const result = executeAction(world, insider, {
      type: "talk",
      targetCharacterId: outsider.id,
      message: "Can you hear me?",
    });

    expect(result.success).toBe(true);
  });

  it("should NOT be able to talk beyond MAX_TALK_DISTANCE", () => {
    const world = createTestWorld(30, 10);

    // Character at (0, 5)
    const char1 = createTestCharacter("Char1", 0, 5);
    // Character at (20, 5) - distance is 20 tiles (beyond MAX_TALK_DISTANCE of 15)
    const char2 = createTestCharacter("Char2", 20, 5);
    world.characters.push(char1, char2);

    const result = executeAction(world, char1, {
      type: "talk",
      targetCharacterId: char2.id,
      message: "Too far!",
    });

    expect(result.success).toBe(false);
    expect(result.message).toContain("too far");
  });
});

describe("Pickup Action", () => {
  it("should pick up an item on the current tile", () => {
    const world = createTestWorld(10, 10);
    const character = createTestCharacter("Picker", 5, 5);
    world.characters.push(character);

    const item = {
      id: createId(),
      name: "Test Sword",
      type: "weapon" as const,
      damage: 5,
    };
    world.tiles[5][5].items.push(item);

    const result = executeAction(world, character, {
      type: "pick_up",
      targetItemName: "Test Sword",
    });

    expect(result.success).toBe(true);
    expect(result.message).toContain("Picked up Test Sword");
    expect(character.inventory).toContain(item);
    expect(world.tiles[5][5].items).not.toContain(item);
  });

  it("should pick up an item from an adjacent tile", () => {
    const world = createTestWorld(10, 10);
    const character = createTestCharacter("Picker", 5, 5);
    world.characters.push(character);

    const item = {
      id: createId(),
      name: "Adjacent Key",
      type: "key" as const,
    };
    world.tiles[5][6].items.push(item); // Adjacent tile (x+1)

    const result = executeAction(world, character, {
      type: "pick_up",
      targetItemName: "Adjacent Key",
    });

    expect(result.success).toBe(true);
    expect(result.message).toContain("Picked up Adjacent Key");
    expect(character.inventory).toContain(item);
    expect(world.tiles[5][6].items).not.toContain(item);
  });

  it("should pick up an item from a searched container", () => {
    const world = createTestWorld(10, 10);
    const character = createTestCharacter("Picker", 5, 5);
    world.characters.push(character);

    const itemInContainer = {
      id: createId(),
      name: "Hidden Dagger",
      type: "weapon" as const,
      damage: 3,
    };
    // Create a chest feature with the item inside
    world.tiles[5][5].feature = {
      type: "chest",
      id: createId(),
      name: "Chest",
      searched: true,
      contents: [itemInContainer],
    };

    const result = executeAction(world, character, {
      type: "pick_up",
      targetItemName: "Hidden Dagger",
    });

    expect(result.success).toBe(true);
    expect(result.message).toContain("Picked up Hidden Dagger");
    expect(character.inventory).toContain(itemInContainer);
    expect(
      (world.tiles[5][5].feature as { contents: unknown[] }).contents
    ).not.toContain(itemInContainer);
  });

  it("should NOT pick up an item from an unsearched chest", () => {
    const world = createTestWorld(10, 10);
    const character = createTestCharacter("Picker", 5, 5);
    world.characters.push(character);

    const itemInContainer = {
      id: createId(),
      name: "Hidden Dagger",
      type: "weapon" as const,
      damage: 3,
    };
    // Create a chest feature that is NOT searched
    world.tiles[5][5].feature = {
      type: "chest",
      id: createId(),
      name: "Chest",
      searched: false, // Not searched!
      contents: [itemInContainer],
    };

    const result = executeAction(world, character, {
      type: "pick_up",
      targetItemName: "Hidden Dagger",
    });

    expect(result.success).toBe(false);
    expect(result.message).toContain("not found");
    expect(character.inventory).not.toContain(itemInContainer);
  });

  it("should NOT pick up an item that is too far away", () => {
    const world = createTestWorld(10, 10);
    const character = createTestCharacter("Picker", 5, 5);
    world.characters.push(character);

    const item = {
      id: createId(),
      name: "Distant Item",
      type: "weapon" as const,
      damage: 5,
    };
    world.tiles[5][8].items.push(item); // 3 tiles away (not adjacent)

    const result = executeAction(world, character, {
      type: "pick_up",
      targetItemName: "Distant Item",
    });

    expect(result.success).toBe(false);
    expect(result.message).toContain("not found");
    expect(character.inventory).toHaveLength(0);
    expect(world.tiles[5][8].items).toContain(item);
  });

  it("should NOT pick up an item that does not exist", () => {
    const world = createTestWorld(10, 10);
    const character = createTestCharacter("Picker", 5, 5);
    world.characters.push(character);

    const result = executeAction(world, character, {
      type: "pick_up",
      targetItemName: "nonexistent-item",
    });

    expect(result.success).toBe(false);
    expect(result.message).toContain("not found");
    expect(character.inventory).toHaveLength(0);
  });

  it("should pick up from all four adjacent directions", () => {
    const world = createTestWorld(10, 10);
    const character = createTestCharacter("Picker", 5, 5);
    world.characters.push(character);

    const directions = [
      { x: 4, y: 5, name: "Left Sword" },
      { x: 6, y: 5, name: "Right Sword" },
      { x: 5, y: 4, name: "Up Sword" },
      { x: 5, y: 6, name: "Down Sword" },
    ];

    for (const dir of directions) {
      const item = {
        id: createId(),
        name: dir.name,
        type: "weapon" as const,
        damage: 1,
      };
      world.tiles[dir.y][dir.x].items.push(item);

      const result = executeAction(world, character, {
        type: "pick_up",
        targetItemName: dir.name,
      });

      expect(result.success).toBe(true);
      expect(character.inventory).toContain(item);
    }

    expect(character.inventory).toHaveLength(4);
  });

  it("should require exact name match (case-insensitive)", () => {
    const world = createTestWorld(10, 10);
    const character = createTestCharacter("Picker", 5, 5);
    world.characters.push(character);

    const item = {
      id: createId(),
      name: "Legendary Sword",
      type: "weapon" as const,
      damage: 10,
    };
    world.tiles[5][5].items.push(item);

    // Partial match should fail
    const partialResult = executeAction(world, character, {
      type: "pick_up",
      targetItemName: "sword",
    });
    expect(partialResult.success).toBe(false);

    // Exact match (different case) should succeed
    const exactResult = executeAction(world, character, {
      type: "pick_up",
      targetItemName: "legendary sword",
    });
    expect(exactResult.success).toBe(true);
    expect(exactResult.message).toContain("Picked up Legendary Sword");
    expect(character.inventory).toContain(item);
  });
});

describe("Corner Wall Visibility", () => {
  it("should mark top-left corner wall as explored when two adjacent walls are visible", () => {
    const world = createTestWorld(5, 5);
    // Create an L-shaped room with walls on top and left
    // . . . . .
    // . # # # .
    // . # . . .
    // . # . . .
    // . . . . .
    world.tiles[1][1].type = "wall";
    world.tiles[1][2].type = "wall";
    world.tiles[1][3].type = "wall";
    world.tiles[2][1].type = "wall";
    world.tiles[3][1].type = "wall";

    const character = createTestCharacter("Test", 2, 2);
    character.viewDistance = 10;

    // Mark the two adjacent walls (top and left) as visible/remembered
    character.mapMemory.set("1,2", { type: "wall", lastSeenTurn: 0 });
    character.mapMemory.set("2,1", { type: "wall", lastSeenTurn: 0 });

    // The corner wall at (1,1) should be marked as explored
    const visible = getVisibleTiles(world, character);
    const visiblePositions = new Set<string>();
    for (const tile of visible.tiles) {
      visiblePositions.add(`${tile.position.x},${tile.position.y}`);
    }

    // Import the function (it's not exported, so we'll test via look_around)
    const result = executeAction(world, character, { type: "look_around" });
    expect(result.success).toBe(true);

    // The corner wall (1,1) should now be in memory
    expect(character.mapMemory.has("1,1")).toBe(true);
    const cornerMemory = character.mapMemory.get("1,1");
    expect(cornerMemory?.type).toBe("wall");
  });

  it("should mark top-right corner wall as explored when two adjacent walls are visible", () => {
    const world = createTestWorld(5, 5);
    // Create an L-shaped room with walls on top and right
    // Game coordinates: (x, y) = world.tiles[y][x]
    // . . . . .
    // . # # # .  <- row 1: walls at (1,1), (2,1), (3,1)
    // . . . # .  <- row 2: wall at (3,2)
    // . . . # .  <- row 3: wall at (3,3)
    // . . . . .
    // Corner wall at game position (1,3) = world.tiles[3][1]
    // Adjacent walls: (1,2) = world.tiles[2][1], (2,3) = world.tiles[3][2]
    world.tiles[1][1].type = "wall"; // (1,1)
    world.tiles[1][2].type = "wall"; // (2,1)
    world.tiles[1][3].type = "wall"; // (3,1)
    world.tiles[3][2].type = "wall"; // (2,3) - adjacent wall
    world.tiles[3][3].type = "wall"; // (3,3)
    world.tiles[3][1].type = "wall"; // Corner wall at (1,3)
    world.tiles[2][1].type = "wall"; // Adjacent wall at (1,2)

    const character = createTestCharacter("Test", 2, 2);
    // Use larger view distance so adjacent walls are visible
    // This ensures they're in visiblePositions when markCornerWallsAsVisible runs
    character.viewDistance = 10;

    // Mark the two adjacent walls (top at (1,2) and right at (2,3)) as visible/remembered
    // These will be seen as visible when look_around runs, ensuring they stay as walls
    character.mapMemory.set("1,2", { type: "wall", lastSeenTurn: 0 });
    character.mapMemory.set("2,3", { type: "wall", lastSeenTurn: 0 });

    // Verify the corner wall is not yet in memory
    expect(character.mapMemory.has("1,3")).toBe(false);

    const result = executeAction(world, character, { type: "look_around" });
    expect(result.success).toBe(true);

    // Verify adjacent walls are still in memory as walls
    expect(character.mapMemory.get("1,2")?.type).toBe("wall");
    expect(character.mapMemory.get("2,3")?.type).toBe("wall");

    // The corner wall at (1,3) should now be in memory as a wall
    expect(character.mapMemory.has("1,3")).toBe(true);
    const cornerMemory = character.mapMemory.get("1,3");
    expect(cornerMemory?.type).toBe("wall");
  });

  it("should mark bottom-left corner wall as explored when two adjacent walls are visible", () => {
    const world = createTestWorld(5, 5);
    // Create an L-shaped room with walls on bottom and left
    // Game coordinates: (x, y) = world.tiles[y][x]
    // . . . . .
    // . # . . .  <- row 1: wall at (1,1)
    // . # . . .  <- row 2: wall at (1,2)
    // . # # # .  <- row 3: walls at (1,3), (2,3), (3,3)
    // . . . . .
    // Corner wall at game position (3,1) = world.tiles[1][3]
    // Adjacent walls: (3,2) = world.tiles[2][3], (2,1) = world.tiles[1][2]
    world.tiles[1][1].type = "wall"; // (1,1)
    world.tiles[2][1].type = "wall"; // (1,2) - adjacent wall
    world.tiles[3][1].type = "wall"; // (1,3)
    world.tiles[3][2].type = "wall"; // (2,3) - adjacent wall
    world.tiles[3][3].type = "wall"; // (3,3)
    world.tiles[1][3].type = "wall"; // Corner wall at (3,1)

    const character = createTestCharacter("Test", 2, 2);
    // Use larger view distance so adjacent walls are visible
    // This ensures they're in visiblePositions when markCornerWallsAsVisible runs
    character.viewDistance = 10;

    // Mark the two adjacent walls (bottom at (3,2) and left at (2,1)) as visible/remembered
    // These will be seen as visible when look_around runs, ensuring they stay as walls
    character.mapMemory.set("3,2", { type: "wall", lastSeenTurn: 0 });
    character.mapMemory.set("2,1", { type: "wall", lastSeenTurn: 0 });

    const result = executeAction(world, character, { type: "look_around" });
    expect(result.success).toBe(true);

    // The corner wall at game position (3,1) = world.tiles[1][3] should now be in memory as a wall
    expect(character.mapMemory.has("3,1")).toBe(true);
    const cornerMemory = character.mapMemory.get("3,1");
    expect(cornerMemory?.type).toBe("wall");
  });

  it("should mark bottom-right corner wall as explored when two adjacent walls are visible", () => {
    const world = createTestWorld(5, 5);
    // Create an L-shaped room with walls on bottom and right
    // . . . . .
    // . . . # .
    // . . . # .
    // . # # # .
    // . . . . .
    world.tiles[1][3].type = "wall";
    world.tiles[2][3].type = "wall";
    world.tiles[3][1].type = "wall";
    world.tiles[3][2].type = "wall";
    world.tiles[3][3].type = "wall";

    const character = createTestCharacter("Test", 2, 2);
    character.viewDistance = 10;

    // Mark the two adjacent walls (bottom and right) as visible/remembered
    character.mapMemory.set("3,2", { type: "wall", lastSeenTurn: 0 });
    character.mapMemory.set("2,3", { type: "wall", lastSeenTurn: 0 });

    const result = executeAction(world, character, { type: "look_around" });
    expect(result.success).toBe(true);

    // The corner wall at (3,3) should now be in memory
    expect(character.mapMemory.has("3,3")).toBe(true);
    const cornerMemory = character.mapMemory.get("3,3");
    expect(cornerMemory?.type).toBe("wall");
  });

  it("should NOT mark corner wall when adjacent walls are only in memory (not currently visible)", () => {
    const world = createTestWorld(5, 5);
    // Create corner walls
    world.tiles[1][1].type = "wall";
    world.tiles[1][2].type = "wall";
    world.tiles[2][1].type = "wall";

    const character = createTestCharacter("Test", 3, 3); // Far from the corner
    character.viewDistance = 1; // Short view distance so walls aren't currently visible

    // Mark the two adjacent walls as remembered (but not currently visible)
    character.mapMemory.set("1,2", { type: "wall", lastSeenTurn: 0 });
    character.mapMemory.set("2,1", { type: "wall", lastSeenTurn: 0 });

    const result = executeAction(world, character, { type: "look_around" });
    expect(result.success).toBe(true);

    // The corner wall at (1,1) should NOT be marked because adjacent walls aren't currently visible
    // Corner wall detection only works with currently visible walls, not remembered ones
    expect(character.mapMemory.has("1,1")).toBe(false);
  });
});

describe("Legal Actions - Chest Contents", () => {
  it("should include PICKUP actions for items in searched chests", async () => {
    const { generateLegalActionsJson } = await import("./agent");

    const world = createTestWorld(5, 5);
    const character = createTestCharacter("Picker", 2, 2);
    character.viewDistance = 10;
    world.characters.push(character);

    // Add a searched chest with a health potion at adjacent position
    const healthPotion: Item = {
      id: "potion-1",
      name: "Health Potion",
      type: "consumable",
      useEffect: { type: "heal", amount: 10 },
    };

    world.tiles[2][3].feature = {
      type: "chest",
      id: "chest-1",
      name: "Supply Crate",
      searched: true,
      contents: [healthPotion],
    };

    // Get knowledge using the same function parseJsonAction uses
    const knowledge = getCharacterKnowledge(world, character);

    const actionsJson = generateLegalActionsJson(
      world,
      character,
      knowledge,
      false
    );
    const actions = JSON.parse(actionsJson);

    // Should have a PICKUP action for the Health Potion
    const pickupActions = actions.filter(
      (a: { action: string; target?: string }) =>
        a.action === "PICKUP" && a.target === "Health Potion"
    );

    expect(pickupActions.length).toBe(1);
  });

  it("should NOT include PICKUP actions for items in unsearched chests", async () => {
    const { generateLegalActionsJson } = await import("./agent");

    const world = createTestWorld(5, 5);
    const character = createTestCharacter("Picker", 2, 2);
    character.viewDistance = 10;
    world.characters.push(character);

    // Add an unsearched chest with a health potion at adjacent position
    const healthPotion: Item = {
      id: "potion-1",
      name: "Health Potion",
      type: "consumable",
      useEffect: { type: "heal", amount: 10 },
    };

    world.tiles[2][3].feature = {
      type: "chest",
      id: "chest-1",
      name: "Supply Crate",
      searched: false,
      contents: [healthPotion],
    };

    // Get knowledge using the same function parseJsonAction uses
    const knowledge = getCharacterKnowledge(world, character);

    const actionsJson = generateLegalActionsJson(
      world,
      character,
      knowledge,
      false
    );
    const actions = JSON.parse(actionsJson);

    // Should NOT have a PICKUP action for the Health Potion (chest not searched)
    const pickupActions = actions.filter(
      (a: { action: string; target?: string }) =>
        a.action === "PICKUP" && a.target === "Health Potion"
    );

    expect(pickupActions.length).toBe(0);

    // Should have a SEARCH action for the chest
    const searchActions = actions.filter(
      (a: { action: string; target?: string }) =>
        a.action === "SEARCH" && a.target === "Supply Crate"
    );

    expect(searchActions.length).toBe(1);
  });
});

describe("Unexplored Frontier Tiles", () => {
  it("should return adjacent unexplored walkable tiles", async () => {
    const { getUnexploredFrontierTiles } = await import("./agent");

    const world = createTestWorld(5, 5);
    const character = createTestCharacter("Explorer", 2, 2);
    world.characters.push(character);

    // Initialize character's map memory with just their current position
    character.mapMemory = new Map();
    character.mapMemory.set("2,2", { type: "ground", lastSeenTurn: 0 });

    const frontier = getUnexploredFrontierTiles(world, character);

    // Should include all 8 adjacent tiles (all are ground and unexplored)
    expect(frontier.length).toBe(8);

    // All frontier tiles should be adjacent to (2,2)
    for (const tile of frontier) {
      const dx = Math.abs(tile.x - 2);
      const dy = Math.abs(tile.y - 2);
      expect(dx <= 1 && dy <= 1).toBe(true);
      expect(dx === 0 && dy === 0).toBe(false); // Not the center tile
    }
  });

  it("should NOT include wall tiles in frontier", async () => {
    const { getUnexploredFrontierTiles } = await import("./agent");

    const world = createTestWorld(5, 5);
    const character = createTestCharacter("Explorer", 2, 2);
    world.characters.push(character);

    // Make tile (3, 2) a wall
    world.tiles[2][3].type = "wall";

    // Initialize character's map memory with just their current position
    character.mapMemory = new Map();
    character.mapMemory.set("2,2", { type: "ground", lastSeenTurn: 0 });

    const frontier = getUnexploredFrontierTiles(world, character);

    // Should NOT include the wall tile
    const hasWallTile = frontier.some((t) => t.x === 3 && t.y === 2);
    expect(hasWallTile).toBe(false);

    // Should have 7 tiles (8 - 1 wall)
    expect(frontier.length).toBe(7);
  });

  it("should NOT include tiles adjacent to walls in memory", async () => {
    const { getUnexploredFrontierTiles } = await import("./agent");

    const world = createTestWorld(5, 5);
    const character = createTestCharacter("Explorer", 2, 2);
    world.characters.push(character);

    // Initialize character's map memory with current position AND a wall
    character.mapMemory = new Map();
    character.mapMemory.set("2,2", { type: "ground", lastSeenTurn: 0 });
    character.mapMemory.set("3,2", { type: "wall", lastSeenTurn: 0 }); // Wall to the east

    const frontier = getUnexploredFrontierTiles(world, character);

    // Should NOT expand from the wall tile, so tiles only adjacent to the wall
    // should not be included UNLESS they're also adjacent to (2,2)
    // The wall at (3,2) would have (4,2) adjacent to it, but (4,2) is not adjacent to (2,2)
    const hasTile4_2 = frontier.some((t) => t.x === 4 && t.y === 2);
    expect(hasTile4_2).toBe(false);
  });

  it("should NOT include already explored tiles", async () => {
    const { getUnexploredFrontierTiles } = await import("./agent");

    const world = createTestWorld(5, 5);
    const character = createTestCharacter("Explorer", 2, 2);
    world.characters.push(character);

    // Initialize character's map memory with a 3x3 explored area
    character.mapMemory = new Map();
    for (let y = 1; y <= 3; y++) {
      for (let x = 1; x <= 3; x++) {
        character.mapMemory.set(`${x},${y}`, {
          type: "ground",
          lastSeenTurn: 0,
        });
      }
    }

    const frontier = getUnexploredFrontierTiles(world, character);

    // Should not include any tiles that are already in mapMemory
    for (const tile of frontier) {
      const key = `${tile.x},${tile.y}`;
      expect(character.mapMemory.has(key)).toBe(false);
    }

    // Frontier should be the ring around the 3x3 area
    // That's tiles at x=0 or x=4, y in [1,3], and y=0 or y=4, x in [1,3]
    // Plus corners (0,0), (4,0), (0,4), (4,4)
    // Total: 16 tiles around a 3x3 center, but we're in 5x5 world
    // Actually: x=0,y=0-4 (5) + x=4,y=0-4 (5) + y=0,x=1-3 (3) + y=4,x=1-3 (3) = 16
    expect(frontier.length).toBe(16);
  });

  it("should include frontier tiles regardless of distance from character", async () => {
    const { getUnexploredFrontierTiles } = await import("./agent");

    const world = createTestWorld(30, 30);
    const character = createTestCharacter("Explorer", 15, 15);
    world.characters.push(character);

    // Initialize character's map memory with position far from current
    character.mapMemory = new Map();
    character.mapMemory.set("15,15", { type: "ground", lastSeenTurn: 0 }); // Current position
    character.mapMemory.set("1,1", { type: "ground", lastSeenTurn: 0 }); // Far away explored tile

    const frontier = getUnexploredFrontierTiles(world, character);

    // Tiles adjacent to (1,1) SHOULD be in frontier even though far away
    const hasTileNear1_1 = frontier.some(
      (t) => Math.abs(t.x - 1) <= 1 && Math.abs(t.y - 1) <= 1
    );
    expect(hasTileNear1_1).toBe(true);

    // Tiles adjacent to (15,15) should also be in frontier
    const hasTileNear15_15 = frontier.some(
      (t) => Math.abs(t.x - 15) <= 1 && Math.abs(t.y - 15) <= 1
    );
    expect(hasTileNear15_15).toBe(true);
  });

  it("should be sorted by distance from character (closest first)", async () => {
    const { getUnexploredFrontierTiles } = await import("./agent");

    const world = createTestWorld(10, 10);
    const character = createTestCharacter("Explorer", 5, 5);
    world.characters.push(character);

    // Explore a path going east
    character.mapMemory = new Map();
    character.mapMemory.set("5,5", { type: "ground", lastSeenTurn: 0 });
    character.mapMemory.set("6,5", { type: "ground", lastSeenTurn: 0 });
    character.mapMemory.set("7,5", { type: "ground", lastSeenTurn: 0 });

    const frontier = getUnexploredFrontierTiles(world, character);

    // Verify sorted by distance
    for (let i = 1; i < frontier.length; i++) {
      const prevDist = Math.max(
        Math.abs(frontier[i - 1].x - 5),
        Math.abs(frontier[i - 1].y - 5)
      );
      const currDist = Math.max(
        Math.abs(frontier[i].x - 5),
        Math.abs(frontier[i].y - 5)
      );
      expect(currDist).toBeGreaterThanOrEqual(prevDist);
    }
  });
});
