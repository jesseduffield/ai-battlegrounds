export type Position = {
  x: number;
  y: number;
};

export type TileType = "ground" | "wall" | "door" | "grass";

export type PlacedTrap = {
  id: string;
  name: string;
  ownerId: string;
  damage: number;
  attackDebuff: number;
  debuffDuration: number;
};

export type Tile = {
  type: TileType;
  items: Item[];
  traps: PlacedTrap[];
  roomId?: string;
};

export type ItemType =
  | "weapon"
  | "clothing"
  | "consumable"
  | "container"
  | "trap"
  | "misc";

export type Item = {
  id: string;
  name: string;
  type: ItemType;
  damage?: number;
  armor?: number;
  contents?: Item[];
  searched?: boolean;
  trapDamage?: number;
  trapAttackDebuff?: number;
  trapDebuffDuration?: number;
};

export type TileMemory = {
  type: TileType;
  lastSeenTurn: number;
  items?: string[];
  characterName?: string;
  characterAlive?: boolean;
};

export type Character = {
  id: string;
  name: string;
  position: Position;
  hp: number;
  maxHp: number;
  inventory: Item[];
  equippedWeapon?: Item;
  equippedClothing?: Item;
  alive: boolean;
  personalityPrompt: string;
  movementRange: number;
  viewDistance: number;
  memories: Memory[];
  mapMemory: Map<string, TileMemory>;
  debuffTurnsRemaining: number;
  trapped?: boolean;
  attackDebuff?: number;
};

export type MemoryType =
  | "saw_item"
  | "saw_character"
  | "saw_corpse"
  | "saw_move"
  | "searched_container"
  | "picked_up_item"
  | "attacked"
  | "was_attacked"
  | "witnessed_attack"
  | "character_died"
  | "heard_about"
  | "talked_to"
  | "placed_trap"
  | "thought";

export type Memory = {
  id: string;
  turn: number;
  type: MemoryType;
  description: string;
  location?: Position;
  characterId?: string;
  itemId?: string;
  source: "witnessed" | string;
};

export type Room = {
  id: string;
  name: string;
  bounds: { minX: number; minY: number; maxX: number; maxY: number };
};

export type World = {
  width: number;
  height: number;
  tiles: Tile[][];
  rooms: Room[];
  characters: Character[];
  turn: number;
};

export type ActionType =
  | "move"
  | "look_around"
  | "search_container"
  | "pick_up"
  | "drop"
  | "equip"
  | "unequip"
  | "attack"
  | "talk"
  | "place"
  | "wait";

export type Action = {
  type: ActionType;
  targetPosition?: Position;
  targetCharacterId?: string;
  targetItemId?: string;
  targetItemName?: string;
  message?: string;
};

export type ActionResult = {
  success: boolean;
  message: string;
  events: GameEvent[];
  animationData?: {
    type: "move" | "attack" | "pickup" | "place";
    path?: Position[];
    targetPosition?: Position;
    damage?: number;
    missed?: boolean;
    itemName?: string;
  };
};

export type GameEventType =
  | "move"
  | "search"
  | "pickup"
  | "drop"
  | "equip"
  | "attack"
  | "damage"
  | "death"
  | "talk"
  | "miss"
  | "place_trap"
  | "trap_triggered";

export type GameEvent = {
  turn: number;
  type: GameEventType;
  actorId: string;
  targetId?: string;
  itemId?: string;
  position?: Position;
  damage?: number;
  message?: string;
  description: string;
};

export type VisibleState = {
  tiles: (Tile & { position: Position })[];
  characters: { character: Character; position: Position }[];
  items: { item: Item; position: Position }[];
};

export type CharacterKnowledge = {
  status: {
    hp: number;
    maxHp: number;
    position: Position;
    inventory: Item[];
    equippedWeapon?: Item;
    equippedClothing?: Item;
  };
  visible: VisibleState;
  memories: Memory[];
  possibleActions: Action[];
};
