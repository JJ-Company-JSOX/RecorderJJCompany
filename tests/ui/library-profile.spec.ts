import {test,expect} from '@playwright/test';
import fs from 'node:fs/promises';
import {installDesktopBridge,installDesktopBridgeOverrides} from './bridge';
test('count library work during real video playback',async({page})=>{
await installDesktopBridge(page,'filmstrip.mp4',{signedIn:false});
await installDesktopBridgeOverrides(page,()=>{window.electronAPI.listRecordings=async()=>({success:true,value:[]});});
await page.goto('/?windowType=editor');await expect(page.locator('[data-variant="clip"]')).toHaveAttribute('data-end-ms','6000',{timeout:90000});await expect(page.getByLabel('Loading preview')).toHaveCount(0);
await page.getByRole('button',{name:'Clips',exact:true}).click();await expect(page.locator('[data-recording-library]')).toBeVisible();await expect(page.getByRole('button',{name:'Play',exact:true})).toBeEnabled();await page.waitForTimeout(1000);
const before=await page.evaluate(()=>(window as any).__libraryRenders??0);await page.getByRole('button',{name:'Play',exact:true}).click();await page.waitForTimeout(3000);await page.getByRole('button',{name:'Pause',exact:true}).click();const after=await page.evaluate(()=>(window as any).__libraryRenders??0);const report={variant:process.env.LIBRARY_PROFILE_VARIANT,renders:after-before,windowMs:3000,before,after};await fs.writeFile(process.env.LIBRARY_PROFILE_REPORT!,JSON.stringify(report,null,2));console.log(JSON.stringify(report));expect(before).toBeGreaterThan(0);
});
