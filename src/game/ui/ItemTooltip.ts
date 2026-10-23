import Phaser from 'phaser';
import type { ItemTooltipContent } from './ItemTooltipContent';
import { TOOLTIP_TEXT } from './TooltipText';

const WIDTH = 280;
const PADDING = 12;
const LINE_STEP = 18;

export class ItemTooltip {
    private readonly scene: Phaser.Scene;
    private readonly container: Phaser.GameObjects.Container;
    private readonly background: Phaser.GameObjects.Graphics;
    private readonly chargeGraphics: Phaser.GameObjects.Graphics;
    private readonly labels: Phaser.GameObjects.Text[];
    private contentKey = '';
    private height = 0;

    constructor(scene: Phaser.Scene) {
        this.scene = scene;
        this.background = scene.add.graphics().setDepth(200);
        this.chargeGraphics = scene.add.graphics().setDepth(201);
        // Eight labels cover title, type, five consumer stats and an optional warning.
        // Battery content (including percentage) also fits this reusable pool.
        this.labels = Array.from({ length: 8 }, (_, index) => {
            const size = index === 0 ? 16 : 13;
            return scene.add.text(PADDING, PADDING, '', {
                fontFamily: 'monospace', fontSize: `${size}px`, color: '#00ff66',
                wordWrap: { width: WIDTH - PADDING * 2, useAdvancedWrap: true },
                metrics: { ascent: size - 3, descent: 3, fontSize: size },
                lineSpacing: LINE_STEP - size
            }).setOrigin(0).setDepth(201);
        });
        this.container = scene.add.container(0, 0, [this.background, this.chargeGraphics, ...this.labels])
            .setDepth(200).setVisible(false);
    }

    get visible(): boolean {
        return this.container.visible;
    }

    show(content: ItemTooltipContent, pointerX: number, pointerY: number): void {
        const key = JSON.stringify(content);
        if (key !== this.contentKey) {
            this.contentKey = key;
            this.layout(content);
        }
        let x = pointerX + 16;
        let y = pointerY + 16;
        if (x + WIDTH > this.scene.scale.width - 8) {
            x = pointerX - 16 - WIDTH;
        }
        if (y + this.height > this.scene.scale.height - 8) {
            y = pointerY - 16 - this.height;
        }
        x = Phaser.Math.Clamp(x, 8, this.scene.scale.width - 8 - WIDTH);
        y = Phaser.Math.Clamp(y, 8, Math.max(8, this.scene.scale.height - 8 - this.height));
        this.container.setPosition(x, y).setVisible(true);
    }

    private layout(content: ItemTooltipContent): void {
        for (const label of this.labels) {
            label.setVisible(false);
        }
        this.chargeGraphics.clear();
        let y = PADDING;
        let index = 0;
        const addText = (text: string, color = '#00ff66'): void => {
            const label = this.labels[index++];
            label.setPosition(PADDING, y).setText(text).setColor(color).setVisible(true);
            y += label.getWrappedText().length * LINE_STEP;
        };
        addText(content.name);
        addText(content.type, '#72b887');
        content.lines.forEach((line, lineIndex) => {
            const text = line.active ? `${TOOLTIP_TEXT.activeMarker} ${line.text}` : line.text;
            addText(text, line.active === undefined ? '#00ff66' : line.active ? '#39ff14' : '#72b887');
            if (lineIndex === 0 && content.charge) {
                addText(content.charge.percent, '#72b887');
                this.chargeGraphics.fillStyle(0x102b18).fillRect(PADDING, y, WIDTH - PADDING * 2, 8);
                if (content.charge.ratio > 0) {
                    this.chargeGraphics.fillStyle(0x39ff14)
                        .fillRect(PADDING, y, (WIDTH - PADDING * 2) * content.charge.ratio, 8);
                }
                y += LINE_STEP;
            }
        });
        this.height = y + PADDING;
        this.background.clear().fillStyle(0x07140b).fillRect(0, 0, WIDTH, this.height)
            .lineStyle(1, 0x00ff66).strokeRect(0, 0, WIDTH, this.height);
    }

    hide(): void {
        this.container.setVisible(false);
    }

    destroy(): void {
        this.container.destroy();
    }
}
