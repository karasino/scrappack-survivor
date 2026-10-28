import Phaser from 'phaser';
import { UITheme, cssColor } from './UITheme';
import { ViewButton } from './ViewButton';

export interface WorkshopPresentation {
    recipes: ReadonlyArray<{ id: string; name: string }>;
    selectedId: string;
    details: string;
    reason: string | null;
    canCraft: boolean;
    final: boolean;
    enabled: boolean;
}

export class WorkshopView {
    public readonly craftButton: ViewButton;
    public readonly continueButton: ViewButton;
    public readonly rows: ViewButton[] = [];
    public selectedRecipe = 'weak_battery';
    public x = 824;
    private readonly panel: Phaser.GameObjects.Graphics;
    private readonly title: Phaser.GameObjects.Text;
    private readonly details: Phaser.GameObjects.Text;
    private readonly hint: Phaser.GameObjects.Text;

    constructor(scene: Phaser.Scene, recipes: ReadonlyArray<{ id: string; name: string }>,
        onSelect: (id: string) => void, onCraft: () => void, onContinue: () => void) {
        this.panel = scene.add.graphics().setDepth(50);
        const label = (size: number) => scene.add.text(0, 0, '', {
            fontFamily: UITheme.fonts.family, fontSize: `${size}px`, color: cssColor(UITheme.colors.text)
        }).setDepth(112);
        this.title = label(20).setText('WORKSHOP');
        this.details = label(14).setWordWrapWidth(376, true).setLineSpacing(4);
        this.hint = label(13).setWordWrapWidth(400, true).setLineSpacing(3).setColor(cssColor(UITheme.colors.warning));
        for (const recipe of recipes) this.rows.push(new ViewButton(scene, recipe.name,
            () => { this.selectedRecipe = recipe.id; onSelect(recipe.id); }));
        this.craftButton = new ViewButton(scene, 'CRAFT', onCraft);
        this.continueButton = new ViewButton(scene, 'CONTINUE', onContinue);
        this.setLayout(false);
        this.setVisible(false);
    }

    public setLayout(compact: boolean): void {
        this.x = compact ? 200 : 824;
        this.title.setPosition(this.x, 110);
        this.rows.forEach((row, i) => row.place(this.x, 150 + i * 28, 400, 26));
        this.details.setPosition(this.x + 12, 368);
        this.hint.setPosition(this.x, 562);
        this.craftButton.place(this.x, 516, 192);
        this.continueButton.place(this.x + 204, 516, 196);
        this.panel.clear().fillStyle(UITheme.colors.panel).fillRect(this.x, 356, 400, 148)
            .lineStyle(1, UITheme.colors.border).strokeRect(this.x, 356, 400, 148);
    }

    public refresh(data: WorkshopPresentation): void {
        this.selectedRecipe = data.selectedId;
        this.rows.forEach((row, i) => {
            row.setEnabled(data.enabled);
            row.rect.setStrokeStyle(data.recipes[i]?.id === data.selectedId ? 2 : 1,
                data.recipes[i]?.id === data.selectedId ? UITheme.colors.selected : UITheme.colors.border);
        });
        this.details.setText(data.details);
        this.hint.setText(`${data.reason ?? 'Move crafted items from the bench into your backpack.'}\nItems left on the bench will be lost.`);
        this.craftButton.setEnabled(data.enabled && data.canCraft);
        this.continueButton.setText(data.final ? 'FINISH DEMO' : 'CONTINUE').setEnabled(data.enabled);
    }

    public setVisible(visible: boolean): void {
        for (const object of [this.panel, this.title, this.details, this.hint]) object.setVisible(visible);
        for (const button of [...this.rows, this.craftButton, this.continueButton]) button.setVisible(visible);
    }
    public destroy(): void {
        for (const object of [this.panel, this.title, this.details, this.hint]) object.destroy();
        for (const button of [...this.rows, this.craftButton, this.continueButton]) button.destroy();
    }
}
