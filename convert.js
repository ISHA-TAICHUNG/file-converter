// ===== 檔案轉檔工具（純前端，不上傳雲端）=====
// PDF → TXT 用 PDF.js、XLSX → CSV 用 SheetJS（已在 HTML 載入）

// 動態載入 PDF.js ESM
let pdfjsLib = null;
(async () => {
    try {
        pdfjsLib = await import('https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.0.379/pdf.min.mjs');
        pdfjsLib.GlobalWorkerOptions.workerSrc =
            'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.0.379/pdf.worker.min.mjs';
    } catch (err) {
        console.error('PDF.js 載入失敗:', err);
    }
})();

// ===== 共用工具 =====
function log(area, msg, type) {
    area.classList.add('show');
    const line = document.createElement('div');
    line.className = 'log-line' + (type ? ' ' + type : '');
    line.textContent = msg;
    area.appendChild(line);
    area.scrollTop = area.scrollHeight;
}

function downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => {
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    }, 100);
}

function buildSignoffTxtName(filename) {
    const baseName = filename.replace(/\.pdf$/i, '').trim();
    const safeName = baseName || '轉檔結果';
    if (safeName.includes('成績單簽收')) {
        return safeName + '.txt';
    }
    return '成績單簽收總表-' + safeName + '.txt';
}

function analyzeSignoffText(txt) {
    const lines = String(txt || '').split(/\r?\n/).filter(l => l.trim());
    let studentCount = 0;
    for (const line of lines) {
        const text = line.trim();
        // 與管理職類查詢 GAS parser 對齊：
        // 座號 + 遮罩身分證 + 姓名 + 期別 + 准考證號 + 職類
        if (/^\d{4}\s+[A-Z]\d{2}X{5}\d{2}\s+\S+\s+/.test(text)) {
            studentCount++;
        }
    }
    return {
        lineCount: lines.length,
        studentCount,
    };
}

function renderFileList(listEl, files) {
    listEl.textContent = '';
    files.forEach((f, i) => {
        const item = document.createElement('div');
        item.className = 'file-item';
        const name = document.createElement('span');
        name.textContent = f.name + ' (' + (f.size / 1024).toFixed(1) + ' KB)';
        const status = document.createElement('span');
        status.className = 'status waiting';
        status.textContent = '待轉';
        status.dataset.idx = i;
        item.appendChild(name);
        item.appendChild(status);
        listEl.appendChild(item);
    });
}

function updateStatus(listEl, idx, cls, text) {
    const st = listEl.querySelector(`[data-idx="${idx}"]`);
    if (!st) return;
    st.className = 'status ' + cls;
    st.textContent = text;
}

function initDropZone(dropEl, inputEl, onFiles) {
    dropEl.addEventListener('dragover', e => {
        e.preventDefault();
        dropEl.classList.add('dragover');
    });
    dropEl.addEventListener('dragleave', () => dropEl.classList.remove('dragover'));
    dropEl.addEventListener('drop', e => {
        e.preventDefault();
        dropEl.classList.remove('dragover');
        onFiles(Array.from(e.dataTransfer.files));
    });
    inputEl.addEventListener('change', () => {
        onFiles(Array.from(inputEl.files));
    });
}

// ===== PDF → TXT =====
const pdfDrop = document.getElementById('pdfDrop');
const pdfInput = document.getElementById('pdfInput');
const pdfFileList = document.getElementById('pdfFileList');
const pdfConvertBtn = document.getElementById('pdfConvertBtn');
const pdfClearBtn = document.getElementById('pdfClearBtn');
const pdfLog = document.getElementById('pdfLog');
let pdfFiles = [];

initDropZone(pdfDrop, pdfInput, files => {
    pdfFiles = files.filter(f => f.name.toLowerCase().endsWith('.pdf'));
    renderFileList(pdfFileList, pdfFiles);
    pdfConvertBtn.disabled = pdfFiles.length === 0;
});

pdfClearBtn.addEventListener('click', () => {
    pdfFiles = [];
    pdfFileList.textContent = '';
    pdfInput.value = '';
    pdfLog.classList.remove('show');
    pdfLog.textContent = '';
    pdfConvertBtn.disabled = true;
});

pdfConvertBtn.addEventListener('click', async () => {
    if (!pdfjsLib) {
        log(pdfLog, '⚠ PDF.js 尚未載入完成，請稍後再試', 'err');
        return;
    }
    pdfConvertBtn.disabled = true;
    for (let i = 0; i < pdfFiles.length; i++) {
        const file = pdfFiles[i];
        updateStatus(pdfFileList, i, 'processing', '轉檔中…');
        try {
            const buf = await file.arrayBuffer();
            const pdf = await pdfjsLib.getDocument({ data: buf }).promise;
            const allLines = [];
            for (let p = 1; p <= pdf.numPages; p++) {
                const page = await pdf.getPage(p);
                const content = await page.getTextContent();
                // 步驟 1：依 y 座標分行（容差 3 pt）
                // 步驟 2：同行按 x 座標升序（左 → 右）
                // 步驟 3：相鄰 item 間若 x 有較大 gap 則加空格
                const rows = []; // [{y, items:[{x, str}]}]
                for (const it of content.items) {
                    if (!it.str || !it.str.trim()) continue;
                    const x = it.transform[4];
                    const y = it.transform[5];
                    // 找同 y 的既有行
                    let row = rows.find(r => Math.abs(r.y - y) <= 3);
                    if (!row) {
                        row = { y, items: [] };
                        rows.push(row);
                    }
                    row.items.push({ x, str: it.str, width: it.width || 0 });
                }
                // 依 y 降序排行（PDF 座標 y 從底部算起，閱讀順序是 y 大 → 小）
                rows.sort((a, b) => b.y - a.y);
                for (const row of rows) {
                    row.items.sort((a, b) => a.x - b.x);
                    let line = '';
                    let lastEnd = null;
                    for (const it of row.items) {
                        if (lastEnd !== null) {
                            const gap = it.x - lastEnd;
                            // gap > 2 pt 視為需要空格分隔
                            if (gap > 2 && !line.endsWith(' ') && !it.str.startsWith(' ')) {
                                line += ' ';
                            }
                        }
                        line += it.str;
                        lastEnd = it.x + (it.width || 0);
                    }
                    allLines.push(line.replace(/\s+/g, ' ').trim());
                }
            }
            const txt = allLines.filter(l => l).join('\n');
            const outName = buildSignoffTxtName(file.name);
            const analysis = analyzeSignoffText(txt);
            const blob = new Blob([txt], { type: 'text/plain;charset=utf-8' });
            downloadBlob(blob, outName);
            if (analysis.studentCount > 0) {
                updateStatus(pdfFileList, i, 'done', `✓ ${analysis.studentCount} 筆`);
                log(pdfLog, `✓ ${file.name} → ${outName}（${pdf.numPages} 頁、${analysis.lineCount} 行、解析到 ${analysis.studentCount} 筆學生記錄）`, 'ok');
            } else {
                updateStatus(pdfFileList, i, 'warning', '⚠ 0 筆');
                log(pdfLog, `⚠ ${file.name} → ${outName}（${pdf.numPages} 頁、${analysis.lineCount} 行、未解析到學生記錄，請確認是否為成績單簽收總表）`, 'warn');
            }
        } catch (err) {
            updateStatus(pdfFileList, i, 'error', '✗ 失敗');
            log(pdfLog, `✗ ${file.name}: ${err.message || err}`, 'err');
        }
    }
    pdfConvertBtn.disabled = false;
});

// ===== XLSX → CSV =====
const ALLOWED_WRITTEN_FIELDS_ZH = new Set([
    '准考證號', '學科測試編號', '場地', '試場', '場次', '測試日期', '測試時間'
]);
const WRITTEN_FIELD_MAP = {
    '准考證號': 'aeno',
    '學科測試編號': 'examno',
    '場地': 'venue',
    '試場': 'room',
    '場次': 'distid',
    '測試日期': 'exdate',
    '測試時間': 'extime'
};
// 報檢資料允許輸出之欄位（英文欄位名，大寫比對）
// IDNO 會被特別處理：輸出欄位改為 IDNO_LAST4，僅保留末 4 碼
// 2026-04-23 更新：完整身分證字號不再寫入 CSV，降低個資敏感度
const ALLOWED_REG_FIELDS = new Set([
    'IDNO', 'NAME', 'AENO', 'PNO', 'EGR', 'DSTNG', 'OPEXDT', 'OPEXTIME'
]);

// 身分證欄位裁切設定：轉換輸出時把 IDNO 替換成 IDNO_LAST4
const IDNO_TRANSFORM = {
    source: 'IDNO',         // 原英文欄位名
    zhNew: '身分證末4碼',   // 新中文標題
    enNew: 'IDNO_LAST4',    // 新英文欄位名
    transform: v => {        // 裁切函式
        const s = String(v == null ? '' : v).trim();
        return s.length >= 4 ? s.slice(-4) : s;
    }
};

const xlsxDrop = document.getElementById('xlsxDrop');
const xlsxInput = document.getElementById('xlsxInput');
const xlsxFileList = document.getElementById('xlsxFileList');
const xlsxConvertBtn = document.getElementById('xlsxConvertBtn');
const xlsxClearBtn = document.getElementById('xlsxClearBtn');
const xlsxLog = document.getElementById('xlsxLog');
let xlsxFiles = [];

initDropZone(xlsxDrop, xlsxInput, files => {
    xlsxFiles = files.filter(f => /\.xlsx?$/i.test(f.name));
    renderFileList(xlsxFileList, xlsxFiles);
    xlsxConvertBtn.disabled = xlsxFiles.length === 0;
});

xlsxClearBtn.addEventListener('click', () => {
    xlsxFiles = [];
    xlsxFileList.textContent = '';
    xlsxInput.value = '';
    xlsxLog.classList.remove('show');
    xlsxLog.textContent = '';
    xlsxConvertBtn.disabled = true;
});

function rowsToCsv(rows) {
    const bom = '\uFEFF';
    const escape = v => {
        if (v === null || v === undefined) return '';
        const s = String(v);
        if (s.includes(',') || s.includes('"') || s.includes('\n')) {
            return '"' + s.replace(/"/g, '""') + '"';
        }
        return s;
    };
    return bom + rows.map(r => r.map(escape).join(',')).join('\n');
}

function convertWrittenXlsx(wb) {
    const ws = wb.Sheets[wb.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });
    if (rows.length < 4) throw new Error('資料不足');
    const zhHeaders = rows[2];
    const keepIdx = [], keepZh = [], keepEn = [];
    zhHeaders.forEach((h, i) => {
        const s = String(h || '').trim();
        if (ALLOWED_WRITTEN_FIELDS_ZH.has(s)) {
            keepIdx.push(i);
            keepZh.push(s);
            keepEn.push(WRITTEN_FIELD_MAP[s]);
        }
    });
    if (keepIdx.length === 0) throw new Error('找不到預期的欄位');
    const out = [keepZh, keepEn];
    let count = 0;
    for (let r = 3; r < rows.length; r++) {
        const row = rows[r];
        if (!row || !row[keepIdx[0]]) continue;
        out.push(keepIdx.map(i => (row[i] !== null && row[i] !== undefined) ? String(row[i]) : ''));
        count++;
    }
    return { csv: rowsToCsv(out), count, outName: '學科報檢資料.csv' };
}

function convertRegistrationXlsx(wb) {
    const sheetName = wb.SheetNames.includes('SKT1') ? 'SKT1' : wb.SheetNames[0];
    const ws = wb.Sheets[sheetName];
    const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });
    if (rows.length < 3) throw new Error('資料不足');
    const zhHeaders = rows[0];
    const enFields = rows[1];
    const keepIdx = [];
    let idnoIdx = -1; // 記錄 IDNO 欄位位置（要裁切為末 4 碼）
    enFields.forEach((f, i) => {
        if (f && ALLOWED_REG_FIELDS.has(String(f).trim().toUpperCase())) {
            keepIdx.push(i);
            if (String(f).trim().toUpperCase() === IDNO_TRANSFORM.source) {
                idnoIdx = i;
            }
        }
    });
    if (keepIdx.length === 0) throw new Error('找不到預期的欄位');

    // 輸出標題列：IDNO 欄位名改為 IDNO_LAST4
    const outZhHeaders = keepIdx.map(i =>
        i === idnoIdx ? IDNO_TRANSFORM.zhNew : zhHeaders[i]
    );
    const outEnFields = keepIdx.map(i =>
        i === idnoIdx ? IDNO_TRANSFORM.enNew : enFields[i]
    );
    const out = [outZhHeaders, outEnFields];

    let count = 0;
    for (let r = 2; r < rows.length; r++) {
        const row = rows[r];
        if (!row || !row[keepIdx[0]]) continue;
        out.push(keepIdx.map(i => {
            const v = row[i];
            if (i === idnoIdx) {
                // 身分證 → 只留末 4 碼
                return IDNO_TRANSFORM.transform(v);
            }
            return (v !== null && v !== undefined) ? String(v) : '';
        }));
        count++;
    }
    return { csv: rowsToCsv(out), count, outName: '報檢資料.csv' };
}

// 等 SheetJS 載入（最多 8 秒，每 200ms 檢查一次）
async function waitForXLSX(timeoutMs = 8000) {
    const deadline = Date.now() + timeoutMs;
    while (typeof XLSX === 'undefined' && Date.now() < deadline) {
        await new Promise(r => setTimeout(r, 200));
    }
    return typeof XLSX !== 'undefined';
}

xlsxConvertBtn.addEventListener('click', async () => {
    if (typeof XLSX === 'undefined') {
        log(xlsxLog, '⏳ 等待 SheetJS 載入…', 'ok');
        const ok = await waitForXLSX(8000);
        if (!ok) {
            log(xlsxLog, '⚠ SheetJS 載入失敗，請檢查網路或關閉擴充功能阻擋 CDN', 'err');
            return;
        }
        log(xlsxLog, '✓ SheetJS 已載入', 'ok');
    }
    xlsxConvertBtn.disabled = true;
    for (let i = 0; i < xlsxFiles.length; i++) {
        const file = xlsxFiles[i];
        updateStatus(xlsxFileList, i, 'processing', '轉檔中…');
        try {
            const buf = await file.arrayBuffer();
            const wb = XLSX.read(buf, { type: 'array' });
            let result;
            if (file.name.includes('學科報檢資料')) {
                result = convertWrittenXlsx(wb);
            } else {
                result = convertRegistrationXlsx(wb);
            }
            const blob = new Blob([result.csv], { type: 'text/csv;charset=utf-8' });
            downloadBlob(blob, result.outName);
            updateStatus(xlsxFileList, i, 'done', `✓ ${result.count} 筆`);
            log(xlsxLog, `✓ ${file.name} → ${result.outName}（${result.count} 筆，個資已過濾）`, 'ok');
        } catch (err) {
            updateStatus(xlsxFileList, i, 'error', '✗ 失敗');
            log(xlsxLog, `✗ ${file.name}: ${err.message || err}`, 'err');
        }
    }
    xlsxConvertBtn.disabled = false;
});
