import type OpenAI from "openai";

export type Position = {
  x: number;
  y: number;
};

export type TileType =
  | "ground"
  | "wall"
  | "door"
  | "grass"
  | "bars"
  | "blue_door";

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
  | "contract"
  | "key"
  | "misc";

export type BloodContract = {
  id: string;
  issuerId: string;
  issuerName: string;
  targetId: string;
  targetName: string;
  contents: string;
  expiryTurn: number;
  signed: boolean; // true when target has countersigned
  createdTurn: number;
};

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
  contract?: BloodContract;
};

export type TileMemory = {
  type: TileType;
  lastSeenTurn: number;
  items?: string[];
  characterName?: string;
  characterAlive?: boolean;
};

export type ReasoningEffort = "none" | "low" | "medium" | "high";

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
  mapMemory: Map<string, TileMemory>;
  debuffTurnsRemaining: number;
  trapped?: boolean;
  attackDebuff?: number;
  aiModel: OpenAI.ResponsesModel;
  reasoningEffort: ReasoningEffort;
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
  activeContracts: BloodContract[];
  events: GameEvent[];
};

export type MoveAction = {
  type: "move";
  targetPosition: Position;
};

export type LookAroundAction = {
  type: "look_around";
};

export type SearchContainerAction = {
  type: "search_container";
  targetItemId: string;
};

export type PickUpAction = {
  type: "pick_up";
  targetItemName: string;
};

export type DropAction = {
  type: "drop";
  targetItemId: string;
};

export type EquipAction = {
  type: "equip";
  targetItemId: string;
};

export type UnequipAction = {
  type: "unequip";
  targetItemId: string;
};

export type AttackAction = {
  type: "attack";
  targetCharacterId: string;
};

export type TalkAction = {
  type: "talk";
  targetCharacterId: string;
  message: string;
};

export type PlaceAction = {
  type: "place";
  targetPosition: Position;
  targetItemId: string;
};

export type IssueContractAction = {
  type: "issue_contract";
  targetCharacterId: string;
  contractContents: string;
  contractExpiry: number;
  message?: string;
};

export type SignContractAction = {
  type: "sign_contract";
};

export type DeclineContractAction = {
  type: "decline_contract";
};

export type UnlockAction = {
  type: "unlock";
  targetDoorName: string;
};

export type WaitAction = {
  type: "wait";
};

export type Action =
  | MoveAction
  | LookAroundAction
  | SearchContainerAction
  | PickUpAction
  | DropAction
  | EquipAction
  | UnequipAction
  | AttackAction
  | TalkAction
  | PlaceAction
  | IssueContractAction
  | SignContractAction
  | DeclineContractAction
  | UnlockAction
  | WaitAction;

export type ActionType = Action["type"];

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
  | "think"
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
  | "trap_triggered"
  | "unlock"
  | "contract_issued"
  | "contract_signed"
  | "contract_judged"
  | "contract_violation";

export type GameEvent = {
  turn: number;
  order?: number;
  type: GameEventType;
  actorId: string;
  targetId?: string;
  itemId?: string;
  position?: Position;
  damage?: number;
  message?: string;
  description: string;
  judgePrompt?: string;
  judgeResponse?: string;
  witnessIds: string[];
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
  witnessedEvents: GameEvent[];
  possibleActions: Action[];
};
