// Only fictional fixtures are generated, into the ignored tests/output folder.
const {chromium}=require('/Users/shuyukie/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const out=path.join(__dirname,'output');fs.mkdirSync(out,{recursive:true});
const origin=process.env.TEST_ORIGIN||'http://127.0.0.1:8768/';
(async()=>{
 const browser=await chromium.launch({channel:'chrome',headless:true});
 try {
  const context=await browser.newContext({viewport:{width:430,height:932},isMobile:true,hasTouch:true});
  const page=await context.newPage();
  for(const [variant,amounts] of [[0,[154980,159876,38689,121187]],[1,[234567,258900,42120,216780]],[2,[267890,293210,48560,244650]]]){
   await page.goto(origin);await page.waitForFunction(()=>!document.querySelector('#take-photo').disabled);
   const png=await page.evaluate(({variant,amounts})=>{
    const c=document.createElement('canvas');c.width=2400;c.height=3200;const x=c.getContext('2d');
    x.fillStyle='#e4e3dd';x.fillRect(0,0,2400,3200);
    x.save();x.translate(1200,1300);x.rotate((variant===0?.45:variant===1?.8:-.6)*Math.PI/180);x.translate(-1200,-1300);
    x.fillStyle='#faf9ef';x.fillRect(90,230,2220,2200);
    x.fillStyle='#222';x.font='bold 66px "Hiragino Sans",sans-serif';x.fillText('2027年2月 給与明細',190,440);
    x.font='38px "Hiragino Sans",sans-serif';x.fillText('テスト用・架空の明細',190,530);
    const draw=(y,labels,values)=>{
     const w=270,start=195;
     x.strokeStyle='#559bd3';x.lineWidth=3;
     for(let i=0;i<=labels.length;i++){x.beginPath();x.moveTo(start+i*w,y);x.lineTo(start+i*w,y+210);x.stroke();}
     for(const dy of [0,100,210]){x.beginPath();x.moveTo(start,y+dy);x.lineTo(start+labels.length*w,y+dy);x.stroke();}
     labels.forEach((label,i)=>{x.fillStyle='#222';x.font='34px "Hiragino Sans",sans-serif';x.fillText(label,start+i*w+14,y+63);x.font='40px sans-serif';x.fillText(values[i].toLocaleString('en-US'),start+i*w+28,y+175);});
    };
    draw(720,['基本給','役職手当','資格手当','普通残業','通勤交通費','支給合計'],[amounts[0],5000,2000,3333,4000,amounts[1]]);
    draw(1100,['健康保険','厚生年金','雇用保険','所得税','住民税','控除合計'],[12000,22000,900,3500,4000,amounts[2]]);
    // A tall summary cell at the far right, matching the real layout shape.
    x.strokeStyle='#559bd3';x.lineWidth=3;x.strokeRect(1840,720,370,700);
    x.beginPath();x.moveTo(1840,850);x.lineTo(2210,850);x.stroke();
    x.fillStyle='#222';x.font='34px "Hiragino Sans",sans-serif';x.fillText('振込支給額',1880,800);
    x.font='42px sans-serif';x.fillText(amounts[3].toLocaleString('en-US'),1900,1340);
    x.restore();
    if(variant===2){const g=x.createLinearGradient(0,0,2400,0);g.addColorStop(0,'rgba(30,20,10,.18)');g.addColorStop(1,'rgba(30,20,10,0)');x.fillStyle=g;x.fillRect(0,0,2400,3200);}
    return c.toDataURL('image/jpeg',.88).split(',')[1];
   },{variant,amounts});
   const file=path.join(out,`fictional-table-${variant}.jpg`);fs.writeFileSync(file,Buffer.from(png,'base64'));
   await page.locator('#photo-input').setInputFiles(file);
   await page.locator('#review:not([hidden])').waitFor({timeout:160000});
   const actual=await page.locator('#key-fields input').evaluateAll(inputs=>Object.fromEntries(inputs.map(e=>[e.name,e.value])));
   console.log('Table variant',variant,actual);
   await page.screenshot({path:path.join(out,`table-result-${variant}.png`),fullPage:true,animations:'disabled'});
   for(const [i,key] of ['basePay','gross','deductions','net'].entries()) assert.equal(actual[key],amounts[i].toLocaleString('en-US'),`variant ${variant} ${key}`);
  }
  console.log('PASS: actual OCR of the requested values and two different fictional table images, with skew and uneven lighting.');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
