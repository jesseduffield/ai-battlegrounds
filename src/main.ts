import { createCageMap } from "./world-builder";
import {
  render,
  getCanvasSize,
  getTileFromPixel,
  addFloatingText,
  startMoveAnimation,
  updateAnimations,
  isAnimating,
  setThinkingCharacter,
} from "./renderer";
import {
  executeAction,
  getReachableTiles,
  getVisibleTiles,
  addMemory,
  distance,
  MAX_TALK_DISTANCE,
  getWitnessIds,
} from "./engine";
import {
  getAgentDecision,
  initializeAgent,
  judgeContract,
  getContractDecision,
  getConversationResponse,
} from "./agent";
import type { World, Character, GameEvent, Position, Action } from "./types";

type WorldSnapshot = {
  turn: number;
  characterIndex: number;
  world: string;
  eventIndex: number;
};

type AgentDecisionLog = {
  turn: number;
  character: string;
  reasoning: string | null;
  fullPrompt: string;
  fullResponse: string;
  sequence: number;
  errors?: string[];
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
let fastMode = false;
let playerControlledCharacter: string | null = null; // Character name or null for AI-only
let awaitingPlayerAction = false;
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

async function processExpiredContracts(): Promise<void> {
  const expiredContracts = world.activeContracts.filter(
    (c) => c.expiryTurn === world.turn
  );

  for (const contract of expiredContracts) {
    // Remove from active contracts
    const idx = world.activeContracts.indexOf(contract);
    if (idx >= 0) {
      world.activeContracts.splice(idx, 1);
    }

    // Judge the contract
    const verdict = await judgeContract(contract, allEvents, world);

    // Log the judgment
    const judgmentEvent: GameEvent = {
      turn: world.turn,
      type: "contract_judged",
      actorId: "",
      description: `⚖️ THE GREAT JUDGE speaks on the contract between ${contract.issuerName} and ${contract.targetName}: "${verdict.verdict}"`,
      message: verdict.verdict,
      judgePrompt: verdict.prompt,
      judgeResponse: verdict.rawResponse,
      witnessIds: world.characters.filter((c) => c.alive).map((c) => c.id),
    };
    allEvents.push(judgmentEvent);
    addLogEntry(judgmentEvent);

    // Kill violators
    for (const violatorName of verdict.violators) {
      const violator = world.characters.find(
        (c) => c.name.toLowerCase() === violatorName.toLowerCase() && c.alive
      );
      if (violator) {
        violator.alive = false;
        violator.hp = 0;

        const deathEvent: GameEvent = {
          turn: world.turn,
          type: "contract_violation",
          actorId: violator.id,
          description: `💀 ${violator.name} is struck dead by divine judgment for violating the Blood Contract!`,
          witnessIds: world.characters.filter((c) => c.alive).map((c) => c.id),
        };
        allEvents.push(deathEvent);
        addLogEntry(deathEvent);

        // Drop their items
        const tile = world.tiles[violator.position.y][violator.position.x];
        for (const item of violator.inventory) {
          tile.items.push(item);
        }
        violator.inventory = [];
        violator.equippedWeapon = undefined;
      }
    }
  }
}

function getCurrentCharacter(): Character | null {
  const alive = getAliveCharacters();
  if (alive.length === 0) return null;
  return alive[currentCharacterIndex % alive.length];
}

const CHARACTER_COLORS: Record<string, string> = {
  // Hunt map
  Kane: "#e63946",
  Razor: "#4361ee",
  Alice: "#e67e22",
  Bob: "#1abc9c",
  Charlie: "#e74c3c",
  // Bloodsport map
  Rex: "#e63946", // red
  Luna: "#9b59b6", // purple
  Vex: "#27ae60", // green
  Nova: "#3498db", // blue
};

function showThoughtBubble(
  character: Character,
  text: string,
  mode: "thinking" | "speaking" = "thinking"
): void {
  const bubble = document.getElementById("thought-bubble");
  const avatar = document.getElementById("thought-avatar");
  const name = document.getElementById("thought-name");
  const content = document.getElementById("thought-content");
  const modeIndicator = document.getElementById("thought-mode");

  if (bubble && avatar && name && content) {
    const color = CHARACTER_COLORS[character.name] ?? "#e8c84a";
    avatar.style.backgroundColor = color;
    avatar.textContent = character.name.charAt(0);
    name.textContent = character.name;
    name.style.color = color;

    if (mode === "thinking") {
      content.innerHTML = `<em>"${text}"</em>`;
      if (modeIndicator) modeIndicator.textContent = "💭";
      bubble.classList.remove("speaking");
      bubble.classList.add("thinking");
    } else {
      content.innerHTML = `<strong>"${text}"</strong>`;
      if (modeIndicator) modeIndicator.textContent = "💬";
      bubble.classList.remove("thinking");
      bubble.classList.add("speaking");
    }

    bubble.classList.remove("placeholder");
    bubble.classList.add("visible");
    bubble.style.borderColor = color;
  }
}

function hideThoughtBubble(): void {
  const bubble = document.getElementById("thought-bubble");
  if (bubble) {
    bubble.classList.remove("visible");
    bubble.classList.add("placeholder");
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
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

  let extraHtml = "";
  if (event.type === "contract_judged" && event.judgePrompt) {
    const eventIdx = allEvents.length - 1;
    extraHtml = `<div style="margin-top: 4px;"><a href="#" class="show-judge-prompt" data-event-idx="${eventIdx}" style="font-size: 11px; color: var(--accent-blue);">📜 Show Judge Prompt</a></div>`;
  }

  entry.innerHTML = `
    <div class="log-turn">Turn ${event.turn}</div>
    <div class="${typeClass[event.type] ?? ""}">${event.description}</div>
    ${extraHtml}
  `;

  entry.addEventListener("click", () => handleLogEntryClick(entry));

  // Add judge prompt click handler
  const judgeLink = entry.querySelector(".show-judge-prompt");
  if (judgeLink) {
    judgeLink.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      const idx = parseInt((e.target as HTMLElement).dataset.eventIdx || "0");
      showJudgePrompt(idx);
    });
  }

  eventElements.set(allEvents.length - 1, entry);
  eventLogEl.insertBefore(entry, eventLogEl.firstChild);

  while (eventLogEl.children.length > 100) {
    eventLogEl.removeChild(eventLogEl.lastChild!);
  }
}

function addReasoningEntry(
  character: Character,
  reasoning: string | null,
  fullPrompt?: string,
  fullResponse?: string,
  errors?: string[]
): void {
  if (fullPrompt && fullResponse) {
    const decision: AgentDecisionLog = {
      turn: world.turn,
      character: character.name,
      reasoning,
      fullPrompt,
      fullResponse,
      sequence: logSequence++,
      errors: errors && errors.length > 0 ? errors : undefined,
    };
    allAgentDecisions.push(decision);
    chronologicalLog.push({ type: "decision", decision });
  }

  const eventLogEl = document.getElementById("event-log");
  if (!eventLogEl) return;

  const entry = document.createElement("div");
  entry.className = "log-entry";
  entry.dataset.snapshotIndex = String(snapshots.length - 1);

  const errorHtml =
    errors && errors.length > 0
      ? `<div style="color: #f66; font-size: 11px; margin-top: 4px;">⚠ Errors: ${errors
          .map((e) => escapeHtml(e))
          .join(", ")}</div>`
      : "";

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
    ${errorHtml}
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
  render(ctx, displayWorld, current, reachable, visible, current?.id);
}

function handleCanvasClick(event: MouseEvent): void {
  const rect = canvas.getBoundingClientRect();
  const x = event.clientX - rect.left;
  const y = event.clientY - rect.top;
  const tilePos = getTileFromPixel(x, y);

  // If player is selecting an action target, handle that first
  if (awaitingPlayerAction && selectedAction) {
    executePlayerActionFromClick(tilePos.x, tilePos.y);
    return;
  }

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
      html += `<div style="margin-top: 0.5rem; font-weight: 600;">Memories:</div>`;
      for (const mem of character.memories) {
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

function toggleContractsPanel(): void {
  const panel = document.getElementById("contracts-panel");
  if (!panel) return;

  if (panel.style.display === "none") {
    updateContractsPanel();
    panel.style.display = "block";
  } else {
    panel.style.display = "none";
  }
}

function hideContractsPanel(): void {
  const panel = document.getElementById("contracts-panel");
  if (panel) panel.style.display = "none";
}

function showJudgePrompt(eventIdx: number): void {
  const event = allEvents[eventIdx];
  if (!event || !event.judgePrompt) return;

  const panel = document.getElementById("inspector-panel");
  const content = document.getElementById("inspector-content");
  const title = document.getElementById("inspector-title");

  if (!panel || !content || !title) return;

  title.textContent = "⚖️ Great Judge - Full Prompt";

  const promptHtml = `
    <div style="margin-bottom: 1rem;">
      <h4 style="color: var(--accent-blue); margin-bottom: 0.5rem;">Prompt sent to Judge:</h4>
      <pre style="white-space: pre-wrap; font-size: 11px; background: var(--bg-tertiary); padding: 0.5rem; border-radius: 4px; max-height: 300px; overflow-y: auto;">${escapeHtml(
        event.judgePrompt
      )}</pre>
    </div>
    ${
      event.judgeResponse
        ? `<div>
        <h4 style="color: var(--accent-green); margin-bottom: 0.5rem;">Judge Response:</h4>
        <pre style="white-space: pre-wrap; font-size: 11px; background: var(--bg-tertiary); padding: 0.5rem; border-radius: 4px;">${escapeHtml(
          event.judgeResponse
        )}</pre>
      </div>`
        : ""
    }
  `;

  content.innerHTML = promptHtml;
  panel.style.display = "block";
}

function updateContractsPanel(): void {
  const content = document.getElementById("contracts-content");
  if (!content) return;

  if (world.activeContracts.length === 0) {
    content.innerHTML = `<p style="color: var(--text-secondary);">No active blood contracts.</p>`;
    return;
  }

  const contractsHtml = world.activeContracts
    .map((c) => {
      const turnsLeft = c.expiryTurn - world.turn;
      return `
        <div style="padding: 0.5rem; margin-bottom: 0.5rem; background: var(--bg-tertiary); border-radius: 4px; border-left: 3px solid var(--accent-red);">
          <div style="font-weight: bold;">${c.issuerName} ↔ ${
        c.targetName
      }</div>
          <div style="font-size: 0.8rem; margin: 0.25rem 0;">"${
            c.contents
          }"</div>
          <div style="font-size: 0.7rem; color: var(--text-secondary);">
            ${
              turnsLeft > 0
                ? `${turnsLeft} turns remaining (expires turn ${c.expiryTurn})`
                : "⚠️ EXPIRING THIS TURN"
            }
          </div>
        </div>
      `;
    })
    .join("");

  content.innerHTML = contractsHtml;
}

function showConversationInput(
  _speaker: Character,
  listener: Character,
  lastMessage: string
): Promise<string | null> {
  return new Promise((resolve) => {
    const panel = document.getElementById("player-actions-panel");
    if (!panel) {
      resolve(null);
      return;
    }

    panel.style.display = "block";
    panel.innerHTML = `
      <h3 style="margin: 0 0 0.5rem 0;">💬 Respond to ${listener.name}</h3>
      <p style="font-size: 0.8rem; margin-bottom: 0.5rem;">"${lastMessage}"</p>
      <input type="text" id="convo-response" placeholder="Your response..." style="width: 100%; margin-bottom: 0.5rem;">
      <div style="display: flex; gap: 0.5rem;">
        <button class="action-btn" id="convo-reply-btn">Reply</button>
        <button class="action-btn" id="convo-end-btn" style="background: var(--bg-tertiary);">End Conversation</button>
      </div>
    `;

    const input = document.getElementById("convo-response") as HTMLInputElement;
    const replyBtn = document.getElementById("convo-reply-btn");
    const endBtn = document.getElementById("convo-end-btn");

    const submit = () => {
      const msg = input.value.trim();
      panel.style.display = "none";
      resolve(msg || null);
    };

    const endConvo = () => {
      panel.style.display = "none";
      resolve(null);
    };

    replyBtn?.addEventListener("click", submit);
    endBtn?.addEventListener("click", endConvo);
    input?.addEventListener("keypress", (e) => {
      if (e.key === "Enter") submit();
    });
    input?.focus();
  });
}

async function handleConversation(
  initiator: Character,
  target: Character,
  initialMessage: string
): Promise<void> {
  const maxExchanges = 2; // A speaks, B responds, A responds (3 total messages, 2 exchanges after initial)
  let speaker = target;
  let listener = initiator;
  let lastMessage = initialMessage;
  let exchanges = 0;

  while (exchanges < maxExchanges && speaker.alive && listener.alive) {
    let responseMessage: string | null = null;

    // Check if speaker is player-controlled
    if (speaker.name === playerControlledCharacter) {
      // Show input UI for player
      responseMessage = await showConversationInput(
        speaker,
        listener,
        lastMessage
      );

      if (!responseMessage) {
        break; // Player chose to end conversation
      }
    } else {
      // AI decides response - using constrained schema that only allows TALK or WAIT
      setThinkingCharacter(speaker.id);
      renderWorld();

      const { wantsToRespond, thought, message, fullPrompt, fullResponse } =
        await getConversationResponse(
          world,
          speaker,
          listener.name,
          lastMessage
        );

      setThinkingCharacter(null);

      if (thought) {
        showThoughtBubble(speaker, thought);
        if (!fastMode) {
          await delay(1500);
        }
        hideThoughtBubble();
      }

      addReasoningEntry(speaker, thought, fullPrompt, fullResponse);

      // If they don't want to talk back, end conversation
      if (!wantsToRespond || !message) {
        break;
      }

      responseMessage = message;
    }

    // Show their response
    showThoughtBubble(speaker, responseMessage, "speaking");
    if (!fastMode) {
      await delay(2500);
    }
    hideThoughtBubble();

    // Log the response
    const evt: GameEvent = {
      turn: world.turn,
      type: "talk",
      actorId: speaker.id,
      targetId: listener.id,
      message: responseMessage,
      description: `${speaker.name} responds to ${listener.name}: "${responseMessage}"`,
      witnessIds: [speaker.id, listener.id],
    };
    allEvents.push(evt);
    addLogEntry(evt);

    // Add memories
    addMemory(speaker, {
      turn: world.turn,
      type: "talked_to",
      description: `Said to ${listener.name}: "${responseMessage}"`,
      characterId: listener.id,
      source: "witnessed",
    });
    addMemory(listener, {
      turn: world.turn,
      type: "talked_to",
      description: `${speaker.name} said: "${responseMessage}"`,
      characterId: speaker.id,
      source: "witnessed",
    });

    // Swap roles
    lastMessage = responseMessage;
    [speaker, listener] = [listener, speaker];
    exchanges++;
  }
}

function showContractDecisionUI(
  issuer: Character,
  contents: string,
  expiry: number,
  pitch?: string
): Promise<{ signed: boolean; response?: string }> {
  return new Promise((resolve) => {
    const panel = document.getElementById("player-actions-panel");
    if (!panel) {
      resolve({ signed: false });
      return;
    }

    panel.style.display = "block";
    panel.innerHTML = `
      <h3 style="margin: 0 0 0.5rem 0;">🩸 Blood Contract Offer</h3>
      <p style="font-size: 0.8rem;"><strong>From ${issuer.name}:</strong></p>
      ${
        pitch
          ? `<p style="font-size: 0.9rem; font-style: italic; margin: 0.5rem 0;">"${pitch}"</p>`
          : ""
      }
      <p style="font-size: 0.9rem; margin: 0.5rem 0; padding: 0.5rem; background: var(--bg-tertiary); border-radius: 4px;"><strong>Terms:</strong> "${contents}"</p>
      <p style="font-size: 0.7rem; color: var(--text-secondary);">Duration: ${expiry} turns (expires turn ${
      world.turn + expiry
    })</p>
      <p style="font-size: 0.7rem; color: var(--accent-red);">⚠️ Violating the terms = DEATH</p>
      <input type="text" id="contract-response" placeholder="Optional message..." style="width: 100%; margin-bottom: 0.5rem;">
      <div style="display: flex; gap: 0.5rem;">
        <button class="action-btn" id="contract-sign-btn" style="background: var(--accent-green);">✓ Sign</button>
        <button class="action-btn" id="contract-decline-btn" style="background: var(--accent-red);">✗ Decline</button>
      </div>
    `;

    const input = document.getElementById(
      "contract-response"
    ) as HTMLInputElement;
    const signBtn = document.getElementById("contract-sign-btn");
    const declineBtn = document.getElementById("contract-decline-btn");

    signBtn?.addEventListener("click", () => {
      const response = input.value.trim() || undefined;
      panel.style.display = "none";
      resolve({ signed: true, response });
    });

    declineBtn?.addEventListener("click", () => {
      const response = input.value.trim() || undefined;
      panel.style.display = "none";
      resolve({ signed: false, response });
    });
  });
}

async function handleContractNegotiation(
  issuer: Character,
  target: Character,
  contents: string,
  expiry: number,
  pitch?: string
): Promise<{ signed: boolean; response?: string }> {
  // Check if target is player-controlled
  if (target.name === playerControlledCharacter) {
    const result = await showContractDecisionUI(
      issuer,
      contents,
      expiry,
      pitch
    );

    // Show their response if any
    if (result.response) {
      showThoughtBubble(target, result.response, "speaking");
      if (!fastMode) {
        await delay(2500);
      }
      hideThoughtBubble();
    }

    return result;
  }

  // AI decides using dedicated contract schema (only SIGN or DECLINE allowed)
  setThinkingCharacter(target.id);
  renderWorld();

  const result = await getContractDecision(
    issuer.name,
    target.name,
    contents,
    expiry,
    world.turn,
    pitch
  );

  setThinkingCharacter(null);

  if (result.thought) {
    showThoughtBubble(target, result.thought);
    if (!fastMode) {
      await delay(1500);
    }
    hideThoughtBubble();
  }

  addReasoningEntry(
    target,
    result.thought,
    result.fullPrompt,
    result.fullResponse
  );

  // Show their response if any
  if (result.message) {
    showThoughtBubble(target, result.message, "speaking");
    if (!fastMode) {
      await delay(2500);
    }
    hideThoughtBubble();
  }

  return { signed: result.signed, response: result.message || undefined };
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

  // If this is a player-controlled character, show actions UI instead of AI
  if (current.name === playerControlledCharacter) {
    // Stop autoplay if running
    if (autoPlayInterval) {
      clearInterval(autoPlayInterval);
      autoPlayInterval = null;
      updateAutoPlayButton();
    }
    showPlayerActions();
    return;
  }

  isProcessingTurn = true;
  updateButton(true);
  saveSnapshot();

  try {
    // Decrement debuff at start of turn
    if (current.debuffTurnsRemaining > 0) {
      current.debuffTurnsRemaining--;
      if (current.debuffTurnsRemaining === 0) {
        current.trapped = false;
        current.attackDebuff = undefined;
        const freeEvent: GameEvent = {
          turn: world.turn,
          type: "move",
          actorId: current.id,
          description: `${current.name} has broken free from the trap!`,
          witnessIds: getWitnessIds(world, current.position),
        };
        allEvents.push(freeEvent);
        addLogEntry(freeEvent);
      }
    }

    const lookResult = executeAction(world, current, { type: "look_around" });
    for (const event of lookResult.events) {
      allEvents.push(event);
    }

    let equippedThisTurn = false;
    let movedThisTurn = false;
    let conversationsThisTurn = 0;
    const maxConversationsPerTurn = 1;
    let contractsIssuedThisTurn = 0;
    const maxContractsPerTurn = 2;
    let turnEnded = false;
    let actionsThisTurn = 0;
    const maxActionsPerTurn = 3;
    let errorRetries = 0;
    const maxErrorRetries = 2;
    const turnHistory: { response: string; result: string }[] = [];

    while (!turnEnded && current.alive && actionsThisTurn < maxActionsPerTurn) {
      setThinkingCharacter(current.id);
      renderWorld();

      const { action, reasoning, fullPrompt, fullResponse, error } =
        await getAgentDecision(world, current, turnHistory);

      setThinkingCharacter(null);

      // Show what the character is thinking and pause (only if reasoning provided)
      if (reasoning) {
        // Store thought as memory
        addMemory(current, {
          turn: world.turn,
          type: "thought",
          description: `Thought: "${reasoning}"`,
          source: "witnessed",
        });

        showThoughtBubble(current, reasoning);
        if (!fastMode) {
          await delay(2500); // Let player read the thought
        }
        hideThoughtBubble();
      }
      addReasoningEntry(
        current,
        reasoning,
        fullPrompt,
        fullResponse,
        error ? [error] : undefined
      );

      // If the agent had a parsing error, retry with that error as feedback
      if (error) {
        errorRetries++;
        if (errorRetries <= maxErrorRetries) {
          if (fullResponse) {
            turnHistory.push({
              response: fullResponse,
              result: `ERROR: ${error}`,
            });
          }
          continue;
        }
        // Too many errors, end turn
        const evt: GameEvent = {
          turn: world.turn,
          type: "move",
          actorId: current.id,
          description: `${current.name}: turn ended due to repeated errors`,
          witnessIds: getWitnessIds(world, current.position),
        };
        allEvents.push(evt);
        addLogEntry(evt);
        break;
      }

      // Prevent duplicate moves in one turn
      if (action.type === "move" && movedThisTurn) {
        if (fullResponse) {
          turnHistory.push({
            response: fullResponse,
            result: "REJECTED: Already moved this turn",
          });
        }
        const evt: GameEvent = {
          turn: world.turn,
          type: "move",
          actorId: current.id,
          description: `${current.name}: move (REJECTED - already moved this turn)`,
          witnessIds: getWitnessIds(world, current.position),
        };
        allEvents.push(evt);
        addLogEntry(evt);
        continue;
      }

      // Prevent attack after equip
      if (action.type === "equip") {
        equippedThisTurn = true;
      }
      if (action.type === "attack" && equippedThisTurn) {
        const evt: GameEvent = {
          turn: world.turn,
          type: "move",
          actorId: current.id,
          description: `${current.name} cannot attack after equipping this turn`,
          witnessIds: getWitnessIds(world, current.position),
        };
        allEvents.push(evt);
        addLogEntry(evt);
        turnEnded = true;
        continue;
      }

      const result = executeAction(world, current, action);

      // Handle animations
      if (result.animationData) {
        if (result.animationData.type === "move" && result.animationData.path) {
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
        } else if (
          result.animationData.type === "pickup" &&
          result.animationData.targetPosition
        ) {
          const pos = result.animationData.targetPosition;
          const itemName = result.animationData.itemName ?? "item";
          addFloatingText(pos.x, pos.y, `+${itemName}`, "#4ade80");
          await waitForAnimations();
        } else if (
          result.animationData.type === "place" &&
          result.animationData.targetPosition
        ) {
          const pos = result.animationData.targetPosition;
          const itemName = result.animationData.itemName ?? "item";
          addFloatingText(pos.x, pos.y, `-${itemName}`, "#facc15");
          await waitForAnimations();
        }
      }

      // Log events
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
          witnessIds: getWitnessIds(world, current.position),
        };
        allEvents.push(evt);
        addLogEntry(evt);
      }

      // Track actions for conversation history
      if (action.type !== "look_around" && fullResponse) {
        const resultDesc = result.success
          ? result.message
          : `FAILED: ${result.message}`;
        turnHistory.push({
          response: fullResponse,
          result: resultDesc,
        });
        if (result.success) {
          actionsThisTurn++;
        }
      }

      // Handle action results
      if (action.type === "move") {
        if (result.success) {
          movedThisTurn = true;
          // If character got trapped, let them continue with next action
          if (current.trapped) {
            turnHistory[turnHistory.length - 1].result += " (TRAPPED!)";
            continue;
          }
        } else {
          continue;
        }
      }

      // Handle failures for non-turn-ending actions (search, pickup, equip, drop, place)
      const nonEndingActions = [
        "search_container",
        "pick_up",
        "equip",
        "drop",
        "place",
        "unequip",
      ];
      if (nonEndingActions.includes(action.type) && !result.success) {
        continue;
      }

      // Handle talk actions - start a conversation
      if (action.type === "talk" && result.success && action.message) {
        if (conversationsThisTurn >= maxConversationsPerTurn) {
          continue;
        }

        showThoughtBubble(current, action.message, "speaking");
        if (!fastMode) {
          await delay(2500);
        }
        hideThoughtBubble();

        // Start conversation with target
        const target = world.characters.find(
          (c) => c.id === action.targetCharacterId
        );
        if (target && target.alive) {
          await handleConversation(current, target, action.message);
        }

        conversationsThisTurn++;
        // Talk does NOT end turn - continue with other actions
      } else if (action.type === "talk" && !result.success) {
        continue;
      }

      // Handle contract negotiation - immediate dialog
      if (action.type === "issue_contract" && result.success) {
        if (contractsIssuedThisTurn >= maxContractsPerTurn) {
          continue;
        }

        const target = world.characters.find(
          (c) => c.id === action.targetCharacterId
        );
        if (
          target &&
          target.alive &&
          action.contractContents &&
          action.contractExpiry
        ) {
          const { signed, response } = await handleContractNegotiation(
            current,
            target,
            action.contractContents,
            action.contractExpiry,
            action.message
          );

          if (signed) {
            // Create and activate the contract
            const contract = {
              id: crypto.randomUUID(),
              issuerId: current.id,
              issuerName: current.name,
              targetId: target.id,
              targetName: target.name,
              contents: action.contractContents,
              expiryTurn: world.turn + action.contractExpiry,
              signed: true,
              createdTurn: world.turn,
            };

            world.activeContracts.push(contract);

            // Add to both inventories
            const issuerCopy = {
              id: crypto.randomUUID(),
              name: `Contract with ${target.name}`,
              type: "contract" as const,
              contract,
            };
            const targetCopy = {
              id: crypto.randomUUID(),
              name: `Contract with ${current.name}`,
              type: "contract" as const,
              contract,
            };
            current.inventory.push(issuerCopy);
            target.inventory.push(targetCopy);

            const signedEvt: GameEvent = {
              turn: world.turn,
              type: "contract_signed",
              actorId: target.id,
              targetId: current.id,
              message: action.contractContents,
              description: `🩸 ${target.name} signed the Blood Contract with ${current.name}: "${action.contractContents}" (expires turn ${contract.expiryTurn})`,
              witnessIds: [target.id, current.id],
            };
            allEvents.push(signedEvt);
            addLogEntry(signedEvt);

            // Add memories
            addMemory(current, {
              turn: world.turn,
              type: "signed_contract",
              description: `${target.name} signed the Blood Contract: "${action.contractContents}" (expires turn ${contract.expiryTurn})`,
              characterId: target.id,
              source: "witnessed",
            });
            addMemory(target, {
              turn: world.turn,
              type: "signed_contract",
              description: `Signed Blood Contract with ${current.name}: "${action.contractContents}" (expires turn ${contract.expiryTurn})`,
              characterId: current.id,
              source: "witnessed",
            });
            // Add to turn history so follow-up actions know the result
            turnHistory.push({
              response: `CONTRACT ${target.name}: "${action.contractContents}"`,
              result: `✅ ${target.name} SIGNED the contract`,
            });
          } else {
            const declineEvt: GameEvent = {
              turn: world.turn,
              type: "talk",
              actorId: target.id,
              targetId: current.id,
              message: response || "declined",
              description: `${target.name} declined the Blood Contract${
                response ? `: "${response}"` : ""
              }`,
              witnessIds: [target.id, current.id],
            };
            allEvents.push(declineEvt);
            addLogEntry(declineEvt);

            // Add to turn history so follow-up actions know the result
            turnHistory.push({
              response: `CONTRACT ${target.name}: "${action.contractContents}"`,
              result: `❌ ${target.name} DECLINED${
                response ? `: "${response}"` : ""
              }`,
            });
          }
        }
        contractsIssuedThisTurn++;
        // Contracts no longer end turn - can issue up to maxContractsPerTurn
      } else if (action.type === "issue_contract" && !result.success) {
        continue;
      }

      // Attack ends turn
      if (action.type === "attack") {
        if (result.success) {
          turnEnded = true;
        } else {
          continue;
        }
      }

      if (action.type === "wait") {
        turnEnded = true;
      }

      // Character died
      if (!current.alive) {
        turnEnded = true;
      }
    }

    currentCharacterIndex++;
    const alive = getAliveCharacters();

    if (alive.length <= 1) {
      const winner = alive[0];
      const gameOverEvent: GameEvent = {
        turn: world.turn,
        type: "death",
        actorId: winner?.id ?? "",
        description: winner
          ? `🏆 GAME OVER! ${winner.name} is the last one standing!`
          : "💀 GAME OVER! Everyone is dead!",
        witnessIds: world.characters.filter((c) => c.alive).map((c) => c.id),
      };
      allEvents.push(gameOverEvent);
      addLogEntry(gameOverEvent);

      if (autoPlayInterval) {
        clearInterval(autoPlayInterval);
        autoPlayInterval = null;
        updateAutoPlayButton();
      }

      renderWorld();
      updateUI();
      updateButton(false);

      const btn = document.getElementById("next-turn-btn") as HTMLButtonElement;
      if (btn) {
        btn.textContent = "Game Over";
        btn.disabled = true;
      }

      showGameOverBanner(winner?.name ?? null);
      saveCompactLogsToFile();
      return;
    }

    if (currentCharacterIndex >= alive.length) {
      currentCharacterIndex = 0;
      world.turn++;
      // Check for expired contracts at the start of each new turn
      await processExpiredContracts();
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

function toggleSpeed(): void {
  fastMode = !fastMode;
  const btn = document.getElementById("speed-toggle-btn");
  if (btn) {
    btn.textContent = fastMode ? "🐇 Fast" : "🐢 Slow";
  }
}

function togglePlayerControl(): void {
  const btn = document.getElementById("player-control-btn");
  const characters = world.characters.filter((c) => c.alive);

  if (playerControlledCharacter) {
    // Turn off player control
    playerControlledCharacter = null;
    if (btn) btn.textContent = "🎮 Watch";
    hidePlayerActions();
  } else {
    // Cycle through characters or pick first alive one
    const currentChar = characters[0];
    if (currentChar) {
      playerControlledCharacter = currentChar.name;
      if (btn) btn.textContent = `🎮 ${currentChar.name}`;
      updatePlayerActionsUI();
    }
  }
}

function cyclePlayerCharacter(): void {
  const characters = world.characters.filter((c) => c.alive);
  if (characters.length === 0) return;

  const currentIndex = characters.findIndex(
    (c) => c.name === playerControlledCharacter
  );
  const nextIndex = (currentIndex + 1) % characters.length;
  playerControlledCharacter = characters[nextIndex].name;

  const btn = document.getElementById("player-control-btn");
  if (btn) btn.textContent = `🎮 ${playerControlledCharacter}`;
  updatePlayerActionsUI();
}

function showPlayerActions(): void {
  const panel = document.getElementById("player-actions");
  if (panel) panel.style.display = "block";
  awaitingPlayerAction = true;
  updatePlayerActionsUI();
}

function hidePlayerActions(): void {
  const panel = document.getElementById("player-actions");
  if (panel) panel.style.display = "none";
  awaitingPlayerAction = false;

  // Clear any selection
  document.querySelectorAll(".action-btn").forEach((btn) => {
    btn.classList.remove("selected");
  });
  const details = document.getElementById("action-details");
  if (details) details.innerHTML = "";
}

let selectedAction: string | null = null;

function updatePlayerActionsUI(): void {
  const current = world.characters[currentCharacterIndex];
  if (!current || current.name !== playerControlledCharacter) {
    hidePlayerActions();
    return;
  }

  showPlayerActions();
}

function selectPlayerAction(actionType: string): void {
  selectedAction = actionType;

  document.querySelectorAll(".action-btn").forEach((btn) => {
    btn.classList.remove("selected");
    if ((btn as HTMLElement).dataset.action === actionType) {
      btn.classList.add("selected");
    }
  });

  const details = document.getElementById("action-details");
  if (!details) return;

  const current = world.characters[currentCharacterIndex];
  if (!current) return;

  switch (actionType) {
    case "move":
      details.innerHTML = `<p>Click a tile to move there</p>`;
      break;
    case "attack":
      const adjacent = world.characters.filter(
        (c) =>
          c.alive &&
          c.id !== current.id &&
          Math.abs(c.position.x - current.position.x) +
            Math.abs(c.position.y - current.position.y) ===
            1
      );
      if (adjacent.length === 0) {
        details.innerHTML = `<p>No adjacent targets</p>`;
      } else {
        details.innerHTML = adjacent
          .map(
            (c) =>
              `<button class="action-btn" onclick="window.executePlayerAction('attack', '${c.name}')">${c.name}</button>`
          )
          .join(" ");
      }
      break;
    case "talk":
      const nearby = world.characters.filter(
        (c) =>
          c.alive &&
          c.id !== current.id &&
          distance(current.position, c.position) <= MAX_TALK_DISTANCE
      );
      if (nearby.length === 0) {
        details.innerHTML = `<p>No one within ${MAX_TALK_DISTANCE} tiles</p>`;
      } else {
        details.innerHTML = `
          <select id="talk-target">${nearby
            .map((c) => `<option value="${c.name}">${c.name}</option>`)
            .join("")}</select>
          <input type="text" id="talk-message" placeholder="Message..." style="width: 100%;">
          <button class="action-btn" onclick="window.executePlayerTalk()">Send</button>
        `;
      }
      break;
    case "search":
      details.innerHTML = `<p>Click an adjacent container to search</p>`;
      break;
    case "pickup":
      details.innerHTML = `<p>Click an adjacent item to pick up</p>`;
      break;
    case "equip":
      const weapons = current.inventory.filter((i) => i.type === "weapon");
      if (weapons.length === 0) {
        details.innerHTML = `<p>No weapons in inventory</p>`;
      } else {
        details.innerHTML = weapons
          .map(
            (w) =>
              `<button class="action-btn" onclick="window.executePlayerAction('equip', '${w.name}')">${w.name}</button>`
          )
          .join(" ");
      }
      break;
    case "drop":
      if (current.inventory.length === 0) {
        details.innerHTML = `<p>No items in inventory</p>`;
      } else {
        details.innerHTML = current.inventory
          .map(
            (item) =>
              `<button class="action-btn" onclick="window.executePlayerAction('drop', '${item.name}')">${item.name}</button>`
          )
          .join(" ");
      }
      break;
    case "place":
      const traps = current.inventory.filter((i) => i.type === "trap");
      if (traps.length === 0) {
        details.innerHTML = `<p>No traps in inventory</p>`;
      } else {
        details.innerHTML = `<p>Click an adjacent tile to place: ${traps
          .map((t) => t.name)
          .join(", ")}</p>`;
      }
      break;
    case "contract":
      const otherChars = world.characters.filter(
        (c) => c.alive && c.id !== current.id
      );
      const nearbyChars = otherChars.filter(
        (c) => distance(current.position, c.position) <= MAX_TALK_DISTANCE
      );
      if (nearbyChars.length === 0) {
        details.innerHTML = `<p>No characters within 4 tiles to contract with</p>`;
      } else {
        details.innerHTML = `
          <p>Offer Blood Contract:</p>
          <select id="contract-target">${nearbyChars
            .map(
              (c) =>
                `<option value="${c.name}">${c.name} (${Math.round(
                  distance(current.position, c.position)
                )} tiles)</option>`
            )
            .join("")}</select>
          <input type="text" id="contract-pitch" placeholder="Your pitch (optional)" style="width: 100%;">
          <input type="number" id="contract-expiry" placeholder="Expiry (1-20 turns)" min="1" max="20" value="10" style="width: 100%;">
          <input type="text" id="contract-terms" placeholder="Terms, e.g. 'Neither attacks the other'" style="width: 100%;">
          <button class="action-btn" onclick="window.executePlayerContract()">Offer Contract</button>
        `;
      }
      break;
    case "sign":
      // Sign action is now handled during contract negotiation - not a standalone action
      details.innerHTML = `<p>Signing happens automatically when someone offers you a contract.</p>`;
      break;
    case "wait":
      details.innerHTML = `<button class="action-btn" onclick="window.executePlayerAction('wait')">End Turn</button>`;
      break;
    default:
      details.innerHTML = "";
  }
}

async function executePlayerActionFromClick(
  x: number,
  y: number
): Promise<void> {
  if (!awaitingPlayerAction || !selectedAction) return;

  const current = world.characters[currentCharacterIndex];
  if (!current || current.name !== playerControlledCharacter) return;

  let action: Action | null = null;

  if (selectedAction === "move") {
    action = { type: "move", targetPosition: { x, y } };
  } else if (selectedAction === "search") {
    const tile = world.tiles[y]?.[x];
    if (tile) {
      const container = tile.items.find((i) => i.type === "container");
      if (container) {
        action = { type: "search_container", targetItemId: container.id };
      }
    }
  } else if (selectedAction === "pickup") {
    const tile = world.tiles[y]?.[x];
    if (tile) {
      // Check for items on ground
      let item = tile.items.find((i) => i.type !== "container");
      if (item) {
        action = {
          type: "pick_up",
          targetPosition: { x, y },
          targetItemName: item.name,
        };
      } else {
        // Check for items inside searched containers
        for (const container of tile.items.filter(
          (i) => i.type === "container" && i.searched
        )) {
          if (container.contents && container.contents.length > 0) {
            item = container.contents[0];
            action = {
              type: "pick_up",
              targetPosition: { x, y },
              targetItemName: item.name,
            };
            break;
          }
        }
      }
    }
  } else if (selectedAction === "place") {
    const trap = current.inventory.find((i) => i.type === "trap");
    if (trap) {
      action = {
        type: "place",
        targetPosition: { x, y },
        targetItemId: trap.id,
      };
    }
  }
  // Contract action is handled by executePlayerContract, not by clicking tiles

  if (action) {
    await executePlayerAction(action);
  }
}

async function executePlayerAction(
  action: Action | string,
  target?: string
): Promise<void> {
  const current = world.characters[currentCharacterIndex];
  if (!current) return;

  let actualAction: Action;

  if (typeof action === "string") {
    switch (action) {
      case "attack":
        const attackTarget = world.characters.find((c) => c.name === target);
        if (!attackTarget) return;
        actualAction = { type: "attack", targetCharacterId: attackTarget.id };
        break;
      case "equip":
        const equipItem = current.inventory.find((i) => i.name === target);
        if (!equipItem) return;
        actualAction = { type: "equip", targetItemId: equipItem.id };
        break;
      case "drop":
        const dropItem = current.inventory.find((i) => i.name === target);
        if (!dropItem) return;
        actualAction = { type: "drop", targetItemId: dropItem.id };
        break;
      case "sign":
        actualAction = { type: "sign_contract", targetItemName: target };
        break;
      case "wait":
        actualAction = { type: "wait" };
        break;
      default:
        return;
    }
  } else {
    actualAction = action;
  }

  // Execute the action
  const result = executeAction(world, current, actualAction);

  // Add events to log
  for (const evt of result.events) {
    allEvents.push(evt);
    addLogEntry(evt);
  }

  // If action failed, show error and let player retry
  if (!result.success) {
    const details = document.getElementById("action-details");
    if (details) {
      details.innerHTML = `<p style="color: var(--accent-red);">⚠️ ${result.message}</p>`;
    }
    // Keep actions panel open for retry
    selectedAction = null;
    updateUI();
    return;
  }

  hidePlayerActions();
  awaitingPlayerAction = false;

  // Handle animations
  if (result.animationData) {
    // Play animation (simplified - could expand)
    renderWorld();
  }

  updateUI();

  // If wait or turn-ending action, advance turn
  // Note: talk is handled separately in executePlayerTalk with conversation
  // Note: issue_contract is handled separately in executePlayerContract
  if (actualAction.type === "wait" || actualAction.type === "attack") {
    await advanceToNextCharacter();
  } else {
    // Show actions again for follow-up
    showPlayerActions();
    selectedAction = null;
  }
}

async function executePlayerTalk(): Promise<void> {
  if (!playerControlledCharacter) return;

  const current = world.characters.find(
    (c) => c.name === playerControlledCharacter
  );
  if (!current || !current.alive) return;

  const targetSelect = document.getElementById(
    "talk-target"
  ) as HTMLSelectElement;
  const messageInput = document.getElementById(
    "talk-message"
  ) as HTMLInputElement;

  if (!targetSelect || !messageInput) return;

  const targetName = targetSelect.value;
  const message = messageInput.value;

  const target = world.characters.find((c) => c.name === targetName);
  if (!target || !message) return;

  // Execute the talk action
  const action: Action = {
    type: "talk",
    targetCharacterId: target.id,
    message,
  };

  const result = executeAction(world, current, action);
  for (const evt of result.events) {
    allEvents.push(evt);
    addLogEntry(evt);
  }

  if (result.success) {
    // Show speech bubble
    showThoughtBubble(current, message, "speaking");
    if (!fastMode) {
      await delay(2500);
    }
    hideThoughtBubble();

    // Start conversation with target - they can respond
    if (target.alive) {
      await handleConversation(current, target, message);
    }

    // Talk does NOT end turn - show actions again
    showPlayerActions();
    selectedAction = null;
  } else {
    const details = document.getElementById("action-details");
    if (details) {
      details.innerHTML += `<p style="color: var(--accent-red);">⚠️ ${result.message}</p>`;
    }
  }

  updateUI();
}

async function advanceToNextCharacter(): Promise<void> {
  currentCharacterIndex++;

  // Check if round is complete
  while (
    currentCharacterIndex < world.characters.length &&
    !world.characters[currentCharacterIndex].alive
  ) {
    currentCharacterIndex++;
  }

  if (currentCharacterIndex >= world.characters.length) {
    // New turn
    world.turn++;
    // Check for expired contracts at the start of each new turn
    await processExpiredContracts();
    currentCharacterIndex = 0;
    while (
      currentCharacterIndex < world.characters.length &&
      !world.characters[currentCharacterIndex].alive
    ) {
      currentCharacterIndex++;
    }
  }

  updateUI();

  // Check if it's player's turn
  const next = world.characters[currentCharacterIndex];
  if (next && next.name === playerControlledCharacter && next.alive) {
    showPlayerActions();
  }
}

async function executePlayerContract(): Promise<void> {
  if (!playerControlledCharacter) return;

  const current = world.characters.find(
    (c) => c.name === playerControlledCharacter
  );
  if (!current || !current.alive) return;

  const targetSelect = document.getElementById(
    "contract-target"
  ) as HTMLSelectElement;
  const expiryInput = document.getElementById(
    "contract-expiry"
  ) as HTMLInputElement;
  const termsInput = document.getElementById(
    "contract-terms"
  ) as HTMLInputElement;
  const pitchInput = document.getElementById(
    "contract-pitch"
  ) as HTMLInputElement;

  if (!targetSelect || !expiryInput || !termsInput) return;

  const targetName = targetSelect.value;
  const expiry = parseInt(expiryInput.value, 10);
  const terms = termsInput.value;
  const pitch = pitchInput?.value || undefined;

  if (!terms) {
    const details = document.getElementById("action-details");
    if (details) {
      details.innerHTML += `<p style="color: var(--accent-red);">⚠️ Enter contract terms first</p>`;
    }
    return;
  }

  const targetChar = world.characters.find((c) => c.name === targetName);
  if (!targetChar) return;

  // Execute the contract offer
  const action: Action = {
    type: "issue_contract",
    targetCharacterId: targetChar.id,
    contractContents: terms,
    contractExpiry: expiry,
    message: pitch,
  };

  const result = executeAction(world, current, action);
  for (const evt of result.events) {
    allEvents.push(evt);
    addLogEntry(evt);
  }

  if (result.success) {
    // Handle the negotiation
    const { signed, response } = await handleContractNegotiation(
      current,
      targetChar,
      terms,
      expiry,
      pitch
    );

    if (signed) {
      // Create and activate the contract
      const contract = {
        id: crypto.randomUUID(),
        issuerId: current.id,
        issuerName: current.name,
        targetId: targetChar.id,
        targetName: targetChar.name,
        contents: terms,
        expiryTurn: world.turn + expiry,
        signed: true,
        createdTurn: world.turn,
      };

      world.activeContracts.push(contract);

      // Add to both inventories
      const issuerCopy = {
        id: crypto.randomUUID(),
        name: `Contract with ${targetChar.name}`,
        type: "contract" as const,
        contract,
      };
      const targetCopy = {
        id: crypto.randomUUID(),
        name: `Contract with ${current.name}`,
        type: "contract" as const,
        contract,
      };
      current.inventory.push(issuerCopy);
      targetChar.inventory.push(targetCopy);

      const signedEvt: GameEvent = {
        turn: world.turn,
        type: "contract_signed",
        actorId: targetChar.id,
        targetId: current.id,
        message: terms,
        description: `🩸 ${targetChar.name} signed the Blood Contract with ${current.name}: "${terms}" (expires turn ${contract.expiryTurn})`,
        witnessIds: [targetChar.id, current.id],
      };
      allEvents.push(signedEvt);
      addLogEntry(signedEvt);
    } else {
      const declineEvt: GameEvent = {
        turn: world.turn,
        type: "talk",
        actorId: targetChar.id,
        targetId: current.id,
        message: response || "declined",
        description: `${targetChar.name} declined the Blood Contract${
          response ? `: "${response}"` : ""
        }`,
        witnessIds: [targetChar.id, current.id],
      };
      allEvents.push(declineEvt);
      addLogEntry(declineEvt);
    }

    // Contract no longer ends turn - show actions again
    showPlayerActions();
    selectedAction = null;
  } else {
    const details = document.getElementById("action-details");
    if (details) {
      details.innerHTML += `<p style="color: var(--accent-red);">⚠️ ${result.message}</p>`;
    }
  }

  updateUI();
}

// Expose functions to window for onclick handlers
(window as any).executePlayerAction = executePlayerAction;
(window as any).executePlayerTalk = executePlayerTalk;
(window as any).executePlayerContract = executePlayerContract;

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
      if (d.errors && d.errors.length > 0) {
        lines.push("");
        lines.push("--- ERRORS ---");
        for (const error of d.errors) {
          lines.push(`⚠️ ${error}`);
        }
      }
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

function showGameOverBanner(winnerName: string | null): void {
  const banner = document.createElement("div");
  banner.id = "game-over-banner";
  banner.setAttribute("role", "alert");
  banner.setAttribute("aria-live", "assertive");
  banner.style.cssText = `
    position: fixed;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    background: linear-gradient(135deg, #1a1a2e 0%, #16213e 100%);
    border: 3px solid #ffcc44;
    padding: 2rem 3rem;
    border-radius: 12px;
    z-index: 1000;
    text-align: center;
    box-shadow: 0 0 50px rgba(255, 204, 68, 0.3);
  `;
  banner.innerHTML = `
    <h2 style="font-family: 'Press Start 2P', cursive; font-size: 1.5rem; color: #ffcc44; margin-bottom: 1rem;">
      🏆 GAME OVER 🏆
    </h2>
    <p style="font-size: 1.2rem; color: #e8e8f0; margin-bottom: 0.5rem;">
      ${
        winnerName
          ? `${winnerName} is the last one standing!`
          : "Everyone is dead!"
      }
    </p>
    <p style="font-size: 0.9rem; color: #8888a0; margin-top: 1rem;">
      Logs printed to browser console
    </p>
    <button id="close-game-over" style="
      margin-top: 1rem;
      padding: 0.5rem 1.5rem;
      font-family: 'JetBrains Mono', monospace;
      background: #ffcc44;
      border: none;
      border-radius: 4px;
      color: #000;
      cursor: pointer;
      font-weight: 600;
    ">Close</button>
  `;
  document.body.appendChild(banner);

  document.getElementById("close-game-over")?.addEventListener("click", () => {
    banner.remove();
  });
}

function getCompactLogText(): string {
  const lines: string[] = [];

  lines.push("=".repeat(80));
  lines.push("AILAND GAME LOG (COMPACT)");
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
      lines.push(`[Turn ${d.turn}] ${d.character} thinks: "${d.reasoning}"`);

      try {
        const response = JSON.parse(d.fullResponse);
        // Handle single action (new format)
        if (response.action) {
          let str = response.action;
          if (response.x !== null && response.y !== null)
            str += ` (${response.x}, ${response.y})`;
          if (response.target) str += ` "${response.target}"`;
          if (response.message) str += `: "${response.message}"`;
          lines.push(`  Action: ${str}`);
        }
      } catch {
        lines.push(`  Response: ${d.fullResponse.substring(0, 200)}...`);
      }

      // Include any errors
      if (d.errors && d.errors.length > 0) {
        for (const error of d.errors) {
          lines.push(`  ⚠️ ERROR: ${error}`);
        }
      }
    }
  }

  return lines.join("\n");
}

function saveCompactLogsToFile(): void {
  const text = getCompactLogText();

  // Log to console for automated reading via browser tools
  console.log("=== GAME LOG START ===");
  console.log(text);
  console.log("=== GAME LOG END ===");
}

function exportLogsCompact(): void {
  const text = getCompactLogText();

  navigator.clipboard
    .writeText(text)
    .then(() => {
      const btn = document.getElementById("export-compact-btn");
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
  world = createCageMap(); // Options: createBloodsportMap(), createCageMap()

  canvas = document.getElementById("game-canvas") as HTMLCanvasElement;
  ctx = canvas.getContext("2d")!;

  const size = getCanvasSize(world);
  canvas.width = size.width;
  canvas.height = size.height;

  showApiKeyPrompt();

  saveSnapshot();
  renderWorld();
  updateUI();
  hidePlayerActions(); // Start with player actions hidden

  canvas.addEventListener("click", handleCanvasClick);

  const nextTurnBtn = document.getElementById("next-turn-btn");
  nextTurnBtn?.addEventListener("click", () => {
    if (!isProcessingTurn) {
      processTurn();
    }
  });

  const autoPlayBtn = document.getElementById("auto-play-btn");
  autoPlayBtn?.addEventListener("click", toggleAutoPlay);

  const speedToggleBtn = document.getElementById("speed-toggle-btn");
  speedToggleBtn?.addEventListener("click", toggleSpeed);

  const playerControlBtn = document.getElementById("player-control-btn");
  playerControlBtn?.addEventListener("click", togglePlayerControl);
  playerControlBtn?.addEventListener("contextmenu", (e) => {
    e.preventDefault();
    cyclePlayerCharacter();
  });

  // Action button listeners
  document.querySelectorAll(".action-btn[data-action]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const action = (btn as HTMLElement).dataset.action;
      if (action) selectPlayerAction(action);
    });
  });

  const exportLogsBtn = document.getElementById("export-logs-btn");
  exportLogsBtn?.addEventListener("click", exportLogs);

  const exportCompactBtn = document.getElementById("export-compact-btn");
  exportCompactBtn?.addEventListener("click", exportLogsCompact);

  const returnBtn = document.getElementById("return-to-present");
  returnBtn?.addEventListener("click", returnToPresent);

  const closeInspectorBtn = document.getElementById("close-inspector");
  closeInspectorBtn?.addEventListener("click", hideInspector);

  const contractsBtn = document.getElementById("contracts-btn");
  contractsBtn?.addEventListener("click", toggleContractsPanel);

  const closeContractsBtn = document.getElementById("close-contracts");
  closeContractsBtn?.addEventListener("click", hideContractsPanel);

  const initialEvent: GameEvent = {
    turn: 0,
    type: "move",
    actorId: "",
    description: "",
    witnessIds: [],
  };
  allEvents.push(initialEvent);
  addLogEntry(initialEvent);

  for (const character of world.characters) {
    const evt: GameEvent = {
      turn: 0,
      type: "move",
      actorId: character.id,
      description: `${character.name} is at (${character.position.x}, ${character.position.y})`,
      witnessIds: getWitnessIds(world, character.position),
    };
    allEvents.push(evt);
    addLogEntry(evt);
  }
}

document.addEventListener("DOMContentLoaded", init);
