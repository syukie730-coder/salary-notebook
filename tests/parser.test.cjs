const assert = require('node:assert/strict');
const { FIELDS, parse, reconcile } = require('../parser.js');

function tsv(rows) {
  return 'level\tpage_num\tblock_num\tpar_num\tline_num\tword_num\tleft\ttop\twidth\theight\tconf\ttext\n' + rows.map((row, i) =>
    [5, 1, 1, 1, i + 1, 1, row[1], row[2], row[3] || 80, 20, row[4] === undefined ? 95 : row[4], row[0]].join('\t')
  ).join('\n');
}

assert.equal(FIELDS.length, 30);
assert.equal(new Set(FIELDS.map(field => field.key)).size, 30);
const sample = parse(`給与明細 令和８年９月\n基本給 １２０，０００円\n役職手当 10,000\n支給合計 159,876\n控除合計 38,689\n振込支給額 121,187\n現金支給額 0\n勤務時間 157:30\n有休日数 0.5\n出勤日数 20\n普通残業 12,000\n休日深夜残業手当 3,000`);
assert.equal(sample.values.month, '2026-09');
assert.equal(sample.values.basePay, 120000);
assert.equal(sample.values.gross, 159876);
assert.equal(sample.values.deductions, 38689);
assert.equal(sample.values.net, 121187);
assert.equal(sample.values.cash, 0);
assert.equal(sample.values.workHours, 157.5);
assert.equal(sample.values.paidLeaveDays, 0.5);
assert.equal(sample.values.attendanceDays, 20);
assert.equal(sample.values.regularOvertime, 12000);
assert.equal(sample.values.holidayNightOvertime, 3000);
assert.equal(sample.values.nightOvertime, null);
assert.ok(sample.detected.includes('cash'));
assert.equal(sample.warnings.length, 0);

const inline = parse('2026/09\n基 本 給：200,000 総 支 給 額：230,000 控 除 合 計：40,000 銀行振込額：190,000');
assert.equal(inline.values.month, '2026-09');
assert.equal(inline.values.basePay, 200000);
assert.equal(inline.values.gross, 230000);
assert.equal(inline.values.deductions, 40000);
assert.equal(inline.values.net, 190000);

assert.equal(parse('9月分 基本給 120,000').values.month, '');
assert.equal(parse('令和元年5月 給与明細').values.month, '2019-05');
assert.equal(parse('給与明細 R8.9').values.month, '2026-09');
assert.equal(parse('支給年月 2026年9月\n勤怠 2026年8月').values.month, '2026-09');
assert.equal(parse('2026年9月\n2026年8月').values.month, '');
assert.equal(parse('2026年13月').values.month, '');

const uncertain = parse('基本給 12O,OOO\n支給合計 123,45\n控除合計 3.52\n振込支給額 120,000 130,000\n勤務時間 12:99');
assert.equal(uncertain.values.basePay, null);
assert.equal(uncertain.values.gross, null);
assert.equal(uncertain.values.deductions, null);
assert.equal(uncertain.values.net, null);
assert.equal(uncertain.values.workHours, null);
assert.equal(parse('基本給 100 200').values.basePay, null);
assert.equal(parse('基本給 20日').values.basePay, null);
assert.equal(parse('基本給 200,000\n基本給 210,000').values.basePay, null);
assert.equal(parse('所得税 ▲1,500').values.incomeTax, -1500);
assert.equal(parse('出勤日数 99').values.attendanceDays, null);
assert.equal(parse('基本給\n200,000').values.basePay, 200000);

const table = tsv([
  ['基本', 20, 20, 40], ['給', 60, 20, 20], ['役職手当', 200, 20, 90], ['支給合計', 370, 20, 90],
  ['200,000', 20, 52], ['10,000', 210, 52], ['230,000', 380, 52],
  ['健康保険', 20, 100], ['控除合計', 200, 100], ['振込支給額', 370, 100, 110],
  ['12,000', 20, 132], ['40,000', 210, 132], ['190,000', 390, 132]
]);
const tableResult = parse('2026年9月\n基本給 役職手当 支給合計\n200,000 10,000 230,000\n健康保険 控除合計 振込支給額\n12,000 40,000 190,000', table);
assert.equal(tableResult.values.basePay, 200000);
assert.equal(tableResult.values.positionAllowance, 10000);
assert.equal(tableResult.values.gross, 230000);
assert.equal(tableResult.values.healthInsurance, 12000);
assert.equal(tableResult.values.deductions, 40000);
assert.equal(tableResult.values.net, 190000);

const vertical = parse('', tsv([
  ['基本給', 20, 20], ['200,000', 250, 20],
  ['支給合計', 20, 60], ['230,000', 250, 60],
  ['控除合計', 20, 100], ['40,000', 250, 100],
  ['振込支給額', 20, 140, 100], ['190,000', 250, 140]
]));
assert.equal(vertical.values.basePay, 200000);
assert.equal(vertical.values.gross, 230000);
assert.equal(vertical.values.deductions, 40000);
assert.equal(vertical.values.net, 190000);

// An unreadable amount, two equally plausible columns, or an intervening label stays blank.
assert.equal(parse('', tsv([['基本給', 20, 20], ['200,000', 20, 52, 80, 5]])).values.basePay, null);
assert.equal(parse('', tsv([['基本給', 20, 20], ['200,000', 10, 52, 50], ['210,000', 90, 52, 50]])).values.basePay, null);
assert.equal(parse('', tsv([['基本給', 20, 20], ['役職手当', 20, 50], ['10,000', 20, 80]])).values.basePay, null);
assert.equal(parse('', 'not a TSV').detected.length, 0);
assert.equal(parse('').values.net, null);
assert.ok(parse('').warnings.length);

// Regression from the browser's real Tesseract.js 6 OCR of our synthetic payslip.
// OCR emits label and amount columns in separate blocks and has no TSV header.
const browserText = '2026年9月 給与明細\n其本給\n支給合計\n控除合計\n振込支給額\n\n150,000\n159,876\n38,689\n121,187\n';
const browserTsv = [
  '1\t1\t0\t0\t0\t0\t0\t0\t1728\t2400\t-1\t',
  '5\t1\t2\t1\t8\t1\t126\t902\t44\t41\t91.538040\t其',
  '5\t1\t2\t1\t8\t2\t181\t902\t34\t42\t90.444664\t本',
  '5\t1\t2\t1\t8\t3\t224\t902\t38\t43\t92.963821\t給',
  '5\t1\t2\t1\t10\t1\t128\t1190\t88\t43\t95.202370\t支給',
  '5\t1\t2\t1\t10\t2\t237\t1190\t70\t42\t96.843262\t合計',
  '5\t1\t2\t1\t17\t1\t127\t1862\t89\t42\t95.774651\t控除',
  '5\t1\t2\t1\t17\t2\t236\t1862\t71\t42\t96.814545\t合計',
  '5\t1\t2\t1\t18\t1\t127\t1958\t114\t42\t96.563416\t振込',
  '5\t1\t2\t1\t18\t2\t240\t1954\t68\t64\t72.811707\t支給',
  '5\t1\t2\t1\t18\t3\t325\t1958\t29\t43\t92.009239\t額',
  '5\t1\t4\t1\t2\t1\t708\t904\t184\t42\t96.704712\t150,000',
  '5\t1\t4\t1\t5\t1\t708\t1192\t183\t42\t96.278824\t159,876',
  '5\t1\t4\t1\t12\t1\t703\t1864\t158\t42\t96.925804\t38,689',
  '5\t1\t4\t1\t13\t1\t708\t1960\t183\t42\t96.134109\t121,187'
].join('\n');
const browserResult = parse(browserText, browserTsv);
assert.equal(browserResult.values.month, '2026-09');
assert.equal(browserResult.values.basePay, 150000);
assert.equal(browserResult.values.gross, 159876);
assert.equal(browserResult.values.deductions, 38689);
assert.equal(browserResult.values.net, 121187);
assert.equal(browserResult.warnings.length, 0);
assert.equal(parse('其 本 給 150,000').values.basePay, 150000);
assert.equal(parse('', table.split('\n').slice(1).join('\n')).values.gross, 230000);

// Fabricated changing amounts: positions, not a known salary or fixed result.
for (let seed=1;seed<=20;seed++) {
  const base=230000+seed*791, gross=base+14500, deductions=37000+seed*173, net=gross-deductions;
  const expected={basePay:base,gross,deductions,net};
  const cells=[];
  ['基本給','支給合計','控除合計','振込支給額'].forEach((label,i)=>{
    const x=20+i*200, key=Object.keys(expected)[i];
    cells.push([label,x,20,110]);
    const parts=expected[key].toLocaleString('en-US').split(',');
    const firstWidth=parts[0].length*10;
    cells.push([parts[0],x,60,firstWidth],[',',x+firstWidth+1,60,4,0],[parts[1],x+firstWidth+6,60,30]);
  });
  const actual=parse('2027年2月',tsv(cells)).values;
  for(const key of Object.keys(expected)) assert.equal(actual[key],expected[key],`${key} table variant ${seed}`);
}
const wrapped=parse('',tsv([
  ['基本給',20,20,80],['支給',220,20,45],['控除',420,20,45],['振込',620,20,45],
  ['合計',220,44,45],['合計',420,44,45],['支給額',620,44,70],
  ['234,567',20,80,80],['258,900',220,80,80],['42,120',420,80,75],['216,780',620,80,80]
]));
assert.equal(wrapped.values.gross,258900);assert.equal(wrapped.values.deductions,42120);assert.equal(wrapped.values.net,216780);
assert.equal(parse('',tsv([['基本給',20,20,80],['12',20,55,20],[',',41,55,4],['34',47,55,20]])).values.basePay,null);
assert.equal(parse('',tsv([['基本給',20,20,80],['230,000',20,55,60],['245,000',100,55,60]])).values.basePay,null);
const iphoneSplit=parse('',tsv([
  ['振込支給額',700,20,120],['121',700,250,40,8],[',',755,250,7,0],['187',780,250,40,94]
]));
assert.equal(iphoneSplit.values.net,121187);
const tallTotals=parse('',tsv([
  ['支給合計',400,20,90],['159,876',400,155,100],
  ['控除合計',550,20,90],['38,689',550,155,85],
  ['振込支給額',720,20,120],['121,187',720,360,100]
]));
assert.equal(tallTotals.values.gross,159876);assert.equal(tallTotals.values.deductions,38689);assert.equal(tallTotals.values.net,121187);
const recovered=reconcile([
  {values:{month:'2026-09',basePay:null,gross:null,deductions:null,net:187,cash:null},warnings:['読み取れなかった項目は空欄です。元の明細を見ながら確認してください。']},
  {values:{month:'2026-09',basePay:154980,gross:159876,deductions:38689,net:121187,cash:0},warnings:[]}
]);
assert.equal(recovered.values.basePay,154980);assert.equal(recovered.values.gross,159876);assert.equal(recovered.values.deductions,38689);assert.equal(recovered.values.net,121187);
const changingRecovered=reconcile([
  {values:{month:'2026-10',basePay:null,gross:null,deductions:null,net:650,cash:null},warnings:[]},
  {values:{month:'2026-10',basePay:268430,gross:301250,deductions:51230,net:250020,cash:0},warnings:[]}
]);
assert.equal(changingRecovered.values.basePay,268430);assert.equal(changingRecovered.values.net,250020);
const realLayoutShapes=parse('',tsv([
  ['支給台計',400,20,90],['271,430',400,500,90],
  ['控',700,20,24],['除',700,48,24],['合',700,76,24],['計',700,104,24],['47,210',700,600,80],
  ['振',1000,20,24],['込',1000,48,24],['支',1000,76,24],['給',1000,104,24],['額',1000,132,24],['224,220',1000,700,90]
]));
assert.equal(realLayoutShapes.values.gross,271430);
assert.equal(realLayoutShapes.values.deductions,47210);
assert.equal(realLayoutShapes.values.net,224220);
const candidateRecovery=reconcile([{values:{month:'2027-03',basePay:260000,gross:280000,deductions:52000,net:219000,cash:0},warnings:[],candidates:{
  gross:[{value:280000},{value:270000}],deductions:[{value:52000},{value:45000}],net:[{value:219000},{value:225000}],cash:[{value:0}]
}}]);
assert.equal(candidateRecovery.values.gross,270000);assert.equal(candidateRecovery.values.deductions,45000);assert.equal(candidateRecovery.values.net,225000);
const unlabeledTotals=reconcile([parse('',tsv([
  ['基本給',20,20,70],['262,540',20,60,90],['7,500',220,60,70],['283,910',800,300,90],['49,780',800,620,80],['234,130',800,940,90]
]))]);
assert.equal(unlabeledTotals.values.basePay,262540);assert.equal(unlabeledTotals.values.gross,283910);assert.equal(unlabeledTotals.values.deductions,49780);assert.equal(unlabeledTotals.values.net,234130);
const ambiguousUnlabeled=reconcile([{values:{month:'2027-04',gross:null,deductions:null,net:null,cash:null},warnings:[],moneyCandidates:[300000,50000,250000,60000,240000].map(value=>({value}))}]);
assert.equal(ambiguousUnlabeled.values.gross,null);assert.equal(ambiguousUnlabeled.values.deductions,null);assert.equal(ambiguousUnlabeled.values.net,null);
console.log('Payroll parser: original regressions, wrapped labels, split commas, and 20 changing table amounts passed.');
