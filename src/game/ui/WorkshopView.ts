import Phaser from 'phaser';
import { UITheme, cssColor } from './UITheme';
import { ViewButton } from './ViewButton';
export interface WorkshopPresentation {
    recipes: ReadonlyArray<{ id: string; name: string }>; selectedId: string; details: string;
    reason: string | null; canCraft: boolean; final: boolean; enabled: boolean;
}
export class WorkshopView {
    public readonly craftButton: ViewButton;
    public readonly continueButton: ViewButton;
    public readonly rows: ViewButton[] = [];
    public readonly previousButton: ViewButton;
    public readonly nextButton: ViewButton;
    public selectedRecipe = 'dagger';
    public page = 0;
    public x = 824;
    private data: WorkshopPresentation | null = null;
    private visible = false;
    private readonly panel: Phaser.GameObjects.Graphics;
    private readonly title: Phaser.GameObjects.Text;
    private readonly details: Phaser.GameObjects.Text;
    private readonly hint: Phaser.GameObjects.Text;
    private readonly pages: Phaser.GameObjects.Text;
    private readonly onSelect: (id: string) => void;
    constructor(scene: Phaser.Scene, _recipes: ReadonlyArray<{ id: string; name: string }>,
        onSelect: (id: string) => void, onCraft: () => void, onContinue: () => void) {
        this.onSelect = onSelect;
        this.panel = scene.add.graphics().setDepth(50);
        const label = (size: number) => scene.add.text(0, 0, '', {
            fontFamily: UITheme.fonts.family, fontSize: `${size}px`, color: cssColor(UITheme.colors.text)
        }).setDepth(112);
        this.title = label(20).setText('WORKSHOP');
        this.details = label(14).setWordWrapWidth(376, true).setLineSpacing(3);
        this.hint = label(13).setWordWrapWidth(400, true).setLineSpacing(3).setColor(cssColor(UITheme.colors.warning));
        this.pages = label(14);
        for (let i = 0; i < 4; i++) this.rows.push(new ViewButton(scene, '', () => {
            const recipe = this.data?.recipes[this.page * 4 + i];
            if (recipe) { this.selectedRecipe = recipe.id; this.onSelect(recipe.id); }
        }));
        this.previousButton = new ViewButton(scene, 'PREV', () => this.changePage(-1));
        this.nextButton = new ViewButton(scene, 'NEXT', () => this.changePage(1));
        this.craftButton = new ViewButton(scene, 'CRAFT', onCraft);
        this.continueButton = new ViewButton(scene, 'CONTINUE', onContinue);
        this.setLayout(false); this.setVisible(false);
    }
    private changePage(delta: number): void {
        if (!this.data) return;
        this.page = Math.max(0, Math.min(Math.ceil(this.data.recipes.length / 4) - 1, this.page + delta));
        this.selectedRecipe = this.data.recipes[this.page * 4]?.id ?? 'dagger';
        this.onSelect(this.selectedRecipe);
    }
    public setLayout(compact: boolean): void {
        this.x = compact ? 200 : 824;
        this.title.setPosition(this.x, 110);
        this.rows.forEach((row, i) => row.place(this.x, 150 + i * 28, 400, 26));
        this.previousButton.place(this.x, 270, 100, 28);
        this.nextButton.place(this.x + 300, 270, 100, 28); this.pages.setPosition(this.x + 164, 276);
        this.details.setPosition(this.x + 12, 322); this.hint.setPosition(this.x, 562);
        this.craftButton.place(this.x, 516, 192); this.continueButton.place(this.x + 204, 516, 196);
        this.panel.clear().fillStyle(UITheme.colors.panel).fillRect(this.x, 310, 400, 194)
            .lineStyle(1, UITheme.colors.border).strokeRect(this.x, 310, 400, 194);
    }
    public refresh(data: WorkshopPresentation): void {
        this.data = data; this.selectedRecipe = data.selectedId;
        const selectedIndex = data.recipes.findIndex(r => r.id === data.selectedId);
        if (selectedIndex >= 0) this.page = Math.floor(selectedIndex / 4);
        this.rows.forEach((row, i) => {
            const recipe = data.recipes[this.page * 4 + i];
            // Short row labels leave the full variant and properties in the details panel.
            row.setText(recipe?.name.split(' · ')[0] ?? '').setVisible(this.visible && !!recipe).setEnabled(data.enabled && !!recipe);
            row.rect.setStrokeStyle(recipe?.id === data.selectedId ? 2 : 1,
                recipe?.id === data.selectedId ? UITheme.colors.selected : UITheme.colors.border);
        });
        const count = Math.max(1, Math.ceil(data.recipes.length / 4));
        this.pages.setText(`${this.page + 1} / ${count}`);
        this.previousButton.setEnabled(data.enabled && this.page > 0);
        this.nextButton.setEnabled(data.enabled && this.page + 1 < count);
        this.details.setText(data.details);
        this.hint.setText(`${data.reason ?? 'Move crafted items into your backpack.'}\nItems left on the bench will be lost.`);
        this.craftButton.setEnabled(data.enabled && data.canCraft);
        this.continueButton.setText(data.final ? 'FINISH DEMO' : 'CONTINUE').setEnabled(data.enabled);
    }
    public setVisible(visible: boolean): void {
        this.visible = visible;
        for (const object of [this.panel, this.title, this.details, this.hint, this.pages]) object.setVisible(visible);
        for (const button of [...this.rows, this.craftButton, this.continueButton, this.previousButton, this.nextButton]) button.setVisible(visible);
    }
    public destroy(): void {
        for (const object of [this.panel, this.title, this.details, this.hint, this.pages]) object.destroy();
        for (const button of [...this.rows, this.craftButton, this.continueButton, this.previousButton, this.nextButton]) button.destroy();
    }
}
