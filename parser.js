(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.PayrollParser = api;
})(typeof window !== 'undefined' ? window : globalThis, function () {
  'use strict';

  const FIELDS = [
    ['workDays', '就業日数', '勤務', 'number', ['所定労働日数', '所定日数']],
    ['attendanceDays', '出勤日数', '勤務', 'number', ['実出勤日数', '出勤日']],
    ['absenceDays', '欠勤日数', '勤務', 'number', ['欠勤日']],
    ['workHours', '勤務時間', '勤務', 'hours', ['実働時間', '労働時間', '就業時間']],
    ['paidLeaveDays', '有休日数', '勤務', 'number', ['有給休暇日数', '有給日数', '有休取得日数']],
    ['overtimeHours', '残業時間', '勤務', 'hours', ['時間外労働時間', '時間外時間']],
    ['basePay', '基本給', '支給', 'money', ['基本給与', '其本給']],
    ['positionAllowance', '役職手当', '支給', 'money', []],
    ['qualificationAllowance', '資格手当', '支給', 'money', []],
    ['leaderAllowance', '当務長手当', '支給', 'money', []],
    ['specialAllowance', '特別手当', '支給', 'money', []],
    ['regularOvertime', '普通残業', '支給', 'money', ['普通残業手当', '時間外手当', '残業手当']],
    ['nightOvertime', '深夜残業', '支給', 'money', ['深夜残業手当', '深夜手当']],
    ['holidayOvertime', '休日残業', '支給', 'money', ['休日残業手当', '休日手当']],
    ['holidayNightOvertime', '休日深夜', '支給', 'money', ['休日深夜残業手当', '休日深夜手当', '休日深夜残業']],
    ['otherAllowance', 'その他手当', '支給', 'money', ['その他支給']],
    ['commute', '通勤交通費', '支給', 'money', ['通勤手当', '交通費']],
    ['commuterPass', '定期代', '支給', 'money', ['通勤定期代']],
    ['gross', '支給合計', '支給', 'money', ['総支給額', '総支給金額', '総支給', '支給額合計', '支給総額', '支給計']],
    ['healthInsurance', '健康保険', '控除', 'money', ['健康保険料', '健保料']],
    ['careInsurance', '介護保険', '控除', 'money', ['介護保険料']],
    ['pension', '厚生年金', '控除', 'money', ['厚生年金保険料', '厚生年金保険', '厚生年金料']],
    ['unionFee', '共済組合費', '控除', 'money', ['共済掛金', '共済組合掛金']],
    ['employmentInsurance', '雇用保険', '控除', 'money', ['雇用保険料']],
    ['incomeTax', '所得税', '控除', 'money', ['源泉所得税']],
    ['residentTax', '住民税', '控除', 'money', []],
    ['otherDeduction', 'その他控除', '控除', 'money', []],
    ['deductions', '控除合計', '控除', 'money', ['控除額合計', '控除総額', '総控除額', '控除計']],
    ['net', '振込支給額', '手取り', 'money', ['銀行振込額', '銀行振込金額', '振込金額', '振込額', '差引支給額', '差引支給金額', '差引支給', '手取り額']],
    ['cash', '現金支給額', '手取り', 'money', ['現金支給', '現金支払額']]
  ].map(function (entry) {
    return { key: entry[0], label: entry[1], group: entry[2], kind: entry[3], aliases: entry[4] };
  });
  const byKey = Object.fromEntries(FIELDS.map(function (field) { return [field.key, field]; }));
  const aliases = FIELDS.flatMap(function (field) {
    return [field.label].concat(field.aliases).map(function (label) { return { key: field.key, label: label }; });
  }).sort(function (a, b) { return b.label.length - a.label.length; });

  function normalize(text) {
    return String(text || '').normalize('NFKC').replace(/[−–―]/g, '-').replace(/[▲△]/g, '-');
  }

  function labelsIn(text) {
    const matches = [];
    aliases.forEach(function (alias) {
      let start = text.indexOf(alias.label);
      while (start !== -1) {
        const end = start + alias.label.length;
        if (!matches.some(function (match) { return start < match.end && end > match.start; })) {
          matches.push({ key: alias.key, start: start, end: end });
        }
        start = text.indexOf(alias.label, end);
      }
    });
    return matches.sort(function (a, b) { return a.start - b.start; });
  }

  // OCR substitutions such as O -> 0 are deliberately not made.
  function numberFrom(text, kind) {
    const normalized = normalize(text);
    if (/\d\s+\d/.test(normalized)) return null;
    let valueText = normalized.replace(/\s/g, '').replace(/^[：:=|]+|[|]+$/g, '');
    valueText = valueText.replace(/^\([^)]{0,12}\)/, '').replace(/^[¥￥]/, '').replace(/円$/, '');
    if (kind === 'number') valueText = valueText.replace(/日$/, '');
    if (kind === 'hours') valueText = valueText.replace(/(?:時間|h)$/i, '');
    valueText = valueText.replace(/\([^)]{0,12}\)$/, '');
    const time = /^(\d{1,3}):(\d{2})$/.exec(valueText);
    if (kind === 'hours' && time && Number(time[2]) < 60) return Math.round((Number(time[1]) + Number(time[2]) / 60) * 100) / 100;
    if (!/^[+-]?(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d+)?$/.test(valueText)) return null;
    const value = Number(valueText.replace(/,/g, ''));
    if (!Number.isFinite(value) || Math.abs(value) > 999999999) return null;
    if (kind === 'money' && !Number.isInteger(value)) return null;
    if (kind !== 'money' && (value < 0 || value > (kind === 'hours' ? 744 : 31))) return null;
    return value;
  }

  function numericOCRText(text) {
    let value=normalize(text).replace(/\s/g,'');
    if (/^[¥￥+\-\d,.円日時間h:]+$/i.test(value)) return value;
    if (!/\d/.test(value) || !/^[¥￥+\-\d,.円OoIl|SsB]+$/.test(value)) return null;
    return value.replace(/[Oo]/g,'0').replace(/[Il|]/g,'1').replace(/[Ss]/g,'5').replace(/B/g,'8');
  }

  function readMonth(text) {
    const found = [];
    normalize(text).split(/\r?\n/).forEach(function (line) {
      const compact = line.replace(/\s/g, '');
      const patterns = [
        { re: /((?:19|20|21)\d{2})年(1[0-2]|0?[1-9])月/g, era: false },
        { re: /((?:19|20|21)\d{2})[/.\-](1[0-2]|0?[1-9])(?=$|[^\d])/g, era: false },
        { re: /令和(元|\d{1,2})年(1[0-2]|0?[1-9])月/g, era: true },
        { re: /(?:^|[^A-Za-z])R(\d{1,2})[/.\-](1[0-2]|0?[1-9])(?=$|[^\d])/gi, era: true }
      ];
      const priority = /支給年月/.test(compact) ? 5 : /(?:給与|給料).*明細|明細.*(?:給与|給料)/.test(compact) ? 4 : /支給日/.test(compact) ? 3 : /給与|給料|支給/.test(compact) ? 2 : 1;
      patterns.forEach(function (pattern) {
        let match;
        while ((match = pattern.re.exec(compact))) {
          const year = pattern.era ? 2018 + (match[1] === '元' ? 1 : Number(match[1])) : Number(match[1]);
          if (pattern.era && year < 2019) continue;
          found.push({ value: year + '-' + match[2].padStart(2, '0'), priority: priority });
        }
      });
    });
    if (!found.length) return { value: '', conflict: false };
    const best = Math.max.apply(null, found.map(function (entry) { return entry.priority; }));
    const choices = Array.from(new Set(found.filter(function (entry) { return entry.priority === best; }).map(function (entry) { return entry.value; })));
    return { value: choices.length === 1 ? choices[0] : '', conflict: choices.length > 1 };
  }

  function readTsv(tsv) {
    if (typeof tsv !== 'string' || !tsv.trim()) return [];
    const lines = tsv.trim().replace(/^\uFEFF/, '').split(/\r?\n/);
    // Tesseract.js 6 returns the standard 12 TSV columns without a header.
    // CLI exports may include one. Keep the first data row in the headerless case.
    const standardHeader = ['level', 'page_num', 'block_num', 'par_num', 'line_num', 'word_num', 'left', 'top', 'width', 'height', 'conf', 'text'];
    const header = lines[0].startsWith('level\t') ? lines.shift().split('\t') : standardHeader;
    const columns = Object.fromEntries(header.map(function (name, index) { return [name, index]; }));
    if (!['level', 'left', 'top', 'width', 'height', 'conf', 'text'].every(function (key) { return columns[key] !== undefined; })) return [];
    return lines.map(function (line) {
      const cells = line.split('\t');
      return {
        level: Number(cells[columns.level]), left: Number(cells[columns.left]), top: Number(cells[columns.top]),
        width: Number(cells[columns.width]), height: Number(cells[columns.height]), confidence: Number(cells[columns.conf]),
        text: normalize(cells.slice(columns.text).join('\t')).replace(/\s/g, '')
      };
    }).filter(function (word) {
      return word.level === 5 && word.text && word.width > 0 && word.height > 0 && Number.isFinite(word.left) && Number.isFinite(word.top);
    });
  }

  function visualRows(words) {
    const rows = [];
    words.slice().sort(function (a, b) { return a.top + a.height / 2 - b.top - b.height / 2; }).forEach(function (word) {
      const center = word.top + word.height / 2;
      let row = rows.find(function (entry) { return Math.abs(entry.center - center) < Math.min(entry.height, word.height) * 0.65; });
      if (!row) {
        row = { center: center, height: word.height, words: [] };
        rows.push(row);
      }
      row.words.push(word);
      row.center = row.words.reduce(function (sum, item) { return sum + item.top + item.height / 2; }, 0) / row.words.length;
    });
    return rows.map(function (row) {
      let text = '';
      row.words.sort(function (a, b) { return a.left - b.left; }).forEach(function (word) {
        word.start = text.length;
        text += word.text;
        word.end = text.length;
      });
      const labels = labelsIn(text).map(function (label) {
        const parts = row.words.filter(function (word) { return word.start < label.end && word.end > label.start; });
        return Object.assign(label, {
          left: Math.min.apply(null, parts.map(function (word) { return word.left; })),
          right: Math.max.apply(null, parts.map(function (word) { return word.left + word.width; })),
          top: Math.min.apply(null, parts.map(function (word) { return word.top; })),
          bottom: Math.max.apply(null, parts.map(function (word) { return word.top + word.height; })),
          row: row
        });
      });
      return Object.assign(row, { text: text, labels: labels });
    });
  }

  // A printed amount may be several OCR words (e.g. "234", ",", "567").
  // Join only touching numeric fragments on one visual line, never separate cells.
  function amountWords(rows) {
    const result = [];
    rows.forEach(function (row) {
      let parts = [];
      function flush() {
        if (!parts.length) return;
        const digits = parts.filter(function (w) { return /\d/.test(w.text); });
        if (digits.length) {
          const left = parts[0].left, right = Math.max.apply(null, parts.map(w => w.left + w.width));
          const top = Math.min.apply(null, parts.map(w => w.top));
          result.push({text:parts.map(w => w.text).join(''),left:left,top:top,width:right-left,
            height:Math.max.apply(null, parts.map(w => w.top + w.height))-top,
            // A comma or the leading group may have low confidence even when the
            // complete printed amount is clear. Use the digit-weighted average.
            confidence:digits.reduce((sum,w) => sum + Math.max(0,w.confidence),0) / digits.length});
        }
        parts = [];
      }
      row.words.forEach(function (word) {
        const repaired=numericOCRText(word.text);
        if (repaired===null) { flush(); return; }
        const numericWord=Object.assign({},word,{text:repaired});
        const previous = parts[parts.length - 1];
        if (previous) {
          const gap = numericWord.left - previous.left - previous.width;
          const charWidth = Math.min(previous.width / previous.text.length, numericWord.width / numericWord.text.length);
          // iPhone photographs can split a six-digit amount around its comma.
          // A table-cell gap is much wider than two text heights.
          if (gap > Math.max(5, Math.min(row.height * 2, charWidth * 3))) flush();
        }
        parts.push(numericWord);
      });
      flush();
    });
    return result;
  }

  function splitAmountWords(words, existing) {
    const parts=words.map(word=>({word,text:numericOCRText(word.text)})).filter(entry=>entry.text!==null && /^[\d,]+$/.test(entry.text));
    const result=[];
    parts.forEach(function (entry) {
      if (!/^\d{1,3},?$/.test(entry.text)) return;
      const first=entry.word, center=first.top+first.height/2;
      const following=parts.filter(other=>other.word.left>=first.left+first.width-2 && other.word.left-first.left-first.width<Math.max(first.height*3,first.width) && Math.abs(other.word.top+other.word.height/2-center)<Math.max(first.height,other.word.height)*1.15)
        .sort((a,b)=>a.word.left-b.word.left).slice(0,3);
      let joined=entry.text, used=[first];
      for (const next of following) {
        const candidate=joined+next.text;
        if (!/^\d{1,3},?\d{0,3}$/.test(candidate)) break;
        joined=candidate; used.push(next.word);
        if (/^\d{1,3},?\d{3}$/.test(joined)) break;
      }
      if (!/^\d{1,3},?\d{3}$/.test(joined) || used.length<2) return;
      const left=Math.min(...used.map(word=>word.left)), right=Math.max(...used.map(word=>word.left+word.width));
      const top=Math.min(...used.map(word=>word.top)), bottom=Math.max(...used.map(word=>word.top+word.height));
      if (existing.some(word=>Math.abs(word.left-left)<3 && Math.abs(word.top-top)<3 && numberFrom(word.text,'money')===numberFrom(joined,'money'))) return;
      result.push({text:joined,left,top,width:right-left,height:bottom-top,confidence:used.reduce((sum,word)=>sum+Math.max(0,word.confidence),0)/used.length});
    });
    return result;
  }

  function wrappedLabels(rows, existing) {
    const result = [];
    // Restrict reconstruction to known labels, with vertical proximity and overlap.
    // This does not turn arbitrary neighboring text into an amount label.
    rows.forEach(function (upper, i) {
      const lower = rows[i + 1];
      if (!lower || lower.center - upper.center > Math.max(upper.height, lower.height) * 2.5) return;
      upper.words.forEach(function (start, wi) {
        for (let count=1; count<=3 && wi+count<=upper.words.length; count++) {
          const topParts=upper.words.slice(wi,wi+count), prefix=topParts.map(w=>w.text).join('');
          if (!aliases.some(a => a.label.startsWith(prefix) && a.label !== prefix)) continue;
          const left=start.left, right=topParts[topParts.length-1].left+topParts[topParts.length-1].width;
          const bottomParts=lower.words.filter(w => w.left < right+upper.height && w.left+w.width > left-upper.height);
          for (let j=0; j<bottomParts.length; j++) for (let n=1; n<=3 && j+n<=bottomParts.length; n++) {
            const parts=bottomParts.slice(j,j+n), label=aliases.find(a => a.label === prefix+parts.map(w=>w.text).join(''));
            if (!label) continue;
            const all=topParts.concat(parts), box={key:label.key,left:Math.min(...all.map(w=>w.left)),right:Math.max(...all.map(w=>w.left+w.width)),top:Math.min(...all.map(w=>w.top)),bottom:Math.max(...all.map(w=>w.top+w.height)),row:upper};
            if (!existing.concat(result).some(l => l.key===box.key && Math.abs(l.left-box.left)<upper.height && Math.abs(l.top-box.top)<upper.height)) result.push(box);
          }
        }
      });
    });
    return result;
  }

  function editDistance(a, b) {
    const row=Array.from({length:b.length+1},(_,i)=>i);
    for (let i=1;i<=a.length;i++) {
      let previous=row[0]; row[0]=i;
      for (let j=1;j<=b.length;j++) {
        const saved=row[j];
        row[j]=Math.min(row[j]+1,row[j-1]+1,previous+(a[i-1]===b[j-1] ? 0 : 1));
        previous=saved;
      }
    }
    return row[b.length];
  }

  function importantLabelMatch(text) {
    const cleaned=normalize(text).replace(/[^\u3040-\u30ff\u3400-\u9fff]/g,'').replace(/合(?:言)?[十卜]/g,'合計');
    if (cleaned.length < 3 || cleaned.length > 7) return null;
    const choices=aliases.filter(alias => ['basePay','gross','deductions','net'].includes(alias.key) && alias.label.length >= 3)
      .filter(alias => Math.abs(alias.label.length-cleaned.length) <= 1)
      .map(alias => ({key:alias.key,distance:editDistance(cleaned,alias.label)}))
      .filter(choice => choice.distance <= 1)
      .sort((a,b)=>a.distance-b.distance);
    if (!choices.length) return null;
    const best=choices[0].distance, keys=Array.from(new Set(choices.filter(choice=>choice.distance===best).map(choice=>choice.key)));
    return keys.length===1 ? keys[0] : null;
  }

  function fuzzyAndStackedLabels(rows, words, existing) {
    const result=[];
    function add(key,parts,row) {
      const box={key,left:Math.min(...parts.map(w=>w.left)),right:Math.max(...parts.map(w=>w.left+w.width)),top:Math.min(...parts.map(w=>w.top)),bottom:Math.max(...parts.map(w=>w.top+w.height)),unitHeight:Math.max(...parts.map(w=>w.height)),row:row || {}};
      if (!existing.concat(result).some(label => label.key===key && Math.abs(label.left-box.left)<Math.max(8,box.bottom-box.top)*.35 && Math.abs(label.top-box.top)<Math.max(8,box.bottom-box.top)*.35)) result.push(box);
    }
    rows.forEach(row => {
      for (let start=0;start<row.words.length;start++) for (let count=1;count<=4 && start+count<=row.words.length;count++) {
        const parts=row.words.slice(start,start+count);
        const left=parts[0].left, right=parts[parts.length-1].left+parts[parts.length-1].width;
        const top=Math.min(...parts.map(word=>word.top)), bottom=Math.max(...parts.map(word=>word.top+word.height));
        if (existing.some(label=>label.left<=left+2 && label.right>=right-2 && label.top<=top+2 && label.bottom>=bottom-2)) continue;
        const key=importantLabelMatch(parts.map(w=>w.text).join(''));
        if (key) add(key,parts,row);
      }
    });
    const targets=aliases.filter(alias => ['basePay','gross','deductions','net'].includes(alias.key));
    const ordered=words.slice().sort((a,b)=>a.top-b.top || a.left-b.left);
    targets.forEach(target => {
      function extend(parts,text,last) {
        if (text===target.label) { add(target.key,parts); return; }
        if (!target.label.startsWith(text) || parts.length>=6) return;
        const center=last.left+last.width/2, scale=Math.max(last.height,last.width/Math.max(1,last.text.length));
        ordered.filter(word => word.top>last.top && word.top-last.top<scale*4 && Math.abs(word.left+word.width/2-center)<scale*2.5 && target.label.startsWith(text+word.text))
          .sort((a,b)=>(a.top-last.top)+Math.abs(a.left+a.width/2-center)-(b.top-last.top)-Math.abs(b.left+b.width/2-center)).slice(0,4)
          .forEach(word => extend(parts.concat(word),text+word.text,word));
      }
      ordered.filter(word => target.label.startsWith(word.text) && word.text!==target.label).forEach(word => extend([word],word.text,word));
    });
    return result;
  }

  function parse(text, tsv) {
    const values = { month: '' };
    FIELDS.forEach(function (field) { values[field.key] = null; });
    const candidates = {};
    const warnings = [];
    function add(key, value, priority, evidence) {
      if (value === null) return;
      if (!candidates[key]) candidates[key] = [];
      candidates[key].push(Object.assign({ value: value, priority: priority, spatialScore:0, confidence:0 },evidence || {}));
    }
    const lines = normalize(text).split(/\r?\n/).map(function (line) {
      return line.replace(/([\u3040-\u30ff\u3400-\u9fff])\s+(?=[\u3040-\u30ff\u3400-\u9fff])/g, '$1').trim();
    });
    lines.forEach(function (line, lineIndex) {
      const labels = labelsIn(line);
      labels.forEach(function (label, index) {
        const segment = line.slice(label.end, labels[index + 1] ? labels[index + 1].start : line.length);
        add(label.key, numberFrom(segment, byKey[label.key].kind), 3);
        if (labels.length === 1 && !segment.trim() && lines[lineIndex + 1]) {
          add(label.key, numberFrom(lines[lineIndex + 1], byKey[label.key].kind), 1);
        }
      });
    });
    const words = readTsv(tsv);
    const rows = visualRows(words);
    const allLabels = rows.flatMap(function (row) { return row.labels; });
    allLabels.push(...wrappedLabels(rows, allLabels));
    allLabels.push(...fuzzyAndStackedLabels(rows, words, allLabels));
    const amounts = amountWords(rows);
    amounts.push(...splitAmountWords(words,amounts));
    const pageBox=words.length ? {left:Math.min(...words.map(word=>word.left)),top:Math.min(...words.map(word=>word.top)),right:Math.max(...words.map(word=>word.left+word.width)),bottom:Math.max(...words.map(word=>word.top+word.height))} : {left:0,top:0,right:1,bottom:1};
    const pageWidth=Math.max(1,pageBox.right-pageBox.left), pageHeight=Math.max(1,pageBox.bottom-pageBox.top);
    const moneyCandidates=amounts.map(function (word) { return {value:numberFrom(word.text,'money'),left:word.left,top:word.top,x:(word.left+word.width/2-pageBox.left)/pageWidth,y:(word.top+word.height/2-pageBox.top)/pageHeight,confidence:word.confidence}; })
      .filter(function (entry) { return entry.value !== null && entry.confidence >= 20; });
    allLabels.forEach(function (label) {
      const kind = byKey[label.key].kind;
      const numeric = amounts.map(function (word) { return { word: word, value: numberFrom(word.text, kind) }; }).filter(function (entry) { return entry.value !== null && entry.word.confidence >= 20; });
      const height = label.unitHeight || label.bottom - label.top;
      const center = (label.left + label.right) / 2;
      const sameRow = numeric.filter(function (entry) {
        const word = entry.word;
        const middle = word.top + word.height / 2;
        return middle >= label.top - height * 0.2 && middle <= label.bottom + height * 0.2 && word.left >= label.right - 2 && word.left - label.right <= height * 12 &&
          !allLabels.some(function (other) { return other !== label && other.row === label.row && other.left >= label.right && other.left < word.left; });
      }).sort(function (a, b) { return a.word.left - b.word.left; });
      sameRow.slice(0,4).forEach(function (entry,index) {
        const gap=Math.max(0,entry.word.left-label.right);
        add(label.key,entry.value,sameRow.length===1 ? 4 : 2,{source:'same-row',spatialScore:Math.max(0,120-gap/Math.max(1,height)*8-index*12),confidence:entry.word.confidence});
      });

      // Horizontal headers above amounts: stay inside this header's column.
      const labelMiddle=(label.top+label.bottom)/2;
      const neighbors = allLabels.filter(function (other) {
        const otherHeight=other.unitHeight || other.bottom-other.top;
        return other !== label && Math.abs((other.top+other.bottom)/2-labelMiddle) < Math.max(height,otherHeight) * 1.4;
      });
      const previous = neighbors.filter(function (other) { return other.right <= label.left; }).sort(function (a, b) { return b.right - a.right; })[0];
      const next = neighbors.filter(function (other) { return other.left >= label.right; }).sort(function (a, b) { return a.left - b.left; })[0];
      const isTotal=['gross','deductions','net'].includes(label.key);
      const minX = previous ? (previous.right + label.left) / 2 : label.left - height * (isTotal ? 5 : 2.5);
      const maxX = next ? (label.right + next.left) / 2 : label.right + height * (isTotal ? 18 : 4.5);
      const verticalReach = isTotal ? Math.max(height * 30, 240) : height * 3.5;
      const below = numeric.filter(function (entry) {
        const word = entry.word;
        const x = word.left + word.width / 2;
        return word.top >= label.bottom - 2 && word.top - label.bottom <= verticalReach && x > minX && x < maxX &&
          !allLabels.some(function (other) {
            return other !== label && other.top >= label.bottom - 2 && other.top < word.top && other.left < maxX && other.right > minX;
          });
      }).map(function (entry) {
        const word=entry.word, x=word.left+word.width/2;
        const xDistance=Math.abs(x-center)/Math.max(1,height), yDistance=Math.max(0,word.top-label.bottom)/Math.max(1,height);
        return Object.assign(entry,{spatialScore:Math.max(0,120-xDistance*9-yDistance*2)});
      }).sort(function (a, b) { return b.spatialScore-a.spatialScore || a.word.top-b.word.top; });
      if (below.length) {
        const top=Math.min(...below.map(entry=>entry.word.top));
        const nearestRow = below.filter(function (entry) { return Math.abs(entry.word.top-top) < height * 0.6; });
        if (nearestRow.length === 1) add(label.key, nearestRow[0].value, 2,{source:'same-column',spatialScore:nearestRow[0].spatialScore+20,confidence:nearestRow[0].word.confidence});
        if (isTotal) {
          below.slice(0,8).forEach(function (entry) { add(label.key, entry.value, 1,{source:'total-column',spatialScore:entry.spatialScore,confidence:entry.word.confidence}); });
        }
      }
    });
    FIELDS.forEach(function (field) {
      const entries = candidates[field.key] || [];
      if (!entries.length) return;
      const rank=entry=>entry.priority*1000+entry.spatialScore+entry.confidence*.1;
      const best = Math.max.apply(null, entries.map(rank));
      const options = Array.from(new Set(entries.filter(function (entry) { return Math.abs(rank(entry)-best)<.01; }).map(function (entry) { return entry.value; })));
      if (options.length === 1) values[field.key] = options[0];
      else warnings.push(field.label + 'が複数読み取れました。元の明細で確認してください。');
    });
    const month = readMonth(text);
    values.month = month.value;
    if (month.conflict) warnings.push('支給年月の候補が複数あります。元の明細で確認してください。');
    if (['month', 'basePay', 'gross', 'deductions', 'net'].some(function (key) { return values[key] === null || values[key] === ''; })) {
      warnings.push('読み取れなかった項目は空欄です。元の明細を見ながら確認してください。');
    }
    return { values: values, detected: Object.keys(values).filter(function (key) { return values[key] !== null && values[key] !== ''; }), warnings: warnings, candidates: candidates, moneyCandidates: moneyCandidates };
  }

  function reconcile(passes) {
    const validPasses=(Array.isArray(passes) ? passes : []).filter(p => p && p.values);
    if (!validPasses.length) return parse('');
    const values=Object.assign({},validPasses[0].values);
    const candidates={}, details={};
    function rankedLabelCandidates(key) {
      const byValue=new Map();
      validPasses.forEach(function (pass,passIndex) {
        const entries=(pass.candidates?.[key] || []).slice();
        if (pass.values[key] !== null && pass.values[key] !== '' && pass.values[key] !== undefined && !entries.some(entry=>entry.value===pass.values[key])) entries.push({value:pass.values[key],priority:3,spatialScore:0,confidence:0});
        entries.forEach(function (entry) {
          if (entry.value===null || entry.value==='' || entry.value===undefined) return;
          const score=(entry.priority || 0)*100+(entry.spatialScore || 0)+(entry.confidence || 0)*.1;
          const current=byValue.get(entry.value) || {value:entry.value,score:0,passes:new Set(),labeled:true};
          current.score=Math.max(current.score,score); current.passes.add(passIndex); byValue.set(entry.value,current);
        });
      });
      return Array.from(byValue.values()).map(entry=>Object.assign(entry,{score:entry.score+entry.passes.size*18})).sort((a,b)=>b.score-a.score);
    }
    ['month'].concat(FIELDS.map(f=>f.key)).forEach(function (key) {
      details[key]=rankedLabelCandidates(key);
      candidates[key]=details[key].map(entry=>entry.value);
      if ((values[key] === null || values[key] === '') && candidates[key].length) values[key]=candidates[key][0];
    });
    // If a first OCR pass kept only the last comma group, prefer a
    // later complete money candidate. This rule is based on digit structure,
    // never on a particular salary amount.
    ['basePay','gross','deductions','net'].forEach(function (key) {
      if (typeof values[key] === 'number' && Math.abs(values[key]) < 1000) {
        const complete=candidates[key].find(v=>typeof v === 'number' && Math.abs(v) >= 1000);
        if (complete !== undefined) values[key]=complete;
      }
    });
    // Keep every amount seen by OCR available. A weak label association must
    // not hide a stronger, arithmetically consistent set of totals.
    const moneyByValue=new Map();
    validPasses.forEach(function (pass,passIndex) {
      (pass.moneyCandidates || []).forEach(function (entry) {
        if (typeof entry.value!=='number' || entry.value<0 || entry.value>999999999) return;
        const current=moneyByValue.get(entry.value) || {value:entry.value,score:0,passes:new Set(),positions:[]};
        current.score=Math.max(current.score,20+(entry.confidence || 0)*.25); current.passes.add(passIndex);
        if (Number.isFinite(entry.x) && Number.isFinite(entry.y)) current.positions.push({passIndex,x:entry.x,y:entry.y});
        moneyByValue.set(entry.value,current);
      });
    });
    moneyByValue.forEach(entry=>{entry.score+=entry.passes.size*14;});
    function roleCandidates(key) {
      const merged=new Map();
      moneyByValue.forEach(entry=>merged.set(entry.value,{value:entry.value,score:entry.score,labeled:false,positions:entry.positions}));
      (details[key] || []).forEach(function (entry) {
        const current=merged.get(entry.value) || {value:entry.value,score:0,labeled:false,positions:[]};
        current.score=Math.max(current.score,entry.score); current.labeled=true; merged.set(entry.value,current);
      });
      return Array.from(merged.values()).sort((a,b)=>b.score-a.score).slice(0,35);
    }
    function layoutScore(gross,deductions,net) {
      let best=0;
      for (let passIndex=0;passIndex<validPasses.length;passIndex++) {
        const gp=gross.positions.filter(p=>p.passIndex===passIndex), dp=deductions.positions.filter(p=>p.passIndex===passIndex), np=net.positions.filter(p=>p.passIndex===passIndex);
        gp.forEach(g=>dp.forEach(d=>np.forEach(n=>{
          const spread=Math.max(g.x,d.x,n.x)-Math.min(g.x,d.x,n.x);
          let score=0;
          if (g.y<d.y && d.y<n.y) score+=spread<.22 ? 95 : 45;
          if ((g.x+d.x+n.x)/3>.58) score+=18;
          best=Math.max(best,score);
        })));
      }
      return best;
    }
    const gross=roleCandidates('gross'), deductions=roleCandidates('deductions'), net=roleCandidates('net');
    const cash=(details.cash || []).length ? details.cash.map(entry=>({value:entry.value,score:entry.score})) : [{value:0,score:20}];
    const balanced=[];
    gross.forEach(g=>deductions.forEach(d=>net.forEach(n=>cash.forEach(c=>{
      if (g.value<0 || d.value<0 || n.value<0 || (typeof values.basePay==='number' && g.value<values.basePay)) return;
      const difference=Math.abs(g.value-d.value-n.value-c.value);
      if (difference>1) return;
      const labeledCount=[g,d,n].filter(entry=>entry.labeled).length;
      const score=g.score+d.score+n.score+c.score+layoutScore(g,d,n)+labeledCount*20;
      const id=[g.value,d.value,n.value,c.value].join(':');
      if (!balanced.some(choice=>choice.id===id)) balanced.push({id,g:g.value,d:d.value,n:n.value,c:c.value,score,labeledCount});
    }))));
    balanced.sort((a,b)=>b.score-a.score);
    const winner=balanced[0], runnerUp=balanced[1];
    if (winner && (!runnerUp || winner.score-runnerUp.score>=25)) {
      values.gross=winner.g; values.deductions=winner.d; values.net=winner.n;
      if (details.cash.length) values.cash=winner.c;
    } else {
      // An unsupported tiny total is more safely shown as unread than as a
      // confident but unrelated allowance fragment.
      if (typeof values.gross==='number' && (values.gross<1000 || (typeof values.basePay==='number' && values.gross<values.basePay))) values.gross=null;
      if (typeof values.net==='number' && values.net<1000) values.net=null;
    }
    const warnings=Array.from(new Set(validPasses.flatMap(p=>p.warnings || []))).filter(w=>
      !w.startsWith('読み取れなかった項目') || !values.month || ['basePay','gross','deductions','net'].some(key=>values[key] == null));
    return {values,detected:Object.keys(values).filter(key=>values[key] !== null && values[key] !== ''),warnings};
  }

  return { FIELDS: FIELDS, parse: parse, reconcile: reconcile };
});
