import Phaser from 'phaser';
import type { BlueprintCache } from '../core/BlueprintGenerator';
import { describeRecipe } from '../core/ItemVariants';
import { LootTable } from '../core/LootTable';
import { UITheme, cssColor } from './UITheme';
import { ViewButton } from './ViewButton';

/** Canvas modal. Core owns postponement, learning and stale-command rejection. */
export class BlueprintChoiceView {
    public readonly learnButtons: ViewButton[] = [];
    public readonly closeButton: ViewButton;
    public visible = false;
    private cache: BlueprintCache | null = null;
    private readonly backdrop: Phaser.GameObjects.Rectangle;
    private readonly panel: Phaser.GameObjects.Graphics;
    private readonly title: Phaser.GameObjects.Text;
    private readonly explanation: Phaser.GameObjects.Text;
    private readonly names: Phaser.GameObjects.Text[] = [];
    private readonly details: Phaser.GameObjects.Text[] = [];
    private readonly scene: Phaser.Scene;
    constructor(scene: Phaser.Scene, onLearn: (cacheId: string, recipeId: string) => void, onClose: () => void) {
        this.scene = scene;
        this.backdrop = scene.add.rectangle(0, 0, 1, 1, 0x000000, 0.85).setOrigin(0).setDepth(600).setInteractive();
        for (const event of ['pointerdown', 'pointerup']) this.backdrop.on(event,
            (_p: unknown, _x: unknown, _y: unknown, data: Phaser.Types.Input.EventData) => data.stopPropagation());
        this.panel = scene.add.graphics().setDepth(601);
        const text = (size: number) => scene.add.text(0, 0, '', { fontFamily: UITheme.fonts.family,
            fontSize: `${size}px`, color: cssColor(UITheme.colors.text) }).setDepth(602);
        this.title = text(22).setText('CHOOSE A BLUEPRINT');
        this.explanation = text(14).setText('Learn one recipe. Craft the item later in a workshop. The other two blueprints will be lost.');
        for (let i = 0; i < 3; i++) {
            this.names.push(text(18)); this.details.push(text(14).setLineSpacing(6));
            this.learnButtons.push(new ViewButton(scene, 'LEARN', () => {
                const cache = this.cache, recipe = cache?.offers[i];
                if (this.visible && cache && recipe) onLearn(cache.id, recipe.id);
            }, 603));
        }
        this.closeButton = new ViewButton(scene, 'CLOSE', onClose, 603);
        this.hide();
    }
    public show(cache: BlueprintCache): void {
        this.cache = cache; this.visible = true;
        const width = this.scene.scale.width, height = this.scene.scale.height;
        const left = 24, top = 62, cardWidth = (width - 88) / 3;
        this.backdrop.setSize(width, height).setVisible(true);
        if (this.backdrop.input) { this.backdrop.input.enabled = true;
            (this.backdrop.input.hitArea as Phaser.Geom.Rectangle).setSize(width, height); }
        this.panel.setVisible(true).clear().fillStyle(UITheme.colors.panel).fillRect(12, top, width - 24, height - top - 16)
            .lineStyle(1, UITheme.colors.border).strokeRect(12, top, width - 24, height - top - 16);
        this.title.setPosition(left, top + 16).setVisible(true);
        this.explanation.setPosition(left, top + 50).setWordWrapWidth(width - 48, true).setVisible(true);
        cache.offers.forEach((recipe, i) => {
            const x = left + i * (cardWidth + 20);
            this.panel.fillStyle(UITheme.colors.itemBackground).fillRect(x, top + 104, cardWidth, height - top - 180)
                .lineStyle(1, UITheme.colors.border).strokeRect(x, top + 104, cardWidth, height - top - 180);
            this.names[i].setPosition(x + 10, top + 118).setText(LootTable.find(b => b.definitionId === recipe.outputDefinitionId)!.name)
                .setWordWrapWidth(cardWidth - 20, true).setVisible(true);
            this.details[i].setPosition(x + 10, top + 158).setWordWrapWidth(cardWidth - 20, true)
                .setText(describeRecipe(recipe).join('\n')).setVisible(true);
            this.learnButtons[i].place(x + 10, height - 124, cardWidth - 20).setVisible(true);
        });
        this.closeButton.place(width - 176, height - 68, 140).setVisible(true);
    }
    public hide(): void {
        this.visible = false; this.backdrop.setVisible(false);
        if (this.backdrop.input) this.backdrop.input.enabled = false;
        for (const o of [this.panel, this.title, this.explanation, ...this.names, ...this.details]) o.setVisible(false);
        [...this.learnButtons, this.closeButton].forEach(button => button.setVisible(false));
    }
    public destroy(): void {
        for (const o of [this.backdrop, this.panel, this.title, this.explanation, ...this.names, ...this.details]) o.destroy();
        [...this.learnButtons, this.closeButton].forEach(button => button.destroy());
    }
}
