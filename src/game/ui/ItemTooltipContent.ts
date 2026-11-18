import { describeItem, traitLines, ownItemStats } from '../core/ItemVariants';
import type { Item } from '../core/Item';
import type { EnergyUnavailableReason, PoweredEffectPreview } from '../core/EnergyPlan';
import { TOOLTIP_TEXT as TEXT } from './TooltipText';

export interface TooltipLine {
    text: string;
    active?: boolean;
    tone?: 'powered' | 'warning';
}

export interface ItemTooltipContent {
    name: string;
    type: string;
    lines: TooltipLine[];
    charge?: { ratio: number; percent: string };
}

export function formatTooltipNumber(value: number): string {
    return value > 0 && value < 0.01 ? '<0.01' : Number(value.toFixed(2)).toString();
}

export function buildItemTooltipContent(item: Item, powerPreview: PoweredEffectPreview): ItemTooltipContent {
    const content: ItemTooltipContent = { name: item.name, type: TEXT.types[item.type], lines: [] };
    const line = (label: string, value: string | number, active?: boolean, tone?: TooltipLine['tone']): TooltipLine => ({
        text: `${label}: ${typeof value === 'number' ? formatTooltipNumber(value) : value}`, active, tone
    });
    const voltage = item.requiredVoltage === 'low' ? TEXT.low : TEXT.high;
    const inGrid = item.gridX >= 0 && item.gridY >= 0;
    const powered = inGrid && powerPreview.available;
    switch (item.type) {
        case 'weapon':
        case 'armor': {
            if (item.powerMode === 'none') { content.lines = describeItem(item).map(text => ({ text })); break; }
            const weapon = item.type === 'weapon';
            const stats = ownItemStats(item);
            content.lines = [
                line(weapon ? TEXT.baseDamage : TEXT.baseShield, weapon ? stats.baseDamage : stats.baseArmor, !powered),
                line(weapon ? TEXT.poweredDamage : TEXT.poweredShield, weapon ? stats.poweredDamage : stats.poweredArmor,
                    powered, 'powered'),
                line(TEXT.requiredVoltage, voltage),
                line(TEXT.baseEnergyCost, `${formatTooltipNumber(stats.energyCost)} ${weapon ? TEXT.perAttack : TEXT.perTurnUsed}`),
                line(TEXT.connectedBatteries, inGrid ? item.connectedBatteries.length : 0)
            ];
            if (inGrid && !powered && powerPreview.reason !== null) {
                const warnings: Record<EnergyUnavailableReason, string> = {
                    'no-source': TEXT.noPowerSource,
                    'insufficient-charge': weapon ? TEXT.insufficientWeaponCharge : TEXT.insufficientArmorCharge,
                    'shared-charge-conflict': TEXT.sharedChargeConflict
                };
                content.lines.push({ text: warnings[powerPreview.reason], tone: 'warning' });
            }
            break;
        }
        case 'battery': {
            const ratio = item.maxCharge > 0 ? Math.max(0, Math.min(1, item.charge / item.maxCharge)) : 0;
            const percent = ratio > 0 && ratio < 0.01 ? '<1%' : `${Math.floor(ratio * 100)}%`;
            content.lines = [
                line(TEXT.charge, `${formatTooltipNumber(item.charge)} / ${formatTooltipNumber(item.maxCharge)}`),
                line(TEXT.outputVoltage, item.voltageType === 'low' ? TEXT.low : TEXT.high)
            ];
            content.charge = { ratio, percent };
            break;
        }
        case 'transformer':
            content.lines = [line(TEXT.conversion, item.transformDirection === 'low-to-high'
                ? TEXT.lowToHigh : item.transformDirection === 'high-to-low' ? TEXT.highToLow : TEXT.noConversion)];
            if (item.transformDirection !== null) {
                content.lines.push({ text: TEXT.conversionCost });
            }
            break;
        case 'wire':
            content.lines = [{ text: 'Energy cost -20% once per path.' }];
            break;
        case 'component':
            content.lines = [{ text: 'Used in workshop recipes.' }, { text: 'Carry in your backpack to craft.' }];
            break;
        case 'consumable':
            content.lines = [line('Restores HP', item.healingAmount),
                { text: 'Use HEAL while carried in the backpack.' },
                { text: 'Combat: replaces your attack.' },
                { text: 'Exploration: costs one world turn.' },
                { text: 'Workshop: no world turn.' }];
            break;
    }
    if (item.powerMode !== 'none' || item.type === 'battery') content.lines.push(...traitLines(item.variant).map(text => ({ text })));
    return content;
}
