import {test,expect} from '@playwright/test';
import {zipSync} from 'fflate';
test('asset parser uses an isolated worker for valid files and rejects malformed archives',async({page})=>{
 await page.goto('http://127.0.0.1:5175/');let workers=0;page.on('worker',()=>workers++);
 const fixture=zipSync({'card.json':new TextEncoder().encode(JSON.stringify({spec:'chara_card_v3',data:{name:'worker fixture',assets:[{type:'icon',name:'portrait',uri:'embeded://portrait.jpg'}]}})),'portrait.jpg':new Uint8Array([255,216,255,224,0,2,255,217])});
 const result=await page.evaluate(async bytes=>{const {importAssetFile}=await import('/src/lib/assets.ts');const valid=await importAssetFile(new File([new Uint8Array(bytes)],'valid.charx'));let rejected=false;try{await importAssetFile(new File(['invalid'],'broken.charx'));}catch{rejected=true;}return {count:valid.assets.length,source:valid.assets[0]?.src,rejected};},[...fixture]);
 expect(result.count).toBe(1);expect(result.source).toMatch(/^data:image\/jpeg;base64,/);expect(result.rejected).toBe(true);expect(workers).toBe(2);
});
test('stalled asset worker is terminated at the time limit',async({page})=>{
 await page.goto('http://127.0.0.1:5175/');await page.clock.install();
 await page.evaluate(async()=>{(window as any).Worker=class{postMessage(){}terminate(){(window as any).assetWorkerTerminated=true;}};const {importAssetFile}=await import('/src/lib/assets.ts');(window as any).assetResult=importAssetFile(new File(['stall'],'slow.charx')).catch(error=>{(window as any).assetError=error.message;});});await page.clock.runFor(30001);expect(await page.evaluate(()=>(window as any).assetWorkerTerminated)).toBe(true);expect(await page.evaluate(()=>(window as any).assetError)).toContain('시간이 너무 길어');
});
