const assert=require('node:assert/strict');
const {parse,reconcile}=require('../parser.js');

function makeTsv(words,width,height) {
  const rows=[[1,1,0,0,0,0,0,0,width,height,-1,'']];
  words.forEach((word,index)=>rows.push([5,1,1,1,index+1,1,word.x,word.y,word.w,word.h,word.conf ?? 90,word.text]));
  return rows.map(row=>row.join('\t')).join('\n');
}

function fixture(variant) {
  const scale=.76+(variant%4)*.09, shiftX=35+(variant%3)*27, shiftY=45+(variant%5)*19;
  const slope=[-.028,-.014,0,.012,.026][variant%5];
  const bend=[-.000012,0,.00001][variant%3];
  const base=218000+variant*1739, gross=base+18400+(variant%3)*2300, deductions=32500+variant*719, net=gross-deductions;
  const words=[];
  function point(x,y) { return {x:Math.round(x*scale+shiftX),y:Math.round(y*scale+shiftY+slope*x+bend*x*y)}; }
  function add(text,x,y,w=92,h=28,conf=90) { const p=point(x,y); words.push({text,x:p.x,y:p.y,w:Math.round(w*scale),h:Math.max(16,Math.round(h*scale)),conf}); }
  function amount(value,x,y,split=false) {
    const text=value.toLocaleString('en-US');
    if (!split) return add(text,x,y,118,30,87+(variant%4));
    const [front,back]=text.split(','), p=point(x,y), h=Math.max(16,Math.round(30*scale));
    words.push({text:front,x:p.x,y:p.y,w:Math.round(42*scale),h,conf:84});
    words.push({text:',',x:p.x+Math.round(46*scale),y:p.y+(variant%2?3:-2),w:Math.max(4,Math.round(7*scale)),h,conf:35});
    words.push({text:back,x:p.x+Math.round(58*scale),y:p.y+(variant%3-1)*4,w:Math.round(48*scale),h,conf:88});
  }
  add(variant%4===3?'基木給':'基本給',120,250,88); amount(base,125,315,variant%3===1);
  // Nearby small values must never become a total.
  add('普通残業',650,250,105); amount(500,655,315); add('その他手当',900,250,115); amount(3500,905,315);
  if (variant%6!==4) add(variant%5===2?'支給台計':'支給合計',1450,210,105);
  amount(gross,1640,510,variant%2===0);
  if (variant%6!==5) add('控除合計',1450,650,105);
  amount(deductions,1640,950,variant%3===0);
  if (variant%4!==2) add('振込支給額',1450,1090,135);
  amount(net,1640,1430,variant%3===2);
  // A different field is deliberately close to each summary column.
  add('住民税',1190,665,80); amount(500,1270,720);
  return {tsv:makeTsv(words,Math.round(2200*scale+shiftX*2),Math.round(1800*scale+shiftY*2)),expected:{base,gross,deductions,net}};
}

for (let variant=0;variant<12;variant++) {
  const {tsv,expected}=fixture(variant), values=reconcile([parse('',tsv)]).values;
  assert.equal(values.basePay,expected.base,`variant ${variant} base`);
  assert.equal(values.gross,expected.gross,`variant ${variant} gross`);
  assert.equal(values.deductions,expected.deductions,`variant ${variant} deductions`);
  assert.equal(values.net,expected.net,`variant ${variant} net`);
}

// If no unique, consistent assignment exists, weak below-column guesses stay blank.
const unsafe=reconcile([{values:{month:'2027-07',basePay:null,gross:38600,deductions:null,net:null,cash:null},warnings:[],candidates:{gross:[{value:38600,priority:1,source:'total-column'}]},moneyCandidates:[{value:38600,x:.8,y:.55,confidence:91}]}]);
assert.equal(unsafe.values.gross,null);
console.log('PASS: 12 changing-coordinate payrolls and 1 unsafe-assignment rejection.');
