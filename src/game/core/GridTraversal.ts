import { WORLD_DIRECTIONS, worldKey } from './SectorDefinitions';
import type { WorldPosition } from './SectorDefinitions';

/** Distances through terrain only; occupants do not block detection. */
export function reachableDistances(
    start: WorldPosition,
    maxDistance: number,
    isWalkable: (position: WorldPosition) => boolean
): Map<string, number> {
    const distances = new Map<string, number>([[worldKey(start), 0]]);
    const queue: WorldPosition[] = [{ x: start.x, y: start.y }];
    for (let head = 0; head < queue.length; head++) {
        const current = queue[head];
        const distance = distances.get(worldKey(current))!;
        if (distance >= maxDistance) continue;
        for (const direction of WORLD_DIRECTIONS) {
            const next = { x: current.x + direction.x, y: current.y + direction.y };
            const key = worldKey(next);
            if (!isWalkable(next) || distances.has(key)) continue;
            distances.set(key, distance + 1);
            queue.push(next);
        }
    }
    return distances;
}
