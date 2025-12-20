// 3D Raycasting Renderer (Wolfenstein-style)
import type { World, Character } from "./types";
import { getSprite, getCharacterSprite, parseColor } from "./sprites";

export type Camera = {
  followCharacterId: string | null;
  angle: number; // Radians, 0 = east, increases counter-clockwise
  fov: number; // Field of view in radians
};

const VIEWPORT_WIDTH = 640;
const VIEWPORT_HEIGHT = 480;
const WALL_HEIGHT_MULTIPLIER = 200; // Affects perceived wall height

// Create a camera with default values
export function createCamera(characterId: string | null = null): Camera {
  return {
    followCharacterId: characterId,
    angle: 0,
    fov: Math.PI / 4, // 45 degrees - narrower FOV for more immersive feel
  };
}

// Ray-DDA intersection test
function castRay(
  world: World,
  startX: number,
  startY: number,
  angle: number
): {
  distance: number;
  hitX: number;
  hitY: number;
  side: "NS" | "EW"; // North-South or East-West wall
  tileType: string;
} | null {
  const dirX = Math.cos(angle);
  const dirY = Math.sin(angle);

  let mapX = Math.floor(startX);
  let mapY = Math.floor(startY);

  const deltaDistX = Math.abs(1 / dirX);
  const deltaDistY = Math.abs(1 / dirY);

  let stepX: number;
  let stepY: number;
  let sideDistX: number;
  let sideDistY: number;

  if (dirX < 0) {
    stepX = -1;
    sideDistX = (startX - mapX) * deltaDistX;
  } else {
    stepX = 1;
    sideDistX = (mapX + 1 - startX) * deltaDistX;
  }

  if (dirY < 0) {
    stepY = -1;
    sideDistY = (startY - mapY) * deltaDistY;
  } else {
    stepY = 1;
    sideDistY = (mapY + 1 - startY) * deltaDistY;
  }

  let hit = false;
  let side: "NS" | "EW" = "NS";
  let maxSteps = 100;

  while (!hit && maxSteps-- > 0) {
    if (sideDistX < sideDistY) {
      sideDistX += deltaDistX;
      mapX += stepX;
      side = "EW";
    } else {
      sideDistY += deltaDistY;
      mapY += stepY;
      side = "NS";
    }

    // Check if out of bounds
    if (mapX < 0 || mapX >= world.width || mapY < 0 || mapY >= world.height) {
      return null;
    }

    const tile = world.tiles[mapY][mapX];
    if (tile.type === "wall") {
      hit = true;
    }
  }

  if (!hit) return null;

  // Calculate perpendicular distance to avoid fisheye
  let perpWallDist: number;
  if (side === "EW") {
    perpWallDist = sideDistX - deltaDistX;
  } else {
    perpWallDist = sideDistY - deltaDistY;
  }

  return {
    distance: perpWallDist,
    hitX: mapX,
    hitY: mapY,
    side,
    tileType: world.tiles[mapY][mapX].type,
  };
}

// Check if a billboard position is occluded by a wall
function isBillboardOccluded(
  world: World,
  cameraX: number,
  cameraY: number,
  billboardX: number,
  billboardY: number
): boolean {
  const dx = billboardX - cameraX;
  const dy = billboardY - cameraY;
  const billboardDistance = Math.sqrt(dx * dx + dy * dy);
  const angle = Math.atan2(dy, dx);

  const rayHit = castRay(world, cameraX, cameraY, angle);

  // If no wall was hit, billboard is visible
  if (!rayHit) return false;

  // If wall is closer than billboard, billboard is occluded
  return rayHit.distance < billboardDistance;
}

// Render a textured wall slice
function drawWallSlice(
  ctx: CanvasRenderingContext2D,
  x: number,
  distance: number,
  side: "NS" | "EW",
  wallTexture: HTMLCanvasElement
): void {
  const lineHeight = Math.min(
    VIEWPORT_HEIGHT * 2,
    WALL_HEIGHT_MULTIPLIER / distance
  );

  const drawStart = Math.max(0, (VIEWPORT_HEIGHT - lineHeight) / 2);
  const drawEnd = Math.min(VIEWPORT_HEIGHT, (VIEWPORT_HEIGHT + lineHeight) / 2);

  // Apply shading based on side (EW walls are darker)
  if (side === "EW") {
    ctx.globalAlpha = 0.7;
  } else {
    ctx.globalAlpha = 1.0;
  }

  // Draw a vertical slice of the wall texture
  ctx.drawImage(
    wallTexture,
    0,
    0,
    16,
    16,
    x,
    drawStart,
    1,
    drawEnd - drawStart
  );

  ctx.globalAlpha = 1.0;
}

// Draw floor and ceiling
function drawFloorCeiling(ctx: CanvasRenderingContext2D): void {
  // Ceiling (upper half)
  ctx.fillStyle = "#1a1a1a";
  ctx.fillRect(0, 0, VIEWPORT_WIDTH, VIEWPORT_HEIGHT / 2);

  // Floor (lower half)
  ctx.fillStyle = "#2a2522";
  ctx.fillRect(0, VIEWPORT_HEIGHT / 2, VIEWPORT_WIDTH, VIEWPORT_HEIGHT / 2);
}

// Billboard sprite rendering (characters, items)
type Billboard = {
  x: number;
  y: number;
  sprite: HTMLCanvasElement;
  distance: number;
};

function getBillboards(
  world: World,
  cameraX: number,
  cameraY: number
): Billboard[] {
  const billboards: Billboard[] = [];

  // Add feature billboards (chests, doors)
  for (let y = 0; y < world.height; y++) {
    for (let x = 0; x < world.width; x++) {
      const tile = world.tiles[y][x];

      if (tile.feature) {
        let spriteName: string | null = null;

        if (tile.feature.type === "chest") {
          spriteName = tile.feature.searched ? "chest_searched" : "chest";
        } else if (tile.feature.type === "door") {
          if (!tile.feature.open) {
            spriteName = tile.feature.locked ? "door_locked" : "door_closed";
          }
          // Don't render open doors
        } else if (tile.feature.type === "trap") {
          // Only render traps that have been triggered (visible)
          if (tile.feature.triggered) {
            spriteName = "trap";
          }
        }

        if (spriteName) {
          const sprite = getSprite(spriteName);
          const dx = x + 0.5 - cameraX;
          const dy = y + 0.5 - cameraY;
          const distance = Math.sqrt(dx * dx + dy * dy);

          billboards.push({
            x: x + 0.5,
            y: y + 0.5,
            sprite,
            distance,
          });
        }
      }

      // Add item billboards
      for (const item of tile.items) {
        let spriteName: string;

        if (item.type === "weapon") {
          spriteName = "item_weapon";
        } else if (item.type === "consumable") {
          spriteName = "item_consumable";
        } else if (item.type === "key") {
          spriteName = "item_key";
        } else if (item.type === "trap") {
          spriteName = "item_trap";
        } else if (item.type === "clothing") {
          spriteName = "item_clothing";
        } else if (item.type === "contract") {
          spriteName = "item_contract";
        } else {
          continue;
        }

        const sprite = getSprite(spriteName);
        const dx = x + 0.5 - cameraX;
        const dy = y + 0.5 - cameraY;
        const distance = Math.sqrt(dx * dx + dy * dy);

        billboards.push({
          x: x + 0.5,
          y: y + 0.5,
          sprite,
          distance,
        });
      }
    }
  }

  // Add character billboards
  for (const char of world.characters) {
    if (!char.alive) continue;

    const colors = getCharacterColors(char);
    const bodyColor = parseColor(colors.body);
    const accentColor = parseColor(colors.accent);
    const armed = !!char.equippedWeapon;
    const sprite = getCharacterSprite(bodyColor, accentColor, armed);

    const dx = char.position.x + 0.5 - cameraX;
    const dy = char.position.y + 0.5 - cameraY;
    const distance = Math.sqrt(dx * dx + dy * dy);

    billboards.push({
      x: char.position.x + 0.5,
      y: char.position.y + 0.5,
      sprite,
      distance,
    });
  }

  // Sort by distance (far to near for painter's algorithm)
  billboards.sort((a, b) => b.distance - a.distance);

  return billboards;
}

function drawBillboard(
  ctx: CanvasRenderingContext2D,
  billboard: Billboard,
  cameraX: number,
  cameraY: number,
  cameraAngle: number,
  fov: number
): void {
  // Transform sprite position to camera space
  const spriteX = billboard.x - cameraX;
  const spriteY = billboard.y - cameraY;

  // Rotate into camera space
  const cosAngle = Math.cos(-cameraAngle);
  const sinAngle = Math.sin(-cameraAngle);
  const transformX = spriteY * cosAngle - spriteX * sinAngle;
  const transformY = spriteY * sinAngle + spriteX * cosAngle;

  // Sprite is behind camera
  if (transformY <= 0.1) return;

  // Calculate sprite screen x position
  const spriteScreenX =
    (VIEWPORT_WIDTH / 2) * (1 + transformX / transformY / Math.tan(fov / 2));

  // Calculate sprite height based on distance - make billboards appear larger
  const spriteHeight = Math.abs(VIEWPORT_HEIGHT / transformY);
  const spriteWidth = spriteHeight;

  const drawStartY = (VIEWPORT_HEIGHT - spriteHeight) / 2;
  const drawStartX = spriteScreenX - spriteWidth / 2;

  // Only draw if on screen
  if (
    drawStartX + spriteWidth > 0 &&
    drawStartX < VIEWPORT_WIDTH &&
    drawStartY < VIEWPORT_HEIGHT
  ) {
    ctx.drawImage(
      billboard.sprite,
      drawStartX,
      drawStartY,
      spriteWidth,
      spriteHeight
    );
  }
}

// Get character colors (same as 2D renderer)
const CHARACTER_COLORS: Record<string, { body: string; accent: string }> = {
  Kane: { body: "#e63946", accent: "#ff6b6b" },
  Razor: { body: "#4361ee", accent: "#7b8fff" },
  Alice: { body: "#e67e22", accent: "#f39c12" },
  Bob: { body: "#1abc9c", accent: "#3dd6b0" },
  Charlie: { body: "#e74c3c", accent: "#ff6b6b" },
  Rex: { body: "#e63946", accent: "#ff6b6b" },
  Luna: { body: "#9b59b6", accent: "#bb77d6" },
  Vex: { body: "#27ae60", accent: "#3dd6b0" },
  Nova: { body: "#3498db", accent: "#5dade2" },
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

function getCharacterColors(character: Character): {
  body: string;
  accent: string;
} {
  if (CHARACTER_COLORS[character.name]) {
    return CHARACTER_COLORS[character.name];
  }
  const index = character.name.charCodeAt(0) % DEFAULT_CHARACTER_COLORS.length;
  return DEFAULT_CHARACTER_COLORS[index];
}

// Main 3D render function
export function render3D(
  ctx: CanvasRenderingContext2D,
  world: World,
  camera: Camera
): void {
  // Disable image smoothing for crisp pixels
  ctx.imageSmoothingEnabled = false;

  // Get camera position (follow character or default)
  let cameraX = world.width / 2;
  let cameraY = world.height / 2;

  if (camera.followCharacterId) {
    const followChar = world.characters.find(
      (c) => c.id === camera.followCharacterId
    );
    if (followChar) {
      cameraX = followChar.position.x + 0.5;
      cameraY = followChar.position.y + 0.5;
    }
  }

  // Draw floor and ceiling
  drawFloorCeiling(ctx);

  // Get wall texture
  const wallSprite = getSprite("wall");

  // Cast rays for each screen column
  for (let x = 0; x < VIEWPORT_WIDTH; x++) {
    // Calculate ray angle
    const cameraX_screen = (2 * x) / VIEWPORT_WIDTH - 1; // x in camera space [-1, 1]
    const rayAngle =
      camera.angle + Math.atan(cameraX_screen * Math.tan(camera.fov / 2));

    // Cast the ray
    const hit = castRay(world, cameraX, cameraY, rayAngle);

    if (hit) {
      drawWallSlice(ctx, x, hit.distance, hit.side, wallSprite);
    }
  }

  // Draw billboards (characters, items) - filter out occluded ones
  const billboards = getBillboards(world, cameraX, cameraY);
  for (const billboard of billboards) {
    // Check if billboard is occluded by a wall
    if (
      !isBillboardOccluded(world, cameraX, cameraY, billboard.x, billboard.y)
    ) {
      drawBillboard(ctx, billboard, cameraX, cameraY, camera.angle, camera.fov);
    }
  }

  // Draw crosshair
  ctx.strokeStyle = "#fff";
  ctx.lineWidth = 2;
  const centerX = VIEWPORT_WIDTH / 2;
  const centerY = VIEWPORT_HEIGHT / 2;
  ctx.beginPath();
  ctx.moveTo(centerX - 5, centerY);
  ctx.lineTo(centerX + 5, centerY);
  ctx.moveTo(centerX, centerY - 5);
  ctx.lineTo(centerX, centerY + 5);
  ctx.stroke();
}

// Camera control helpers
export function rotateCamera(camera: Camera, deltaAngle: number): void {
  camera.angle += deltaAngle;
  // Normalize to [0, 2π]
  while (camera.angle < 0) camera.angle += Math.PI * 2;
  while (camera.angle >= Math.PI * 2) camera.angle -= Math.PI * 2;
}
