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
  bars: "#707070",
  blueDoor: "#3a7ab8",
  blueDoorFrame: "#2a5a88",
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

    case "bars":
      // Draw ground behind bars
      ctx.fillStyle = COLORS.ground;
      ctx.fillRect(px, py, TILE_SIZE, TILE_SIZE);
      // Draw vertical bars
      ctx.fillStyle = COLORS.bars;
      for (let i = 0; i < 4; i++) {
        const barX = px + 4 + i * 8;
        ctx.fillRect(barX, py, 3, TILE_SIZE);
      }
      // Draw horizontal bar at top and bottom
      ctx.fillRect(px, py + 2, TILE_SIZE, 2);
      ctx.fillRect(px, py + TILE_SIZE - 4, TILE_SIZE, 2);
      break;

    case "blue_door":
      // Draw door frame
      ctx.fillStyle = COLORS.blueDoorFrame;
      ctx.fillRect(px, py, TILE_SIZE, TILE_SIZE);
      // Draw door panel
      ctx.fillStyle = COLORS.blueDoor;
      ctx.fillRect(px + 4, py + 2, TILE_SIZE - 8, TILE_SIZE - 4);
      // Draw lock symbol
      ctx.fillStyle = "#ffd700";
      ctx.fillRect(px + TILE_SIZE / 2 - 3, py + TILE_SIZE / 2 - 2, 6, 4);
      ctx.fillRect(px + TILE_SIZE / 2 - 2, py + TILE_SIZE / 2 - 5, 4, 3);
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
  const bodyGradient = ctx.createLinearGradient(px - 6, py, px + 6, py);
  bodyGradient.addColorStop(0, shadeColor(colors.body, -20));
  bodyGradient.addColorStop(0.5, colors.body);
  bodyGradient.addColorStop(1, shadeColor(colors.body, -30));

  ctx.fillStyle = shadeColor(colors.body, -40);
  ctx.beginPath();
  ctx.ellipse(px, py + 13, 5, 2, 0, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = bodyGradient;
  ctx.beginPath();
  ctx.moveTo(px - 5, py + 1);
  ctx.lineTo(px + 5, py + 1);
  ctx.lineTo(px + 6, py + 10);
  ctx.lineTo(px - 6, py + 10);
  ctx.closePath();
  ctx.fill();

  ctx.strokeStyle = shadeColor(colors.body, -40);
  ctx.lineWidth = 1;
  ctx.stroke();

  ctx.fillStyle = colors.accent;
  ctx.fillRect(px - 4, py + 1, 8, 2);

  ctx.fillStyle = shadeColor(colors.body, -10);
  ctx.beginPath();
  ctx.moveTo(px - 5, py + 10);
  ctx.lineTo(px - 3, py + 10);
  ctx.lineTo(px - 4, py + 14);
  ctx.lineTo(px - 6, py + 14);
  ctx.closePath();
  ctx.fill();

  ctx.beginPath();
  ctx.moveTo(px + 5, py + 10);
  ctx.lineTo(px + 3, py + 10);
  ctx.lineTo(px + 4, py + 14);
  ctx.lineTo(px + 6, py + 14);
  ctx.closePath();
  ctx.fill();

  ctx.fillStyle = "#1a1a1a";
  ctx.fillRect(px - 6, py + 13, 4, 2);
  ctx.fillRect(px + 2, py + 13, 4, 2);

  const skinTone = "#e8c4a0";
  const skinShadow = "#c9a080";

  ctx.fillStyle = skinTone;
  ctx.beginPath();
  ctx.arc(px - 8, py + 5, 2, 0, Math.PI * 2);
  ctx.fill();

  ctx.strokeStyle = skinShadow;
  ctx.lineWidth = 3;
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(px - 6, py + 2);
  ctx.lineTo(px - 8, py + 5);
  ctx.stroke();

  if (character.equippedWeapon) {
    ctx.beginPath();
    ctx.moveTo(px + 6, py + 2);
    ctx.lineTo(px + 9, py + 4);
    ctx.stroke();
    drawWeapon(ctx, px + 9, py + 4, colors.accent);
  } else {
    ctx.fillStyle = skinTone;
    ctx.beginPath();
    ctx.arc(px + 8, py + 5, 2, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = skinShadow;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(px + 6, py + 2);
    ctx.lineTo(px + 8, py + 5);
    ctx.stroke();
  }

  const headGradient = ctx.createRadialGradient(
    px - 2,
    py - 5,
    0,
    px,
    py - 3,
    8
  );
  headGradient.addColorStop(0, colors.accent);
  headGradient.addColorStop(0.7, colors.body);
  headGradient.addColorStop(1, shadeColor(colors.body, -30));

  ctx.fillStyle = headGradient;
  ctx.beginPath();
  ctx.ellipse(px, py - 3, 7, 6, 0, 0, Math.PI * 2);
  ctx.fill();

  ctx.strokeStyle = shadeColor(colors.body, -40);
  ctx.lineWidth = 1.5;
  ctx.stroke();

  ctx.fillStyle = "#fff";
  ctx.beginPath();
  ctx.arc(px - 2, py - 4, 1.5, 0, Math.PI * 2);
  ctx.arc(px + 2, py - 4, 1.5, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = "#111";
  ctx.beginPath();
  ctx.arc(px - 2, py - 4, 0.8, 0, Math.PI * 2);
  ctx.arc(px + 2, py - 4, 0.8, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = "rgba(255, 255, 255, 0.6)";
  ctx.beginPath();
  ctx.arc(px - 2.5, py - 4.5, 0.4, 0, Math.PI * 2);
  ctx.arc(px + 1.5, py - 4.5, 0.4, 0, Math.PI * 2);
  ctx.fill();
}

function drawDeadCharacter(
  ctx: CanvasRenderingContext2D,
  px: number,
  py: number,
  colors: { body: string; accent: string }
): void {
  ctx.fillStyle = "rgba(80, 20, 20, 0.4)";
  ctx.beginPath();
  ctx.ellipse(px, py + 8, 10, 4, 0, 0, Math.PI * 2);
  ctx.fill();

  ctx.save();
  ctx.translate(px, py + 4);
  ctx.rotate(Math.PI / 2);

  ctx.fillStyle = colors.body;
  ctx.beginPath();
  ctx.moveTo(-5, -5);
  ctx.lineTo(5, -5);
  ctx.lineTo(6, 4);
  ctx.lineTo(-6, 4);
  ctx.closePath();
  ctx.fill();

  ctx.fillStyle = colors.body;
  ctx.beginPath();
  ctx.ellipse(0, -8, 5, 4, 0, 0, Math.PI * 2);
  ctx.fill();

  ctx.restore();

  ctx.strokeStyle = "#5a2020";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(px - 3, py);
  ctx.lineTo(px - 1, py + 2);
  ctx.lineTo(px + 1, py);
  ctx.lineTo(px + 3, py + 2);
  ctx.stroke();

  ctx.fillStyle = "#8b0000";
  ctx.globalAlpha = 0.6;
  ctx.beginPath();
  ctx.ellipse(px + 5, py + 6, 4, 2, 0.3, 0, Math.PI * 2);
  ctx.fill();
  ctx.globalAlpha = 1;
}

function drawWeapon(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  accentColor: string
): void {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(Math.PI / 4);

  const bladeGradient = ctx.createLinearGradient(0, -10, 3, -10);
  bladeGradient.addColorStop(0, "#a0a0a0");
  bladeGradient.addColorStop(0.5, "#e0e0e0");
  bladeGradient.addColorStop(1, "#808080");

  ctx.fillStyle = bladeGradient;
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.lineTo(2, 0);
  ctx.lineTo(2, -8);
  ctx.lineTo(1, -10);
  ctx.lineTo(0, -8);
  ctx.closePath();
  ctx.fill();

  ctx.strokeStyle = "#505050";
  ctx.lineWidth = 0.5;
  ctx.stroke();

  ctx.fillStyle = accentColor;
  ctx.fillRect(-1, 0, 4, 2);

  ctx.fillStyle = "#4a3020";
  ctx.fillRect(0, 2, 2, 4);

  ctx.restore();
}

function shadeColor(color: string, percent: number): string {
  const num = parseInt(color.replace("#", ""), 16);
  const amt = Math.round(2.55 * percent);
  const R = Math.max(0, Math.min(255, (num >> 16) + amt));
  const G = Math.max(0, Math.min(255, ((num >> 8) & 0x00ff) + amt));
  const B = Math.max(0, Math.min(255, (num & 0x0000ff) + amt));
  return `#${((1 << 24) | (R << 16) | (G << 8) | B).toString(16).slice(1)}`;
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
  } else if (item.type === "contract") {
    // Draw a blood-red scroll
    const scrollX = px + 2;
    const scrollY = py + 2;
    const scrollW = 10;
    const scrollH = 12;

    // Scroll body (parchment color)
    ctx.fillStyle = "#d4b896";
    ctx.fillRect(scrollX, scrollY + 2, scrollW, scrollH - 4);

    // Scroll rolls at top and bottom
    ctx.fillStyle = "#8b0000"; // Dark red
    ctx.beginPath();
    ctx.arc(scrollX + scrollW / 2, scrollY + 2, 3, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(scrollX + scrollW / 2, scrollY + scrollH - 2, 3, 0, Math.PI * 2);
    ctx.fill();

    // Blood drop/seal
    ctx.fillStyle = "#b00000";
    ctx.beginPath();
    ctx.arc(scrollX + scrollW / 2, scrollY + scrollH / 2, 2, 0, Math.PI * 2);
    ctx.fill();
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
