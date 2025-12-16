import type { World, Character, Position, TileType, Item } from "./types";

export const TILE_SIZE = 32;

const COLORS = {
  ground: "#2a2522",
  groundPattern: "#242120",
  wall: "#4a4540",
  wallTop: "#5a5550",
  door: "#6a4a2a",
  doorFrame: "#4a3a1a",
  grass: "#1a3a1a",
  grassPattern: "#1a4a1a",
  grid: "rgba(255, 255, 255, 0.03)",
  characterDead: "#6a3030",
  characterOutline: "#000",
  item: "#4a8aaa",
  weapon: "#aa4a4a",
  container: "#7a5a3a",
  containerSearched: "#5a4a2a",
  highlight: "rgba(68, 136, 255, 0.3)",
  reachable: "rgba(100, 200, 100, 0.25)",
  attackRange: "rgba(255, 100, 100, 0.3)",
  visible: "rgba(255, 255, 200, 0.08)",
  notVisible: "rgba(0, 0, 0, 0.5)",
  trap: "#8B4513",
  trapTeeth: "#666",
};

const CHARACTER_COLORS: Record<string, { body: string; accent: string }> = {
  // Hunt map
  Kane: { body: "#e63946", accent: "#ff6b6b" },
  Razor: { body: "#4361ee", accent: "#7b8fff" },
  Alice: { body: "#e67e22", accent: "#f39c12" },
  Bob: { body: "#1abc9c", accent: "#3dd6b0" },
  Charlie: { body: "#e74c3c", accent: "#ff6b6b" },
  // Bloodsport map
  Rex: { body: "#e63946", accent: "#ff6b6b" },
  Luna: { body: "#9b59b6", accent: "#bb77d6" },
  Vex: { body: "#27ae60", accent: "#3dd6b0" },
  Nova: { body: "#3498db", accent: "#5dade2" },
};

const DEFAULT_CHARACTER_COLORS = [
  { body: "#e8c84a", accent: "#ffd700" },
  { body: "#9b59b6", accent: "#bb77d6" },
  { body: "#e67e22", accent: "#f39c12" },
  { body: "#1abc9c", accent: "#3dd6b0" },
  { body: "#e74c3c", accent: "#ff6b6b" },
];

function getCharacterColor(
  character: Character,
  index: number
): { body: string; accent: string } {
  if (CHARACTER_COLORS[character.name]) {
    return CHARACTER_COLORS[character.name];
  }
  return DEFAULT_CHARACTER_COLORS[index % DEFAULT_CHARACTER_COLORS.length];
}

export type FloatingText = {
  x: number;
  y: number;
  text: string;
  color: string;
  opacity: number;
  offsetY: number;
};

export type MovingCharacter = {
  characterId: string;
  fromX: number;
  fromY: number;
  toX: number;
  toY: number;
  progress: number;
};

let floatingTexts: FloatingText[] = [];
let movingCharacters: Map<string, MovingCharacter> = new Map();
let characterIndexMap: Map<string, number> = new Map();

// Thinking state (kept for potential future canvas-based thinking indicator)
export function setThinkingCharacter(_characterId: string | null): void {
  // Currently handled by HTML UI indicator
}

export function addFloatingText(
  x: number,
  y: number,
  text: string,
  color: string
): void {
  floatingTexts.push({
    x: x * TILE_SIZE + TILE_SIZE / 2,
    y: y * TILE_SIZE + TILE_SIZE / 2,
    text,
    color,
    opacity: 1,
    offsetY: 0,
  });
}

export function startMoveAnimation(
  characterId: string,
  path: Position[]
): Promise<void> {
  return new Promise((resolve) => {
    if (path.length === 0) {
      resolve();
      return;
    }

    let currentStep = 0;
    const animateStep = () => {
      if (currentStep >= path.length) {
        movingCharacters.delete(characterId);
        resolve();
        return;
      }

      const from = currentStep === 0 ? path[0] : path[currentStep - 1];
      const to = path[currentStep];

      movingCharacters.set(characterId, {
        characterId,
        fromX: currentStep === 0 ? from.x : path[currentStep - 1].x,
        fromY: currentStep === 0 ? from.y : path[currentStep - 1].y,
        toX: to.x,
        toY: to.y,
        progress: 0,
      });

      const stepDuration = 120;
      const startTime = performance.now();

      const animateProgress = () => {
        const elapsed = performance.now() - startTime;
        const progress = Math.min(elapsed / stepDuration, 1);

        const anim = movingCharacters.get(characterId);
        if (anim) {
          anim.progress = progress;
        }

        if (progress < 1) {
          requestAnimationFrame(animateProgress);
        } else {
          currentStep++;
          animateStep();
        }
      };

      requestAnimationFrame(animateProgress);
    };

    animateStep();
  });
}

export function updateAnimations(): boolean {
  let hasAnimations = false;

  floatingTexts = floatingTexts.filter((ft) => {
    ft.offsetY -= 1.5;
    ft.opacity -= 0.025;
    return ft.opacity > 0;
  });

  if (floatingTexts.length > 0) hasAnimations = true;
  if (movingCharacters.size > 0) hasAnimations = true;

  return hasAnimations;
}

export function isAnimating(): boolean {
  return floatingTexts.length > 0 || movingCharacters.size > 0;
}

function drawTile(
  ctx: CanvasRenderingContext2D,
  type: TileType,
  x: number,
  y: number
): void {
  const px = x * TILE_SIZE;
  const py = y * TILE_SIZE;

  switch (type) {
    case "ground":
      ctx.fillStyle = COLORS.ground;
      ctx.fillRect(px, py, TILE_SIZE, TILE_SIZE);
      ctx.fillStyle = COLORS.groundPattern;
      for (let i = 0; i < 3; i++) {
        const dx = ((x * 7 + i * 13) % 20) + 6;
        const dy = ((y * 11 + i * 17) % 20) + 6;
        ctx.fillRect(px + dx, py + dy, 2, 2);
      }
      break;

    case "wall":
      ctx.fillStyle = COLORS.wall;
      ctx.fillRect(px, py, TILE_SIZE, TILE_SIZE);
      ctx.fillStyle = COLORS.wallTop;
      ctx.fillRect(px, py, TILE_SIZE, 4);
      ctx.strokeStyle = "#3a3530";
      ctx.lineWidth = 1;
      ctx.strokeRect(px + 0.5, py + 0.5, TILE_SIZE - 1, TILE_SIZE - 1);
      break;

    case "door":
      ctx.fillStyle = COLORS.ground;
      ctx.fillRect(px, py, TILE_SIZE, TILE_SIZE);
      ctx.fillStyle = COLORS.doorFrame;
      ctx.fillRect(px, py, 4, TILE_SIZE);
      ctx.fillRect(px + TILE_SIZE - 4, py, 4, TILE_SIZE);
      ctx.fillStyle = COLORS.door;
      ctx.fillRect(px + 4, py + 2, TILE_SIZE - 8, TILE_SIZE - 4);
      ctx.fillStyle = "#8a6a3a";
      ctx.fillRect(px + TILE_SIZE - 10, py + TILE_SIZE / 2 - 2, 3, 4);
      break;

    case "grass":
      ctx.fillStyle = COLORS.grass;
      ctx.fillRect(px, py, TILE_SIZE, TILE_SIZE);
      ctx.fillStyle = COLORS.grassPattern;
      for (let i = 0; i < 5; i++) {
        const dx = ((x * 7 + i * 11) % 24) + 4;
        const dy = ((y * 13 + i * 19) % 24) + 4;
        ctx.fillRect(px + dx, py + dy, 1, 4);
      }
      break;
  }
}

function drawCharacter(
  ctx: CanvasRenderingContext2D,
  character: Character,
  index: number
): void {
  const moving = movingCharacters.get(character.id);
  let px: number, py: number;

  if (moving && character.alive) {
    const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
    const easeOut = (t: number) => 1 - Math.pow(1 - t, 2);
    const t = easeOut(moving.progress);
    px = lerp(moving.fromX, moving.toX, t) * TILE_SIZE + TILE_SIZE / 2;
    py = lerp(moving.fromY, moving.toY, t) * TILE_SIZE + TILE_SIZE / 2;
  } else {
    px = character.position.x * TILE_SIZE + TILE_SIZE / 2;
    py = character.position.y * TILE_SIZE + TILE_SIZE / 2;
  }

  const colors = character.alive
    ? getCharacterColor(character, index)
    : { body: COLORS.characterDead, accent: COLORS.characterDead };

  ctx.beginPath();
  ctx.arc(px, py - 4, 8, 0, Math.PI * 2);
  ctx.fillStyle = colors.body;
  ctx.fill();
  ctx.strokeStyle = COLORS.characterOutline;
  ctx.lineWidth = 2;
  ctx.stroke();

  ctx.beginPath();
  ctx.arc(px, py - 4, 8, -Math.PI * 0.3, Math.PI * 0.3);
  ctx.strokeStyle = colors.accent;
  ctx.lineWidth = 2;
  ctx.stroke();

  if (character.alive) {
    // Body - scaled to fit in tile
    ctx.beginPath();
    ctx.moveTo(px, py + 2);
    ctx.lineTo(px, py + 10);
    // Arms
    ctx.moveTo(px - 5, py + 5);
    ctx.lineTo(px + 5, py + 5);
    // Legs
    ctx.moveTo(px, py + 10);
    ctx.lineTo(px - 3, py + 14);
    ctx.moveTo(px, py + 10);
    ctx.lineTo(px + 3, py + 14);
    ctx.strokeStyle = colors.body;
    ctx.lineWidth = 2;
    ctx.stroke();

    if (character.equippedWeapon) {
      ctx.beginPath();
      ctx.moveTo(px + 5, py + 5);
      ctx.lineTo(px + 11, py);
      ctx.strokeStyle = colors.accent;
      ctx.lineWidth = 3;
      ctx.stroke();
      ctx.strokeStyle = COLORS.weapon;
      ctx.lineWidth = 2;
      ctx.stroke();
    }
  } else {
    ctx.font = "14px serif";
    ctx.fillStyle = "#888";
    ctx.textAlign = "center";
    ctx.fillText("†", px, py + 10);
  }

  // Draw health bar above character
  if (character.alive) {
    const barWidth = 20;
    const barHeight = 4;
    const barX = px - barWidth / 2;
    const barY = py - 18;
    const healthPercent = character.hp / character.maxHp;

    // Background (dark red)
    ctx.fillStyle = "#4a1a1a";
    ctx.fillRect(barX, barY, barWidth, barHeight);

    // Health fill (green to yellow to red based on health)
    let healthColor: string;
    if (healthPercent > 0.6) {
      healthColor = "#4ade80"; // Green
    } else if (healthPercent > 0.3) {
      healthColor = "#facc15"; // Yellow
    } else {
      healthColor = "#ef4444"; // Red
    }
    ctx.fillStyle = healthColor;
    ctx.fillRect(barX, barY, barWidth * healthPercent, barHeight);

    // Border
    ctx.strokeStyle = "#000";
    ctx.lineWidth = 1;
    ctx.strokeRect(barX, barY, barWidth, barHeight);
  }

  ctx.font = "bold 10px JetBrains Mono, monospace";
  ctx.fillStyle = "#fff";
  ctx.textAlign = "center";
  ctx.shadowColor = "#000";
  ctx.shadowBlur = 3;
  ctx.fillText(character.name.charAt(0), px, py - 1);
  ctx.shadowBlur = 0;

  characterIndexMap.set(character.id, index);
}

function drawTrap(ctx: CanvasRenderingContext2D, x: number, y: number): void {
  const px = x * TILE_SIZE + TILE_SIZE / 2;
  const py = y * TILE_SIZE + TILE_SIZE / 2;
  const size = 10;

  ctx.strokeStyle = COLORS.trap;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(px, py, size, 0, Math.PI * 2);
  ctx.stroke();

  ctx.strokeStyle = COLORS.trapTeeth;
  ctx.lineWidth = 1;
  for (let i = 0; i < 8; i++) {
    const angle = (i * Math.PI * 2) / 8;
    const innerR = size - 3;
    const outerR = size + 3;
    ctx.beginPath();
    ctx.moveTo(px + Math.cos(angle) * innerR, py + Math.sin(angle) * innerR);
    ctx.lineTo(px + Math.cos(angle) * outerR, py + Math.sin(angle) * outerR);
    ctx.stroke();
  }

  ctx.fillStyle = COLORS.trap;
  ctx.beginPath();
  ctx.arc(px, py, 3, 0, Math.PI * 2);
  ctx.fill();
}

function drawItem(
  ctx: CanvasRenderingContext2D,
  item: Item,
  x: number,
  y: number,
  index: number
): void {
  const px = x * TILE_SIZE + 4 + (index % 2) * 14;
  const py = y * TILE_SIZE + 4 + Math.floor(index / 2) * 14;

  let color = COLORS.item;
  if (item.type === "weapon") color = COLORS.weapon;
  if (item.type === "container")
    color = item.searched ? COLORS.containerSearched : COLORS.container;

  ctx.fillStyle = color;

  if (item.type === "container") {
    // Center the container in the tile
    const centerX = x * TILE_SIZE + TILE_SIZE / 2;
    const centerY = y * TILE_SIZE + TILE_SIZE / 2;
    const boxWidth = 20;
    const boxHeight = 14;

    // Main body
    ctx.fillRect(
      centerX - boxWidth / 2,
      centerY - boxHeight / 2 + 2,
      boxWidth,
      boxHeight
    );
    // Lid highlight
    ctx.fillStyle = item.searched ? "#4a3a2a" : "#8a6a4a";
    ctx.fillRect(
      centerX - boxWidth / 2 + 1,
      centerY - boxHeight / 2 + 2,
      boxWidth - 2,
      4
    );
    // Clasp
    ctx.fillStyle = "#aa8855";
    ctx.fillRect(centerX - 2, centerY - boxHeight / 2 + 5, 4, 3);
  } else if (item.type === "weapon") {
    ctx.beginPath();
    ctx.moveTo(px + 2, py + 10);
    ctx.lineTo(px + 10, py + 2);
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.fillStyle = "#654";
    ctx.fillRect(px, py + 8, 4, 4);
  } else {
    ctx.beginPath();
    ctx.arc(px + 6, py + 6, 5, 0, Math.PI * 2);
    ctx.fill();
  }
}

export function render(
  ctx: CanvasRenderingContext2D,
  world: World,
  highlightedCharacter?: Character,
  reachableTiles?: Position[],
  visibleTiles?: Position[],
  currentCharacterId?: string
): void {
  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, world.width * TILE_SIZE, world.height * TILE_SIZE);

  // Create a set of visible positions for quick lookup
  const visibleSet = new Set<string>();
  if (visibleTiles) {
    for (const pos of visibleTiles) {
      visibleSet.add(`${pos.x},${pos.y}`);
    }
  }

  for (let y = 0; y < world.height; y++) {
    for (let x = 0; x < world.width; x++) {
      const tile = world.tiles[y][x];
      drawTile(ctx, tile.type, x, y);
    }
  }

  ctx.strokeStyle = COLORS.grid;
  ctx.lineWidth = 1;
  for (let x = 0; x <= world.width; x++) {
    ctx.beginPath();
    ctx.moveTo(x * TILE_SIZE, 0);
    ctx.lineTo(x * TILE_SIZE, world.height * TILE_SIZE);
    ctx.stroke();
  }
  for (let y = 0; y <= world.height; y++) {
    ctx.beginPath();
    ctx.moveTo(0, y * TILE_SIZE);
    ctx.lineTo(world.width * TILE_SIZE, y * TILE_SIZE);
    ctx.stroke();
  }

  if (reachableTiles) {
    for (const pos of reachableTiles) {
      const px = pos.x * TILE_SIZE;
      const py = pos.y * TILE_SIZE;
      ctx.fillStyle = COLORS.reachable;
      ctx.fillRect(px, py, TILE_SIZE, TILE_SIZE);
    }
  }

  for (let y = 0; y < world.height; y++) {
    for (let x = 0; x < world.width; x++) {
      const tile = world.tiles[y][x];
      tile.items.forEach((item, index) => {
        drawItem(ctx, item, x, y, index);
      });

      if (tile.traps && currentCharacterId) {
        for (const trap of tile.traps) {
          if (trap.ownerId === currentCharacterId) {
            drawTrap(ctx, x, y);
          }
        }
      }
    }
  }

  if (highlightedCharacter) {
    const hx = highlightedCharacter.position.x * TILE_SIZE;
    const hy = highlightedCharacter.position.y * TILE_SIZE;
    ctx.fillStyle = COLORS.highlight;
    ctx.fillRect(hx, hy, TILE_SIZE, TILE_SIZE);
  }

  world.characters.forEach((character, index) => {
    drawCharacter(ctx, character, index);
  });

  // Darken tiles not in line of sight (after everything is drawn)
  if (visibleSet.size > 0 && highlightedCharacter) {
    for (let y = 0; y < world.height; y++) {
      for (let x = 0; x < world.width; x++) {
        const isCharPos =
          highlightedCharacter.position.x === x &&
          highlightedCharacter.position.y === y;
        if (!visibleSet.has(`${x},${y}`) && !isCharPos) {
          const px = x * TILE_SIZE;
          const py = y * TILE_SIZE;
          ctx.fillStyle = COLORS.notVisible;
          ctx.fillRect(px, py, TILE_SIZE, TILE_SIZE);
        }
      }
    }
  }

  for (const room of world.rooms) {
    ctx.font = "10px JetBrains Mono, monospace";
    ctx.fillStyle = "rgba(255, 255, 255, 0.3)";
    ctx.textAlign = "center";
    const centerX =
      ((room.bounds.minX + room.bounds.maxX) / 2 + 0.5) * TILE_SIZE;
    const centerY = (room.bounds.minY + 1.5) * TILE_SIZE;
    ctx.fillText(room.name, centerX, centerY);
  }

  // Draw coordinate labels
  ctx.font = "9px JetBrains Mono, monospace";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";

  // Top row (X coordinates)
  for (let x = 0; x < world.width; x++) {
    const px = x * TILE_SIZE + TILE_SIZE / 2;
    ctx.fillStyle = "rgba(0, 0, 0, 0.7)";
    ctx.fillRect(x * TILE_SIZE, 0, TILE_SIZE, 12);
    ctx.fillStyle = "rgba(255, 255, 255, 0.6)";
    ctx.fillText(String(x), px, 6);
  }

  // Left column (Y coordinates)
  ctx.textAlign = "right";
  for (let y = 0; y < world.height; y++) {
    const py = y * TILE_SIZE + TILE_SIZE / 2;
    ctx.fillStyle = "rgba(0, 0, 0, 0.7)";
    ctx.fillRect(0, y * TILE_SIZE, 14, TILE_SIZE);
    ctx.fillStyle = "rgba(255, 255, 255, 0.6)";
    ctx.fillText(String(y), 12, py);
  }

  for (const ft of floatingTexts) {
    ctx.font = "bold 14px JetBrains Mono, monospace";
    ctx.fillStyle = ft.color
      .replace(")", `, ${ft.opacity})`)
      .replace("rgb", "rgba");
    if (!ft.color.startsWith("rgb")) {
      ctx.globalAlpha = ft.opacity;
      ctx.fillStyle = ft.color;
    }
    ctx.textAlign = "center";
    ctx.shadowColor = "#000";
    ctx.shadowBlur = 4;
    ctx.fillText(ft.text, ft.x, ft.y + ft.offsetY);
    ctx.shadowBlur = 0;
    ctx.globalAlpha = 1;
  }
}

export function getCanvasSize(world: World): { width: number; height: number } {
  return {
    width: world.width * TILE_SIZE,
    height: world.height * TILE_SIZE,
  };
}

export function getTileFromPixel(px: number, py: number): Position {
  return {
    x: Math.floor(px / TILE_SIZE),
    y: Math.floor(py / TILE_SIZE),
  };
}
