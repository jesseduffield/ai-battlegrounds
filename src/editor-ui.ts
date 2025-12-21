import {
  EditorState,
  EditorTool,
  createDefaultEditorState,
  resizeMap,
  createItem,
  createCharacter,
  createDoorFeature,
  createChestFeature,
  exportWorldAsJson,
  importWorldFromJson,
  editorStateToWorld,
  saveEditorStateToStorage,
  loadEditorStateFromStorage,
  AI_MODELS,
} from "./editor";
import type {
  TileType,
  Item,
  Effect,
  EffectAction,
  EffectTrigger,
} from "./types";
import { createId } from "./engine";

const TILE_SIZE = 32;

let editorState: EditorState = createDefaultEditorState();
let editorCanvas: HTMLCanvasElement | null = null;
let editorCtx: CanvasRenderingContext2D | null = null;
let isDragging = false;
let createdItems: Item[] = [];
let pendingAddPosition: { x: number; y: number } | null = null;

// Pending move state for relocating entities
type PendingMove =
  | { type: "character"; id: string }
  | { type: "feature"; fromX: number; fromY: number }
  | { type: "item"; fromX: number; fromY: number; index: number }
  | { type: "chestItem"; fromX: number; fromY: number; index: number };
let pendingMove: PendingMove | null = null;

function saveState(): void {
  saveEditorStateToStorage(editorState);
}

const TERRAIN_COLORS: Record<TileType, string> = {
  ground: "#8B7355",
  wall: "#4a4a5a",
  grass: "#4a7c3f",
  bars: "#6a6a7a",
  water: "#4a7c9f",
};

const TERRAIN_ICONS: Record<TileType, string> = {
  ground: "",
  wall: "#",
  grass: "",
  bars: "║",
  water: "~",
};

export function initEditor(): void {
  editorCanvas = document.getElementById("editor-canvas") as HTMLCanvasElement;
  editorCtx = editorCanvas?.getContext("2d") ?? null;

  // Load saved state from localStorage if available
  const savedState = loadEditorStateFromStorage();
  if (savedState) {
    editorState = savedState;
  }

  setupModeToggle();
  setupToolSelection();
  setupTerrainPalette();
  setupMapControls();
  setupCanvasEvents();
  setupItemForm();
  setupCharacterForm();
  setupActionButtons();

  updateEditorCanvas();
}

function setupModeToggle(): void {
  const gameModeBtn = document.getElementById("game-mode-btn");
  const editorModeBtn = document.getElementById("editor-mode-btn");
  const gameContainer = document.querySelector("main");
  const editorContainer = document.getElementById("editor-container");
  const gameControls = document.getElementById("game-controls");
  const turnInfo = document.getElementById("turn-info");

  gameModeBtn?.addEventListener("click", () => {
    gameModeBtn.classList.add("active");
    editorModeBtn?.classList.remove("active");
    gameContainer?.classList.remove("hidden");
    editorContainer?.classList.remove("active");
    if (gameControls) gameControls.style.display = "";
    if (turnInfo) turnInfo.style.display = "";
  });

  editorModeBtn?.addEventListener("click", () => {
    editorModeBtn.classList.add("active");
    gameModeBtn?.classList.remove("active");
    gameContainer?.classList.add("hidden");
    editorContainer?.classList.add("active");
    if (gameControls) gameControls.style.display = "none";
    if (turnInfo) turnInfo.style.display = "none";
    updateEditorCanvas();
  });
}

function setupToolSelection(): void {
  const toolBtns = document.querySelectorAll(".tool-btn");
  const terrainPanel = document.getElementById("terrain-panel");

  toolBtns.forEach((btn) => {
    btn.addEventListener("click", () => {
      toolBtns.forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");

      const tool = btn.getAttribute("data-tool") as EditorTool;
      editorState.tool = tool;

      // Show/hide terrain panel
      if (terrainPanel)
        terrainPanel.style.display = tool === "terrain" ? "" : "none";
    });
  });
}

function setupTerrainPalette(): void {
  const items = document.querySelectorAll(".terrain-palette .palette-item");
  items.forEach((item) => {
    item.addEventListener("click", () => {
      items.forEach((i) => i.classList.remove("selected"));
      item.classList.add("selected");
      editorState.selectedTerrain = item.getAttribute(
        "data-terrain"
      ) as TileType;
    });
  });
}

function setupMapControls(): void {
  const widthInput = document.getElementById(
    "editor-width"
  ) as HTMLInputElement;
  const heightInput = document.getElementById(
    "editor-height"
  ) as HTMLInputElement;
  const resizeBtn = document.getElementById("resize-map-btn");

  resizeBtn?.addEventListener("click", () => {
    const newWidth = parseInt(widthInput.value) || 20;
    const newHeight = parseInt(heightInput.value) || 15;

    editorState.tiles = resizeMap(editorState, newWidth, newHeight);
    editorState.width = newWidth;
    editorState.height = newHeight;

    // Filter out characters outside new bounds
    editorState.characters = editorState.characters.filter(
      (c) => c.position.x < newWidth && c.position.y < newHeight
    );

    updateEditorCanvas();
    saveState();
  });
}

function setupCanvasEvents(): void {
  if (!editorCanvas) return;

  editorCanvas.addEventListener("mousedown", (e) => {
    isDragging = true;
    handleCanvasClick(e);
  });

  editorCanvas.addEventListener("mousemove", (e) => {
    if (isDragging && editorState.tool === "terrain") {
      handleCanvasClick(e);
    }
  });

  editorCanvas.addEventListener("mouseup", () => {
    isDragging = false;
  });

  editorCanvas.addEventListener("mouseleave", () => {
    isDragging = false;
  });
}

function handleCanvasClick(e: MouseEvent): void {
  if (!editorCanvas) return;

  const rect = editorCanvas.getBoundingClientRect();
  const x = Math.floor((e.clientX - rect.left) / TILE_SIZE);
  const y = Math.floor((e.clientY - rect.top) / TILE_SIZE);

  if (x < 0 || x >= editorState.width || y < 0 || y >= editorState.height)
    return;

  editorState.selectedPosition = { x, y };
  let didModify = false;

  // Handle pending move first
  if (pendingMove) {
    didModify = executePendingMove(x, y);
    pendingMove = null;
    updateEditorCanvas();
    updatePropertiesPanel(x, y);
    if (didModify) {
      saveState();
    }
    return;
  }

  if (editorState.tool === "terrain") {
    // Terrain is paint mode
    editorState.tiles[y][x].type = editorState.selectedTerrain;
    didModify = true;
  } else {
    // Select mode (default) - show properties panel
    updatePropertiesPanel(x, y);
  }

  updateEditorCanvas();

  // Save state to localStorage when modified
  if (didModify) {
    saveState();
  }
}

function executePendingMove(toX: number, toY: number): boolean {
  if (!pendingMove) return false;

  const targetTile = editorState.tiles[toY][toX];

  switch (pendingMove.type) {
    case "character": {
      const charId = pendingMove.id;
      const char = editorState.characters.find((c) => c.id === charId);
      if (char) {
        // Check if another character is already at target
        const existingChar = editorState.characters.find(
          (c) => c.position.x === toX && c.position.y === toY
        );
        if (existingChar && existingChar.id !== char.id) {
          alert("Another character is already at that position");
          return false;
        }
        char.position = { x: toX, y: toY };
        return true;
      }
      return false;
    }
    case "feature": {
      const { fromX, fromY } = pendingMove;
      const sourceTile = editorState.tiles[fromY][fromX];
      if (!sourceTile.feature) return false;
      if (targetTile.feature) {
        alert("Target tile already has a feature");
        return false;
      }
      targetTile.feature = sourceTile.feature;
      sourceTile.feature = undefined;
      return true;
    }
    case "item": {
      const { fromX, fromY, index } = pendingMove;
      const sourceTile = editorState.tiles[fromY][fromX];
      if (index < 0 || index >= sourceTile.items.length) return false;
      const item = sourceTile.items.splice(index, 1)[0];
      // If target has a chest, add to chest. Otherwise add to ground.
      if (targetTile.feature?.type === "chest") {
        targetTile.feature.contents.push(item);
      } else {
        targetTile.items.push(item);
      }
      return true;
    }
    case "chestItem": {
      const { fromX, fromY, index } = pendingMove;
      const sourceTile = editorState.tiles[fromY][fromX];
      if (sourceTile.feature?.type !== "chest") return false;
      if (index < 0 || index >= sourceTile.feature.contents.length)
        return false;
      const item = sourceTile.feature.contents.splice(index, 1)[0];
      // If target has a chest, add to chest. Otherwise add to ground.
      if (targetTile.feature?.type === "chest") {
        targetTile.feature.contents.push(item);
      } else {
        targetTile.items.push(item);
      }
      return true;
    }
  }
  return false;
}

function updatePropertiesPanel(x: number, y: number): void {
  const panel = document.getElementById("properties-content");
  if (!panel) return;

  const tile = editorState.tiles[y][x];
  const character = editorState.characters.find(
    (c) => c.position.x === x && c.position.y === y
  );

  let html = `<h4>Tile (${x}, ${y})</h4>`;
  html += `<p>Terrain: ${tile.type}</p>`;

  // Show pending move indicator
  if (pendingMove) {
    html += `<div style="background: #ffcc44; color: #000; padding: 0.5rem; border-radius: 4px; margin: 0.5rem 0; text-align: center;">`;
    html += `<strong>📍 Click a tile to move here</strong>`;
    html += `<button class="btn-secondary" style="display: block; width: 100%; margin-top: 0.25rem;" onclick="window.editorCancelMove()">Cancel Move</button>`;
    html += `</div>`;
  }

  // Feature section
  if (tile.feature) {
    html += `<hr style="margin: 0.5rem 0; border-color: var(--border-color);">`;
    html += `<h4>Feature: ${tile.feature.name}</h4>`;
    html += `<p style="color: var(--text-secondary);">Type: ${tile.feature.type}</p>`;

    // Show chest contents if it's a chest
    if (tile.feature.type === "chest") {
      const chest = tile.feature;
      if (chest.contents.length > 0) {
        html += `<p style="margin-top: 0.5rem; font-weight: 600;">Contents:</p>`;
        html += `<div style="margin-left: 0.5rem;">`;
        chest.contents.forEach((item, idx) => {
          html += `<div style="display: flex; justify-content: space-between; align-items: center; margin: 0.25rem 0;">`;
          html += `<span>• ${item.name} <span style="color: var(--text-secondary); font-size: 0.75rem;">(${item.type})</span></span>`;
          html += `<div style="display: flex; gap: 0.25rem;">`;
          html += `<button class="btn-secondary" style="padding: 0.1rem 0.3rem; font-size: 0.7rem;" title="Move" onclick="window.editorMoveChestItem(${x}, ${y}, ${idx})">↗</button>`;
          html += `<button class="btn-secondary" style="padding: 0.1rem 0.3rem; font-size: 0.7rem;" onclick="window.editorEditItem(${x}, ${y}, ${idx}, 'chest')">✎</button>`;
          html += `<button class="btn-secondary" style="padding: 0.1rem 0.3rem; font-size: 0.7rem;" onclick="window.editorRemoveChestItem(${x}, ${y}, ${idx})">✕</button>`;
          html += `</div>`;
          html += `</div>`;
        });
        html += `</div>`;
      } else {
        html += `<p style="color: var(--text-secondary); font-style: italic;">Empty</p>`;
      }
    }

    html += `<div style="display: flex; gap: 0.25rem; margin-top: 0.5rem;">`;
    html += `<button class="btn-secondary" style="flex: 1;" onclick="window.editorMoveFeature(${x}, ${y})">↗ Move</button>`;
    html += `<button class="btn-secondary" style="flex: 1;" onclick="window.editorRemoveFeature(${x}, ${y})">🗑️ Remove</button>`;
    html += `</div>`;
  }

  // Items on ground section
  if (tile.items.length > 0) {
    html += `<hr style="margin: 0.5rem 0; border-color: var(--border-color);">`;
    html += `<h4>Items on Ground</h4>`;
    html += `<div style="margin-left: 0.5rem;">`;
    tile.items.forEach((item, idx) => {
      html += `<div style="display: flex; justify-content: space-between; align-items: center; margin: 0.25rem 0;">`;
      html += `<span>• ${item.name} <span style="color: var(--text-secondary); font-size: 0.75rem;">(${item.type})</span></span>`;
      html += `<div style="display: flex; gap: 0.25rem;">`;
      html += `<button class="btn-secondary" style="padding: 0.1rem 0.3rem; font-size: 0.7rem;" title="Move" onclick="window.editorMoveItem(${x}, ${y}, ${idx})">↗</button>`;
      html += `<button class="btn-secondary" style="padding: 0.1rem 0.3rem; font-size: 0.7rem;" onclick="window.editorEditItem(${x}, ${y}, ${idx}, 'ground')">✎</button>`;
      html += `<button class="btn-secondary" style="padding: 0.1rem 0.3rem; font-size: 0.7rem;" onclick="window.editorRemoveItem(${x}, ${y}, ${idx})">✕</button>`;
      html += `</div>`;
      html += `</div>`;
    });
    html += `</div>`;
    html += `<button class="btn-secondary" style="margin-top: 0.5rem; width: 100%;" onclick="window.editorClearItems(${x}, ${y})">🗑️ Clear All Items</button>`;
  }

  // Character section
  if (character) {
    html += `<hr style="margin: 0.5rem 0; border-color: var(--border-color);">`;
    html += `<h4>Character: ${character.name}</h4>`;
    html += `<p style="font-size: 0.85rem;">Gender: ${character.gender}</p>`;
    html += `<p style="font-size: 0.85rem;">HP: ${character.hp}/${character.maxHp}</p>`;
    html += `<p style="font-size: 0.85rem;">Model: ${character.aiModel}</p>`;
    if (character.inventory.length > 0) {
      html += `<p style="font-size: 0.85rem;">Inventory: ${character.inventory.length} items</p>`;
    }
    if (character.equippedWeapon) {
      html += `<p style="font-size: 0.85rem;">Weapon: ${character.equippedWeapon.name}</p>`;
    }
    if (character.effects.length > 0) {
      html += `<p style="font-size: 0.85rem;">Effects: ${character.effects
        .map((e) => e.name)
        .join(", ")}</p>`;
    }
    html += `<div style="display: flex; gap: 0.25rem; margin-top: 0.5rem;">`;
    html += `<button class="btn-secondary" style="flex: 1;" onclick="window.editorMoveCharacter('${character.id}')">↗ Move</button>`;
    html += `<button class="btn-primary" style="flex: 1;" onclick="window.editorEditCharacter('${character.id}')">✎ Edit</button>`;
    html += `<button class="btn-secondary" style="flex: 1;" onclick="window.editorRemoveCharacter('${character.id}')">🗑️</button>`;
    html += `</div>`;
  }

  // Quick actions section
  html += `<hr style="margin: 0.75rem 0; border-color: var(--border-color);">`;
  html += `<h4>Add to Tile</h4>`;
  html += `<div style="display: flex; flex-direction: column; gap: 0.25rem;">`;

  if (!tile.feature) {
    html += `<button class="btn-secondary" style="width: 100%;" onclick="window.editorAddFeature(${x}, ${y}, 'door')">🚪 Add Door</button>`;
    html += `<button class="btn-secondary" style="width: 100%;" onclick="window.editorAddFeature(${x}, ${y}, 'chest')">📦 Add Chest</button>`;
  }

  html += `<button class="btn-secondary" style="width: 100%;" onclick="window.editorShowAddItem(${x}, ${y})">📦 Add Item...</button>`;

  if (!character) {
    html += `<button class="btn-secondary" style="width: 100%;" onclick="window.editorShowAddCharacter(${x}, ${y})">👤 Add Character...</button>`;
  }

  html += `</div>`;

  panel.innerHTML = html;
}

// Item effect form state for building triggers dynamically
let itemEffectFormTriggers: TriggerBuilder[] = [];

function renderItemEffectTriggersUI(): void {
  const container = document.getElementById("item-effect-triggers-container");
  if (!container) return;

  if (itemEffectFormTriggers.length === 0) {
    container.innerHTML =
      '<p style="color: var(--text-secondary); font-size: 0.8rem;">No triggers. Add at least one trigger.</p>';
    return;
  }

  container.innerHTML = itemEffectFormTriggers
    .map(
      (trigger, tIdx) => `
    <div style="border: 1px solid var(--border-color); padding: 0.5rem; margin-bottom: 0.5rem; border-radius: 4px; background: var(--bg-panel);">
      <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.5rem;">
        <select class="item-trigger-type-select" data-trigger-idx="${tIdx}" style="flex: 1;">
          <option value="turn_start" ${
            trigger.on === "turn_start" ? "selected" : ""
          }>Turn Start</option>
          <option value="turn_end" ${
            trigger.on === "turn_end" ? "selected" : ""
          }>Turn End</option>
          <option value="on_attack" ${
            trigger.on === "on_attack" ? "selected" : ""
          }>On Attack</option>
          <option value="on_damaged" ${
            trigger.on === "on_damaged" ? "selected" : ""
          }>On Damaged</option>
          <option value="on_expired" ${
            trigger.on === "on_expired" ? "selected" : ""
          }>On Expired</option>
        </select>
        <button class="btn-secondary" style="padding: 0.1rem 0.3rem; font-size: 0.7rem; margin-left: 0.25rem;" onclick="window.itemEffectFormRemoveTrigger(${tIdx})">✕</button>
      </div>
      <div style="margin-left: 0.5rem;">
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.25rem;">
          <span style="font-size: 0.8rem; font-weight: 600;">Actions:</span>
          <button class="btn-secondary" style="padding: 0.1rem 0.3rem; font-size: 0.7rem;" onclick="window.itemEffectFormAddAction(${tIdx})">+ Add</button>
        </div>
        ${
          trigger.actions.length === 0
            ? '<p style="color: var(--text-secondary); font-size: 0.75rem;">No actions</p>'
            : trigger.actions
                .map(
                  (action, aIdx) => `
          <div style="display: flex; gap: 0.25rem; align-items: center; margin-bottom: 0.25rem; padding: 0.25rem; background: var(--bg-panel-light); border-radius: 3px;">
            <select class="item-action-type-select" data-trigger-idx="${tIdx}" data-action-idx="${aIdx}" style="width: 100px;">
              <option value="damage" ${
                action.type === "damage" ? "selected" : ""
              }>Damage</option>
              <option value="heal" ${
                action.type === "heal" ? "selected" : ""
              }>Heal</option>
              <option value="modify_stat" ${
                action.type === "modify_stat" ? "selected" : ""
              }>Modify Stat</option>
              <option value="message" ${
                action.type === "message" ? "selected" : ""
              }>Message</option>
              <option value="custom" ${
                action.type === "custom" ? "selected" : ""
              }>Custom</option>
            </select>
            ${renderItemActionFields(action, tIdx, aIdx)}
            <button class="btn-secondary" style="padding: 0.1rem 0.3rem; font-size: 0.7rem;" onclick="window.itemEffectFormRemoveAction(${tIdx}, ${aIdx})">✕</button>
          </div>
        `
                )
                .join("")
        }
      </div>
    </div>
  `
    )
    .join("");

  // Add event listeners
  container.querySelectorAll(".item-trigger-type-select").forEach((el) => {
    el.addEventListener("change", (e) => {
      const select = e.target as HTMLSelectElement;
      const tIdx = parseInt(select.dataset.triggerIdx || "0");
      itemEffectFormTriggers[tIdx].on = select.value as EffectTrigger;
    });
  });

  container.querySelectorAll(".item-action-type-select").forEach((el) => {
    el.addEventListener("change", (e) => {
      const select = e.target as HTMLSelectElement;
      const tIdx = parseInt(select.dataset.triggerIdx || "0");
      const aIdx = parseInt(select.dataset.actionIdx || "0");
      itemEffectFormTriggers[tIdx].actions[aIdx] = createDefaultAction(
        select.value
      );
      renderItemEffectTriggersUI();
    });
  });

  container.querySelectorAll(".item-action-field").forEach((el) => {
    el.addEventListener("change", (e) => {
      const input = e.target as HTMLInputElement | HTMLSelectElement;
      const tIdx = parseInt(input.dataset.triggerIdx || "0");
      const aIdx = parseInt(input.dataset.actionIdx || "0");
      const field = input.dataset.field || "";
      updateItemActionField(tIdx, aIdx, field, input.value);
    });
  });
}

function renderItemActionFields(
  action: EffectAction,
  tIdx: number,
  aIdx: number
): string {
  switch (action.type) {
    case "damage":
    case "heal":
      return `<input type="number" class="item-action-field" data-trigger-idx="${tIdx}" data-action-idx="${aIdx}" data-field="amount" value="${action.amount}" style="width: 60px;">`;
    case "modify_stat":
      return `
        <select class="item-action-field" data-trigger-idx="${tIdx}" data-action-idx="${aIdx}" data-field="stat" style="width: 70px;">
          <option value="attack" ${
            action.stat === "attack" ? "selected" : ""
          }>Attack</option>
          <option value="defense" ${
            action.stat === "defense" ? "selected" : ""
          }>Defense</option>
          <option value="speed" ${
            action.stat === "speed" ? "selected" : ""
          }>Speed</option>
        </select>
        <select class="item-action-field" data-trigger-idx="${tIdx}" data-action-idx="${aIdx}" data-field="operation" style="width: 70px;">
          <option value="add" ${
            action.operation === "add" ? "selected" : ""
          }>Add</option>
          <option value="multiply" ${
            action.operation === "multiply" ? "selected" : ""
          }>Multiply</option>
        </select>
        <input type="number" class="item-action-field" data-trigger-idx="${tIdx}" data-action-idx="${aIdx}" data-field="value" value="${
        action.value
      }" step="0.1" style="width: 50px;">
      `;
    case "message":
      return `<input type="text" class="item-action-field" data-trigger-idx="${tIdx}" data-action-idx="${aIdx}" data-field="text" value="${action.text}" placeholder="Message" style="flex: 1;">`;
    case "custom":
      return `<input type="text" class="item-action-field" data-trigger-idx="${tIdx}" data-action-idx="${aIdx}" data-field="prompt" value="${action.prompt}" placeholder="Custom prompt" style="flex: 1;">`;
    default:
      return "";
  }
}

function updateItemActionField(
  tIdx: number,
  aIdx: number,
  field: string,
  value: string
): void {
  const action = itemEffectFormTriggers[tIdx].actions[aIdx];
  switch (action.type) {
    case "damage":
    case "heal":
      if (field === "amount") (action as any).amount = parseInt(value);
      break;
    case "modify_stat":
      if (field === "stat") (action as any).stat = value;
      if (field === "operation") (action as any).operation = value;
      if (field === "value") (action as any).value = parseFloat(value);
      break;
    case "message":
      if (field === "text") (action as any).text = value;
      break;
    case "custom":
      if (field === "prompt") (action as any).prompt = value;
      break;
  }
}

(window as any).itemEffectFormRemoveTrigger = (tIdx: number) => {
  itemEffectFormTriggers.splice(tIdx, 1);
  renderItemEffectTriggersUI();
};

(window as any).itemEffectFormAddAction = (tIdx: number) => {
  itemEffectFormTriggers[tIdx].actions.push({ type: "damage", amount: 1 });
  renderItemEffectTriggersUI();
};

(window as any).itemEffectFormRemoveAction = (tIdx: number, aIdx: number) => {
  itemEffectFormTriggers[tIdx].actions.splice(aIdx, 1);
  renderItemEffectTriggersUI();
};

function setupItemForm(): void {
  const itemTypeSelect = document.getElementById(
    "item-type"
  ) as HTMLSelectElement;
  const damageGroup = document.getElementById("damage-group");
  const armorGroup = document.getElementById("armor-group");
  const useEffectGroup = document.getElementById("use-effect-group");

  const useEffectTypeSelect = document.getElementById(
    "item-use-effect-type"
  ) as HTMLSelectElement;
  const useEffectHealGroup = document.getElementById("use-effect-heal-group");
  const useEffectDamageGroup = document.getElementById(
    "use-effect-damage-group"
  );
  const useEffectModifyStatGroup = document.getElementById(
    "use-effect-modify-stat-group"
  );
  const useEffectMessageGroup = document.getElementById(
    "use-effect-message-group"
  );
  const useEffectApplyGroup = document.getElementById("use-effect-apply-group");

  const showUseEffectFields = (effectType: string) => {
    if (useEffectHealGroup)
      useEffectHealGroup.style.display = effectType === "heal" ? "" : "none";
    if (useEffectDamageGroup)
      useEffectDamageGroup.style.display =
        effectType === "damage" ? "" : "none";
    if (useEffectModifyStatGroup)
      useEffectModifyStatGroup.style.display =
        effectType === "modify_stat" ? "" : "none";
    if (useEffectMessageGroup)
      useEffectMessageGroup.style.display =
        effectType === "message" ? "" : "none";
    if (useEffectApplyGroup)
      useEffectApplyGroup.style.display =
        effectType === "apply_effect" ? "" : "none";
  };

  itemTypeSelect?.addEventListener("change", () => {
    const type = itemTypeSelect.value;
    if (damageGroup)
      damageGroup.style.display = type === "weapon" ? "" : "none";
    if (armorGroup)
      armorGroup.style.display = type === "clothing" ? "" : "none";
    if (useEffectGroup)
      useEffectGroup.style.display = type === "consumable" ? "" : "none";
  });

  useEffectTypeSelect?.addEventListener("change", () => {
    showUseEffectFields(useEffectTypeSelect.value);
  });

  // Add trigger button for apply_effect
  const itemAddTriggerBtn = document.getElementById("item-add-trigger-btn");
  itemAddTriggerBtn?.addEventListener("click", () => {
    itemEffectFormTriggers.push({ on: "turn_start", actions: [] });
    renderItemEffectTriggersUI();
  });

  // Initialize trigger UI when apply_effect is selected
  useEffectTypeSelect?.addEventListener("change", () => {
    if (useEffectTypeSelect.value === "apply_effect") {
      itemEffectFormTriggers = [];
      renderItemEffectTriggersUI();
    }
  });

  const itemFormPanel = document.getElementById("item-form-panel");
  const cancelItemBtn = document.getElementById("cancel-item-btn");
  const saveItemBtn = document.getElementById("save-item-btn");

  saveItemBtn?.addEventListener("click", () => {
    const name = (document.getElementById("item-name") as HTMLInputElement)
      .value;
    const type = (document.getElementById("item-type") as HTMLSelectElement)
      .value;
    const damage = parseInt(
      (document.getElementById("item-damage") as HTMLInputElement).value
    );
    const armor = parseInt(
      (document.getElementById("item-armor") as HTMLInputElement).value
    );

    if (!name) return;

    let useEffect: EffectAction | undefined;
    if (type === "consumable") {
      const effectType = useEffectTypeSelect?.value || "heal";

      switch (effectType) {
        case "heal":
          useEffect = {
            type: "heal",
            amount: parseInt(
              (document.getElementById("item-use-heal") as HTMLInputElement)
                .value
            ),
          };
          break;
        case "damage":
          useEffect = {
            type: "damage",
            amount: parseInt(
              (document.getElementById("item-use-damage") as HTMLInputElement)
                .value
            ),
          };
          break;
        case "modify_stat":
          useEffect = {
            type: "modify_stat",
            stat: (
              document.getElementById("item-use-stat") as HTMLSelectElement
            ).value as "attack" | "defense" | "speed",
            operation: (
              document.getElementById("item-use-operation") as HTMLSelectElement
            ).value as "add" | "multiply",
            value: parseFloat(
              (document.getElementById("item-use-value") as HTMLInputElement)
                .value
            ),
          };
          break;
        case "message":
          useEffect = {
            type: "message",
            text: (
              document.getElementById("item-use-message") as HTMLInputElement
            ).value,
          };
          break;
        case "apply_effect":
          const effectName = (
            document.getElementById("item-effect-name") as HTMLInputElement
          ).value;
          const effectDuration = parseInt(
            (
              document.getElementById(
                "item-effect-duration"
              ) as HTMLInputElement
            ).value
          );
          const preventsMovement = (
            document.getElementById(
              "item-effect-prevents-movement"
            ) as HTMLInputElement
          ).checked;

          if (itemEffectFormTriggers.length === 0) {
            alert("Add at least one trigger to the effect");
            return;
          }

          const effect: Effect = {
            id: createId(),
            name: effectName || "Effect",
            duration: effectDuration,
            preventsMovement: preventsMovement || undefined,
            triggers: itemEffectFormTriggers.map((t) => ({
              on: t.on,
              actions: [...t.actions],
            })),
          };
          useEffect = { type: "apply_effect", effect };
          itemEffectFormTriggers = [];
          break;
      }
    }

    const item = createItem({
      name,
      type: type as any,
      damage: type === "weapon" ? damage : undefined,
      armor: type === "clothing" ? armor : undefined,
      useEffect,
    });

    if (editingItemLocation) {
      // Edit mode - update existing item
      const { x, y, idx, location } = editingItemLocation;
      const tile = editorState.tiles[y][x];

      if (location === "ground") {
        tile.items[idx] = { ...item };
      } else if (location === "chest" && tile.feature?.type === "chest") {
        tile.feature.contents[idx] = { ...item };
      }

      updateEditorCanvas();
      updatePropertiesPanel(x, y);
      saveState();
      editingItemLocation = null;
      pendingAddPosition = null;
    } else {
      // Create mode
      createdItems.push(item);

      if (pendingAddPosition) {
        const tile =
          editorState.tiles[pendingAddPosition.y][pendingAddPosition.x];
        const chest = tile.feature?.type === "chest" ? tile.feature : null;

        if (chest) {
          chest.contents.push({ ...item });
        } else {
          tile.items.push({ ...item });
        }

        updateEditorCanvas();
        updatePropertiesPanel(pendingAddPosition.x, pendingAddPosition.y);
        saveState();
        pendingAddPosition = null;
      }
    }

    (document.getElementById("item-name") as HTMLInputElement).value = "";
    const saveBtn = document.getElementById("save-item-btn");
    if (saveBtn) saveBtn.textContent = "Create Item";
    if (itemFormPanel) itemFormPanel.style.display = "none";
  });

  cancelItemBtn?.addEventListener("click", () => {
    pendingAddPosition = null;
    editingItemLocation = null;
    const saveBtn = document.getElementById("save-item-btn");
    if (saveBtn) saveBtn.textContent = "Create Item";
    if (itemFormPanel) itemFormPanel.style.display = "none";
  });
}

let charFormInventory: Item[] = [];
let charFormEffects: Effect[] = [];
let charFormEquippedWeaponId: string | null = null;
let charFormEquippedClothingId: string | null = null;

function resetCharacterForm(): void {
  charFormInventory = [];
  charFormEffects = [];
  charFormEquippedWeaponId = null;
  charFormEquippedClothingId = null;
  effectFormTriggers = [];
  updateCharFormInventoryUI();
  updateCharFormEffectsUI();
  updateCharFormEquipmentDropdowns();
  (document.getElementById("char-name") as HTMLInputElement).value = "";
  (document.getElementById("char-hp") as HTMLInputElement).value = "20";
  (
    document.getElementById("char-reasoning-effort") as HTMLSelectElement
  ).value = "medium";
  (document.getElementById("char-prompt") as HTMLTextAreaElement).value = "";
  const effectForm = document.getElementById("char-effect-form");
  if (effectForm) effectForm.style.display = "none";
}

function updateCharFormInventoryUI(): void {
  const list = document.getElementById("char-inventory-list");
  if (!list) return;

  if (charFormInventory.length === 0) {
    list.innerHTML =
      '<p style="color: var(--text-secondary); font-size: 0.8rem;">No items</p>';
  } else {
    list.innerHTML = charFormInventory
      .map(
        (item, idx) => `
      <div style="display: flex; justify-content: space-between; align-items: center; margin: 0.25rem 0;">
        <span style="font-size: 0.85rem;">• ${item.name} <span style="color: var(--text-secondary);">(${item.type})</span></span>
        <button class="btn-secondary" style="padding: 0.1rem 0.3rem; font-size: 0.7rem;" onclick="window.charFormRemoveItem(${idx})">✕</button>
      </div>
    `
      )
      .join("");
  }
}

function updateCharFormEffectsUI(): void {
  const list = document.getElementById("char-effects-list");
  if (!list) return;

  if (charFormEffects.length === 0) {
    list.innerHTML =
      '<p style="color: var(--text-secondary); font-size: 0.8rem;">No effects</p>';
  } else {
    list.innerHTML = charFormEffects
      .map(
        (effect, idx) => `
      <div style="display: flex; justify-content: space-between; align-items: center; margin: 0.25rem 0;">
        <span style="font-size: 0.85rem;">• ${effect.name} <span style="color: var(--text-secondary);">(${effect.duration} turns)</span></span>
        <button class="btn-secondary" style="padding: 0.1rem 0.3rem; font-size: 0.7rem;" onclick="window.charFormRemoveEffect(${idx})">✕</button>
      </div>
    `
      )
      .join("");
  }
}

function updateCharFormEquipmentDropdowns(): void {
  const weaponSelect = document.getElementById(
    "char-equipped-weapon"
  ) as HTMLSelectElement;
  const clothingSelect = document.getElementById(
    "char-equipped-clothing"
  ) as HTMLSelectElement;

  if (weaponSelect) {
    const weapons = charFormInventory.filter((i) => i.type === "weapon");
    weaponSelect.innerHTML = '<option value="">None</option>';
    weapons.forEach((w) => {
      weaponSelect.innerHTML += `<option value="${w.id}" ${
        charFormEquippedWeaponId === w.id ? "selected" : ""
      }>${w.name}</option>`;
    });
  }

  if (clothingSelect) {
    const clothing = charFormInventory.filter((i) => i.type === "clothing");
    clothingSelect.innerHTML = '<option value="">None</option>';
    clothing.forEach((c) => {
      clothingSelect.innerHTML += `<option value="${c.id}" ${
        charFormEquippedClothingId === c.id ? "selected" : ""
      }>${c.name}</option>`;
    });
  }
}

function populateCharAddItemDropdown(): void {
  const select = document.getElementById(
    "char-add-item-select"
  ) as HTMLSelectElement;
  if (!select) return;

  const allItems = getAllItems();
  select.innerHTML = allItems
    .map((i) => `<option value="${i.id}">${i.name} (${i.type})</option>`)
    .join("");
}

(window as any).charFormRemoveItem = (idx: number) => {
  const removed = charFormInventory.splice(idx, 1)[0];
  if (removed && charFormEquippedWeaponId === removed.id) {
    charFormEquippedWeaponId = null;
  }
  if (removed && charFormEquippedClothingId === removed.id) {
    charFormEquippedClothingId = null;
  }
  updateCharFormInventoryUI();
  updateCharFormEquipmentDropdowns();
};

(window as any).charFormRemoveEffect = (idx: number) => {
  charFormEffects.splice(idx, 1);
  updateCharFormEffectsUI();
};

// Effect form state for building triggers dynamically
type TriggerBuilder = {
  on: EffectTrigger;
  actions: EffectAction[];
};
let effectFormTriggers: TriggerBuilder[] = [];

function renderEffectTriggersUI(): void {
  const container = document.getElementById("char-effect-triggers-container");
  if (!container) return;

  if (effectFormTriggers.length === 0) {
    container.innerHTML =
      '<p style="color: var(--text-secondary); font-size: 0.8rem;">No triggers. Add at least one trigger.</p>';
    return;
  }

  container.innerHTML = effectFormTriggers
    .map(
      (trigger, tIdx) => `
    <div style="border: 1px solid var(--border-color); padding: 0.5rem; margin-bottom: 0.5rem; border-radius: 4px; background: var(--bg-panel);">
      <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.5rem;">
        <select class="trigger-type-select" data-trigger-idx="${tIdx}" style="flex: 1;">
          <option value="turn_start" ${
            trigger.on === "turn_start" ? "selected" : ""
          }>Turn Start</option>
          <option value="turn_end" ${
            trigger.on === "turn_end" ? "selected" : ""
          }>Turn End</option>
          <option value="on_attack" ${
            trigger.on === "on_attack" ? "selected" : ""
          }>On Attack</option>
          <option value="on_damaged" ${
            trigger.on === "on_damaged" ? "selected" : ""
          }>On Damaged</option>
          <option value="on_expired" ${
            trigger.on === "on_expired" ? "selected" : ""
          }>On Expired</option>
        </select>
        <button class="btn-secondary" style="padding: 0.1rem 0.3rem; font-size: 0.7rem; margin-left: 0.25rem;" onclick="window.effectFormRemoveTrigger(${tIdx})">✕</button>
      </div>
      <div style="margin-left: 0.5rem;">
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.25rem;">
          <span style="font-size: 0.8rem; font-weight: 600;">Actions:</span>
          <button class="btn-secondary" style="padding: 0.1rem 0.3rem; font-size: 0.7rem;" onclick="window.effectFormAddAction(${tIdx})">+ Add</button>
        </div>
        ${
          trigger.actions.length === 0
            ? '<p style="color: var(--text-secondary); font-size: 0.75rem;">No actions</p>'
            : trigger.actions
                .map(
                  (action, aIdx) => `
          <div style="display: flex; gap: 0.25rem; align-items: center; margin-bottom: 0.25rem; padding: 0.25rem; background: var(--bg-panel-light); border-radius: 3px;">
            <select class="action-type-select" data-trigger-idx="${tIdx}" data-action-idx="${aIdx}" style="width: 100px;">
              <option value="damage" ${
                action.type === "damage" ? "selected" : ""
              }>Damage</option>
              <option value="heal" ${
                action.type === "heal" ? "selected" : ""
              }>Heal</option>
              <option value="modify_stat" ${
                action.type === "modify_stat" ? "selected" : ""
              }>Modify Stat</option>
              <option value="message" ${
                action.type === "message" ? "selected" : ""
              }>Message</option>
              <option value="custom" ${
                action.type === "custom" ? "selected" : ""
              }>Custom</option>
            </select>
            ${renderActionFields(action, tIdx, aIdx)}
            <button class="btn-secondary" style="padding: 0.1rem 0.3rem; font-size: 0.7rem;" onclick="window.effectFormRemoveAction(${tIdx}, ${aIdx})">✕</button>
          </div>
        `
                )
                .join("")
        }
      </div>
    </div>
  `
    )
    .join("");

  // Add event listeners for trigger type changes
  container.querySelectorAll(".trigger-type-select").forEach((el) => {
    el.addEventListener("change", (e) => {
      const select = e.target as HTMLSelectElement;
      const tIdx = parseInt(select.dataset.triggerIdx || "0");
      effectFormTriggers[tIdx].on = select.value as EffectTrigger;
    });
  });

  // Add event listeners for action type changes
  container.querySelectorAll(".action-type-select").forEach((el) => {
    el.addEventListener("change", (e) => {
      const select = e.target as HTMLSelectElement;
      const tIdx = parseInt(select.dataset.triggerIdx || "0");
      const aIdx = parseInt(select.dataset.actionIdx || "0");
      const newType = select.value;
      // Create new action with default values for the new type
      effectFormTriggers[tIdx].actions[aIdx] = createDefaultAction(newType);
      renderEffectTriggersUI();
    });
  });

  // Add event listeners for action value changes
  container.querySelectorAll(".action-field").forEach((el) => {
    el.addEventListener("change", (e) => {
      const input = e.target as HTMLInputElement | HTMLSelectElement;
      const tIdx = parseInt(input.dataset.triggerIdx || "0");
      const aIdx = parseInt(input.dataset.actionIdx || "0");
      const field = input.dataset.field || "";
      updateActionField(tIdx, aIdx, field, input.value);
    });
  });
}

function renderActionFields(
  action: EffectAction,
  tIdx: number,
  aIdx: number
): string {
  switch (action.type) {
    case "damage":
    case "heal":
      return `<input type="number" class="action-field" data-trigger-idx="${tIdx}" data-action-idx="${aIdx}" data-field="amount" value="${action.amount}" style="width: 60px;">`;
    case "modify_stat":
      return `
        <select class="action-field" data-trigger-idx="${tIdx}" data-action-idx="${aIdx}" data-field="stat" style="width: 70px;">
          <option value="attack" ${
            action.stat === "attack" ? "selected" : ""
          }>Attack</option>
          <option value="defense" ${
            action.stat === "defense" ? "selected" : ""
          }>Defense</option>
          <option value="speed" ${
            action.stat === "speed" ? "selected" : ""
          }>Speed</option>
        </select>
        <select class="action-field" data-trigger-idx="${tIdx}" data-action-idx="${aIdx}" data-field="operation" style="width: 70px;">
          <option value="add" ${
            action.operation === "add" ? "selected" : ""
          }>Add</option>
          <option value="multiply" ${
            action.operation === "multiply" ? "selected" : ""
          }>Multiply</option>
        </select>
        <input type="number" class="action-field" data-trigger-idx="${tIdx}" data-action-idx="${aIdx}" data-field="value" value="${
        action.value
      }" step="0.1" style="width: 50px;">
      `;
    case "message":
      return `<input type="text" class="action-field" data-trigger-idx="${tIdx}" data-action-idx="${aIdx}" data-field="text" value="${action.text}" placeholder="Message" style="flex: 1;">`;
    case "custom":
      return `<input type="text" class="action-field" data-trigger-idx="${tIdx}" data-action-idx="${aIdx}" data-field="prompt" value="${action.prompt}" placeholder="Custom prompt" style="flex: 1;">`;
    default:
      return "";
  }
}

function createDefaultAction(type: string): EffectAction {
  switch (type) {
    case "heal":
      return { type: "heal", amount: 5 };
    case "damage":
      return { type: "damage", amount: 5 };
    case "modify_stat":
      return {
        type: "modify_stat",
        stat: "attack",
        operation: "multiply",
        value: 0.5,
      };
    case "message":
      return { type: "message", text: "" };
    case "custom":
      return { type: "custom", prompt: "" };
    default:
      return { type: "damage", amount: 1 };
  }
}

function updateActionField(
  tIdx: number,
  aIdx: number,
  field: string,
  value: string
): void {
  const action = effectFormTriggers[tIdx].actions[aIdx];
  switch (action.type) {
    case "damage":
    case "heal":
      if (field === "amount") (action as any).amount = parseInt(value);
      break;
    case "modify_stat":
      if (field === "stat") (action as any).stat = value;
      if (field === "operation") (action as any).operation = value;
      if (field === "value") (action as any).value = parseFloat(value);
      break;
    case "message":
      if (field === "text") (action as any).text = value;
      break;
    case "custom":
      if (field === "prompt") (action as any).prompt = value;
      break;
  }
}

(window as any).effectFormRemoveTrigger = (tIdx: number) => {
  effectFormTriggers.splice(tIdx, 1);
  renderEffectTriggersUI();
};

(window as any).effectFormAddAction = (tIdx: number) => {
  effectFormTriggers[tIdx].actions.push({ type: "damage", amount: 1 });
  renderEffectTriggersUI();
};

(window as any).effectFormRemoveAction = (tIdx: number, aIdx: number) => {
  effectFormTriggers[tIdx].actions.splice(aIdx, 1);
  renderEffectTriggersUI();
};

function setupCharacterForm(): void {
  // Populate AI model dropdown
  const modelSelect = document.getElementById(
    "char-model"
  ) as HTMLSelectElement;
  if (modelSelect) {
    modelSelect.innerHTML = "";
    for (const model of AI_MODELS) {
      const option = document.createElement("option");
      option.value = model;
      option.textContent = model;
      modelSelect.appendChild(option);
    }
  }

  const charFormPanel = document.getElementById("character-form-panel");
  const cancelCharBtn = document.getElementById("cancel-char-btn");
  const saveCharBtn = document.getElementById("save-char-btn");
  const addItemBtn = document.getElementById("char-add-item-btn");
  const addEffectBtn = document.getElementById("char-add-effect-btn");
  const effectForm = document.getElementById("char-effect-form");
  const saveEffectBtn = document.getElementById("char-save-effect-btn");
  const cancelEffectBtn = document.getElementById("char-cancel-effect-btn");
  const addTriggerBtn = document.getElementById("char-add-trigger-btn");

  addItemBtn?.addEventListener("click", () => {
    const select = document.getElementById(
      "char-add-item-select"
    ) as HTMLSelectElement;
    const itemId = select?.value;
    if (!itemId) return;

    const allItems = getAllItems();
    const item = allItems.find((i) => i.id === itemId);
    if (item) {
      charFormInventory.push({ ...item, id: createId() });
      updateCharFormInventoryUI();
      updateCharFormEquipmentDropdowns();
    }
  });

  addEffectBtn?.addEventListener("click", () => {
    // Reset effect form state
    effectFormTriggers = [];
    (document.getElementById("char-effect-name") as HTMLInputElement).value =
      "";
    (
      document.getElementById("char-effect-duration") as HTMLInputElement
    ).value = "3";
    (
      document.getElementById(
        "char-effect-prevents-movement"
      ) as HTMLInputElement
    ).checked = false;
    renderEffectTriggersUI();
    if (effectForm) effectForm.style.display = "";
  });

  addTriggerBtn?.addEventListener("click", () => {
    effectFormTriggers.push({ on: "turn_start", actions: [] });
    renderEffectTriggersUI();
  });

  cancelEffectBtn?.addEventListener("click", () => {
    effectFormTriggers = [];
    if (effectForm) effectForm.style.display = "none";
  });

  saveEffectBtn?.addEventListener("click", () => {
    const effectName = (
      document.getElementById("char-effect-name") as HTMLInputElement
    ).value;
    const duration = parseInt(
      (document.getElementById("char-effect-duration") as HTMLInputElement)
        .value
    );
    const preventsMovement = (
      document.getElementById(
        "char-effect-prevents-movement"
      ) as HTMLInputElement
    ).checked;

    if (effectFormTriggers.length === 0) {
      alert("Add at least one trigger to the effect");
      return;
    }

    const effect: Effect = {
      id: createId(),
      name: effectName || "Effect",
      duration,
      preventsMovement: preventsMovement || undefined,
      triggers: effectFormTriggers.map((t) => ({
        on: t.on,
        actions: [...t.actions],
      })),
    };

    charFormEffects.push(effect);
    updateCharFormEffectsUI();

    // Clear and hide effect form
    effectFormTriggers = [];
    (document.getElementById("char-effect-name") as HTMLInputElement).value =
      "";
    if (effectForm) effectForm.style.display = "none";
  });

  cancelCharBtn?.addEventListener("click", () => {
    pendingAddPosition = null;
    editingCharacterId = null;
    resetCharacterForm();
    const saveBtn = document.getElementById("save-char-btn");
    if (saveBtn) saveBtn.textContent = "Create Character";
    if (charFormPanel) charFormPanel.style.display = "none";
  });

  const weaponSelect = document.getElementById(
    "char-equipped-weapon"
  ) as HTMLSelectElement;
  const clothingSelect = document.getElementById(
    "char-equipped-clothing"
  ) as HTMLSelectElement;

  weaponSelect?.addEventListener("change", () => {
    charFormEquippedWeaponId = weaponSelect.value || null;
  });

  clothingSelect?.addEventListener("change", () => {
    charFormEquippedClothingId = clothingSelect.value || null;
  });

  saveCharBtn?.addEventListener("click", () => {
    const name = (document.getElementById("char-name") as HTMLInputElement)
      .value;
    const gender = (document.getElementById("char-gender") as HTMLSelectElement)
      .value as "male" | "female";
    const hp = parseInt(
      (document.getElementById("char-hp") as HTMLInputElement).value
    );
    const model = (document.getElementById("char-model") as HTMLSelectElement)
      .value;
    const reasoningEffort = (
      document.getElementById("char-reasoning-effort") as HTMLSelectElement
    ).value as "none" | "low" | "medium" | "high";
    const prompt = (
      document.getElementById("char-prompt") as HTMLTextAreaElement
    ).value;

    if (!name) return;

    // Find equipped items
    const equippedWeapon = charFormInventory.find(
      (i) => i.id === charFormEquippedWeaponId
    );
    const equippedClothing = charFormInventory.find(
      (i) => i.id === charFormEquippedClothingId
    );

    if (editingCharacterId) {
      // Edit mode - update existing character
      const charIdx = editorState.characters.findIndex(
        (c) => c.id === editingCharacterId
      );
      if (charIdx !== -1) {
        const existingChar = editorState.characters[charIdx];
        existingChar.name = name;
        existingChar.gender = gender;
        existingChar.maxHp = hp;
        existingChar.hp = Math.min(existingChar.hp, hp);
        existingChar.aiModel = model as any;
        existingChar.reasoningEffort = reasoningEffort;
        existingChar.personalityPrompt = prompt;
        existingChar.inventory = [...charFormInventory];
        existingChar.equippedWeapon = equippedWeapon
          ? { ...equippedWeapon }
          : undefined;
        existingChar.equippedClothing = equippedClothing
          ? { ...equippedClothing }
          : undefined;
        existingChar.effects = charFormEffects.map((e) => ({
          ...e,
          triggers: e.triggers.map((t) => ({ ...t, actions: [...t.actions] })),
        }));

        updateEditorCanvas();
        updatePropertiesPanel(existingChar.position.x, existingChar.position.y);
        saveState();
      }

      editingCharacterId = null;
      pendingAddPosition = null;
      resetCharacterForm();
      const saveBtn = document.getElementById("save-char-btn");
      if (saveBtn) saveBtn.textContent = "Create Character";
      if (charFormPanel) charFormPanel.style.display = "none";
    } else if (pendingAddPosition) {
      // Create mode
      const char = createCharacter({
        name,
        gender,
        x: pendingAddPosition.x,
        y: pendingAddPosition.y,
        hp,
        personalityPrompt: prompt,
        aiModel: model as string,
        aiModelReasoningEffort: reasoningEffort,
        inventory: [...charFormInventory],
        equippedWeapon: equippedWeapon ? { ...equippedWeapon } : undefined,
        equippedClothing: equippedClothing
          ? { ...equippedClothing }
          : undefined,
        effects: [...charFormEffects],
      });
      editorState.characters.push(char);
      editorState.selectedPosition = { ...pendingAddPosition };

      updateEditorCanvas();
      updatePropertiesPanel(pendingAddPosition.x, pendingAddPosition.y);
      saveState();

      pendingAddPosition = null;
      resetCharacterForm();
      if (charFormPanel) charFormPanel.style.display = "none";
    } else {
      editorState.selectedCharacter = {
        name,
        maxHp: hp,
        hp,
        aiModel: model as any,
        personalityPrompt: prompt,
      };
      resetCharacterForm();
      if (charFormPanel) charFormPanel.style.display = "none";
    }
  });

  // Initialize on first setup
  populateCharAddItemDropdown();
}

function setupActionButtons(): void {
  const exportBtn = document.getElementById("export-map-btn");
  const importBtn = document.getElementById("import-map-btn");
  const clearBtn = document.getElementById("clear-map-btn");
  const playBtn = document.getElementById("play-map-btn");

  exportBtn?.addEventListener("click", () => {
    const json = exportWorldAsJson(editorState);
    navigator.clipboard.writeText(json);
    alert("Map JSON copied to clipboard!");
  });

  importBtn?.addEventListener("click", () => {
    // Create a modal dialog with a textarea
    const modal = document.createElement("div");
    modal.style.cssText = `
      position: fixed; top: 0; left: 0; right: 0; bottom: 0;
      background: rgba(0,0,0,0.8); display: flex; align-items: center;
      justify-content: center; z-index: 10000;
    `;

    const dialog = document.createElement("div");
    dialog.style.cssText = `
      background: #1a1a25; padding: 20px; border-radius: 8px;
      border: 1px solid #2a2a3a; max-width: 600px; width: 90%;
    `;

    dialog.innerHTML = `
      <h3 style="margin: 0 0 10px 0; color: #e8e8f0;">Import Map JSON</h3>
      <textarea id="import-json-textarea" style="
        width: 100%; height: 300px; background: #12121a; color: #e8e8f0;
        border: 1px solid #2a2a3a; border-radius: 4px; padding: 10px;
        font-family: monospace; font-size: 12px; resize: vertical;
      " placeholder="Paste your map JSON here..."></textarea>
      <div style="margin-top: 10px; display: flex; gap: 10px; justify-content: flex-end;">
        <button id="import-cancel-btn" style="
          padding: 8px 16px; background: #2a2a3a; color: #e8e8f0;
          border: none; border-radius: 4px; cursor: pointer;
        ">Cancel</button>
        <button id="import-confirm-btn" style="
          padding: 8px 16px; background: #4488ff; color: white;
          border: none; border-radius: 4px; cursor: pointer;
        ">Import</button>
      </div>
    `;

    modal.appendChild(dialog);
    document.body.appendChild(modal);

    const textarea = document.getElementById(
      "import-json-textarea"
    ) as HTMLTextAreaElement;
    textarea?.focus();

    document
      .getElementById("import-cancel-btn")
      ?.addEventListener("click", () => {
        modal.remove();
      });

    document
      .getElementById("import-confirm-btn")
      ?.addEventListener("click", () => {
        const json = textarea?.value;
        if (json) {
          try {
            editorState = importWorldFromJson(json);
            updateEditorCanvas();
            saveState();
            modal.remove();
          } catch (e) {
            alert("Invalid JSON: " + (e as Error).message);
          }
        }
      });

    // Close on escape key
    modal.addEventListener("keydown", (e) => {
      if (e.key === "Escape") modal.remove();
    });

    // Close on backdrop click
    modal.addEventListener("click", (e) => {
      if (e.target === modal) modal.remove();
    });
  });

  clearBtn?.addEventListener("click", () => {
    if (confirm("Clear the entire map?")) {
      editorState = createDefaultEditorState();
      updateEditorCanvas();
      saveState();
    }
  });

  playBtn?.addEventListener("click", () => {
    // Store the editor world for game mode
    const world = editorStateToWorld(editorState);
    (window as any).customWorld = world;

    // Switch to game mode with custom map
    const mapSelect = document.getElementById(
      "map-select"
    ) as HTMLSelectElement;
    if (mapSelect) mapSelect.value = "custom";

    // Trigger game mode
    document.getElementById("game-mode-btn")?.click();

    // Dispatch change event to load custom map
    mapSelect?.dispatchEvent(new Event("change"));
  });
}

function updateEditorCanvas(): void {
  if (!editorCanvas || !editorCtx) return;

  // Resize canvas to fit map
  editorCanvas.width = editorState.width * TILE_SIZE;
  editorCanvas.height = editorState.height * TILE_SIZE;

  const ctx = editorCtx;

  // Draw tiles
  for (let y = 0; y < editorState.height; y++) {
    for (let x = 0; x < editorState.width; x++) {
      const tile = editorState.tiles[y][x];
      const px = x * TILE_SIZE;
      const py = y * TILE_SIZE;

      // Fill background
      ctx.fillStyle = TERRAIN_COLORS[tile.type];
      ctx.fillRect(px, py, TILE_SIZE, TILE_SIZE);

      // Draw terrain icon
      const icon = TERRAIN_ICONS[tile.type];
      if (icon) {
        ctx.fillStyle = "#ffffff44";
        ctx.font = "16px monospace";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(icon, px + TILE_SIZE / 2, py + TILE_SIZE / 2);
      }

      // Draw feature
      if (tile.feature) {
        ctx.fillStyle =
          tile.feature.type === "door"
            ? "#8B4513"
            : tile.feature.type === "chest"
            ? "#DAA520"
            : "#ff4444";
        ctx.fillRect(px + 4, py + 4, TILE_SIZE - 8, TILE_SIZE - 8);

        ctx.fillStyle = "#fff";
        ctx.font = "12px monospace";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        const featureIcon =
          tile.feature.type === "door"
            ? "D"
            : tile.feature.type === "chest"
            ? "C"
            : "^";
        ctx.fillText(featureIcon, px + TILE_SIZE / 2, py + TILE_SIZE / 2);

        // Show indicator if chest has contents
        if (tile.feature.type === "chest" && tile.feature.contents.length > 0) {
          ctx.fillStyle = "#00ff88";
          ctx.beginPath();
          ctx.arc(px + TILE_SIZE - 8, py + TILE_SIZE - 8, 5, 0, Math.PI * 2);
          ctx.fill();
          ctx.fillStyle = "#000";
          ctx.font = "bold 8px sans-serif";
          ctx.fillText(
            String(tile.feature.contents.length),
            px + TILE_SIZE - 8,
            py + TILE_SIZE - 7
          );
        }
      }

      // Draw items indicator
      if (tile.items.length > 0) {
        ctx.fillStyle = "#ffcc00";
        ctx.beginPath();
        ctx.arc(px + TILE_SIZE - 6, py + 6, 4, 0, Math.PI * 2);
        ctx.fill();
      }

      // Draw grid
      ctx.strokeStyle = "#ffffff22";
      ctx.strokeRect(px, py, TILE_SIZE, TILE_SIZE);
    }
  }

  // Draw characters
  for (const char of editorState.characters) {
    const px = char.position.x * TILE_SIZE;
    const py = char.position.y * TILE_SIZE;

    ctx.fillStyle = "#4488ff";
    ctx.beginPath();
    ctx.arc(
      px + TILE_SIZE / 2,
      py + TILE_SIZE / 2,
      TILE_SIZE / 3,
      0,
      Math.PI * 2
    );
    ctx.fill();

    ctx.fillStyle = "#fff";
    ctx.font = "bold 10px sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(char.name[0], px + TILE_SIZE / 2, py + TILE_SIZE / 2);
  }

  // Highlight selected position
  if (editorState.selectedPosition) {
    const { x, y } = editorState.selectedPosition;
    ctx.strokeStyle = "#ffcc00";
    ctx.lineWidth = 2;
    ctx.strokeRect(x * TILE_SIZE, y * TILE_SIZE, TILE_SIZE, TILE_SIZE);
    ctx.lineWidth = 1;
  }

  // Highlight source position when in move mode
  const currentMove = pendingMove;
  if (currentMove) {
    let sourceX: number | undefined;
    let sourceY: number | undefined;

    if (currentMove.type === "character") {
      const char = editorState.characters.find((c) => c.id === currentMove.id);
      if (char) {
        sourceX = char.position.x;
        sourceY = char.position.y;
      }
    } else {
      sourceX = currentMove.fromX;
      sourceY = currentMove.fromY;
    }

    if (sourceX !== undefined && sourceY !== undefined) {
      ctx.strokeStyle = "#00ff88";
      ctx.lineWidth = 3;
      ctx.setLineDash([4, 4]);
      ctx.strokeRect(
        sourceX * TILE_SIZE,
        sourceY * TILE_SIZE,
        TILE_SIZE,
        TILE_SIZE
      );
      ctx.setLineDash([]);
      ctx.lineWidth = 1;
    }
  }
}

// Global functions for onclick handlers
(window as any).editorRemoveFeature = (x: number, y: number) => {
  editorState.tiles[y][x].feature = undefined;
  updateEditorCanvas();
  updatePropertiesPanel(x, y);
  saveState();
};

(window as any).editorClearItems = (x: number, y: number) => {
  editorState.tiles[y][x].items = [];
  updateEditorCanvas();
  updatePropertiesPanel(x, y);
  saveState();
};

(window as any).editorRemoveItem = (x: number, y: number, idx: number) => {
  editorState.tiles[y][x].items.splice(idx, 1);
  updateEditorCanvas();
  updatePropertiesPanel(x, y);
  saveState();
};

(window as any).editorRemoveChestItem = (x: number, y: number, idx: number) => {
  const feature = editorState.tiles[y][x].feature;
  if (feature?.type === "chest") {
    feature.contents.splice(idx, 1);
    updateEditorCanvas();
    updatePropertiesPanel(x, y);
    saveState();
  }
};

(window as any).editorRemoveCharacter = (id: string) => {
  editorState.characters = editorState.characters.filter((c) => c.id !== id);
  updateEditorCanvas();
  saveState();
  const panel = document.getElementById("properties-content");
  if (panel)
    panel.innerHTML =
      '<p class="text-muted">Select a tile or entity to edit its properties.</p>';
};

// Move functions
(window as any).editorMoveCharacter = (id: string) => {
  pendingMove = { type: "character", id };
  const char = editorState.characters.find((c) => c.id === id);
  if (char) {
    updatePropertiesPanel(char.position.x, char.position.y);
  }
  updateEditorCanvas();
};

(window as any).editorMoveFeature = (x: number, y: number) => {
  pendingMove = { type: "feature", fromX: x, fromY: y };
  updatePropertiesPanel(x, y);
  updateEditorCanvas();
};

(window as any).editorMoveItem = (x: number, y: number, idx: number) => {
  pendingMove = { type: "item", fromX: x, fromY: y, index: idx };
  updatePropertiesPanel(x, y);
  updateEditorCanvas();
};

(window as any).editorMoveChestItem = (x: number, y: number, idx: number) => {
  pendingMove = { type: "chestItem", fromX: x, fromY: y, index: idx };
  updatePropertiesPanel(x, y);
  updateEditorCanvas();
};

(window as any).editorCancelMove = () => {
  const pos = editorState.selectedPosition;
  pendingMove = null;
  updateEditorCanvas();
  if (pos) {
    updatePropertiesPanel(pos.x, pos.y);
  }
};

(window as any).editorAddFeature = (
  x: number,
  y: number,
  featureType: "door" | "chest"
) => {
  if (featureType === "door") {
    editorState.tiles[y][x].feature = createDoorFeature({
      name: "Door",
      locked: false,
    });
  } else if (featureType === "chest") {
    editorState.tiles[y][x].feature = createChestFeature({
      name: "Chest",
      contents: [],
    });
  }
  editorState.selectedPosition = { x, y };
  updateEditorCanvas();
  updatePropertiesPanel(x, y);
  saveState();
};

(window as any).editorShowAddItem = (x: number, y: number) => {
  const panel = document.getElementById("properties-content");
  if (!panel) return;

  const allItems = getAllItems();
  let html = `<h4>Select Item to Add</h4>`;
  html += `<div style="display: flex; flex-direction: column; gap: 0.25rem; max-height: 200px; overflow-y: auto;">`;

  for (const item of allItems) {
    html += `<button class="btn-secondary" style="width: 100%; text-align: left;" onclick="window.editorAddItem(${x}, ${y}, '${item.id}')">`;
    html += `${item.name} <span style="color: var(--text-secondary); font-size: 0.75rem;">(${item.type})</span>`;
    html += `</button>`;
  }

  html += `</div>`;
  html += `<hr style="margin: 0.5rem 0; border-color: var(--border-color);">`;
  html += `<button class="btn-secondary" style="width: 100%;" onclick="window.editorShowNewItemForm(${x}, ${y})">+ Create New Item</button>`;
  html += `<button class="btn-secondary" style="width: 100%; margin-top: 0.25rem;" onclick="window.editorCancelAddItem(${x}, ${y})">Cancel</button>`;

  panel.innerHTML = html;
};

(window as any).editorAddItem = (x: number, y: number, itemId: string) => {
  const allItems = getAllItems();
  const item = allItems.find((i) => i.id === itemId);
  if (!item) return;

  const itemCopy = { ...item, id: createId() };
  const tile = editorState.tiles[y][x];
  const chest = tile.feature?.type === "chest" ? tile.feature : null;

  if (chest) {
    chest.contents.push(itemCopy);
  } else {
    tile.items.push(itemCopy);
  }

  updateEditorCanvas();
  updatePropertiesPanel(x, y);
  saveState();
};

(window as any).editorCancelAddItem = (x: number, y: number) => {
  updatePropertiesPanel(x, y);
};

(window as any).editorShowNewItemForm = (x: number, y: number) => {
  pendingAddPosition = { x, y };
  editingItemLocation = null;
  // Reset form to defaults
  (document.getElementById("item-name") as HTMLInputElement).value = "";
  (document.getElementById("item-type") as HTMLSelectElement).value = "weapon";
  (document.getElementById("item-damage") as HTMLInputElement).value = "5";
  (document.getElementById("item-armor") as HTMLInputElement).value = "2";
  const damageGroup = document.getElementById("damage-group");
  const armorGroup = document.getElementById("armor-group");
  const useEffectGroup = document.getElementById("use-effect-group");
  if (damageGroup) damageGroup.style.display = "";
  if (armorGroup) armorGroup.style.display = "none";
  if (useEffectGroup) useEffectGroup.style.display = "none";
  itemEffectFormTriggers = [];
  const saveBtn = document.getElementById("save-item-btn");
  if (saveBtn) saveBtn.textContent = "Create Item";
  const itemFormPanel = document.getElementById("item-form-panel");
  if (itemFormPanel) itemFormPanel.style.display = "";
};

(window as any).editorShowAddCharacter = (x: number, y: number) => {
  pendingAddPosition = { x, y };
  editingCharacterId = null;
  resetCharacterForm();
  populateCharAddItemDropdown();
  const charFormPanel = document.getElementById("character-form-panel");
  const saveBtn = document.getElementById("save-char-btn");
  if (saveBtn) saveBtn.textContent = "Create Character";
  if (charFormPanel) charFormPanel.style.display = "";
};

// Edit mode state
let editingItemLocation: {
  x: number;
  y: number;
  idx: number;
  location: "ground" | "chest";
} | null = null;
let editingCharacterId: string | null = null;

(window as any).editorEditItem = (
  x: number,
  y: number,
  idx: number,
  location: "ground" | "chest"
) => {
  const tile = editorState.tiles[y][x];
  let item: Item | undefined;

  if (location === "ground") {
    item = tile.items[idx];
  } else if (location === "chest" && tile.feature?.type === "chest") {
    item = tile.feature.contents[idx];
  }

  if (!item) return;

  editingItemLocation = { x, y, idx, location };
  pendingAddPosition = { x, y };

  // Populate item form with existing data
  (document.getElementById("item-name") as HTMLInputElement).value = item.name;
  (document.getElementById("item-type") as HTMLSelectElement).value = item.type;
  (document.getElementById("item-damage") as HTMLInputElement).value = String(
    item.damage || 5
  );
  (document.getElementById("item-armor") as HTMLInputElement).value = String(
    item.armor || 2
  );

  // Show/hide appropriate fields
  const damageGroup = document.getElementById("damage-group");
  const armorGroup = document.getElementById("armor-group");
  const useEffectGroup = document.getElementById("use-effect-group");
  if (damageGroup)
    damageGroup.style.display = item.type === "weapon" ? "" : "none";
  if (armorGroup)
    armorGroup.style.display = item.type === "clothing" ? "" : "none";
  if (useEffectGroup)
    useEffectGroup.style.display = item.type === "consumable" ? "" : "none";

  // Handle use effect
  if (item.type === "consumable" && item.useEffect) {
    const useEffectTypeSelect = document.getElementById(
      "item-use-effect-type"
    ) as HTMLSelectElement;
    useEffectTypeSelect.value = item.useEffect.type;

    // Show appropriate use effect fields
    const useEffectHealGroup = document.getElementById("use-effect-heal-group");
    const useEffectDamageGroup = document.getElementById(
      "use-effect-damage-group"
    );
    const useEffectModifyStatGroup = document.getElementById(
      "use-effect-modify-stat-group"
    );
    const useEffectMessageGroup = document.getElementById(
      "use-effect-message-group"
    );
    const useEffectApplyGroup = document.getElementById(
      "use-effect-apply-group"
    );

    if (useEffectHealGroup)
      useEffectHealGroup.style.display =
        item.useEffect.type === "heal" ? "" : "none";
    if (useEffectDamageGroup)
      useEffectDamageGroup.style.display =
        item.useEffect.type === "damage" ? "" : "none";
    if (useEffectModifyStatGroup)
      useEffectModifyStatGroup.style.display =
        item.useEffect.type === "modify_stat" ? "" : "none";
    if (useEffectMessageGroup)
      useEffectMessageGroup.style.display =
        item.useEffect.type === "message" ? "" : "none";
    if (useEffectApplyGroup)
      useEffectApplyGroup.style.display =
        item.useEffect.type === "apply_effect" ? "" : "none";

    // Fill in effect values
    if (item.useEffect.type === "heal") {
      (document.getElementById("item-use-heal") as HTMLInputElement).value =
        String(item.useEffect.amount);
    } else if (item.useEffect.type === "damage") {
      (document.getElementById("item-use-damage") as HTMLInputElement).value =
        String(item.useEffect.amount);
    } else if (item.useEffect.type === "message") {
      (document.getElementById("item-use-message") as HTMLInputElement).value =
        item.useEffect.text;
    } else if (item.useEffect.type === "apply_effect") {
      const effect = item.useEffect.effect;
      (document.getElementById("item-effect-name") as HTMLInputElement).value =
        effect.name;
      (
        document.getElementById("item-effect-duration") as HTMLInputElement
      ).value = String(effect.duration);
      (
        document.getElementById(
          "item-effect-prevents-movement"
        ) as HTMLInputElement
      ).checked = !!effect.preventsMovement;

      // Populate triggers
      itemEffectFormTriggers = effect.triggers.map((t) => ({
        on: t.on,
        actions: [...t.actions],
      }));
      renderItemEffectTriggersUI();
    }
  }

  const itemFormPanel = document.getElementById("item-form-panel");
  const saveBtn = document.getElementById("save-item-btn");
  if (saveBtn) saveBtn.textContent = "Save Item";
  if (itemFormPanel) itemFormPanel.style.display = "";
};

(window as any).editorEditCharacter = (id: string) => {
  const character = editorState.characters.find((c) => c.id === id);
  if (!character) return;

  editingCharacterId = id;
  pendingAddPosition = { x: character.position.x, y: character.position.y };

  // Populate form fields
  (document.getElementById("char-name") as HTMLInputElement).value =
    character.name;
  (document.getElementById("char-gender") as HTMLSelectElement).value =
    character.gender;
  (document.getElementById("char-hp") as HTMLInputElement).value = String(
    character.maxHp
  );
  (document.getElementById("char-model") as HTMLSelectElement).value =
    character.aiModel;
  (
    document.getElementById("char-reasoning-effort") as HTMLSelectElement
  ).value = character.reasoningEffort;
  (document.getElementById("char-prompt") as HTMLTextAreaElement).value =
    character.personalityPrompt;

  // Populate inventory
  charFormInventory = character.inventory.map((i) => ({ ...i }));
  charFormEquippedWeaponId = character.equippedWeapon?.id || null;
  charFormEquippedClothingId = character.equippedClothing?.id || null;
  charFormEffects = character.effects.map((e) => ({
    ...e,
    triggers: e.triggers.map((t) => ({ ...t, actions: [...t.actions] })),
  }));

  updateCharFormInventoryUI();
  updateCharFormEquipmentDropdowns();
  updateCharFormEffectsUI();
  populateCharAddItemDropdown();

  const charFormPanel = document.getElementById("character-form-panel");
  const saveBtn = document.getElementById("save-char-btn");
  if (saveBtn) saveBtn.textContent = "Save Character";
  if (charFormPanel) charFormPanel.style.display = "";
};

export function getCustomWorld() {
  // First check if there's a pre-set custom world (from Play Map button)
  if ((window as any).customWorld) {
    return (window as any).customWorld;
  }

  // Load editor state from storage if it hasn't been loaded yet
  // (check if it's still the default empty state)
  if (
    editorState.characters.length === 0 &&
    editorState.width === 20 &&
    editorState.height === 15
  ) {
    const savedState = loadEditorStateFromStorage();
    if (savedState) {
      editorState = savedState;
    }
  }

  // Generate from current editor state
  if (editorState && editorState.characters.length > 0) {
    return editorStateToWorld(editorState);
  }
  return null;
}

function getAllItems(): Item[] {
  return [
    { id: "sword", name: "Sword", type: "weapon", damage: 5 },
    { id: "shield", name: "Shield", type: "clothing", armor: 3 },
    {
      id: "potion",
      name: "Health Potion",
      type: "consumable",
      useEffect: { type: "heal", amount: 10 },
    },
    { id: "key", name: "Key", type: "key" },
    ...createdItems,
  ];
}
