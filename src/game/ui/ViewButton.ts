import Phaser from 'phaser';
import { UITheme, cssColor } from './UITheme';

/** One completed primary click invokes one action. Hidden buttons never receive input. */
export class ViewButton {
    public readonly rect: Phaser.GameObjects.Rectangle;
    public readonly label: Phaser.GameObjects.Text;
    public enabled = true;
    private visible = true;
    private hovered = false;
    private pointerId: number | null = null;
    private readonly scene: Phaser.Scene;

    constructor(scene: Phaser.Scene, text: string, action: () => void, depth = 110) {
        this.scene = scene;
        this.rect = scene.add.rectangle(0, 0, 100, 36, UITheme.colors.button).setOrigin(0).setDepth(depth)
            .setStrokeStyle(UITheme.borders.panel, UITheme.colors.border).setInteractive();
        this.label = scene.add.text(0, 0, text, {
            fontFamily: UITheme.fonts.family, fontSize: '14px', color: cssColor(UITheme.colors.text)
        }).setOrigin(0.5).setDepth(depth + 1);
        this.rect.on('pointerover', () => { this.hovered = true; this.style(); });
        this.rect.on('pointerout', () => { this.hovered = false; this.reset(); });
        this.rect.on('pointerdown', (pointer: Phaser.Input.Pointer) => {
            if (this.visible && this.enabled && pointer.leftButtonDown()) { this.pointerId = pointer.id; this.style(); }
        });
        this.rect.on('pointerup', (pointer: Phaser.Input.Pointer) => {
            const accepted = this.visible && this.enabled && this.pointerId === pointer.id && pointer.button === 0;
            this.reset();
            if (accepted) action();
        });
        scene.input.on('pointerupoutside', this.reset, this);
        scene.game.events.on(Phaser.Core.Events.BLUR, this.reset, this);
        scene.scale.on(Phaser.Scale.Events.RESIZE, this.reset, this);
        this.style();
    }

    public place(x: number, y: number, width: number, height = 36): this {
        this.reset();
        this.rect.setPosition(x, y).setSize(width, height);
        if (this.rect.input?.hitArea instanceof Phaser.Geom.Rectangle) this.rect.input.hitArea.setSize(width, height);
        this.label.setPosition(x + width / 2, y + height / 2);
        return this;
    }

    public setText(text: string): this { this.label.setText(text); return this; }
    public setEnabled(enabled: boolean): this { this.enabled = enabled; if (!enabled) this.pointerId = null; this.style(); return this; }
    public setVisible(visible: boolean): this {
        this.visible = visible;
        this.rect.setVisible(visible);
        this.label.setVisible(visible);
        if (this.rect.input) this.rect.input.enabled = visible;
        if (!visible) this.reset();
        return this;
    }
    public reset(): void { this.pointerId = null; this.style(); }
    private style(): void {
        this.rect.setFillStyle(!this.enabled ? UITheme.colors.buttonDisabled : this.pointerId !== null
            ? UITheme.colors.buttonPressed : this.hovered ? UITheme.colors.buttonHover : UITheme.colors.button);
        this.label.setColor(cssColor(this.enabled ? UITheme.colors.text : UITheme.colors.disabledText));
        if (this.rect.input) this.rect.input.cursor = this.enabled ? 'pointer' : 'default';
    }
    public destroy(): void {
        this.scene.input.off('pointerupoutside', this.reset, this);
        this.scene.game.events.off(Phaser.Core.Events.BLUR, this.reset, this);
        this.scene.scale.off(Phaser.Scale.Events.RESIZE, this.reset, this);
        this.rect.destroy(); this.label.destroy();
    }
}
