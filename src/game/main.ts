import Phaser from 'phaser';
import { GameScene } from './scenes/GameScene';
import { UITheme, cssColor } from './ui/UITheme';
import '../style.css';

// Настройки конфигурации твоей игры Scrappack Survivor
const config: Phaser.Types.Core.GameConfig = {
    type: Phaser.AUTO, // Движок сам выберет WebGL или Canvas в зависимости от браузера
    width: 1248,
    height: 640,
    scale: { mode: Phaser.Scale.FIT, autoCenter: Phaser.Scale.CENTER_BOTH },
    backgroundColor: cssColor(UITheme.colors.background),
    parent: 'game-container',   // ID тега <div> в index.html, куда встроится игра
    scene: [GameScene],         // Список всех сцен в игре (пока только одна)
};

// Создаем и запускаем инстанс игры Phaser
export const game = new Phaser.Game(config);
