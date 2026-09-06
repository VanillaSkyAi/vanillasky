import {test,expect} from '@playwright/test';
for(const orientation of ['landscape','portrait']){
 for(const id of ['cinemaMedia','chapterTitle','focusCards','editorialTimeline','mobileMessage','comparison','quote','keyFigure']){
  test(`${orientation} ${id}`,async({page},info)=>{
   await page.setViewportSize(orientation==='portrait'?{width:390,height:694}:{width:1280,height:720});
   const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));
   await page.goto(`${info.project.use.baseURL ?? "http://127.0.0.1:4274"}/tests/browser/fixtures/cinematic-gallery.html?orientation=${orientation}&template=${id}`);
   await expect(page.locator('[data-video-frame="ready"]')).toBeVisible();
   await page.evaluate(()=>Promise.all([...document.images].map(image=>image.decode())));
   expect(errors).toEqual([]);
   if(id==='comparison'){await expect(page.getByText('More clarity')).toBeVisible();await expect(page.getByText('More noise')).toBeVisible();}
   if(id==='keyFigure'){await expect(page.getByText('42%')).toBeVisible();await expect(page.getByText('Illustrative figure')).toHaveCount(1);}

   const stage=page.locator('[data-video-frame="ready"]');
   await stage.screenshot({path:info.outputPath(`${orientation}-${id}.png`)});
   expect(await stage.locator('[data-scene-fallback]').count()).toBe(0);
  });
 }
}
