import Phaser from 'phaser';
import type { RunState } from '../core/RunState';
import type { ExplorationEngine } from '../core/ExplorationEngine';
import { UITheme, cssColor } from './UITheme';

interface MapCallbacks {
    onMove(dx: number, dy: number): void;
    onWait(): void;
    onAction(): void;
    onHover(enemyId: string | null): void;
    onNewRun(): void;
}

interface MapButton {
    rect: Phaser.GameObjects.Rectangle;
    label: Phaser.GameObjects.Text;
    enabled: boolean;
    hovered: boolean;
    pointerId: number | null;
}

/** Reuses its graphics and text objects across sectors and layout changes. */
export class ExplorationMapView {
    public boardX = 824;
    public readonly boardY = 150;
    public readonly cellSize = 50;

    private readonly graphics: Phaser.GameObjects.Graphics;
    private readonly boardInput: Phaser.GameObjects.Zone;
    private readonly labels: Phaser.GameObjects.Text[] = [];
    private readonly title: Phaser.GameObjects.Text;
    private readonly turns: Phaser.GameObjects.Text;
    private readonly paused: Phaser.GameObjects.Text;
    private readonly help: Phaser.GameObjects.Text;
    private readonly waitButton: MapButton;
    private readonly actionButton: MapButton;
    private readonly scene: Phaser.Scene;
    private readonly callbacks: MapCallbacks;
    private visible = true;
    private compact = false;
    private enabled = false;
    private run: RunState | null = null;
    private engine: ExplorationEngine | null = null;
    private hoveredEnemyId: string | null = null;
    private pointerEnemyId: string | null = null;
    private signature = '';
    private gesture: { id: number; x: number; y: number; cellX: number; cellY: number; moved: boolean } | null = null;

    constructor(scene: Phaser.Scene, callbacks: MapCallbacks) {
        this.scene = scene;
        this.callbacks = callbacks;
        this.graphics = scene.add.graphics().setDepth(50);
        this.boardInput = scene.add.zone(this.boardX, this.boardY, 400, 400).setOrigin(0)
            .setDepth(51).setInteractive();
        const text = (size: number): Phaser.GameObjects.Text => scene.add.text(0, 0, '', {
            fontFamily: UITheme.fonts.family, fontSize: `${size}px`, color: cssColor(UITheme.colors.text)
        }).setDepth(52);
        this.title = text(UITheme.fonts.heading);
        this.turns = text(UITheme.fonts.body).setColor(cssColor(UITheme.colors.secondaryText));
        this.paused = text(UITheme.fonts.body).setColor(cssColor(UITheme.colors.warning));
        this.help = text(13).setWordWrapWidth(400, true).setText('WASD / ARROWS: MOVE   SPACE: WAIT   E: ACTION');
        for (let i = 0; i < 64; i++) this.labels.push(text(18).setOrigin(0.5));
        this.waitButton = this.createButton('WAIT', () => callbacks.onWait());
        this.actionButton = this.createButton('NO ACTION', () => {
            if (this.run?.mode === 'defeat' || this.run?.mode === 'complete') callbacks.onNewRun();
            else callbacks.onAction();
        });
        this.boardInput.on('pointerdown', (pointer: Phaser.Input.Pointer) => {
            if (!this.canMove() || !pointer.leftButtonDown()) return;
            const cell = this.pointerCell(pointer);
            this.gesture = { id: pointer.id, x: pointer.x, y: pointer.y,
                cellX: cell.x, cellY: cell.y, moved: false };
        });
        this.boardInput.on('pointermove', this.handleBoardHover, this);
        this.boardInput.on('pointerover', this.handleBoardHover, this);
        this.boardInput.on('pointerout', () => this.setPointerEnemy(null));
        this.boardInput.on('pointerup', (pointer: Phaser.Input.Pointer) => {
            const gesture = this.gesture;
            this.gesture = null;
            if (!gesture || gesture.id !== pointer.id || pointer.button !== 0 || gesture.moved || !this.canMove()) return;
            const cell = this.pointerCell(pointer);
            if (gesture.cellX !== cell.x || gesture.cellY !== cell.y || !this.run) return;
            const dx = cell.x - this.run.hero.x;
            const dy = cell.y - this.run.hero.y;
            if (Math.abs(dx) + Math.abs(dy) === 1) this.callbacks.onMove(dx, dy);
        });
        scene.input.on('pointermove', this.trackGesture, this);
        scene.input.on('pointerup', this.clearGestures, this);
        scene.input.on('pointerupoutside', this.clearGestures, this);
        scene.game.events.on(Phaser.Core.Events.BLUR, this.clearGestures, this);
        this.setLayout(false);
    }

    public setLayout(compact: boolean): void {
        this.compact = compact;
        this.boardX = compact ? 200 : 824;
        this.boardInput.setPosition(this.boardX, this.boardY);
        this.title.setPosition(this.boardX, 110);
        this.turns.setPosition(this.boardX, 132);
        this.paused.setPosition(this.boardX, 82);
        this.help.setPosition(this.boardX, 614).setVisible(this.visible && !compact);
        this.positionButton(this.waitButton, this.boardX, compact ? 560 : 566, 112, compact ? 32 : 40);
        this.positionButton(this.actionButton, this.boardX + 124, compact ? 560 : 566, 168, compact ? 32 : 40);
        for (let y = 0; y < 8; y++) {
            for (let x = 0; x < 8; x++) {
                this.labels[y * 8 + x].setPosition(this.boardX + x * 50 + 25, this.boardY + y * 50 + 25);
            }
        }
        this.clearGestures();
        this.signature = '';
        if (this.run && this.engine) this.refresh(this.run, this.engine, this.hoveredEnemyId, this.enabled);
    }

    public setVisible(visible: boolean): void {
        this.visible = visible;
        this.graphics.setVisible(visible);
        this.boardInput.setVisible(visible);
        if (this.boardInput.input) this.boardInput.input.enabled = visible;
        for (const object of [this.title, this.turns, this.paused, ...this.labels]) object.setVisible(visible);
        this.help.setVisible(visible && !this.compact);
        for (const button of [this.waitButton, this.actionButton]) {
            button.rect.setVisible(visible);
            button.label.setVisible(visible);
            if (button.rect.input) button.rect.input.enabled = visible;
        }
        if (!visible) {
            this.clearGestures();
            this.setPointerEnemy(null);
        }
    }

    public refresh(run: RunState, engine: ExplorationEngine, hoveredEnemyId: string | null, enabled: boolean): void {
        this.run = run;
        this.engine = engine;
        this.enabled = enabled;
        this.hoveredEnemyId = hoveredEnemyId;
        // A world action can clear the scene's hover without a pointerout event.
        // Keep the event cache aligned so hovering that enemy again is reported.
        this.pointerEnemyId = hoveredEnemyId;
        const final = run.mode === 'complete' || run.mode === 'defeat';
        this.title.setText(`SECTOR ${String(run.sectorIndex + 1).padStart(2, '0')} / 02`);
        this.turns.setText(`WORLD TURN: ${String(run.worldTurn).padStart(2, '0')}`);
        this.paused.setText(run.mode === 'combat' ? 'MAP PAUSED'
            : run.mode === 'complete' ? 'DEMO COMPLETE' : run.mode === 'defeat' ? 'DEFEAT' : '');
        const action = engine.contextualAction();
        this.waitButton.enabled = enabled && run.mode === 'exploration';
        this.actionButton.enabled = final || (enabled && action !== null && run.mode === 'exploration');
        this.actionButton.label.setText(final ? 'NEW RUN' : action === 'search' ? 'SEARCH' : action === 'exit' ? 'LEAVE SECTOR' : 'NO ACTION');
        this.styleButton(this.waitButton);
        this.styleButton(this.actionButton);
        const signature = JSON.stringify([run.sectorIndex, run.map.rows, run.hero, run.enemies, run.lootPoints,
            Array.from(run.groundItems, ([key, items]) => [key, items.length]), hoveredEnemyId]);
        if (signature === this.signature) return;
        this.signature = signature;
        this.drawBoard();
    }

    private drawBoard(): void {
        const run = this.run;
        const engine = this.engine;
        if (!run || !engine) return;
        const g = this.graphics.clear();
        const hovered = run.enemies.find(enemy => enemy.id === this.hoveredEnemyId);
        const detection = new Set(hovered ? engine.detectionCells(hovered).map(cell => `${cell.x},${cell.y}`) : []);
        for (let y = 0; y < 8; y++) {
            for (let x = 0; x < 8; x++) {
                const left = this.boardX + x * 50;
                const top = this.boardY + y * 50;
                const cx = left + 25;
                const cy = top + 25;
                const wall = run.map.rows[y]?.[x] === '#';
                g.fillStyle(wall ? UITheme.colors.itemBackground : UITheme.colors.panel).fillRect(left, top, 50, 50);
                if (wall) {
                    g.lineStyle(1, UITheme.colors.border);
                    for (let offset = -36; offset < 50; offset += 12) {
                        const start = Math.max(4, offset);
                        const end = Math.min(46, offset + 42);
                        if (end > start) g.lineBetween(left + start, top + 46 - start + offset, left + end, top + 46 - end + offset);
                    }
                }
                if (detection.has(`${x},${y}`)) g.fillStyle(UITheme.colors.warning, 0.12).fillRect(left + 1, top + 1, 48, 48);
                g.lineStyle(1, UITheme.colors.border).strokeRect(left, top, 50, 50);
                const label = this.labels[y * 8 + x].setText('').setColor(cssColor(UITheme.colors.text));
                const point = run.lootPoints.find(candidate => candidate.x === x && candidate.y === y);
                const ground = (run.groundItems.get(`${x},${y}`)?.length ?? 0) > 0;
                if (x === run.map.exit.x && y === run.map.exit.y) {
                    g.lineStyle(2, UITheme.colors.powered).strokeRect(left + 8, top + 8, 34, 34);
                    label.setText('X').setColor(cssColor(UITheme.colors.powered));
                }
                if (point) {
                    g.lineStyle(1, point.searched ? UITheme.colors.secondaryText : UITheme.colors.selected)
                        .strokeRect(left + 11, top + 13, 28, 24);
                    label.setText(point.searched ? (ground ? '+' : '·') : point.id.endsWith('1') ? '1' : '2')
                        .setColor(cssColor(point.searched ? UITheme.colors.secondaryText : UITheme.colors.selected));
                } else if (ground) label.setText('+').setColor(cssColor(UITheme.colors.selected));
                const enemy = run.enemies.find(candidate => candidate.x === x && candidate.y === y);
                if (enemy) {
                    g.fillStyle(UITheme.colors.itemBackground).lineStyle(2, UITheme.colors.warning);
                    if (enemy.kind === 'rat') g.fillCircle(cx, cy, 16).strokeCircle(cx, cy, 16);
                    else g.fillTriangle(cx, top + 7, left + 7, top + 41, left + 43, top + 41)
                        .strokeTriangle(cx, top + 7, left + 7, top + 41, left + 43, top + 41);
                    label.setText(`${enemy.kind === 'rat' ? 'R' : 'C'}${enemy.isChasing ? '!' : ''}`)
                        .setColor(cssColor(UITheme.colors.warning));
                }
                if (run.hero.x === x && run.hero.y === y) {
                    g.fillStyle(UITheme.colors.background).lineStyle(2, UITheme.colors.powered);
                    g.beginPath().moveTo(cx, top + 6).lineTo(left + 44, cy).lineTo(cx, top + 44).lineTo(left + 6, cy)
                        .closePath().fillPath().strokePath();
                    label.setText('P').setColor(cssColor(UITheme.colors.powered));
                }
                if (ground && (enemy || (run.hero.x === x && run.hero.y === y))) {
                    g.lineStyle(2, UITheme.colors.selected).lineBetween(left + 39, top + 38, left + 39, top + 46)
                        .lineBetween(left + 35, top + 42, left + 43, top + 42);
                }
            }
        }
    }

    private createButton(label: string, action: () => void): MapButton {
        const rect = this.scene.add.rectangle(0, 0, 112, 40, UITheme.colors.button).setOrigin(0).setDepth(52).setInteractive();
        const text = this.scene.add.text(0, 0, label, { fontFamily: UITheme.fonts.family,
            fontSize: '16px', color: cssColor(UITheme.colors.text) }).setOrigin(0.5).setDepth(53);
        const button: MapButton = { rect, label: text, enabled: false, hovered: false, pointerId: null };
        rect.on('pointerover', () => { button.hovered = true; this.styleButton(button); });
        rect.on('pointerout', () => { button.hovered = false; button.pointerId = null; this.styleButton(button); });
        rect.on('pointerdown', (pointer: Phaser.Input.Pointer) => {
            if (this.visible && button.enabled && pointer.leftButtonDown()) {
                button.pointerId = pointer.id;
                this.styleButton(button);
            }
        });
        rect.on('pointerup', (pointer: Phaser.Input.Pointer) => {
            const accepted = this.visible && button.enabled && button.pointerId === pointer.id && pointer.button === 0;
            button.pointerId = null;
            this.styleButton(button);
            if (accepted) action();
        });
        return button;
    }

    private positionButton(button: MapButton, x: number, y: number, width: number, height: number): void {
        button.rect.setPosition(x, y).setSize(width, height);
        if (button.rect.input?.hitArea instanceof Phaser.Geom.Rectangle) button.rect.input.hitArea.setSize(width, height);
        button.label.setPosition(x + width / 2, y + height / 2);
    }

    private styleButton(button: MapButton): void {
        button.rect.setFillStyle(!button.enabled ? UITheme.colors.buttonDisabled : button.pointerId !== null
            ? UITheme.colors.buttonPressed : button.hovered ? UITheme.colors.buttonHover : UITheme.colors.button)
            .setStrokeStyle(1, UITheme.colors.border);
        button.label.setColor(cssColor(button.enabled ? UITheme.colors.text : UITheme.colors.disabledText));
        if (button.rect.input) button.rect.input.cursor = button.enabled ? 'pointer' : 'default';
    }

    private canMove(): boolean {
        return this.visible && this.enabled && this.run?.mode === 'exploration';
    }

    private pointerCell(pointer: Phaser.Input.Pointer): { x: number; y: number } {
        return { x: Math.floor((pointer.x - this.boardX) / 50), y: Math.floor((pointer.y - this.boardY) / 50) };
    }

    private handleBoardHover(pointer: Phaser.Input.Pointer): void {
        const cell = this.pointerCell(pointer);
        this.setPointerEnemy(this.run?.enemies.find(enemy => enemy.x === cell.x && enemy.y === cell.y)?.id ?? null);
    }

    private setPointerEnemy(id: string | null): void {
        if (id === this.pointerEnemyId) return;
        this.pointerEnemyId = id;
        this.callbacks.onHover(id);
    }

    private trackGesture(pointer: Phaser.Input.Pointer): void {
        if (this.gesture?.id === pointer.id && Math.hypot(pointer.x - this.gesture.x, pointer.y - this.gesture.y) >= 6) {
            this.gesture.moved = true;
        }
    }

    private clearGestures(): void {
        this.gesture = null;
        for (const button of [this.waitButton, this.actionButton]) {
            button.pointerId = null;
            this.styleButton(button);
        }
    }

    public destroy(): void {
        this.scene.input.off('pointermove', this.trackGesture, this);
        this.scene.input.off('pointerup', this.clearGestures, this);
        this.scene.input.off('pointerupoutside', this.clearGestures, this);
        this.scene.game.events.off(Phaser.Core.Events.BLUR, this.clearGestures, this);
        this.graphics.destroy();
        this.boardInput.destroy();
        for (const text of [this.title, this.turns, this.paused, this.help, ...this.labels]) text.destroy();
        for (const button of [this.waitButton, this.actionButton]) {
            button.rect.destroy();
            button.label.destroy();
        }
    }
}
