import type {
  World,
  Tile,
  TileType,
  Item,
  ItemType,
  Character,
  Feature,
  Effect,
  EffectAction,
  Room,
  ReasoningEffort,
} from "./types";
import { createId } from "./engine";

export type EditorTool =
  | "select"
  | "terrain"
  | "feature"
  | "item"
  | "character"
  | "room";

export type EditorState = {
  tool: EditorTool;
  selectedTerrain: TileType;
  selectedFeatureType: "door" | "chest" | "trap" | null;
  selectedItem: Item | null;
  selectedCharacter: Partial<Character> | null;
  width: number;
  height: number;
  tiles: Tile[][];
  characters: Character[];
  rooms: Room[];
  selectedPosition: { x: number; y: number } | null;
};

export function createEmptyWorld(width: number, height: number): Tile[][] {
  const tiles: Tile[][] = [];
  for (let y = 0; y < height; y++) {
    tiles[y] = [];
    for (let x = 0; x < width; x++) {
      tiles[y][x] = { type: "ground", items: [] };
    }
  }
  return tiles;
}

export function createDefaultEditorState(): EditorState {
  return {
    tool: "select",
    selectedTerrain: "ground",
    selectedFeatureType: null,
    selectedItem: null,
    selectedCharacter: null,
    width: 20,
    height: 15,
    tiles: createEmptyWorld(20, 15),
    characters: [],
    rooms: [],
    selectedPosition: null,
  };
}

export function resizeMap(
  state: EditorState,
  newWidth: number,
  newHeight: number
): Tile[][] {
  const newTiles: Tile[][] = [];
  for (let y = 0; y < newHeight; y++) {
    newTiles[y] = [];
    for (let x = 0; x < newWidth; x++) {
      if (y < state.height && x < state.width) {
        newTiles[y][x] = state.tiles[y][x];
      } else {
        newTiles[y][x] = { type: "ground", items: [] };
      }
    }
  }
  return newTiles;
}

export function createItem(data: {
  name: string;
  type: ItemType;
  damage?: number;
  armor?: number;
  useEffect?: EffectAction;
}): Item {
  return {
    id: createId(),
    name: data.name,
    type: data.type,
    damage: data.damage,
    armor: data.armor,
    useEffect: data.useEffect,
  };
}

export function createCharacter(data: {
  name: string;
  gender?: "male" | "female";
  x: number;
  y: number;
  hp: number;
  personalityPrompt: string;
  aiModel?: string;
  aiModelReasoningEffort?: ReasoningEffort;
  inventory?: Item[];
  equippedWeapon?: Item;
  equippedClothing?: Item;
  effects?: Effect[];
}): Character {
  return {
    id: createId(),
    name: data.name,
    gender: data.gender || "male",
    position: { x: data.x, y: data.y },
    hp: data.hp,
    maxHp: data.hp,
    inventory: data.inventory || [],
    equippedWeapon: data.equippedWeapon,
    equippedClothing: data.equippedClothing,
    alive: true,
    personalityPrompt: data.personalityPrompt,
    movementRange: 5,
    viewDistance: 8,
    mapMemory: new Map(),
    effects: data.effects || [],
    aiModel: (data.aiModel as any) || "gpt-5.2",
    reasoningEffort: data.aiModelReasoningEffort || "medium",
  };
}

export function createDoorFeature(data: {
  name: string;
  locked: boolean;
  keyId?: string;
}): Feature {
  return {
    type: "door",
    id: createId(),
    name: data.name,
    locked: data.locked,
    open: false,
    keyId: data.keyId,
  };
}

export function createChestFeature(data: {
  name: string;
  contents: Item[];
}): Feature {
  return {
    type: "chest",
    id: createId(),
    name: data.name,
    searched: false,
    contents: data.contents,
  };
}

export function createTrapFeature(data: {
  name: string;
  ownerId: string;
  effect: Effect;
}): Feature {
  return {
    type: "trap",
    id: createId(),
    name: data.name,
    ownerId: data.ownerId,
    appliesEffect: data.effect,
    triggered: false,
  };
}

export function editorStateToWorld(state: EditorState): World {
  return {
    width: state.width,
    height: state.height,
    tiles: state.tiles,
    characters: state.characters,
    rooms: state.rooms,
    turn: 0,
    events: [],
    activeContracts: [],
  };
}

export function worldToEditorState(world: World): EditorState {
  return {
    tool: "select",
    selectedTerrain: "ground",
    selectedFeatureType: null,
    selectedItem: null,
    selectedCharacter: null,
    width: world.width,
    height: world.height,
    tiles: world.tiles,
    characters: world.characters,
    rooms: world.rooms,
    selectedPosition: null,
  };
}

export function exportWorldAsJson(state: EditorState): string {
  const world = editorStateToWorld(state);
  // Convert Map to array for JSON serialization
  const serializable = {
    ...world,
    characters: world.characters.map((c) => ({
      ...c,
      mapMemory: Array.from(c.mapMemory.entries()),
    })),
  };
  return JSON.stringify(serializable, null, 2);
}

export function importWorldFromJson(json: string): EditorState {
  const data = JSON.parse(json);
  // Convert mapMemory arrays back to Maps
  const world: World = {
    ...data,
    characters: data.characters.map((c: any) => ({
      ...c,
      mapMemory: new Map(c.mapMemory || []),
    })),
  };
  return worldToEditorState(world);
}

const STORAGE_KEY = "ailand-editor-state";

export function saveEditorStateToStorage(state: EditorState): void {
  try {
    const json = exportWorldAsJson(state);
    localStorage.setItem(STORAGE_KEY, json);
  } catch (e) {
    console.error("Failed to save editor state to localStorage:", e);
  }
}

export function loadEditorStateFromStorage(): EditorState | null {
  try {
    const json = localStorage.getItem(STORAGE_KEY);
    if (json) {
      return importWorldFromJson(json);
    }
  } catch (e) {
    console.error("Failed to load editor state from localStorage:", e);
  }
  return null;
}

// Schema definitions for form generation
export const TILE_TYPES: TileType[] = [
  "ground",
  "wall",
  "grass",
  "bars",
  "water",
];

export const ITEM_TYPES: ItemType[] = [
  "weapon",
  "clothing",
  "consumable",
  "trap",
  "contract",
  "key",
  "misc",
];

export const AI_MODELS = [
  "gpt-5.2",
  "gpt-4.1",
  "gpt-4o",
  "gpt-4o-mini",
  "o4-mini",
];

export type FieldSchema = {
  name: string;
  label: string;
  type: "text" | "number" | "select" | "textarea" | "checkbox";
  options?: string[];
  required?: boolean;
  default?: any;
  showIf?: { field: string; value: any };
};

export const ITEM_SCHEMA: FieldSchema[] = [
  { name: "name", label: "Name", type: "text", required: true },
  {
    name: "type",
    label: "Type",
    type: "select",
    options: ITEM_TYPES,
    required: true,
    default: "misc",
  },
  {
    name: "damage",
    label: "Damage",
    type: "number",
    showIf: { field: "type", value: "weapon" },
  },
  {
    name: "armor",
    label: "Armor",
    type: "number",
    showIf: { field: "type", value: "clothing" },
  },
  {
    name: "healAmount",
    label: "Heal Amount",
    type: "number",
    showIf: { field: "type", value: "consumable" },
  },
];

export const CHARACTER_SCHEMA: FieldSchema[] = [
  { name: "name", label: "Name", type: "text", required: true },
  { name: "hp", label: "HP", type: "number", required: true, default: 20 },
  {
    name: "personalityPrompt",
    label: "Personality Prompt",
    type: "textarea",
    required: true,
  },
  {
    name: "aiModel",
    label: "AI Model",
    type: "select",
    options: AI_MODELS,
    default: "gpt-4.1",
  },
];

export const DOOR_SCHEMA: FieldSchema[] = [
  {
    name: "name",
    label: "Name",
    type: "text",
    required: true,
    default: "Door",
  },
  { name: "locked", label: "Locked", type: "checkbox", default: false },
];

export const CHEST_SCHEMA: FieldSchema[] = [
  {
    name: "name",
    label: "Name",
    type: "text",
    required: true,
    default: "Chest",
  },
];
