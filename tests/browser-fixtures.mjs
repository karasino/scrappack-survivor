// Development/test-only preparation. This function is serialized into the Vite page;
// production code never imports this module or installs its globals.
export const scenarioIds = ['transformer-chain', 'combat-heal'];
export const scenarioSeed = 170117;

async function installBrowserFixtures(fixedSeed) {
    const { game } = await import('/src/game/main.ts');
    const { Item } = await import('/src/game/core/Item.ts');
    const { LootTable } = await import('/src/game/core/LootTable.ts');
    const { CombatEngine } = await import('/src/game/core/CombatEngine.ts');
    const { UITheme } = await import('/src/game/ui/UITheme.ts');
    globalThis.uiTheme=UITheme;
    for (let i = 0; i < 100 && !game.scene.isActive('GameScene'); i++) {
        await new Promise(r => setTimeout(r, 20));
    }
    globalThis.s = game.scene.getScene('GameScene');
    if (!s?.endTurnButton?.input) throw Error('GameScene did not become ready');
    globalThis.seed = (items) => {
        for (const config of items) {
            const base = LootTable.find(item => item.definitionId === config.definitionId) ?? LootTable.find(item => item.definitionId === ({weapon:'laser_pistol',armor:'makeshift_vest',battery:'weak_battery',wire:'copper_wire',transformer:'step_up_transformer',consumable:'medkit'}[config.type]));
            const item = new Item({ ...base, ...config });
            if (config.x !== undefined) {
                if (!s.inventory.placeItem(item, config.x, config.y)) throw Error('Invalid fixture placement');
            }
            s.addItemVisual(item);
            if (config.x !== undefined) s.visualItemsMap.get(item.id).setPosition(200 + 50 * config.x, 150 + 50 * config.y);
        }
        s.refreshPowerGrid();
        s.updateCombatUI();
    };
    globalThis.freshRun = async (runSeed) => {
        if (runSeed !== undefined) {
            s.startNewRun(runSeed);
            s.backpackView=true;s.applyLayout();
            return;
        }
        const previous = s.run;
        s.scene.restart();
        for (let i = 0; i < 100 && (s.run === previous || !s.sys.isActive() || !s.endTurnButton?.input || s.endTurnButton.scene!==s); i++) await new Promise(r => setTimeout(r, 20));
        if (s.run === previous || !s.endTurnButton?.input || s.endTurnButton.scene!==s) throw Error('Scene did not finish restarting');
        s.backpackView=true;s.applyLayout();
    };
    globalThis.reset = async (runSeed, { ground = true, encounter } = {}) => {
        await freshRun(runSeed);
        // Legacy combat fixtures exercise the complete 6 × 6 network.
        // Actual new runs remain restricted to their real 4 × 4 start.
        s.inventory.expandTo(6,6);
        for(const v of Array.from(s.visualItemsMap.values()))v.destroy();
        for(const item of [...s.inventory.items])s.inventory.removeItem(item.id);
        s.run.groundItems?.clear();
        const enemy = encounter ? s.run.enemies.find(enemy => enemy.kind === encounter.kind) : s.run.enemies[0];
        if (encounter) Object.assign(enemy, encounter);
        s.run.beginEncounter(enemy.id);
        if (!encounter) s.combatEngine=new CombatEngine(s.inventory,100,50,12,'Rad-Scorpion');
        s.battleState='active';s.completedTurns=0;s.messages=[];
        s.appendMessage('Select a weapon to begin.');
        if (ground) seed([{id:'scrap_battery_01',definitionId:'rusty_battery',name:'Rusty Battery',type:'battery'}]);
        s.updateCombatUI();
    };
    globalThis.seedTransformerChain = (charge = 5) => seed([
        {type:'battery',id:'A',x:0,y:0,charge},
        {type:'transformer',id:'transformer',x:1,y:0},
        {type:'weapon',id:'gun',x:2,y:0}
    ]);
    globalThis.freshElectricRun = async () => {
        await freshRun(fixedSeed);
        for (const visual of [...s.visualItemsMap.values()]) visual.destroy();
        for (const item of [...s.inventory.items]) s.inventory.removeItem(item.id);
        for (const [definitionId,x,y] of [['heavy_battery',0,0],['laser_pistol',2,0],['weak_battery',0,2],['makeshift_vest',1,2],['medkit',0,1]]) {
            const item=s.run.createItem(definitionId); item.isSelectedForTurn=item.type==='weapon'||item.type==='armor';
            if(!s.inventory.placeItem(item,x,y))throw Error('Invalid combat-heal fixture');
        }
        s.inventory.updatePowerGrid();
        s.updateCombatUI();
    };
    globalThis.prepareCombatHeal = async () => {
        await freshElectricRun();
        s.run.playerHp=60;
        s.run.beginEncounter(s.run.enemies.find(enemy => enemy.kind==='scorpion').id);
        s.backpackView=true;
        s.updateCombatUI();
    };
    globalThis.learnFixtureBlueprint = async base => {
        const {generateBlueprintCaches}=await import('/src/game/core/BlueprintGenerator.ts');
        const {ExplorationEngine}=await import('/src/game/core/ExplorationEngine.ts');
        const old={hero:s.run.hero,enemies:s.run.enemies,caches:s.run.blueprintCaches};
        let caches;
        for(let seed=0;seed<1000;seed++) {const c=generateBlueprintCaches(seed,0);if(c.some(p=>p.offers.some(r=>r.outputDefinitionId===base))){caches=c;break}}
        const cache=caches.find(p=>p.offers.some(r=>r.outputDefinitionId===base));
        const recipe=cache.offers.find(r=>r.outputDefinitionId===base);
        s.run.blueprintCaches=caches;s.run.enemies=[];s.run.hero={x:cache.x,y:cache.y};
        if(!new ExplorationEngine(s.run).applyAction({type:'blueprint-cache'}).accepted||!s.run.chooseBlueprint(cache.id,recipe.id))throw Error('Knowledge fixture failed');
        Object.assign(s.run,{hero:old.hero,enemies:old.enemies,blueprintCaches:old.caches});return recipe.id;
    };
    globalThis.prepareScenario = async id => {
        if (id === 'transformer-chain') {
            // Explicit authored encounter, matching the legacy energy checks.
            await reset(fixedSeed, { ground:false, encounter:{kind:'scorpion',maxHp:50,damage:12} });
            seedTransformerChain();
        } else if (id === 'combat-heal') {
            await prepareCombatHeal();
        } else throw Error('Unknown scenario: '+id);
        s.appendMessage('FIXTURE: '+id+' | SEED: '+fixedSeed);
        s.updateCombatUI();
    };
    return game.renderer.type;
}

export const browserFixtureSource = `(${installBrowserFixtures.toString()})(${scenarioSeed})`;
