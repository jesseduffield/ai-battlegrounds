import type {
  World,
  Character,
  Position,
  TileType,
  Item,
  Feature,
} from "./types";
import {
  initSprites,
  getSprite,
  getCharacterSprite,
  parseColor,
} from "./sprites";

export const TILE_SIZE = 32;

const COLORS = {
  grid: "rgba(255, 255, 255, 0.03)",
  highlight: "rgba(68, 136, 255, 0.3)",
  reachable: "rgba(100, 200, 100, 0.08)",
  frontier: "rgba(200, 100, 255, 0.12)",
  attackRange: "rgba(255, 100, 100, 0.3)",
  visible: "rgba(255, 255, 200, 0.08)",
  notVisible: "rgba(0, 0, 0, 0.5)",
};

// Initialize sprites once
initSprites();

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
  // Cage map
  Beast: { body: "#8b0000", accent: "#dc143c" },
  Warden: { body: "#4a4a4a", accent: "#7a7a7a" },
  Hunter: { body: "#2f4f4f", accent: "#5f8f8f" },
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

let thinkingCharacterId: string | null = null;
let speakingCharacterId: string | null = null;

export function setThinkingCharacter(characterId: string | null): void {
  thinkingCharacterId = characterId;
}

export function setSpeakingCharacter(characterId: string | null): void {
  speakingCharacterId = characterId;
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

  let spriteName: string;
  switch (type) {
    case "ground":
      spriteName = "ground";
      break;
    case "wall":
      spriteName = "wall";
      break;
    case "water":
      spriteName = "water";
      break;
    case "grass":
      spriteName = "grass";
      break;
    case "bars":
      spriteName = "bars";
      break;
    default:
      spriteName = "ground";
  }

  const sprite = getSprite(spriteName);
  ctx.drawImage(sprite, px, py, TILE_SIZE, TILE_SIZE);
}

function drawFeature(
  ctx: CanvasRenderingContext2D,
  feature: Feature,
  x: number,
  y: number
): void {
  const px = x * TILE_SIZE;
  const py = y * TILE_SIZE;

  let spriteName: string | null = null;

  switch (feature.type) {
    case "door":
      if (feature.open) {
        spriteName = "door_open";
      } else if (feature.locked) {
        spriteName = "door_locked";
      } else {
        spriteName = "door_closed";
      }
      break;

    case "chest":
      spriteName = feature.searched ? "chest_searched" : "chest";
      break;

    case "trap":
      spriteName = "trap";
      break;
  }

  if (spriteName) {
    const sprite = getSprite(spriteName);
    ctx.drawImage(sprite, px, py, TILE_SIZE, TILE_SIZE);
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
    : { body: "#4a3535", accent: "#3a2525" };

  if (character.alive) {
    drawAliveCharacter(ctx, px, py, colors, character);
  } else {
    drawDeadCharacter(ctx, px, py, colors);
  }

  if (character.alive) {
    const barWidth = 22;
    const barHeight = 3;
    const barX = px - barWidth / 2;
    const barY = py - 14;
    const healthPercent = character.hp / character.maxHp;

    ctx.fillStyle = "#1a0a0a";
    ctx.fillRect(barX - 1, barY - 1, barWidth + 2, barHeight + 2);

    const gradient = ctx.createLinearGradient(
      barX,
      barY,
      barX,
      barY + barHeight
    );
    if (healthPercent > 0.6) {
      gradient.addColorStop(0, "#6be875");
      gradient.addColorStop(1, "#3cb44a");
    } else if (healthPercent > 0.3) {
      gradient.addColorStop(0, "#fcd34d");
      gradient.addColorStop(1, "#d97706");
    } else {
      gradient.addColorStop(0, "#f87171");
      gradient.addColorStop(1, "#b91c1c");
    }
    ctx.fillStyle = gradient;
    ctx.fillRect(barX, barY, barWidth * healthPercent, barHeight);

    ctx.fillStyle = "rgba(255, 255, 255, 0.3)";
    ctx.fillRect(barX, barY, barWidth * healthPercent, 1);
  }

  ctx.font = "bold 8px JetBrains Mono, monospace";
  ctx.fillStyle = "#fff";
  ctx.textAlign = "center";
  ctx.shadowColor = "#000";
  ctx.shadowBlur = 2;
  ctx.shadowOffsetX = 1;
  ctx.shadowOffsetY = 1;
  ctx.fillText(character.name, px, py - 20);
  ctx.shadowBlur = 0;
  ctx.shadowOffsetX = 0;
  ctx.shadowOffsetY = 0;

  // Draw thinking or speaking bubble icon
  if (character.alive) {
    if (thinkingCharacterId === character.id) {
      drawThoughtBubbleIcon(ctx, px + 12, py - 16);
    } else if (speakingCharacterId === character.id) {
      drawSpeechBubbleIcon(ctx, px + 12, py - 16);
    }
  }

  characterIndexMap.set(character.id, index);
}

function drawThoughtBubbleIcon(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number
): void {
  ctx.save();

  // Main bubble
  ctx.fillStyle = "#fff";
  ctx.strokeStyle = "#666";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.ellipse(x, y, 8, 6, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();

  // Thought dots (trailing circles)
  ctx.beginPath();
  ctx.arc(x - 6, y + 6, 2.5, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();

  ctx.beginPath();
  ctx.arc(x - 9, y + 9, 1.5, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();

  // Three dots inside bubble
  ctx.fillStyle = "#666";
  ctx.beginPath();
  ctx.arc(x - 3, y, 1.2, 0, Math.PI * 2);
  ctx.arc(x, y, 1.2, 0, Math.PI * 2);
  ctx.arc(x + 3, y, 1.2, 0, Math.PI * 2);
  ctx.fill();

  ctx.restore();
}

function drawSpeechBubbleIcon(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number
): void {
  ctx.save();

  // Main bubble
  ctx.fillStyle = "#fff";
  ctx.strokeStyle = "#333";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.ellipse(x, y, 8, 6, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();

  // Speech tail (pointed triangle)
  ctx.beginPath();
  ctx.moveTo(x - 4, y + 4);
  ctx.lineTo(x - 8, y + 10);
  ctx.lineTo(x - 1, y + 5);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();

  // Three lines inside bubble (speech lines)
  ctx.strokeStyle = "#333";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(x - 4, y - 1);
  ctx.lineTo(x + 4, y - 1);
  ctx.moveTo(x - 4, y + 2);
  ctx.lineTo(x + 2, y + 2);
  ctx.stroke();

  ctx.restore();
}

function drawAliveCharacter(
  ctx: CanvasRenderingContext2D,
  px: number,
  py: number,
  colors: { body: string; accent: string },
  character: Character
): void {
  const bodyColor = parseColor(colors.body);
  const accentColor = parseColor(colors.accent);
  const armed = !!character.equippedWeapon;

  const sprite = getCharacterSprite(bodyColor, accentColor, armed);

  // Draw sprite centered on character position
  // 16x16 sprite, scaled to 32x32
  ctx.drawImage(sprite, px - 16, py - 16, 32, 32);
}

function drawDeadCharacter(
  ctx: CanvasRenderingContext2D,
  px: number,
  py: number,
  _colors: { body: string; accent: string }
): void {
  const sprite = getSprite("character_dead");

  // Draw sprite centered on character position
  ctx.drawImage(sprite, px - 16, py - 16, 32, 32);
}

function drawTrap(ctx: CanvasRenderingContext2D, x: number, y: number): void {
  const px = x * TILE_SIZE;
  const py = y * TILE_SIZE;
  const sprite = getSprite("trap");
  ctx.drawImage(sprite, px, py, TILE_SIZE, TILE_SIZE);
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

  let spriteName: string;
  switch (item.type) {
    case "weapon":
      spriteName = "item_weapon";
      break;
    case "consumable":
      spriteName = "item_consumable";
      break;
    case "key":
      spriteName = "item_key";
      break;
    case "trap":
      spriteName = "item_trap";
      break;
    case "clothing":
      spriteName = "item_clothing";
      break;
    case "contract":
      spriteName = "item_contract";
      break;
    default:
      spriteName = "item_consumable"; // fallback
  }

  const sprite = getSprite(spriteName);
  // Draw 16x16 sprite scaled to 12x12 for compact display
  ctx.drawImage(sprite, px, py, 12, 12);
}

export function render(
  ctx: CanvasRenderingContext2D,
  world: World,
  highlightedCharacter?: Character,
  reachableTiles?: Position[],
  visibleTiles?: Position[],
  currentCharacterId?: string,
  frontierTiles?: Position[]
): void {
  // Disable image smoothing for crisp pixel art
  ctx.imageSmoothingEnabled = false;

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
      if (tile.feature) {
        drawFeature(ctx, tile.feature, x, y);
      }
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

  if (frontierTiles) {
    for (const pos of frontierTiles) {
      const px = pos.x * TILE_SIZE;
      const py = pos.y * TILE_SIZE;
      ctx.fillStyle = COLORS.frontier;
      ctx.fillRect(px, py, TILE_SIZE, TILE_SIZE);
    }
  }

  for (let y = 0; y < world.height; y++) {
    for (let x = 0; x < world.width; x++) {
      const tile = world.tiles[y][x];
      tile.items.forEach((item, index) => {
        drawItem(ctx, item, x, y, index);
      });

      // Draw trap if owned by current player (traps are invisible to others)
      if (
        tile.feature?.type === "trap" &&
        currentCharacterId &&
        tile.feature.ownerId === currentCharacterId
      ) {
        drawTrap(ctx, x, y);
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
