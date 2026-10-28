import Phaser from 'phaser';
import { UITheme, cssColor } from './UITheme';
import { ViewButton } from './ViewButton';
import { MATERIAL_CAPACITY, MATERIAL_NAMES } from '../core/Crafting';
import type { MaterialType } from '../core/Crafting';
import type { RunState } from '../core/RunState';

const DEPTH = 500;
export class RunOverlayView {
    public kind: 'materials' | 'reward' | null = null;
    public readonly closeButton: ViewButton;
    public readonly continueButton: ViewButton;
    public readonly dropButtons: Record<MaterialType, ViewButton>;
    private readonly backdrop: Phaser.GameObjects.Rectangle;
    private readonly panel: Phaser.GameObjects.Graphics;
    private readonly title: Phaser.GameObjects.Text;
    private readonly body: Phaser.GameObjects.Text;
    private readonly counts: Phaser.GameObjects.Text[] = [];
    private readonly scene: Phaser.Scene;

    constructor(scene: Phaser.Scene, onClose: () => void,
        onDrop: (material: MaterialType) => void, onContinue: () => void) {
        this.scene = scene;
        this.backdrop = scene.add.rectangle(0, 0, scene.scale.width, scene.scale.height, 0x000000, 0.7)
            .setOrigin(0).setDepth(DEPTH).setInteractive();
        this.panel = scene.add.graphics().setDepth(DEPTH + 1);
        const label = (size: number) => scene.add.text(174, 164, '', {
            fontFamily: UITheme.fonts.family, fontSize: `${size}px`, color: cssColor(UITheme.colors.text)
        }).setDepth(DEPTH + 2);
        this.title = label(20);
        this.body = label(14).setPosition(174, 204).setWordWrapWidth(452, true).setLineSpacing(6);
        this.dropButtons = {} as Record<MaterialType, ViewButton>;
        (['metal', 'electronics', 'fabric'] as const).forEach((material, i) => {
            this.counts.push(label(16).setPosition(174, 228 + i * 48));
            this.dropButtons[material] = new ViewButton(scene, 'DROP 1', () => onDrop(material), DEPTH + 3)
                .place(514, 220 + i * 48, 112, 32);
        });
        this.closeButton = new ViewButton(scene, 'CLOSE', onClose, DEPTH + 3).place(450, 404, 176, 36);
        this.continueButton = new ViewButton(scene, 'CONTINUE', onContinue, DEPTH + 3).place(450, 404, 176, 36);
        this.setKind(null);
    }

    public setKind(kind: 'materials' | 'reward' | null): void {
        this.kind = kind;
        const visible = kind !== null;
        this.backdrop.setVisible(visible);
        if (this.backdrop.input) this.backdrop.input.enabled = visible;
        this.panel.setVisible(visible);
        this.title.setVisible(visible);
        this.body.setVisible(visible);
        this.closeButton.setVisible(kind === 'materials');
        this.continueButton.setVisible(kind === 'reward');
        this.counts.forEach(count => count.setVisible(kind === 'materials'));
        Object.values(this.dropButtons).forEach(button => button.setVisible(kind === 'materials'));
    }

    public refresh(run: RunState): void {
        this.backdrop.setSize(this.scene.scale.width, this.scene.scale.height);
        if (this.backdrop.input?.hitArea instanceof Phaser.Geom.Rectangle)
            this.backdrop.input.hitArea.setSize(this.scene.scale.width, this.scene.scale.height);
        this.panel.clear().fillStyle(UITheme.colors.panel).fillRect(150, 140, 500, 320)
            .lineStyle(1, UITheme.colors.border).strokeRect(150, 140, 500, 320);
        if (this.kind === 'materials') {
            this.title.setText(`MATERIALS — ${run.materialUsed} / ${MATERIAL_CAPACITY}`);
            this.body.setText(run.mode === 'combat' ? 'Materials cannot be dropped during combat.' : 'Drop one unit onto the ground or workshop bench.');
            (['metal', 'electronics', 'fabric'] as const).forEach((material, i) => {
                this.counts[i].setText(`${MATERIAL_NAMES[material]}: ${run.materials[material]}`);
                this.dropButtons[material].setEnabled(run.materials[material] > 0 &&
                    (run.mode === 'exploration' || run.mode === 'workshop'));
            });
        } else if (this.kind === 'reward' && run.pendingBossReward) {
            const reward = run.pendingBossReward;
            this.title.setText('BOSS DEFEATED');
            const components = reward.components.map(item => `${item.name} ×${item.quantity}`).join('\n');
            const expansion = reward.expansionApplied
                ? `\n\nBACKPACK EXPANSION\n${reward.oldSize.width} × ${reward.oldSize.height} → ${reward.newSize.width} × ${reward.newSize.height}\nUpgrade applied automatically.` : '';
            this.body.setText(`${reward.bossName}\n${components}${expansion}`);
            if (reward.expansionApplied) this.panel.lineStyle(2, UITheme.colors.selected).strokeRect(162, 290, 476, 100);
        }
    }

    public destroy(): void {
        this.backdrop.destroy(); this.panel.destroy(); this.title.destroy(); this.body.destroy();
        this.counts.forEach(count => count.destroy());
        [...Object.values(this.dropButtons), this.closeButton, this.continueButton].forEach(button => button.destroy());
    }
}
