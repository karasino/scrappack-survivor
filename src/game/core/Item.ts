export interface ItemConfig {
    id: string;
    name: string;
    width: number;
    height: number;
    color: number;
}

export class Item {
    public id: string;
    public name: string;
    public width: number;
    public height: number;
    public color: number;

    constructor(config: ItemConfig) {
        this.id = config.id;
        this.name = config.name;
        this.width = config.width;
        this.height = config.height;
        this.color = config.color;
    }

    public rotate(): void {
        [this.width, this.height] = [this.height, this.width];
    }
}
