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

  function parse(text, tsv) {
    const values = { month: '' };
    FIELDS.forEach(function (field) { values[field.key] = null; });
    const candidates = {};
    const warnings = [];
    function add(key, value, priority) {
      if (value === null) return;
      if (!candidates[key]) candidates[key] = [];
      candidates[key].push({ value: value, priority: priority });
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
    allLabels.forEach(function (label) {
      const kind = byKey[label.key].kind;
      const numeric = words.map(function (word) { return { word: word, value: numberFrom(word.text, kind) }; }).filter(function (entry) { return entry.value !== null && entry.word.confidence >= 20; });
      const height = label.bottom - label.top;
      const center = (label.left + label.right) / 2;
      const sameRow = numeric.filter(function (entry) {
        const word = entry.word;
        const middle = word.top + word.height / 2;
        return middle >= label.top - height * 0.2 && middle <= label.bottom + height * 0.2 && word.left >= label.right - 2 && word.left - label.right <= height * 12 &&
          !allLabels.some(function (other) { return other !== label && other.row === label.row && other.left >= label.right && other.left < word.left; });
      }).sort(function (a, b) { return a.word.left - b.word.left; });
      if (sameRow.length === 1) add(label.key, sameRow[0].value, 4);

      // Horizontal headers above amounts: stay inside this header's column.
      const neighbors = label.row.labels.filter(function (other) { return other !== label; });
      const previous = neighbors.filter(function (other) { return other.right <= label.left; }).sort(function (a, b) { return b.right - a.right; })[0];
      const next = neighbors.filter(function (other) { return other.left >= label.right; }).sort(function (a, b) { return a.left - b.left; })[0];
      const minX = previous ? (previous.right + label.left) / 2 : label.left - height * 1.5;
      const maxX = next ? (label.right + next.left) / 2 : label.right + height * 2.5;
      const below = numeric.filter(function (entry) {
        const word = entry.word;
        const x = word.left + word.width / 2;
        return word.top >= label.bottom - 2 && word.top - label.bottom <= height * 2.8 && x > minX && x < maxX &&
          !allLabels.some(function (other) {
            return other !== label && other.top >= label.bottom - 2 && other.top < word.top && other.left < maxX && other.right > minX;
          });
      }).sort(function (a, b) { return a.word.top - b.word.top || Math.abs(a.word.left + a.word.width / 2 - center) - Math.abs(b.word.left + b.word.width / 2 - center); });
      if (below.length) {
        const nearestRow = below.filter(function (entry) { return Math.abs(entry.word.top - below[0].word.top) < height * 0.6; });
        if (nearestRow.length === 1) add(label.key, nearestRow[0].value, 2);
      }
    });
    FIELDS.forEach(function (field) {
      const entries = candidates[field.key] || [];
      if (!entries.length) return;
      const best = Math.max.apply(null, entries.map(function (entry) { return entry.priority; }));
      const options = Array.from(new Set(entries.filter(function (entry) { return entry.priority === best; }).map(function (entry) { return entry.value; })));
      if (options.length === 1) values[field.key] = options[0];
      else warnings.push(field.label + 'が複数読み取れました。元の明細で確認してください。');
    });
    const month = readMonth(text);
    values.month = month.value;
    if (month.conflict) warnings.push('支給年月の候補が複数あります。元の明細で確認してください。');
    if (['month', 'basePay', 'gross', 'deductions', 'net'].some(function (key) { return values[key] === null || values[key] === ''; })) {
      warnings.push('読み取れなかった項目は空欄です。元の明細を見ながら確認してください。');
    }
    return { values: values, detected: Object.keys(values).filter(function (key) { return values[key] !== null && values[key] !== ''; }), warnings: warnings };
  }

  return { FIELDS: FIELDS, parse: parse };
});
