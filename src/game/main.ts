import Phaser from 'phaser';
import { GameScene } from './scenes/GameScene';
import { UITheme, cssColor } from './ui/UITheme';

// Настройки конфигурации твоей игры Scrappack Survivor
const config: Phaser.Types.Core.GameConfig = {
    type: Phaser.AUTO, // Движок сам выберет WebGL или Canvas в зависимости от браузера
    width: 800,        // Ширина игрового окна в пикселях
    height: 600,       // Высота игрового окна в пикселях
    backgroundColor: cssColor(UITheme.colors.background),
    parent: 'game-container',   // ID тега <div> в index.html, куда встроится игра
    scene: [GameScene],         // Список всех сцен в игре (пока только одна)
};

// Создаем и запускаем инстанс игры Phaser
export const game = new Phaser.Game(config);
