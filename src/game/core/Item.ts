export type ItemType = 'weapon' | 'armor' | 'battery' | 'wire' | 'transformer';
export type VoltageType = 'low' | 'high';
export type TransformDirection = 'low-to-high' | 'high-to-low' | null;

export interface ItemConfig {
    id: string;
    name: string;
    width: number;
    height: number;
    color: number;
    type?: ItemType;
    baseDamage?: number;
    poweredDamage?: number;
    baseArmor?: number;
    poweredArmor?: number;
    capacity?: number;
    maxCapacity?: number;
    voltageType?: VoltageType;
    transformDirection?: TransformDirection;
    requiredVoltage?: VoltageType;
    energyCost?: number;
    energyCostMultiplier?: number;
    isEnergySource?: boolean;
}

export class Item {
    public id: string;
    public name: string;
    public width: number;
    public height: number;
    public color: number;
    public type: ItemType;
    public baseDamage: number;
    public poweredDamage: number;
    public baseArmor: number;
    public poweredArmor: number;
    public capacity: number;
    public maxCapacity: number;
    public voltageType: VoltageType;
    public transformDirection: TransformDirection;
    public requiredVoltage: VoltageType;
    public energyCost: number;
    public energyCostMultiplier: number;
    public isEnergySource: boolean = false;
    public isPowered: boolean = false;

    constructor(config: ItemConfig) {
        this.id = config.id;
        this.name = config.name;
        this.width = config.width;
        this.height = config.height;
        this.color = config.color;
        this.type = config.type ?? 'weapon';
        this.baseDamage = config.baseDamage ?? 0;
        this.poweredDamage = config.poweredDamage ?? 0;
        this.baseArmor = config.baseArmor ?? 0;
        this.poweredArmor = config.poweredArmor ?? 0;
        this.capacity = config.capacity ?? 0;
        this.maxCapacity = config.maxCapacity ?? 0;
        this.voltageType = config.voltageType ?? 'low';
        this.transformDirection = config.transformDirection ?? null;
        this.requiredVoltage = config.requiredVoltage ?? 'low';
        this.energyCost = config.energyCost ?? 0;
        this.energyCostMultiplier = config.energyCostMultiplier ?? 1;
        this.isEnergySource = config.isEnergySource ?? (this.type === 'battery');
    }

    public rotate(): void {
        [this.width, this.height] = [this.height, this.width];
    }
}
