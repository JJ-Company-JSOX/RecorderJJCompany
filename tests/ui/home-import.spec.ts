import { expect, test } from '@playwright/test';
import { installDesktopBridge, installDesktopBridgeOverrides } from './bridge';

for (const cancel of [false,true]) {
 test(`home import ${cancel?'cancellation keeps the dashboard':'loads video into editor'} without an account`,async({page})=>{
  await installDesktopBridge(page,'filmstrip.mp4',{signedIn:false});
  await installDesktopBridgeOverrides(page,()=>{
   window.electronAPI.getCurrentVideoPath=async()=>({success:false});
   window.electronAPI.setCurrentVideoPath=async(path)=>{
    document.documentElement.dataset.importedPath=path;
    return {success:true};
   };
  });
  await page.addInitScript(cancel=>{
   window.electronAPI.openVideoFilePicker=async()=>{
    document.documentElement.dataset.filePickerOpened='true';
    return cancel?{success:false,canceled:true}:{success:true,path:`${location.origin}/tests/ui/fixtures/filmstrip.mp4`};
   };
  },cancel);
  await page.goto('/?windowType=editor');
  const home=page.getByRole('dialog',{name:'Projects dashboard'});
  await expect(home).toBeVisible();
  const sidebar=home.getByRole('complementary',{name:'Library navigation'});
  await expect(sidebar.getByRole('button',{name:'Import video',exact:true})).toBeInViewport();
  await expect(home.getByRole('button',{name:'Import existing video',exact:true})).toBeVisible();
  await sidebar.getByRole('button',{name:'Import video',exact:true}).click();
  await expect(page.locator('html')).toHaveAttribute('data-file-picker-opened','true');
  if(cancel){await expect(home).toBeVisible();await expect(page.locator('html')).not.toHaveAttribute('data-imported-path');}
  else{await expect(home).not.toBeVisible();await expect(page.locator('[data-variant="clip"]')).toHaveAttribute('data-end-ms','6000');await expect(page.locator('html')).toHaveAttribute('data-imported-path',/filmstrip\.mp4$/);}
  await expect(page.locator('input[type="email"]')).toHaveCount(0);
 });
}
