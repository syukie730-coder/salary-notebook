/* All records and images stay in this browser. No analytics, upload or external API. */
'use strict';
(() => {
  const $ = id => document.getElementById(id);
  const { FIELDS, parse, reconcile } = window.PayrollParser;
  const IMPORTANT = ['basePay', 'gross', 'deductions', 'net'];
  const REQUIRED = ['gross', 'deductions', 'net'];
  const DB_NAME = 'husband-salary-notebook-v1';
  const FORMAT = 'salary-notebook-backup';
  const MONEY = new Intl.NumberFormat('ja-JP');
  let records = [], draft = null, selectedId = null, db = null, imageURL = null;
  let currentScreen = 'home', run = 0, cancelOCR = null, saveBusy = false;
  const yen = n => n === null || n === undefined ? '未確認' : `${MONEY.format(n)}円`;
  const monthText = m => `${Number(m.slice(0, 4))}年${Number(m.slice(5))}月`;
  const monthValid = m => typeof m === 'string' && /^(19|20|21)\d{2}-(0[1-9]|1[0-2])$/.test(m);
  const escapeHTML = s => String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const uid = () => crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  function tell(message, error = false) { $('notice').textContent = message; $('notice').className = `notice${error ? ' error' : ''}`; $('notice').hidden = false; }
  function errorText(err) { return err?.name === 'QuotaExceededError' ? '端末の空き容量が足りません。バックアップを保存してから、不要な写真などを整理してください。' : (err?.message || '処理できませんでした。もう一度お試しください。'); }
  function openDB() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => { const store = req.result.createObjectStore('records', {keyPath:'id'}); store.createIndex('month', 'month', {unique:true}); };
      req.onsuccess = () => { req.result.onversionchange = () => req.result.close(); resolve(req.result); };
      req.onerror = () => reject(new Error('端末に記録を保存できません。Safariの通常の画面で開き直してください。'));
      req.onblocked = () => reject(new Error('別の画面で開いているこのアプリを閉じて、開き直してください。'));
    });
  }
  function transaction(mode, action) {
    return new Promise((resolve, reject) => {
      const tx = db.transaction('records', mode);
      let result;
      tx.oncomplete = () => resolve(result);
      tx.onerror = () => reject(tx.error || new Error('保存できませんでした。'));
      tx.onabort = () => reject(tx.error || new Error('保存を中止しました。'));
      try { result = action(tx.objectStore('records')); } catch (e) { tx.abort(); reject(e); }
    });
  }
  async function refresh() {
    records = await new Promise((resolve, reject) => { const r = db.transaction('records').objectStore('records').getAll(); r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); });
    records.sort((a, b) => b.month.localeCompare(a.month));
  }
  function show(screen, focus = true) {
    const allowed = ['home','reading','review','saved','history','detail','graphs','backup'];
    if (!allowed.includes(screen) || (screen === 'review' && !draft) || (screen === 'detail' && !selectedId)) screen = 'home';
    currentScreen = screen;
    document.querySelectorAll('.screen').forEach(el => { el.hidden = el.id !== screen; });
    $('notice').hidden = true;
    $('back-button').hidden = screen === 'home' || screen === 'reading';
    $('back-button').textContent = screen === 'detail' ? '‹ 過去の明細へ' : '‹ ホームへ';
    if (screen === 'history') renderHistory();
    if (screen === 'graphs') renderGraphs();
    if (screen === 'detail') renderDetail();
    if (focus) { window.scrollTo({top:0, behavior:'instant'}); $(screen).querySelector('h2')?.focus({preventScroll:true}); }
  }
  function navigate(screen) {
    if (saveBusy) return;
    if (currentScreen === 'reading') { cancelOCR?.(); run++; }
    if (currentScreen === 'review' && draft && !confirm('まだ保存していません。確認画面を閉じますか？')) return;
    if (currentScreen === 'review') clearDraft();
    show(screen);
  }
  function clearDraft() { draft = null; if (imageURL) URL.revokeObjectURL(imageURL); imageURL = null; $('review-image').removeAttribute('src'); }
  function useImage(blob, id) { if (imageURL) URL.revokeObjectURL(imageURL); imageURL = URL.createObjectURL(blob); $(id).src = imageURL; }
  function loadImage(blob) {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(blob), img = new Image();
      img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
      img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('この写真を開けませんでした。撮り直すか、JPEG・PNGの写真を選んでください。')); };
      img.src = url;
    });
  }
  const toBlob = (canvas, type, quality) => new Promise((resolve, reject) => canvas.toBlob(b => b ? resolve(b) : reject(new Error('写真を保存用に準備できませんでした。')), type, quality));
  async function preparePhoto(file) {
    if (file.size > 70 * 1024 * 1024) throw new Error('写真が大きすぎます。明細をもう一度撮影してください。');
    const img = await loadImage(file);
    // Safari's Image decoder applies the photograph's EXIF orientation. Retain
    // more detail for small table cells; the stored photo remains at 2000 px.
    const ratio = Math.min(1, 3000 / Math.max(img.naturalWidth, img.naturalHeight));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(img.naturalWidth * ratio); canvas.height = Math.round(img.naturalHeight * ratio);
    const context = canvas.getContext('2d', {willReadFrequently:true});
    context.fillStyle = '#fff'; context.fillRect(0, 0, canvas.width, canvas.height); context.drawImage(img, 0, 0, canvas.width, canvas.height);
    const storage = document.createElement('canvas'), sr = Math.min(1, 2000 / Math.max(canvas.width, canvas.height));
    storage.width = Math.round(canvas.width * sr); storage.height = Math.round(canvas.height * sr);
    storage.getContext('2d').drawImage(canvas, 0, 0, storage.width, storage.height);
    let blob = await toBlob(storage, 'image/webp', .88);
    if (blob.type !== 'image/webp') blob = await toBlob(storage, 'image/jpeg', .88);
    if (blob.size > 1500000) blob = await toBlob(storage, blob.type, .78);
    storage.width = storage.height = 1;
    return {canvas, blob};
  }
  function enhanceForOCR(source, binary = false) {
    const canvas = document.createElement('canvas');
    canvas.width = source.width; canvas.height = source.height;
    const ctx = canvas.getContext('2d', {willReadFrequently:true});
    ctx.drawImage(source,0,0);
    const image = ctx.getImageData(0,0,canvas.width,canvas.height), p=image.data;
    const histogram = new Uint32Array(256);
    for (let i=0;i<p.length;i+=4) {
      const r=p[i], g=p[i+1], b=p[i+2];
      // Printed blue grid lines are common on Japanese payslips. Remove pixels
      // that are clearly blue while retaining neutral black text and numbers.
      const blueGrid=b-r>18 && b-g>7 && b>105;
      const gray=blueGrid ? 255 : Math.round(r*.299+g*.587+b*.114);
      p[i]=gray; histogram[gray]++;
    }
    const total=p.length/4;
    let sum=0, low=0, high=255;
    for (let i=0;i<256;i++) { sum+=histogram[i]; if (sum>=total*.01) {low=i;break;} }
    sum=0;
    for (let i=255;i>=0;i--) { sum+=histogram[i]; if (sum>=total*.01) {high=i;break;} }
    const span=Math.max(50,high-low);
    const threshold=low+span*.68;
    for (let i=0;i<p.length;i+=4) {
      const gray=binary ? (p[i]<threshold ? 0 : 255) : Math.max(0,Math.min(255,Math.round((p[i]-low)*255/span)));
      p[i]=p[i+1]=p[i+2]=gray; p[i+3]=255;
    }
    ctx.putImageData(image,0,0);
    return canvas;
  }
  async function readPhoto(file) {
    if (!file || saveBusy) return;
    clearDraft();
    const token = ++run;
    let worker, canvas, enhanced, binary, timer;
    show('reading'); $('read-progress').value = 0; $('read-status').textContent = '写真を準備しています…';
    const interrupted = new Promise((_, reject) => {
      cancelOCR = () => reject(new Error('cancelled'));
      timer = setTimeout(() => reject(new Error('読み取りに時間がかかっています。通信を確認して、文字が大きくはっきり写った写真でもう一度お試しください。')), 150000);
    });
    const ensureActive = () => { if (token !== run) throw new Error('cancelled'); };
    const job = async () => {
      const prepared = await preparePhoto(file); canvas = prepared.canvas; ensureActive();
      const base = new URL('./vendor/', document.baseURI);
      worker = await Tesseract.createWorker('jpn+eng', 1, {
        workerPath:new URL('worker.min.js', base).href,
        corePath:new URL('core/', base).href,
        langPath:new URL('lang/', base).href,
        workerBlobURL:false, cacheMethod:'none',
        logger: m => {
          if (token !== run) return;
          const recognizing = m.status === 'recognizing text';
          const percent = Math.round((m.progress || 0) * 100);
          $('read-progress').value = recognizing ? 30 + percent * .7 : Math.min(25, percent * .25);
          $('read-status').textContent = recognizing ? `数字を読んでいます… ${percent}%` : '読み取りの準備中…（初回だけ少し長め）';
        }
      });
      if (token !== run) { await worker.terminate(); throw new Error('cancelled'); }
      await worker.setParameters({tessedit_pageseg_mode:'3', preserve_interword_spaces:'1', user_defined_dpi:'300'});
      const {data} = await worker.recognize(canvas, {rotateAuto:true}, {text:true, tsv:true}); ensureActive();
      const passes = [parse(data.text, data.tsv)];
      let parsed = reconcile(passes);
      const needsRetry = () => {
        const values=parsed.values;
        const truncated=IMPORTANT.some(key => typeof values[key] === 'number' && Math.abs(values[key]) < 1000);
        const totalsPresent=['gross','deductions','net'].every(key => typeof values[key] === 'number');
        const totalsMismatch=totalsPresent && Math.abs(values.gross-values.deductions-values.net-(values.cash || 0)) > 1;
        return !values.month || IMPORTANT.some(key => values[key] == null) || truncated || totalsMismatch;
      };
      for (const [index,mode] of ['11', '6'].entries()) {
        if (!needsRetry()) break;
        $('read-status').textContent = 'もう少しだけ、数字を確かめています…';
        if (!enhanced) enhanced = enhanceForOCR(canvas);
        if (index === 1 && !binary) binary = enhanceForOCR(canvas, true);
        const retry = await worker.recognize(index === 0 ? enhanced : binary, {tessedit_pageseg_mode:mode,rotateAuto:true}, {text:true, tsv:true}); ensureActive();
        passes.push(parse(retry.data.text, retry.data.tsv));
        parsed = reconcile(passes);
      }
      draft = {id:null, month:parsed.values.month || '', values:parsed.values, image:prepared.blob, warnings:parsed.warnings || []};
      // Do not retain OCR text (which can contain names or addresses) beyond this operation.
      renderReview(); show('review');
    };
    try { await Promise.race([job(), interrupted]); }
    catch (e) {
      if (token === run) { run++; show('home'); if (e.message !== 'cancelled') tell(errorText(e), true); }
    } finally { clearTimeout(timer); if (token === run) cancelOCR = null; if (worker) await worker.terminate().catch(() => {}); if (canvas) canvas.width = canvas.height = 1; if (enhanced) enhanced.width = enhanced.height = 1; if (binary) binary.width = binary.height = 1; }
  }
  function fieldMarkup(f, key = false) {
    const value = draft.values[f.key];
    const unit = f.kind === 'money' ? '円' : f.kind === 'hours' ? '時間' : '日';
    return `<label class="field ${key ? 'key-field' : ''} ${value === null || value === undefined ? 'missing' : ''}"><span>${escapeHTML(f.label)}</span><span class="value-row"><input id="field-${f.key}" name="${f.key}" inputmode="${f.kind === 'money' ? 'numeric' : 'decimal'}" autocomplete="off" placeholder="未読取・タップで入力" value="${value == null ? '' : MONEY.format(value)}" ${REQUIRED.includes(f.key) ? 'required' : ''}><small>${unit}</small></span></label>`;
  }
  function renderReview() {
    $('key-fields').innerHTML = `<label class="field key-field ${!draft.month ? 'missing' : ''}"><span>支給年月</span><input id="field-month" name="month" type="month" min="1900-01" max="2199-12" required value="${escapeHTML(draft.month)}"></label>` + IMPORTANT.map(k => fieldMarkup(FIELDS.find(f => f.key === k), true)).join('');
    let group = '';
    $('other-fields').innerHTML = FIELDS.filter(f => !IMPORTANT.includes(f.key)).map(f => { const heading = f.group !== group ? `<h3 class="field-group-title">${escapeHTML(f.group)}</h3>` : ''; group = f.group; return heading + fieldMarkup(f); }).join('');
    useImage(draft.image, 'review-image');
    const missing = !draft.month || REQUIRED.some(k => draft.values[k] == null);
    $('review-warning').textContent = missing ? '読み取れていない大切な項目があります。写真を撮り直すか、黄色の欄をタップして確かめてください。' : '年月と金額を写真と見比べてください。読み取り結果は自動では保存しません。';
    if (draft.warnings.length) $('review-warning').textContent += ` ${draft.warnings.join(' ')}`;
    $('save-record').disabled = false;
  }
  function readValues() {
    const values = {};
    for (const f of FIELDS) {
      const el = $(`field-${f.key}`), text = el.value.normalize('NFKC').replace(/[,\s円]/g, '');
      el.setCustomValidity('');
      if (!text) { values[f.key] = null; continue; }
      const pattern = f.kind === 'money' ? /^-?\d+$/ : /^\d+(?:\.\d{1,3})?$/;
      if (!pattern.test(text) || !Number.isFinite(Number(text)) || Math.abs(Number(text)) > 1e10) {
        el.setCustomValidity(f.kind === 'money' ? '金額を整数の数字で入力してください。' : '数字で入力してください。');
        el.closest('details')?.setAttribute('open', ''); el.reportValidity(); return null;
      }
      values[f.key] = Number(text);
    }
    return values;
  }
  async function saveRecord(event) {
    event.preventDefault();
    if (saveBusy || !draft) return;
    const values = readValues(), month = $('field-month').value;
    if (!values || !monthValid(month)) return;
    if (REQUIRED.some(k => values[k] === null)) { tell('支給合計・控除合計・振込支給額を確認してください。', true); return; }
    const totalNet = values.net + (values.cash || 0);
    if (Math.abs(values.gross - values.deductions - totalNet) > 1 && !confirm('支給合計 − 控除合計と、振込・現金支給額の合計が一致していません。写真の数字を確認済みですか？\n\nこの内容で保存する場合は「OK」を押してください。')) return;
    const duplicate = records.find(r => r.month === month && r.id !== draft.id);
    if (duplicate && !confirm(`${monthText(month)}の明細は保存済みです。今回の内容に置き換えますか？`)) return;
    saveBusy = true; $('save-record').disabled = true;
    const editing = records.find(r => r.id === draft.id);
    const record = {id:duplicate?.id || draft.id || uid(), month, values, image:draft.image, createdAt:editing?.createdAt || duplicate?.createdAt || new Date().toISOString(), updatedAt:new Date().toISOString()};
    try {
      await transaction('readwrite', store => { if (editing && editing.id !== record.id) store.delete(editing.id); store.put(record); });
      await refresh(); clearDraft(); selectedId = record.id;
      $('month-comment').textContent = makeComment(record);
      show('saved'); celebrate();
    } catch(e) { tell(errorText(e), true); }
    finally { saveBusy = false; $('save-record').disabled = false; }
  }
  function makeComment(r) {
    const previous = records.filter(x => x.month < r.month).sort((a,b) => b.month.localeCompare(a.month))[0];
    let text = `今月の手取りは${yen(r.values.net)}でした👏`;
    if (previous && previous.values.net != null) {
      const a = new Date(`${r.month}-01T12:00:00`), b = new Date(`${previous.month}-01T12:00:00`);
      const adjacent = (a.getFullYear() - b.getFullYear()) * 12 + a.getMonth() - b.getMonth() === 1;
      const label = adjacent ? '先月' : `${monthText(previous.month)}`;
      const delta = r.values.net - previous.values.net;
      if (delta > 0) text += `\n${label}より${yen(delta)}アップ！`;
      else if (delta < 0) text += `\n${label}より${yen(Math.abs(delta))}少なめでした。`;
      else text += `\n${label}と同じ手取り額でした。`;
      if (r.values.deductions != null && previous.values.deductions != null && r.values.deductions > previous.values.deductions) text += '\n控除が増えています。明細を一度確認してみましょう👀';
      else if (r.values.overtimeHours != null && previous.values.overtimeHours != null && r.values.overtimeHours < previous.values.overtimeHours) text += '\n残業は少なめでした。ゆっくり休んで、来月も元気に☕️';
      else text += '\n今月もお疲れさまでした😊';
    } else text += '\n最初の記録ができました！\n今月もお疲れさまでした😊';
    return text;
  }
  function celebrate() {
    const container = $('celebration'); container.replaceChildren();
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const colors = ['#ffd64e','#1261cf','#53c6aa','#ff9259','#ffffff'];
    for (let i = 0; i < 34; i++) {
      const el = document.createElement('span'); el.className = `confetti${i % 9 === 0 ? ' emoji' : ''}`;
      if (i % 9 === 0) el.textContent = ['👏','✨','💰','🎉'][i / 9];
      el.style.cssText = `left:${Math.random()*100}%;background:${colors[i%colors.length]};--drift:${(Math.random()-.5)*150}px;--turn:${Math.random()*720-360}deg;--duration:${1.5+Math.random()*.8}s;--delay:${Math.random()*.4}s`;
      container.append(el);
    }
    setTimeout(() => container.replaceChildren(), 2900);
  }
  function moneyLines(r) { return `<div class="money-line"><span>総支給</span><strong>${yen(r.values.gross)}</strong></div><div class="money-line"><span>控除</span><strong>${yen(r.values.deductions)}</strong></div><div class="money-line net"><span>手取り</span><strong>${yen(r.values.net)}</strong></div>`; }
  function renderHistory() {
    $('record-list').innerHTML = records.length ? records.map(r => `<button class="record-card" data-record="${escapeHTML(r.id)}"><div class="record-heading"><strong>${monthText(r.month)}</strong><small>詳しく ›</small></div>${moneyLines(r)}</button>`).join('') : '<div class="empty"><span>📋</span>まだ明細がありません。<br>最初の1枚を撮ってみましょう。</div><button class="primary full" data-go="home">📸 撮影ボタンへ</button>';
  }
  function renderDetail() {
    const record = records.find(r => r.id === selectedId);
    if (!record) { show('history'); return; }
    $('detail-title').textContent = monthText(record.month);
    let group = '';
    const details = FIELDS.map(f => { const heading = group !== f.group ? `<h3 class="field-group-title">${escapeHTML(f.group)}</h3>` : ''; group = f.group; const v = record.values[f.key]; return `${heading}<div class="detail-row"><dt>${escapeHTML(f.label)}</dt><dd>${v == null ? '—' : f.kind === 'money' ? yen(v) : `${MONEY.format(v)}${f.kind === 'hours' ? '時間' : '日'}`}</dd></div>`; }).join('');
    $('detail-content').innerHTML = `<div class="paper">${moneyLines(record)}</div><details class="paper"><summary>📄 給与明細の写真</summary><img id="detail-image" alt="保存した給与明細の写真"></details><div class="paper"><dl>${details}</dl></div>`;
    useImage(record.image, 'detail-image');
  }
  function renderGraphs() {
    const years = [...new Set([String(new Date().getFullYear()), ...records.map(r => r.month.slice(0,4))])].sort().reverse();
    const selected = $('graph-year').value || years[0];
    $('graph-year').innerHTML = years.map(y => `<option ${y === selected ? 'selected' : ''}>${y}</option>`).join('');
    const year = $('graph-year').value;
    const data = records.filter(r => r.month.startsWith(`${year}-`)).sort((a,b) => a.month.localeCompare(b.month));
    if (!data.length) { $('graph-content').innerHTML = '<div class="empty"><span>🌱</span>この年の記録はまだありません。<br>保存するたび、グラフが育ちます。</div>'; return; }
    const total = key => data.reduce((s,r) => s + (r.values[key] || 0), 0);
    const series = [{key:'net',label:'手取り',color:'#125ccc'},{key:'gross',label:'総支給',color:'#188465'},{key:'deductions',label:'控除',color:'#b55618'}];
    const all = data.flatMap(r => series.map(s => r.values[s.key]).filter(v => v != null));
    const max = Math.max(...all, 10000), min = Math.min(...all, 0), span = max - min;
    const x = month => 90 + (month - 1) * 53, y = v => 270 - ((v - min) / span) * 210;
    let svg = '<svg viewBox="0 0 720 345" role="img" aria-label="1月から12月までの手取り・総支給・控除。下の月ごとの数字でも確認できます。">';
    for (let i=0; i<4; i++) { const value = min + span*i/3, py = y(value); svg += `<line x1="88" y1="${py}" x2="684" y2="${py}" stroke="#dce6f0"/><text x="78" y="${py+8}" text-anchor="end" font-size="24" fill="#51677c">${(value/10000).toFixed(1)}</text>`; }
    svg += '<text x="78" y="30" text-anchor="end" font-size="24" fill="#51677c">万円</text>';
    for (let m=1; m<=12; m++) svg += `<text x="${x(m)}" y="310" text-anchor="middle" font-size="25" fill="#51677c">${m}</text>`;
    svg += '<text x="689" y="338" font-size="23" fill="#51677c">月</text>';
    for (const s of series) {
      let path = '', previousMonth = -1;
      for (const r of data) { const v = r.values[s.key], m=Number(r.month.slice(5)); if (v == null) { previousMonth=-1; continue; } path += `${previousMonth === m-1 ? 'L' : 'M'}${x(m)},${y(v)} `; previousMonth=m; }
      svg += `<path class="chart-line" d="${path}" fill="none" stroke="${s.color}" stroke-width="5" stroke-linejoin="round"/>`;
      for (const r of data) if (r.values[s.key] != null) svg += `<circle cx="${x(Number(r.month.slice(5)))}" cy="${y(r.values[s.key])}" r="6" fill="${s.color}"/>`;
    }
    svg += '</svg>';
    const netRecords = data.filter(r => r.values.net != null);
    $('graph-content').innerHTML = `<div class="chart-card"><div class="legend">${series.map(s => `<span style="--c:${s.color}">${s.label}</span>`).join('')}</div>${svg}</div><p class="small-note">記録のある月だけ表示しています。</p><div class="totals"><div class="total highlight"><span>${year}年の手取り合計</span><strong>${yen(total('net'))}</strong></div><div class="total"><span>${year}年の総支給額</span><strong>${yen(total('gross'))}</strong></div><div class="total"><span>${year}年の控除合計</span><strong>${yen(total('deductions'))}</strong></div><div class="total"><span>月平均手取り（${netRecords.length}か月分）</span><strong>${yen(netRecords.length ? Math.round(total('net') / netRecords.length) : null)}</strong></div></div><details class="paper"><summary>月ごとの数字を見る</summary><div class="table-scroll"><table class="month-table"><thead><tr><th>月</th><th>手取り</th><th>総支給</th><th>控除</th></tr></thead><tbody>${data.map(r => `<tr><th>${Number(r.month.slice(5))}月</th><td>${yen(r.values.net)}</td><td>${yen(r.values.gross)}</td><td>${yen(r.values.deductions)}</td></tr>`).join('')}</tbody></table></div></details>`;
  }
  function blobDataURL(blob) { return new Promise((resolve,reject) => { const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.onerror = () => reject(reader.error); reader.readAsDataURL(blob); }); }
  async function exportBackup() {
    $('export-backup').disabled = true;
    try {
      await refresh();
      if (!records.length) { $('backup-status').textContent = 'まだ保存した明細がありません。'; return; }
      $('backup-status').textContent = '写真と数字をまとめています…';
      const exported = [];
      for (const r of records) exported.push({...r, image:await blobDataURL(r.image)});
      const blob = new Blob([JSON.stringify({format:FORMAT, version:1, exportedAt:new Date().toISOString(), records:exported})], {type:'application/json'});
      const url = URL.createObjectURL(blob), a = document.createElement('a'); a.href = url;
      a.download = `お給料明細バックアップ-${new Date().toISOString().slice(0,10)}.json`;
      document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 60000);
      $('backup-status').textContent = `${records.length}件のバックアップを用意しました。\n「ファイル」などに保存されたことを確認してください。`;
    } catch(e) { $('backup-status').textContent = errorText(e); }
    finally { $('export-backup').disabled = false; }
  }
  async function decodeBackup(file) {
    let data; try { data = JSON.parse(await file.text()); } catch { throw new Error('このファイルは読み込めません。このアプリで保存したバックアップを選んでください。'); }
    if (data?.format !== FORMAT || data.version !== 1 || !Array.isArray(data.records)) throw new Error('このアプリのバックアップではありません。');
    const result = [];
    for (const r of data.records) {
      if (!r || !monthValid(r.month) || typeof r.id !== 'string' || !/^[\w-]{1,80}$/.test(r.id) || !r.values || typeof r.values !== 'object') throw new Error('バックアップの記録に不正な内容があります。何も変更していません。');
      const values = {};
      for (const f of FIELDS) {
        const v = r.values[f.key];
        if (v == null) values[f.key] = null;
        else if (typeof v !== 'number' || !Number.isFinite(v) || Math.abs(v) > 1e10 || (f.kind === 'money' && !Number.isInteger(v)) || (f.kind !== 'money' && v < 0)) throw new Error('バックアップの数字を確認できません。何も変更していません。');
        else values[f.key] = v;
      }
      if (typeof r.image !== 'string' || r.image.length > 8 * 1024 * 1024 || !/^data:image\/(webp|jpeg|png);base64,[A-Za-z0-9+/]+={0,2}$/.test(r.image)) throw new Error('バックアップの写真を確認できません。何も変更していません。');
      const binary = atob(r.image.split(',')[1]), bytes = Uint8Array.from(binary, c => c.charCodeAt(0));
      const blob = new Blob([bytes], {type:r.image.slice(5, r.image.indexOf(';'))});
      const img = await loadImage(blob);
      if (img.naturalWidth > 5000 || img.naturalHeight > 5000) throw new Error('バックアップの写真が大きすぎます。何も変更していません。');
      result.push({id:r.id,month:r.month,values,image:blob,createdAt:typeof r.createdAt === 'string' ? r.createdAt.slice(0,40) : new Date().toISOString(),updatedAt:new Date().toISOString()});
    }
    return result;
  }
  async function importBackup(file) {
    if (!file) return;
    $('import-backup').disabled = true; $('backup-status').textContent = 'バックアップを確かめています…';
    try {
      const restored = await decodeBackup(file); await refresh();
      const months = new Set(records.map(r => r.month)), ids = new Set(records.map(r => r.id)), additions = [];
      for (const r of restored) { if (months.has(r.month) || ids.has(r.id)) continue; months.add(r.month); ids.add(r.id); additions.push(r); }
      if (!additions.length) { $('backup-status').textContent = '追加する明細はありません。同じ記録は重複させませんでした。'; return; }
      if (!confirm(`${additions.length}件の明細を復元しますか？\n今ある明細はそのまま残ります。`)) { $('backup-status').textContent = '復元をキャンセルしました。'; return; }
      await transaction('readwrite', store => additions.forEach(r => store.add(r))); await refresh();
      $('backup-status').textContent = `${additions.length}件の明細を復元しました。${restored.length - additions.length ? `\n重複する${restored.length - additions.length}件は追加していません。` : ''}`;
    } catch(e) { $('backup-status').textContent = errorText(e); }
    finally { $('import-backup').disabled = false; }
  }
  document.addEventListener('click', event => {
    const go = event.target.closest('[data-go]'); if (go) navigate(go.dataset.go);
    const record = event.target.closest('[data-record]'); if (record) { selectedId = record.dataset.record; show('detail'); }
  });
  $('home-button').onclick = () => navigate('home');
  $('back-button').onclick = () => navigate(currentScreen === 'detail' ? 'history' : 'home');
  $('take-photo').onclick = () => $('camera-input').click();
  $('choose-photo').onclick = () => $('photo-input').click();
  $('retake').onclick = () => $('camera-input').click();
  for (const id of ['camera-input','photo-input']) $(id).onchange = e => { const file = e.target.files[0]; e.target.value = ''; readPhoto(file); };
  $('cancel-reading').onclick = () => navigate('home');
  $('review-form').onsubmit = saveRecord;
  $('review-form').addEventListener('input', e => { e.target.setCustomValidity?.(''); e.target.closest('.field')?.classList.remove('missing'); });
  $('review-form').addEventListener('focusin', e => { if (e.target.inputMode === 'numeric' || e.target.inputMode === 'decimal') e.target.select(); });
  $('review-form').addEventListener('focusout', e => { const el = e.target; if (el.tagName === 'INPUT' && el.type !== 'month' && /^-?\d+(\.\d+)?$/.test(el.value)) el.value = MONEY.format(Number(el.value)); });
  $('edit-record').onclick = () => { const r = records.find(r => r.id === selectedId); if (r) { draft = {...r,values:{...r.values},warnings:[]}; renderReview(); show('review'); } };
  $('delete-record').onclick = async () => {
    const r = records.find(r => r.id === selectedId);
    if (!r || !confirm(`${monthText(r.month)}の給与明細と写真を削除しますか？\nこの操作は元に戻せません。`)) return;
    try { await transaction('readwrite', s => s.delete(r.id)); await refresh(); selectedId = null; show('history'); tell('明細を削除しました。'); }
    catch(e) { tell(errorText(e), true); }
  };
  $('graph-year').onchange = renderGraphs;
  $('export-backup').onclick = exportBackup;
  $('import-backup').onclick = () => $('backup-input').click();
  $('backup-input').onchange = e => { const file = e.target.files[0]; e.target.value = ''; importBackup(file); };
  // A unique database and cache prefix isolate this app from other Pages apps.
  async function init() {
    $('take-photo').disabled = $('choose-photo').disabled = true;
    try { db = await openDB(); await refresh(); $('take-photo').disabled = $('choose-photo').disabled = false; }
    catch(e) { tell(errorText(e), true); }
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('./sw.js', {scope:'./'}).catch(() => {});
      navigator.serviceWorker.addEventListener('message', e => { if (e.data === 'ocr-cached') $('offline-note').textContent = '読み取りの準備ができました。写真は端末内で処理します。'; });
    }
  }
  init();
})();
