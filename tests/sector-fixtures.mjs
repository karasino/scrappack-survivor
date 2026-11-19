// Authored geometry is kept only for existing scenarios with explicit coordinates.
// A fixture adapts the public model; production always calls the real generator.
export const authoredCachePositions = [{ x: 1, y: 6 }, { x: 6, y: 3 }];
export const authoredSectorRows = [
    ['.......X','..##r...','.....#2.','.##..#..','......c.','.1r.##..','..#.....','S.......'],
    ['..#....X','..#c.#..','.....#..','.##...c.','.1..##..','..#r....','..#..#2.','S.......']
];

export function installAuthoredSectors(run) {
    const load = run.loadSector.bind(run);
    run.loadSector = index => {
        load(index);
        const rows = authoredSectorRows[index];
        run.map = { rows: [...rows], width: 8, height: 8, exit: { x: 7, y: 0 } };
        run.hero = { x: 0, y: 7 };
        const remaining = [...run.enemies];
        run.enemies = [];
        const placeEnemy = (kind,x,y) => {
            const n = remaining.findIndex(enemy => enemy.kind === kind);
            if (n < 0) throw Error('Missing authored enemy '+kind);
            const enemy = remaining.splice(n,1)[0];
            Object.assign(enemy,{id:`sector-${index+1}-enemy-${String(run.enemies.length+1).padStart(2,'0')}`,x,y,isChasing:false});
            run.enemies.push(enemy);
            return enemy;
        };
        for (let y=0;y<8;y++) for (let x=0;x<8;x++) {
            const symbol=rows[y][x];
            if(symbol==='r'||symbol==='c')placeEnemy(symbol==='r'?'rat':'scorpion',x,y);
            if(symbol==='1'||symbol==='2')Object.assign(run.lootPoints.find(p=>p.id.endsWith('-'+symbol)),{x,y});
        }
        if(index===1)run.requiredBossId=placeEnemy('brute',7,0).id;
        run.lootPoints.sort((a,b)=>a.y-b.y||a.x-b.x);
        run.blueprintCaches.forEach((cache,i)=>Object.assign(cache,authoredCachePositions[i]));
        if(index===1)Object.assign(run.aidStations[0],{x:0,y:4});
    };
    run.loadSector(run.sectorIndex);
    return run;
}
