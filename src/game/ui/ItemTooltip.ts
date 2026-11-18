import Phaser from 'phaser';
import type { ItemTooltipContent } from './ItemTooltipContent';
import { TOOLTIP_TEXT } from './TooltipText';
import { UITheme, cssColor } from './UITheme';

const WIDTH = UITheme.tooltip.width;
const PADDING = UITheme.tooltip.padding;
const LINE_STEP = UITheme.fonts.tooltipLine;

export class ItemTooltip {
    private readonly scene: Phaser.Scene;
    private readonly container: Phaser.GameObjects.Container;
    private readonly background: Phaser.GameObjects.Graphics;
    private readonly chargeGraphics: Phaser.GameObjects.Graphics;
    private readonly labels: Phaser.GameObjects.Text[];
    private contentKey = '';
    private height = 0;
    private fadeTween: Phaser.Tweens.Tween | null = null;

    constructor(scene: Phaser.Scene) {
        this.scene = scene;
        this.background = scene.add.graphics();
        this.chargeGraphics = scene.add.graphics();
        // Reuse the common labels, growing the pool when variants need more rows.
        this.labels = Array.from({ length: 8 }, (_, index) => this.createLabel(index));
        this.container = scene.add.container(0, 0, [this.background, this.chargeGraphics, ...this.labels])
            .setDepth(UITheme.layers.tooltip).setVisible(false);
    }

    get visible(): boolean {
        return this.container.visible;
    }

    private createLabel(index: number): Phaser.GameObjects.Text {
        const size = index === 0 ? UITheme.fonts.tooltipTitle : UITheme.fonts.tooltipBody;
        return this.scene.add.text(PADDING, PADDING, '', {
            fontFamily: UITheme.fonts.family, fontSize: `${size}px`, color: cssColor(UITheme.colors.text),
            wordWrap: { width: WIDTH - PADDING * 2, useAdvancedWrap: true },
            metrics: { ascent: size - 3, descent: 3, fontSize: size },
            lineSpacing: LINE_STEP - size
        }).setOrigin(0);
    }

    show(content: ItemTooltipContent, pointerX: number, pointerY: number): void {
        const wasVisible = this.visible;
        const key = JSON.stringify(content);
        if (key !== this.contentKey) {
            this.layout(content);
            this.contentKey = key;
        }
        const { cursorOffset, viewportMargin } = UITheme.tooltip;
        let x = pointerX + cursorOffset;
        let y = pointerY + cursorOffset;
        if (x + WIDTH > this.scene.scale.width - viewportMargin) {
            x = pointerX - cursorOffset - WIDTH;
        }
        if (y + this.height > this.scene.scale.height - viewportMargin) {
            y = pointerY - cursorOffset - this.height;
        }
        x = Phaser.Math.Clamp(x, viewportMargin, this.scene.scale.width - viewportMargin - WIDTH);
        y = Phaser.Math.Clamp(y, viewportMargin, Math.max(viewportMargin, this.scene.scale.height - viewportMargin - this.height));
        this.container.setPosition(x, y).setVisible(true);
        if (!wasVisible) {
            this.container.setAlpha(0);
            this.fadeTween = this.scene.tweens.add({
                targets: this.container, alpha: 1, duration: UITheme.durations.tooltipFade,
                onComplete: () => { this.fadeTween = null; }
            });
        }
    }

    private layout(content: ItemTooltipContent): void {
        for (const label of this.labels) {
            label.setVisible(false);
        }
        this.chargeGraphics.clear();
        let y = PADDING;
        let index = 0;
        const addText = (text: string, color = cssColor(UITheme.colors.text)): void => {
            let label = this.labels[index];
            if (!label) {
                label = this.createLabel(index);
                this.labels.push(label);
                this.container.add(label);
            }
            index++;
            label.setPosition(PADDING, y).setText(text).setColor(color).setVisible(true);
            y += label.getWrappedText().length * LINE_STEP;
        };
        addText(content.name);
        addText(content.type, cssColor(UITheme.colors.secondaryText));
        content.lines.forEach((line, lineIndex) => {
            const text = line.active ? `${TOOLTIP_TEXT.activeMarker} ${line.text}` : line.text;
            const color = line.tone === 'warning' ? UITheme.colors.warning
                : line.active === false ? UITheme.colors.secondaryText
                : line.active && line.tone === 'powered' ? UITheme.colors.powered : UITheme.colors.text;
            addText(text, cssColor(color));
            if (lineIndex === 0 && content.charge) {
                addText(content.charge.percent, cssColor(UITheme.colors.secondaryText));
                this.chargeGraphics.fillStyle(UITheme.colors.barBackground)
                    .fillRect(PADDING, y, WIDTH - PADDING * 2, UITheme.tooltip.chargeHeight);
                if (content.charge.ratio > 0) {
                    this.chargeGraphics.fillStyle(UITheme.colors.charge)
                        .fillRect(PADDING, y, (WIDTH - PADDING * 2) * content.charge.ratio, UITheme.tooltip.chargeHeight);
                }
                y += LINE_STEP;
            }
        });
        this.height = y + PADDING;
        this.background.clear().fillStyle(UITheme.colors.panel).fillRect(0, 0, WIDTH, this.height)
            .lineStyle(UITheme.borders.panel, UITheme.colors.border).strokeRect(0, 0, WIDTH, this.height);
    }

    hide(): void {
        this.fadeTween?.remove();
        this.fadeTween = null;
        this.container.setVisible(false).setAlpha(0);
    }

    destroy(): void {
        this.hide();
        this.container.destroy();
    }
}
