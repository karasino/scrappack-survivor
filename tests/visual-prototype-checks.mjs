import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';

export async function runVisualPrototypeChecks({ evaluate, read, check, mouse, click, restart, send, renderer }) {
    await restart();
    await evaluate(`(async () => {
        const { UITheme, cssColor } = await import('/src/game/ui/UITheme.ts');
        const { Item } = await import('/src/game/core/Item.ts');
        const { LootTable } = await import('/src/game/core/LootTable.ts');
        const { buildItemTooltipContent } = await import('/src/game/ui/ItemTooltipContent.ts');
        globalThis.task5Theme=UITheme;
        globalThis.task5Content=buildItemTooltipContent;
        globalThis.task5Loader=s.load.image;
        globalThis.task5Requests=[];
        globalThis.task5Art={};
        // Asymmetric, transparent fixtures exercise actual image decoding and
        // rendered orientation. They are not production artwork.
        for (const [key,width,height] of [['item-weak-battery',256,256],['item-laser-pistol',512,256]]) {
            const canvas=document.createElement('canvas');canvas.width=width;canvas.height=height;
            const ctx=canvas.getContext('2d');
            ctx.fillStyle='#89928a';ctx.fillRect(width*.15,height*.2,width*.7,height*.6);
            ctx.fillStyle='#cd5f50';ctx.fillRect(width*.7,height*.3,width*.1,height*.2);
            ctx.fillStyle='#688eaf';ctx.fillRect(width*.2,height*.25,width*.1,height*.1);
            task5Art[key]=canvas.toDataURL('image/png');
        }
        globalThis.task5Mode='success';
        globalThis.task5ClearTextures=()=>{
            for(const v of Array.from(s.visualItemsMap.values()))v.destroy();
            s.visualItemsMap.clear();
            for(const key of Object.keys(task5Art))if(s.textures.exists(key))s.textures.remove(key);
        };
        globalThis.task5InstallLoader=()=>{
            s.load.image=function(key,url,...args){
                task5Requests.push([key,url]);
                const source=task5Mode==='success'?task5Art[key]:'data:image/png;base64,bm90LWFuLWltYWdl';
                return task5Loader.call(this,key,source??url,...args);
            };
        };
        globalThis.task5Definitions=LootTable.map(i=>i.definitionId);
        globalThis.task5Legacy=new Item({id:'legacy',name:'Legacy',width:1,height:1,color:0});
        if(cssColor(UITheme.colors.text)!=='#e6e2d8')throw Error('Theme primary text');
    })()`);
    await check('task5Legacy.definitionId',null,'legacy item configs remain valid');
    await check('task5Definitions',['dagger','battle_axe','combat_bra','steel_armor','arc_baton','weak_battery','heavy_battery','copper_wire','step_up_transformer','laser_pistol','makeshift_vest','power_core','precision_mechanism','medkit'],
        'loot definitions are stable');
    await check("s.visualItemsMap.get('scrap_battery_01').itemModel.definitionId",'rusty_battery','starter identity');
    await check("s.visualItemsMap.get('scrap_battery_01').image",null,'Rusty Battery keeps its own placeholder');
    await check('[s.endTurnButton.alpha,s.endTurnButton.fillColor,s.endTurnLabel.style.color]',
        [1,0x30353d,'#8b929c'],'disabled controls remain legible');
    await check('[s.logText.style.fontSize,s.logText.lineSpacing,s.logText.style.fontFamily]',
        ['13px',2,'Arial, sans-serif'],'log typography');

    try {
        await evaluate('task5ClearTextures();task5InstallLoader();undefined');
        await restart();
        await check('task5Requests',[
            ['item-weak-battery','/assets/items/weak-battery.png'],
            ['item-laser-pistol','/assets/items/laser-pistol.png']
        ],'preload requests the two catalog paths');
        await check('Object.keys(task5Art).map(key=>s.textures.exists(key))',[true,true],'valid PNG fixtures decode');
        await evaluate(`seed([
            {type:'battery',id:'art-battery',definitionId:'weak_battery',name:'Renamed Battery',x:0,y:0},
            {type:'transformer',id:'art-transformer',x:1,y:0},
            {type:'weapon',id:'art-gun',definitionId:'laser_pistol',name:'Renamed Pistol',x:2,y:0},
            {type:'battery',id:'unknown',definitionId:'unknown',name:'Weak Battery'},
            {type:'weapon',id:'no-definition',definitionId:undefined,name:'Laser Pistol'}
        ])`);
        await check(`['art-battery','art-gun'].map(id=>{const v=s.visualItemsMap.get(id);
            return [v.image.texture.key,v.image.input??null,v.text.visible];})`,
        [['item-weak-battery',null,false],['item-laser-pistol',null,false]],'art comes from definitions, not names');
        await check(`['unknown','no-definition'].map(id=>{const v=s.visualItemsMap.get(id);return [v.image,!!v.text.text];})`,
            [[null,true],[null,true]],'unknown and legacy definitions have labelled fallbacks');
        await click(325,175);
        await check(`(()=>{const v=s.visualItemsMap.get('art-gun');return [v.rect.isStroked,v.powerGraphics.commandBuffer.length>0,
            v.selectionGraphics.commandBuffer.length>0,v.text.visible];})()`,
        [false,true,true,false],'art, power indicator and inset selection coexist');

        const waitFor = async (condition,label) => {
            for(let i=0;i<100;i++){if(await read(condition))return;await delay(20);}
            throw Error(`${renderer}: ${label}`);
        };
        await mouse('mouseMoved',20,20);
        await delay(130);
        const originalRect=await read("(()=>{const r=s.visualItemsMap.get('art-gun').rect;return [r.x,r.y,r.width,r.height]})()");
        await mouse('mouseMoved',325,175);
        await delay(130);
        await check("s.visualItemsMap.get('art-gun').artHover.value",1.03,'art hover reaches 1.03');
        await check("(()=>{const r=s.visualItemsMap.get('art-gun').rect;return [r.x,r.y,r.width,r.height]})()",originalRect,
            'hover leaves hit area unchanged');
        await check(`(()=>{const v=s.visualItemsMap.get('art-gun'),b=v.image.getBounds(),r=v.rect;
            return b.x>=r.x&&b.y>=r.y&&b.right<=r.x+r.width&&b.bottom<=r.y+r.height;})()`,true,'hover art remains inside item');
        await waitFor('s.itemTooltip.visible','art tooltip opens');
        await delay(100);
        await check('s.itemTooltip.container.alpha',1,'tooltip fade finishes');
        await check("s.itemTooltip.labels.find(l=>l.visible&&l.text.startsWith('►')).style.color",'#80b4a2','powered statistic uses power accent');

        // Verify the real rendered red marker, rather than just the angle property.
        const markerPixel = async id => {
            await delay(35);
            const clip=await read(`(()=>{const r=document.querySelector('canvas').getBoundingClientRect();
                return {x:r.x,y:r.y,width:r.width,height:r.height,scale:1};})()`);
            const screenshot=await send('Page.captureScreenshot',{format:'png',clip});
            return evaluate(`(async()=>{
                const source=new Image();source.src='data:image/png;base64,${screenshot.data}';await source.decode();
                const canvas=document.createElement('canvas');canvas.width=800;canvas.height=600;
                const ctx=canvas.getContext('2d');ctx.drawImage(source,0,0,800,600);
                const image=s.visualItemsMap.get('${id}').image;
                const dx=image.width*.25*image.scaleX,dy=-image.height*.1*image.scaleY;
                const x=image.x+dx*Math.cos(image.rotation)-dy*Math.sin(image.rotation);
                const y=image.y+dx*Math.sin(image.rotation)+dy*Math.cos(image.rotation);
                return Array.from(ctx.getImageData(Math.floor(x),Math.floor(y),1,1).data).slice(0,3);
            })()`);
        };
        for(const id of ['art-battery','art-gun']) {
            await mouse('mouseMoved',20,20);
            const point=await read(`(()=>{const r=s.visualItemsMap.get('${id}').rect;return [r.x+10,r.y+10];})()`);
            await mouse('mouseMoved',...point);
            await mouse('mousePressed',...point);
            await mouse('mouseMoved',point[0]+15,point[1]);
            await mouse('mouseMoved',410,310);
            await check(`[s.visualItemsMap.get('${id}').artHover.value,s.visualItemsMap.get('${id}').hoverTween]`,
                [1,null],'drag resets art scale and cancels hover animation');
            for(let rotation=0;rotation<=4;rotation++) {
                await check(`(()=>{const v=s.visualItemsMap.get('${id}'),i=v.image,r=v.rect,b=i.getBounds();
                    return [((i.angle%360)+360)%360,i.x===r.x+r.width/2&&i.y===r.y+r.height/2,
                        b.x>=r.x+3.99&&b.y>=r.y+3.99&&b.right<=r.x+r.width-3.99&&b.bottom<=r.y+r.height-3.99,
                        r.input.hitArea.width===r.width&&r.input.hitArea.height===r.height];})()`,
                [(rotation*90)%360,true,true,true],`art fit and hit area at rotation ${rotation}`);
                const pixel=await markerPixel(id);
                assert.ok(pixel.every((v,index)=>Math.abs(v-[205,95,80][index])<16),`${renderer}: ${id} rendered marker ${rotation}: ${pixel}`);
                if(rotation<4){
                    await send('Input.dispatchKeyEvent',{type:'keyDown',key:'r',code:'KeyR',windowsVirtualKeyCode:82});
                    await send('Input.dispatchKeyEvent',{type:'keyUp',key:'r',code:'KeyR',windowsVirtualKeyCode:82});
                }
            }
            await mouse('mouseReleased',410,310);
            await check(`s.visualItemsMap.get('${id}').itemModel.isSelectedForTurn`,false,'art drag never selects');
        }

        await evaluate(`s.itemTooltip.hide();s.itemTooltip.show(task5Content(s.visualItemsMap.get('art-gun').itemModel,
            {available:false,reason:'insufficient-charge'}),780,580)`);
        await check('[s.itemTooltip.container.alpha,s.itemTooltip.fadeTween.totalDuration]',[0,80],'fade begins once after show');
        await evaluate('s.itemTooltip.hide()');
        await check('[s.itemTooltip.visible,s.itemTooltip.container.alpha,s.itemTooltip.fadeTween]',[false,0,null],'hide cancels fade immediately');
        await mouse('mouseMoved',20,20);
        const position=await read("(()=>{const r=s.visualItemsMap.get('art-gun').rect;return [r.x+10,r.y+10]})()");
        await mouse('mouseMoved',...position);
        await evaluate('s.game.events.emit("blur")');
        await check("[s.visualItemsMap.get('art-gun').artHover.value,s.visualItemsMap.get('art-gun').hoverTween]",[1,null],'blur cancels image hover');
        await evaluate('s.game.events.emit("focus")');
        await evaluate("seed([{type:'weapon',id:'button-test',x:0,y:2}])");
        await click(225,275);
        await mouse('mouseMoved',663,544);
        await evaluate('s.game.events.emit("blur")');
        await check('[s.buttonTween,s.endTurnButton.fillColor]',[null,0x3a424d],'blur settles and cancels button animation');
        await evaluate('s.game.events.emit("focus")');
        await evaluate("globalThis.task5OldImage=s.visualItemsMap.get('art-gun').image;globalThis.task5OldVisual=s.visualItemsMap.get('art-gun');undefined");
        await restart();
        await check('!task5OldImage.scene && task5OldVisual.hoverTween===null',true,'restart destroys images and cancels hover');

        // Corrupt PNG bytes test the real loader failure path with no filesystem fixtures.
        await evaluate("task5ClearTextures();task5Mode='failure';task5Requests.length=0");
        await restart();
        await check('Object.keys(task5Art).map(key=>s.textures.exists(key))',[false,false],'corrupt PNGs never enter texture cache');
        await evaluate("seed([{type:'weapon',id:'bad-art',definitionId:'laser_pistol',x:0,y:0}])");
        await check("[s.visualItemsMap.get('bad-art').image,s.visualItemsMap.get('bad-art').text.visible]",[null,true],
            'failed image keeps a usable labelled fallback');
        await click(225,175);
        await check("s.visualItemsMap.get('bad-art').itemModel.isSelectedForTurn",true,'fallback still selects');
    } finally {
        await evaluate('s.load.image=task5Loader;undefined');
        await restart();
    }
    console.log(`PASS ${renderer}: theme, PNG preload and failures, rendered art rotation, hover and fade cleanup`);
}
