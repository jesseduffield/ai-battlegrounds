import { createTownMap } from "./world-builder";
import {
  render,
  getCanvasSize,
  getTileFromPixel,
  addFloatingText,
  startMoveAnimation,
  updateAnimations,
  isAnimating,
  TILE_SIZE,
} from "./renderer";
import {
  executeAction,
  getCharacterKnowledge,
  getReachableTiles,
  getVisibleTiles,
} from "./engine";
import { getAgentDecision, initializeAgent } from "./agent";
import type { World, Character, GameEvent, Position } from "./types";

type WorldSnapshot = {
  turn: number;
  characterIndex: number;
  world: string;
  eventIndex: number;
};

type AgentDecisionLog = {
  turn: number;
  character: string;
  reasoning: string;
  fullPrompt: string;
  fullResponse: string;
  sequence: number;
};

type LogEntry =
  | { type: "event"; turn: number; description: string; sequence: number }
  | { type: "decision"; decision: AgentDecisionLog };

let logSequence = 0;

let world: World;
let canvas: HTMLCanvasElement;
let ctx: CanvasRenderingContext2D;
let currentCharacterIndex = 0;
let isProcessingTurn = false;
let autoPlayInterval: number | null = null;
let allEvents: GameEvent[] = [];
let allAgentDecisions: AgentDecisionLog[] = [];
let chronologicalLog: LogEntry[] = [];
let snapshots: WorldSnapshot[] = [];
let viewingSnapshot: WorldSnapshot | null = null;
let eventElements: Map<number, HTMLElement> = new Map();

function serializeWorld(w: World): string {
  const worldCopy = {
    ...w,
    characters: w.characters.map((c) => ({
      ...c,
      mapMemory: Array.from(c.mapMemory.entries()),
    })),
  };
  return JSON.stringify(worldCopy);
}

function deserializeWorld(str: string): World {
  const parsed = JSON.parse(str);
  return {
    ...parsed,
    characters: parsed.characters.map(
      (c: { mapMemory: [string, unknown][] }) => ({
        ...c,
        mapMemory: new Map(c.mapMemory),
      })
    ),
  };
}

function saveSnapshot(): void {
  snapshots.push({
    turn: world.turn,
    characterIndex: currentCharacterIndex,
    world: serializeWorld(world),
    eventIndex: allEvents.length,
  });
}

function getWorldForDisplay(): World {
  if (viewingSnapshot) {
    return deserializeWorld(viewingSnapshot.world);
  }
  return world;
}

function getAliveCharacters(w: World = world): Character[] {
  return w.characters.filter((c) => c.alive);
}

function getCurrentCharacter(): Character | null {
  const alive = getAliveCharacters();
  if (alive.length === 0) return null;
  return alive[currentCharacterIndex % alive.length];
}

function updateUI(): void {
  const displayWorld = getWorldForDisplay();
  const turnNumberEl = document.getElementById("turn-number");
  const currentActorEl = document.getElementById("current-actor");
  const characterPanelEl = document.getElementById("character-panel");

  if (turnNumberEl) {
    turnNumberEl.textContent = String(displayWorld.turn);
  }

  const aliveChars = getAliveCharacters(displayWorld);
  const currentIdx = viewingSnapshot
    ? viewingSnapshot.characterIndex
    : currentCharacterIndex;
  const current =
    aliveChars.length > 0 ? aliveChars[currentIdx % aliveChars.length] : null;

  if (currentActorEl) {
    currentActorEl.textContent = current?.name ?? "—";
  }

  if (characterPanelEl && current) {
    const hpPercent = current.hp / current.maxHp;
    const hpClass =
      hpPercent > 0.6 ? "hp-good" : hpPercent > 0.3 ? "hp-mid" : "hp-low";

    characterPanelEl.innerHTML = `
      <div class="character-name">${current.name}</div>
      <div class="stat-row">
        <span class="stat-label">HP</span>
        <span class="${hpClass}">${current.hp} / ${current.maxHp}</span>
      </div>
      <div class="stat-row">
        <span class="stat-label">Position</span>
        <span>(${current.position.x}, ${current.position.y})</span>
      </div>
      <div class="stat-row">
        <span class="stat-label">Weapon</span>
        <span>${current.equippedWeapon?.name ?? "None"}</span>
      </div>
      <div class="stat-row">
        <span class="stat-label">Inventory</span>
        <span>${current.inventory.length} items</span>
      </div>
    `;
  }

  const historyBanner = document.getElementById("history-banner");
  const historyTurn = document.getElementById("history-turn");
  if (historyBanner && historyTurn) {
    if (viewingSnapshot) {
      historyBanner.classList.add("visible");
      historyTurn.textContent = String(viewingSnapshot.turn);
    } else {
      historyBanner.classList.remove("visible");
    }
  }
}

function handleLogEntryClick(entry: HTMLElement): void {
  const snapIdx = parseInt(entry.dataset.snapshotIndex ?? "0");

  document
    .querySelectorAll(".log-entry.selected")
    .forEach((el) => el.classList.remove("selected"));
  entry.classList.add("selected");

  if (snapIdx >= snapshots.length - 1) {
    viewingSnapshot = null;
    renderWorld();
    updateUI();
  } else {
    viewSnapshot(snapIdx);
  }
}

function addLogEntry(event: GameEvent, snapshotIdx?: number): void {
  chronologicalLog.push({
    type: "event",
    turn: event.turn,
    description: event.description,
    sequence: logSequence++,
  });

  const eventLogEl = document.getElementById("event-log");
  if (!eventLogEl) return;

  const typeClass: Record<string, string> = {
    move: "log-action",
    search: "log-action",
    pickup: "log-item",
    drop: "log-item",
    equip: "log-item",
    attack: "log-combat",
    damage: "log-combat",
    death: "log-death",
    talk: "log-talk",
    miss: "log-combat",
  };

  const entry = document.createElement("div");
  entry.className = "log-entry";
  entry.dataset.eventIndex = String(allEvents.length - 1);
  entry.dataset.snapshotIndex = String(snapshotIdx ?? snapshots.length - 1);
  entry.innerHTML = `
    <div class="log-turn">Turn ${event.turn}</div>
    <div class="${typeClass[event.type] ?? ""}">${event.description}</div>
  `;

  entry.addEventListener("click", () => handleLogEntryClick(entry));

  eventElements.set(allEvents.length - 1, entry);
  eventLogEl.insertBefore(entry, eventLogEl.firstChild);

  while (eventLogEl.children.length > 100) {
    eventLogEl.removeChild(eventLogEl.lastChild!);
  }
}

function addReasoningEntry(
  character: Character,
  reasoning: string,
  fullPrompt?: string,
  fullResponse?: string
): void {
  if (fullPrompt && fullResponse) {
    const decision: AgentDecisionLog = {
      turn: world.turn,
      character: character.name,
      reasoning,
      fullPrompt,
      fullResponse,
      sequence: logSequence++,
    };
    allAgentDecisions.push(decision);
    chronologicalLog.push({ type: "decision", decision });
  }

  const eventLogEl = document.getElementById("event-log");
  if (!eventLogEl) return;

  const entry = document.createElement("div");
  entry.className = "log-entry";
  entry.dataset.snapshotIndex = String(snapshots.length - 1);

  const detailsId = `details-${Date.now()}`;
  const promptHtml =
    fullPrompt && fullResponse
      ? `
    <details style="margin-top: 8px; font-size: 11px;">
      <summary style="cursor: pointer; color: #666;">Show full prompt/response</summary>
      <div style="margin-top: 8px; padding: 8px; background: #1a1a2e; border-radius: 4px; white-space: pre-wrap; font-family: monospace; max-height: 300px; overflow-y: auto;">
        <div style="color: #6a6; margin-bottom: 8px;">PROMPT:</div>
        <div style="color: #aaa;">${escapeHtml(fullPrompt)}</div>
        <div style="color: #66a; margin-top: 12px; margin-bottom: 8px;">RESPONSE:</div>
        <div style="color: #aaa;">${escapeHtml(fullResponse)}</div>
      </div>
    </details>
  `
      : "";

  entry.innerHTML = `
    <div class="log-turn">Turn ${world.turn} — ${character.name}'s thinking</div>
    <div style="color: #888; font-style: italic;">"${reasoning}"</div>
    ${promptHtml}
  `;

  entry.addEventListener("click", (e) => {
    if (
      (e.target as HTMLElement).tagName !== "SUMMARY" &&
      !(e.target as HTMLElement).closest("details")
    ) {
      handleLogEntryClick(entry);
    }
  });

  eventLogEl.insertBefore(entry, eventLogEl.firstChild);
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function viewSnapshot(index: number): void {
  if (index >= 0 && index < snapshots.length) {
    viewingSnapshot = snapshots[index];
    renderWorld();
    updateUI();
    hideInspector();
  }
}

function returnToPresent(): void {
  viewingSnapshot = null;
  document
    .querySelectorAll(".log-entry.selected")
    .forEach((el) => el.classList.remove("selected"));
  renderWorld();
  updateUI();
  hideInspector();
}

let animationFrameId: number | null = null;

function startAnimationLoop(): void {
  if (animationFrameId !== null) return;

  const loop = () => {
    const hasAnimations = updateAnimations();
    renderWorld();

    if (hasAnimations) {
      animationFrameId = requestAnimationFrame(loop);
    } else {
      animationFrameId = null;
    }
  };

  animationFrameId = requestAnimationFrame(loop);
}

async function waitForAnimations(): Promise<void> {
  startAnimationLoop();

  return new Promise((resolve) => {
    const check = () => {
      if (!isAnimating()) {
        resolve();
      } else {
        requestAnimationFrame(check);
      }
    };
    requestAnimationFrame(check);
  });
}

function renderWorld(): void {
  const displayWorld = getWorldForDisplay();
  const aliveChars = getAliveCharacters(displayWorld);
  const currentIdx = viewingSnapshot
    ? viewingSnapshot.characterIndex
    : currentCharacterIndex;
  const current =
    aliveChars.length > 0
      ? aliveChars[currentIdx % aliveChars.length]
      : undefined;
  const reachable =
    current && !viewingSnapshot
      ? getReachableTiles(displayWorld, current)
      : undefined;
  const visible =
    current && !viewingSnapshot
      ? getVisibleTiles(displayWorld, current).tiles.map((t) => t.position)
      : undefined;
  render(ctx, displayWorld, current, reachable, visible);
}

function handleCanvasClick(event: MouseEvent): void {
  const rect = canvas.getBoundingClientRect();
  const x = event.clientX - rect.left;
  const y = event.clientY - rect.top;
  const tilePos = getTileFromPixel(x, y);

  const displayWorld = getWorldForDisplay();
  showInspector(displayWorld, tilePos);
}

function showInspector(w: World, pos: Position): void {
  const panel = document.getElementById("inspector-panel");
  const title = document.getElementById("inspector-title");
  const content = document.getElementById("inspector-content");

  if (!panel || !title || !content) return;

  const tile = w.tiles[pos.y]?.[pos.x];
  if (!tile) return;

  const character = w.characters.find(
    (c) => c.position.x === pos.x && c.position.y === pos.y
  );
  const room = w.rooms.find((r) => tile.roomId === r.id);

  let html = `<div class="stat-row"><span class="stat-label">Position</span><span>(${pos.x}, ${pos.y})</span></div>`;
  html += `<div class="stat-row"><span class="stat-label">Tile</span><span>${tile.type}</span></div>`;

  if (room) {
    html += `<div class="stat-row"><span class="stat-label">Room</span><span>${room.name}</span></div>`;
  }

  if (tile.items.length > 0) {
    html += `<div style="margin-top: 0.5rem; font-weight: 600;">Items:</div><div class="item-list">`;
    for (const item of tile.items) {
      html += `<div class="item-entry">• ${item.name} (${item.type})`;
      if (item.damage) html += ` [dmg: ${item.damage}]`;
      if (item.armor) html += ` [armor: ${item.armor}]`;
      if (item.type === "container") {
        html += item.searched ? " (searched)" : " (not searched)";
        if (item.searched && item.contents && item.contents.length > 0) {
          html += '<div style="margin-left: 1rem;">';
          for (const c of item.contents) {
            html += `<div class="item-entry">↳ ${c.name}</div>`;
          }
          html += "</div>";
        }
      }
      html += `</div>`;
    }
    html += `</div>`;
  }

  if (character) {
    const hpPercent = character.hp / character.maxHp;
    const hpClass =
      hpPercent > 0.6 ? "hp-good" : hpPercent > 0.3 ? "hp-mid" : "hp-low";

    title.textContent = character.name;
    html = `
      <div class="stat-row"><span class="stat-label">Status</span><span>${
        character.alive ? "Alive" : "Dead"
      }</span></div>
      <div class="stat-row"><span class="stat-label">HP</span><span class="${hpClass}">${
      character.hp
    }/${character.maxHp}</span></div>
      <div class="stat-row"><span class="stat-label">Position</span><span>(${
        pos.x
      }, ${pos.y})</span></div>
      <div class="stat-row"><span class="stat-label">Weapon</span><span>${
        character.equippedWeapon?.name ?? "None"
      }</span></div>
      <div class="stat-row"><span class="stat-label">Armor</span><span>${
        character.equippedClothing?.name ?? "None"
      }</span></div>
    `;

    if (character.inventory.length > 0) {
      html += `<div style="margin-top: 0.5rem; font-weight: 600;">Inventory:</div><div class="item-list">`;
      for (const item of character.inventory) {
        html += `<div class="item-entry">• ${item.name}</div>`;
      }
      html += `</div>`;
    }

    if (character.memories.length > 0) {
      html += `<div style="margin-top: 0.5rem; font-weight: 600;">Recent Memories:</div>`;
      const recentMems = character.memories.slice(-5);
      for (const mem of recentMems) {
        html += `<div class="memory-item"><span class="memory-turn">[Turn ${mem.turn}]</span> ${mem.description}</div>`;
      }
    }

    if (tile.items.length > 0) {
      html += `<div style="margin-top: 0.5rem; border-top: 1px solid var(--border-color); padding-top: 0.5rem;"><span style="font-weight: 600;">On this tile:</span></div><div class="item-list">`;
      for (const item of tile.items) {
        html += `<div class="item-entry">• ${item.name} (${item.type})`;
        if (item.damage) html += ` [dmg: ${item.damage}]`;
        if (item.armor) html += ` [armor: ${item.armor}]`;
        if (item.type === "container") {
          html += item.searched ? " (searched)" : " (not searched)";
          if (item.searched && item.contents && item.contents.length > 0) {
            html += '<div style="margin-left: 1rem;">';
            for (const c of item.contents) {
              html += `<div class="item-entry">↳ ${c.name}</div>`;
            }
            html += "</div>";
          }
        }
        html += `</div>`;
      }
      html += `</div>`;
    }
  } else {
    title.textContent = `Tile (${pos.x}, ${pos.y})`;
  }

  content.innerHTML = html;
  panel.style.display = "block";
}

function hideInspector(): void {
  const panel = document.getElementById("inspector-panel");
  if (panel) panel.style.display = "none";
}

async function processTurn(): Promise<void> {
  if (isProcessingTurn) return;
  if (viewingSnapshot) {
    returnToPresent();
    return;
  }

  const current = getCurrentCharacter();
  if (!current) {
    console.log("No living characters remaining");
    if (autoPlayInterval) {
      clearInterval(autoPlayInterval);
      autoPlayInterval = null;
      updateAutoPlayButton();
    }
    return;
  }

  isProcessingTurn = true;
  updateButton(true);
  saveSnapshot();

  try {
    const lookResult = executeAction(world, current, { type: "look_around" });
    for (const event of lookResult.events) {
      allEvents.push(event);
    }

    let equippedThisTurn = false;
    let movedThisTurn = false;
    let turnEnded = false;
    let maxIterations = 5;

    while (!turnEnded && current.alive && maxIterations > 0) {
      maxIterations--;

      const { actions, reasoning, fullPrompt, fullResponse } =
        await getAgentDecision(world, current);
      addReasoningEntry(current, reasoning, fullPrompt, fullResponse);

      let searchedContainer = false;

      for (const action of actions) {
        if (action.type === "move" && movedThisTurn) {
          continue;
        }

        if (action.type === "equip") {
          equippedThisTurn = true;
        }

        if (action.type === "attack" && equippedThisTurn) {
          const evt: GameEvent = {
            turn: world.turn,
            type: "move",
            actorId: current.id,
            description: `${current.name} cannot attack after equipping this turn`,
          };
          allEvents.push(evt);
          addLogEntry(evt);
          continue;
        }

        const result = executeAction(world, current, action);

        if (result.animationData) {
          if (
            result.animationData.type === "move" &&
            result.animationData.path
          ) {
            startAnimationLoop();
            await startMoveAnimation(current.id, result.animationData.path);
          } else if (
            result.animationData.type === "attack" &&
            result.animationData.targetPosition
          ) {
            const pos = result.animationData.targetPosition;
            if (result.animationData.missed) {
              addFloatingText(pos.x, pos.y, "MISS", "#ffffff");
            } else {
              addFloatingText(
                pos.x,
                pos.y,
                `-${result.animationData.damage}`,
                "#ff4444"
              );
            }
            await waitForAnimations();
          }
        }

        for (const event of result.events) {
          allEvents.push(event);
          addLogEntry(event);
        }

        if (result.events.length === 0 && action.type !== "look_around") {
          const evt: GameEvent = {
            turn: world.turn,
            type: "move",
            actorId: current.id,
            description: `${current.name}: ${action.type}${
              result.success ? "" : ` (failed: ${result.message})`
            }`,
          };
          allEvents.push(evt);
          addLogEntry(evt);
        }

        if (action.type === "move" && result.success) {
          movedThisTurn = true;
        }

        if (action.type === "search_container" && result.success) {
          searchedContainer = true;
        }

        if (
          action.type === "attack" ||
          action.type === "talk" ||
          action.type === "wait"
        ) {
          turnEnded = true;
          break;
        }

        if (!current.alive) {
          turnEnded = true;
          break;
        }
      }

      if (!searchedContainer) {
        turnEnded = true;
      }
    }

    currentCharacterIndex++;
    const alive = getAliveCharacters();
    if (currentCharacterIndex >= alive.length) {
      currentCharacterIndex = 0;
      world.turn++;
    }

    renderWorld();
    updateUI();
  } catch (error) {
    console.error("Error processing turn:", error);
  } finally {
    isProcessingTurn = false;
    updateButton(false);
  }
}

function updateButton(processing: boolean): void {
  const btn = document.getElementById("next-turn-btn") as HTMLButtonElement;
  if (btn) {
    btn.disabled = processing;
    btn.textContent = processing ? "Thinking..." : "Next Turn";
  }
}

function updateAutoPlayButton(): void {
  const btn = document.getElementById("auto-play-btn") as HTMLButtonElement;
  if (btn) {
    btn.textContent = autoPlayInterval ? "Stop" : "Auto Play";
  }
}

function toggleAutoPlay(): void {
  if (autoPlayInterval) {
    clearInterval(autoPlayInterval);
    autoPlayInterval = null;
  } else {
    autoPlayInterval = window.setInterval(() => {
      if (!isProcessingTurn && !viewingSnapshot) {
        processTurn();
      }
    }, 500);
  }
  updateAutoPlayButton();
}

function exportLogs(): void {
  const lines: string[] = [];

  lines.push("=".repeat(80));
  lines.push("AILAND GAME LOG EXPORT");
  lines.push(`Exported at: ${new Date().toISOString()}`);
  lines.push(`Current Turn: ${world.turn}`);
  lines.push("=".repeat(80));
  lines.push("");

  lines.push("WORLD STATE:");
  lines.push("-".repeat(40));
  for (const char of world.characters) {
    const status = char.alive ? `HP: ${char.hp}/${char.maxHp}` : "DEAD";
    const weapon = char.equippedWeapon?.name ?? "Unarmed";
    lines.push(
      `  ${char.name}: ${status}, Weapon: ${weapon}, Position: (${char.position.x}, ${char.position.y})`
    );
  }
  lines.push("");

  lines.push("CHRONOLOGICAL LOG:");
  lines.push("-".repeat(40));

  for (const entry of chronologicalLog) {
    if (entry.type === "event") {
      lines.push(`[Turn ${entry.turn}] ${entry.description}`);
    } else {
      const d = entry.decision;
      lines.push("");
      lines.push("=".repeat(60));
      lines.push(`AGENT DECISION: Turn ${d.turn} - ${d.character}`);
      lines.push("=".repeat(60));
      lines.push(`Reasoning: "${d.reasoning}"`);
      lines.push("");
      lines.push("--- FULL PROMPT ---");
      lines.push(d.fullPrompt);
      lines.push("");
      lines.push("--- FULL RESPONSE ---");
      lines.push(d.fullResponse);
      lines.push("=".repeat(60));
      lines.push("");
    }
  }

  const text = lines.join("\n");

  navigator.clipboard
    .writeText(text)
    .then(() => {
      const btn = document.getElementById("export-logs-btn");
      if (btn) {
        const originalText = btn.textContent;
        btn.textContent = "✓ Copied!";
        setTimeout(() => {
          btn.textContent = originalText;
        }, 2000);
      }
    })
    .catch((err) => {
      console.error("Failed to copy logs:", err);
      alert("Failed to copy to clipboard. Check console for the full log.");
      console.log(text);
    });
}

function showApiKeyPrompt(): void {
  const key = localStorage.getItem("openai_api_key");
  if (key) {
    initializeAgent(key);
    return;
  }

  const envKey =
    "***REMOVED***";
  if (envKey) {
    localStorage.setItem("openai_api_key", envKey);
    initializeAgent(envKey);
    return;
  }

  const modal = document.createElement("div");
  modal.style.cssText = `
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.8);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 1000;
  `;

  modal.innerHTML = `
    <div style="
      background: #12121a;
      border: 1px solid #2a2a3a;
      padding: 2rem;
      border-radius: 8px;
      max-width: 400px;
      width: 90%;
    ">
      <h2 style="margin-bottom: 1rem; color: #ffcc44; font-family: 'Press Start 2P', cursive; font-size: 1rem;">
        🔑 API Key Required
      </h2>
      <p style="margin-bottom: 1rem; color: #8888a0; font-size: 0.85rem;">
        Enter your OpenAI API key to enable AI-driven characters.
        The key will be stored locally in your browser.
      </p>
      <input
        type="password"
        id="api-key-input"
        placeholder="sk-..."
        style="
          width: 100%;
          padding: 0.75rem;
          background: #1a1a25;
          border: 1px solid #2a2a3a;
          border-radius: 4px;
          color: #e8e8f0;
          font-family: 'JetBrains Mono', monospace;
          margin-bottom: 1rem;
        "
      />
      <div style="display: flex; gap: 0.5rem;">
        <button id="save-key-btn" style="flex: 1;" class="primary">Save & Start</button>
        <button id="skip-key-btn" style="flex: 1;">Skip (Demo Mode)</button>
      </div>
      <p style="margin-top: 1rem; color: #666; font-size: 0.75rem;">
        Demo mode will use random actions instead of AI.
      </p>
    </div>
  `;

  document.body.appendChild(modal);

  const input = document.getElementById("api-key-input") as HTMLInputElement;
  const saveBtn = document.getElementById("save-key-btn");
  const skipBtn = document.getElementById("skip-key-btn");

  saveBtn?.addEventListener("click", () => {
    const apiKey = input.value.trim();
    if (apiKey) {
      localStorage.setItem("openai_api_key", apiKey);
      initializeAgent(apiKey);
    }
    modal.remove();
  });

  skipBtn?.addEventListener("click", () => {
    modal.remove();
  });
}

function init(): void {
  world = createTownMap();

  canvas = document.getElementById("game-canvas") as HTMLCanvasElement;
  ctx = canvas.getContext("2d")!;

  const size = getCanvasSize(world);
  canvas.width = size.width;
  canvas.height = size.height;

  showApiKeyPrompt();

  saveSnapshot();
  renderWorld();
  updateUI();

  canvas.addEventListener("click", handleCanvasClick);

  const nextTurnBtn = document.getElementById("next-turn-btn");
  nextTurnBtn?.addEventListener("click", () => {
    if (!isProcessingTurn) {
      processTurn();
    }
  });

  const autoPlayBtn = document.getElementById("auto-play-btn");
  autoPlayBtn?.addEventListener("click", toggleAutoPlay);

  const exportLogsBtn = document.getElementById("export-logs-btn");
  exportLogsBtn?.addEventListener("click", exportLogs);

  const returnBtn = document.getElementById("return-to-present");
  returnBtn?.addEventListener("click", returnToPresent);

  const closeInspectorBtn = document.getElementById("close-inspector");
  closeInspectorBtn?.addEventListener("click", hideInspector);

  const initialEvent: GameEvent = {
    turn: 0,
    type: "move",
    actorId: "",
    description:
      "THE HUNT BEGINS. Two armed hunters. One unarmed prey. Only the killer survives...",
  };
  allEvents.push(initialEvent);
  addLogEntry(initialEvent);

  for (const character of world.characters) {
    const evt: GameEvent = {
      turn: 0,
      type: "move",
      actorId: character.id,
      description: `${character.name} is at (${character.position.x}, ${character.position.y})`,
    };
    allEvents.push(evt);
    addLogEntry(evt);
  }
}

document.addEventListener("DOMContentLoaded", init);
