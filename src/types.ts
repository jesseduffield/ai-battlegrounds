import type OpenAI from "openai";

export type Position = {
  x: number;
  y: number;
};

export type TileType = "ground" | "wall" | "grass" | "bars" | "water";

export type TrapFeature = {
  type: "trap";
  id: string;
  name: string;
  ownerId: string;
  appliesEffect: Effect;
  triggered: boolean;
};

export type DoorFeature = {
  type: "door";
  id: string;
  name: string;
  locked: boolean;
  open: boolean;
  keyId?: string;
};

export type ChestFeature = {
  type: "chest";
  id: string;
  name: string;
  searched: boolean;
  contents: Item[];
};

export type Feature = TrapFeature | DoorFeature | ChestFeature;

export type Tile = {
  type: TileType;
  items: Item[];
  feature?: Feature;
  roomId?: string;
};

export type ItemType =
  | "weapon"
  | "clothing"
  | "consumable"
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
  trapEffect?: Effect;
  useEffect?: EffectAction;
  contract?: BloodContract;
  unlocksFeatureId?: string;
};

export type TileMemory = {
  type: TileType;
  lastSeenTurn: number;
  items?: string[];
  characterName?: string;
  characterAlive?: boolean;
  feature?: { type: Feature["type"]; name: string };
};

export type ReasoningEffort = "none" | "low" | "medium" | "high";

export type EffectTrigger =
  | "turn_start"
  | "turn_end"
  | "on_attack"
  | "on_damaged"
  | "on_expired";

export type EffectAction =
  | { type: "damage"; amount: number }
  | { type: "heal"; amount: number }
  | {
      type: "modify_stat";
      stat: "attack" | "defense" | "speed";
      operation: "add" | "multiply";
      value: number;
    }
  | { type: "message"; text: string }
  | { type: "custom"; prompt: string }
  | { type: "apply_effect"; effect: Effect };

export type Effect = {
  id: string;
  name: string;
  sourceId?: string;
  duration: number; // Turns remaining, -1 for permanent
  preventsMovement?: boolean;
  triggers: Array<{
    on: EffectTrigger;
    actions: EffectAction[];
  }>;
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
  mapMemory: Map<string, TileMemory>;
  effects: Effect[];
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
  targetFeatureId: string;
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
  targetFeatureId: string;
};

export type WaitAction = {
  type: "wait";
};

export type UseAction = {
  type: "use";
  targetItemId: string;
};

export type Action =
  | MoveAction
  | LookAroundAction
  | SearchContainerAction
  | PickUpAction
  | DropAction
  | EquipAction
  | UnequipAction
  | UseAction
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

export type SoundEffect =
  | "pickup"
  | "drop"
  | "equip"
  | "attack"
  | "miss"
  | "death"
  | "search"
  | "trap"
  | "unlock"
  | "use";

export type GameEvent = {
  turn: number;
  order?: number;
  actorId: string;
  targetId?: string;
  itemId?: string;
  position?: Position;
  damage?: number;
  message?: string;
  description: string;
  sound?: SoundEffect;
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
