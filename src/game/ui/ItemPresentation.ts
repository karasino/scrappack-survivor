import { UITheme } from './UITheme';

export interface ItemPresentation {
    readonly textureKey: string;
    readonly path: string;
    readonly padding: number;
}

// Only these two definitions have art in this prototype. An absent texture uses
// the same neutral fallback as an unknown definition (including Rusty Battery).
export const ITEM_PRESENTATIONS: Readonly<Record<string, ItemPresentation>> = {
    weak_battery: {
        textureKey: 'item-weak-battery', path: '/assets/items/weak-battery.png', padding: UITheme.item.padding
    },
    laser_pistol: {
        textureKey: 'item-laser-pistol', path: '/assets/items/laser-pistol.png', padding: UITheme.item.padding
    }
};

export function getItemPresentation(definitionId: string | null): ItemPresentation | undefined {
    return definitionId !== null && Object.hasOwn(ITEM_PRESENTATIONS, definitionId)
        ? ITEM_PRESENTATIONS[definitionId] : undefined;
}
