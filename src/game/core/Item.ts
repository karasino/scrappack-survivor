import { capacityDelta, traitsFor, validVariant, variantName } from './ItemVariants';
import type { ItemTraits, ItemVariant } from './ItemVariants';
export type ItemType = 'weapon' | 'armor' | 'battery' | 'wire' | 'transformer' | 'component' | 'consumable';
export type VoltageType = 'low' | 'high';
export type TransformDirection = 'low-to-high' | 'high-to-low' | null;

export interface DirectionVector {
    x: number;
    y: number;
}

export interface ConnectedBattery {
    batteryId: string;
    costMultiplier: number;
}

export interface ItemConfig {
    id: string;
    definitionId?: string;
    name: string;
    width: number;
    height: number;
    color: number;
    gridX?: number;
    gridY?: number;
    type?: ItemType;
    baseDamage?: number;
    poweredDamage?: number;
    baseArmor?: number;
    poweredArmor?: number;
    capacity?: number;
    maxCapacity?: number;
    charge?: number;
    maxCharge?: number;
    voltageType?: VoltageType;
    transformDirection?: TransformDirection;
    requiredVoltage?: VoltageType;
    energyCost?: number;
    energyCostMultiplier?: number;
    isEnergySource?: boolean;
    inputDir?: DirectionVector;
    outputDir?: DirectionVector;
    connectionPorts?: DirectionVector[];
    quarterTurns?: number;
    healingAmount?: number;
    powerMode?: 'none' | 'optional';
    variant?: ItemVariant;
}

export class Item {
    public id: string;
    public readonly definitionId: string | null;
    public name: string;
    public readonly baseName: string;
    public readonly powerMode: 'none' | 'optional';
    public readonly variant: ItemVariant | null;
    public readonly traits: ItemTraits;
    public width: number;
    public height: number;
    public color: number;
    public gridX: number;
    public gridY: number;
    public type: ItemType;
    public baseDamage: number;
    public poweredDamage: number;
    public baseArmor: number;
    public poweredArmor: number;
    public capacity: number;
    public maxCapacity: number;
    public charge: number;
    public maxCharge: number;
    public voltageType: VoltageType;
    public transformDirection: TransformDirection;
    public requiredVoltage: VoltageType;
    public energyCost: number;
    public energyCostMultiplier: number;
    public isEnergySource: boolean = false;
    public isPowered: boolean = false;
    public connectedBatteries: ConnectedBattery[] = [];
    public isSelectedForTurn: boolean = false;
    public inputDir: DirectionVector;
    public outputDir: DirectionVector;
    public connectionPorts: DirectionVector[];
    public quarterTurns: number;
    public healingAmount: number;

    constructor(config: ItemConfig) {
        this.id = config.id;
        this.definitionId = config.definitionId ?? null;
        if (config.variant && (config.variant.baseDefinitionId !== config.definitionId || !validVariant(config.variant))) throw new Error('Invalid item variant.');
        this.variant = config.variant ? Object.freeze({ ...config.variant }) : null;
        this.traits = traitsFor(this.variant);
        this.baseName = config.name;
        this.name = this.variant ? variantName(config.name, this.variant, config.type === 'armor') : config.name;
        this.powerMode = config.powerMode ?? ((config.type === 'armor' || config.type === 'weapon' || config.type === undefined) ? 'optional' : 'none');
        this.width = config.width;
        this.height = config.height;
        this.color = config.color;
        this.gridX = config.gridX ?? -1;
        this.gridY = config.gridY ?? -1;
        this.type = config.type ?? 'weapon';
        this.baseDamage = config.baseDamage ?? 0;
        this.poweredDamage = config.poweredDamage ?? 0;
        this.baseArmor = config.baseArmor ?? 0;
        this.poweredArmor = config.poweredArmor ?? 0;
        this.capacity = config.capacity ?? 0;
        this.maxCapacity = config.maxCapacity ?? 0;
        this.charge = config.charge ?? this.capacity;
        this.maxCharge = config.maxCharge ?? config.maxCapacity ?? this.charge;
        const delta = capacityDelta(this.variant);
        this.maxCharge += delta;
        this.maxCapacity += delta;
        this.charge = config.charge === undefined ? this.charge + delta : Math.min(this.maxCharge, this.charge + delta);
        this.capacity = this.charge;
        this.voltageType = config.voltageType ?? 'low';
        this.transformDirection = config.transformDirection ?? null;
        this.requiredVoltage = config.requiredVoltage ?? 'low';
        this.energyCost = config.energyCost ?? 0;
        this.energyCostMultiplier = config.energyCostMultiplier ?? 1;
        this.isEnergySource = config.isEnergySource ?? (this.type === 'battery');
        this.quarterTurns = ((Math.trunc(config.quarterTurns ?? 0) % 4) + 4) % 4;
        this.healingAmount = Math.max(0, config.healingAmount ?? 0);
        this.inputDir = { ...(config.inputDir ?? { x: -1, y: 0 }) };
        this.outputDir = { ...(config.outputDir ?? { x: 1, y: 0 }) };
        this.connectionPorts = (config.connectionPorts ?? (
            this.type === 'wire' ? [{ x: -1, y: 0 }, { x: 1, y: 0 }] : []
        )).map(port => ({ ...port }));
    }

    public rotate(): void {
        this.quarterTurns = (this.quarterTurns + 1) % 4;
        [this.width, this.height] = [this.height, this.width];

        const rotateDirection = (direction: DirectionVector): DirectionVector => ({
            x: direction.y === 0 ? 0 : -direction.y,
            y: direction.x === 0 ? 0 : direction.x
        });

        if (this.type === 'transformer') {
            this.inputDir = rotateDirection(this.inputDir);
            this.outputDir = rotateDirection(this.outputDir);
        }

        if (this.type === 'wire') {
            this.connectionPorts = this.connectionPorts.map(rotateDirection);
        }
    }
}
