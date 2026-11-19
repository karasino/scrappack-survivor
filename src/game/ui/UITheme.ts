// Presentation tokens shared by the scene, items and tooltips. No gameplay data.
export const UITheme = {
    colors: {
        background: 0x22262c,
        panel: 0x2d333b,
        text: 0xe6e2d8,
        secondaryText: 0xb0b5bc,
        border: 0x444b54,
        powered: 0x80b4a2,
        poweredConductor: 0x425e57,
        selected: 0xc9aa72,
        warning: 0xd6ad65,
        health: 0xb9827c,
        barBackground: 0x22262c,
        charge: 0x80b4a2,
        itemBackground: 0x3a424d,
        button: 0x3a424d,
        buttonHover: 0x46515d,
        buttonPressed: 0x6b5c43,
        buttonDisabled: 0x30353d,
        disabledText: 0x8b929c
    },
    fonts: {
        family: 'Arial, sans-serif',
        heading: 20,
        panelHeading: 16,
        body: 14,
        itemLabel: 12,
        tooltipTitle: 16,
        tooltipBody: 14,
        tooltipLine: 18,
        log: 13,
        logLine: 15,
        hintLine: 18
    },
    borders: { panel: 1, grid: 1, powered: 1, selection: 2, selectionInset: 2, arrow: 2 },
    opacity: { item: 0.85, selectedItem: 1, draggedItem: 0.6 },
    durations: { buttonHover: 120, tooltipDelay: 300, tooltipFade: 80, itemHover: 100 },
    item: { padding: 4, hoverScale: 1.03, powerBadge: { margin: 4, width: 14, height: 16, boltWidth: 8, boltHeight: 12 } },
    ground: { x: 562, y: 272, width: 202, height: 136 },
    combat: { brace: { x: 24, y: 392, width: 152, height: 36, hintY: 432 }, tacticsY: 354, previewY: 430 },
    tooltip: { width: 280, padding: 12, cursorOffset: 16, viewportMargin: 8, chargeHeight: 8 },
    layers: { item: 10, draggedItem: 30, connections: 35, hud: 100, tooltip: 200 }
} as const;

export function cssColor(color: number): string {
    return `#${color.toString(16).padStart(6, '0')}`;
}
