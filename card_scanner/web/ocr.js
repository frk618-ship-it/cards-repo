/* 影像前處理與 OCR 引擎:
 *  - 前處理(prepare):自動找出名片、裁掉背景、拉正傾斜;辨識前放大、去陰影、深底白字反相,並以試辨識判斷 0/90/180/270 度方向。
 *  - tesseract:Tesseract.js 在瀏覽器內辨識,免金鑰;第一次使用會下載語言檔(約 20 MB,之後快取)。
 *  - claude:Claude 視覺模型直接讀名片並回傳結構化欄位,準確度高,需自己的 Anthropic API 金鑰(只存在這台裝置)。 */
(function (root) {
  'use strict';
  const TESSERACT_URL = 'https://cdn.jsdelivr.net/npm/tesseract.js@7.0.0/dist/tesseract.min.js';
  const ANTHROPIC_SDK_URL = 'https://cdn.jsdelivr.net/npm/@anthropic-ai/sdk@0.135.0/+esm';
  const FALLBACK_MODELS = ['claude-opus-5-5', 'claude-sonnet-5-5', 'claude-fable-5-1'];

  /* ---------- 影像 ---------- */
  const IM = () => root.CardImaging;
  const MAX_WORK = 3200; // 處理用的最大邊長(記憶體與速度的折衷)

  async function loadBitmap(file) {
    if (root.createImageBitmap) {
      try { return await createImageBitmap(file, { imageOrientation: 'from-image' }); } catch (e) { /* 舊瀏覽器退回 <img> */ }
    }
    const url = URL.createObjectURL(file);
    try {
      const img = new Image();
      img.src = url;
      await img.decode();
      return img;
    } finally { URL.revokeObjectURL(url); }
  }

  function canvas(w, h) {
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(w)); c.height = Math.max(1, Math.round(h));
    return c;
  }
  function ctx(c) {
    const g = c.getContext('2d', { willReadFrequently: true });
    g.imageSmoothingEnabled = true; g.imageSmoothingQuality = 'high';
    return g;
  }

  /** 縮放到長邊 maxSide(不放大) */
  function fit(src, maxSide) {
    const k = Math.min(1, maxSide / Math.max(src.width, src.height));
    const c = canvas(src.width * k, src.height * k);
    ctx(c).drawImage(src, 0, 0, c.width, c.height);
    return c;
  }

  /** 旋轉任意角度(度),畫布擴大到能容納整張圖,空白處補 fill 色 */
  function rotateAny(src, deg, fill) {
    const t = deg * Math.PI / 180, s = Math.abs(Math.sin(t)), co = Math.abs(Math.cos(t));
    const c = canvas(src.width * co + src.height * s, src.width * s + src.height * co);
    const g = ctx(c);
    if (fill) { g.fillStyle = fill; g.fillRect(0, 0, c.width, c.height); }
    g.translate(c.width / 2, c.height / 2); g.rotate(t); g.drawImage(src, -src.width / 2, -src.height / 2);
    return c;
  }
  /** 0/90/180/270 度旋轉 + 縮放 */
  function orient(src, rot, scale = 1) {
    const sw = src.width * scale, sh = src.height * scale, swap = rot === 90 || rot === 270;
    const c = canvas(swap ? sh : sw, swap ? sw : sh);
    const g = ctx(c);
    g.translate(c.width / 2, c.height / 2); g.rotate(rot * Math.PI / 180); g.drawImage(src, -sw / 2, -sh / 2, sw, sh);
    return c;
  }
  function crop(src, x, y, w, h) {
    x = Math.max(0, Math.round(x)); y = Math.max(0, Math.round(y));
    w = Math.min(src.width - x, Math.round(w)); h = Math.min(src.height - y, Math.round(h));
    const c = canvas(w, h);
    ctx(c).drawImage(src, x, y, w, h, 0, 0, w, h);
    return c;
  }
  function analyze(src, side = 480) {
    const sm = fit(src, side);
    const d = ctx(sm).getImageData(0, 0, sm.width, sm.height).data;
    return { sm, k: src.width / sm.width, card: IM().detectCard(d, sm.width, sm.height) };
  }
  function grayOf(c) {
    const d = ctx(c).getImageData(0, 0, c.width, c.height).data;
    return IM().toGray(d, c.width * c.height);
  }
  function putGray(c, gray) {
    const g = ctx(c), im = g.createImageData(c.width, c.height), d = im.data;
    for (let i = 0, j = 0; j < gray.length; i += 4, j++) { d[i] = d[i + 1] = d[i + 2] = gray[j]; d[i + 3] = 255; }
    g.putImageData(im, 0, 0);
    return c;
  }
  const toBlob = (c, type, q) => new Promise(r => c.toBlob(r, type, q));

  /**
   * 讀入照片並找出名片:自動裁掉桌面背景、拉正傾斜。
   * 回傳 {canvas: 裁切後的彩色名片, image: 存檔用 JPEG, info}。
   * 方向(0/90/180/270)由 OCR 判斷後再更新 image。
   */
  async function prepare(file, { autoCrop = true } = {}) {
    const bmp = await loadBitmap(file);
    let work = fit(bmp, MAX_WORK);
    if (bmp.close) bmp.close();
    const info = { cropped: false, skew: 0 };
    if (autoCrop) {
      const a = analyze(work);
      if (a.card.found) {
        let fill = null;
        if (Math.abs(a.card.angle) >= 0.4) {
          const px = ctx(work).getImageData(0, 0, 1, 1).data; // 補邊用背景色,避免黑邊被當成名片
          fill = `rgb(${px[0]},${px[1]},${px[2]})`;
          work = rotateAny(work, -a.card.angle, fill);
          info.skew = -a.card.angle;
        }
        const b = a.card.found && Math.abs(a.card.angle) < 0.4 ? a : analyze(work);
        if (b.card.found) {
          const { x, y, w, h } = b.card.box, k = b.k, inset = Math.min(w, h) * 0.012;
          work = crop(work, (x + inset) * k, (y + inset) * k, (w - 2 * inset) * k, (h - 2 * inset) * k);
          info.cropped = true;
        }
      }
    }
    // 文字列投影微調剩下的傾斜(沒找到名片外框時可修正較大角度)
    const probe = fit(work, 900);
    const pg = IM().normalizeLighting(grayOf(probe), probe.width, probe.height);
    const skew = IM().textSkew(pg, probe.width, probe.height, info.cropped ? 3 : 10);
    if (Math.abs(skew) >= 0.4) {
      const rotated = rotateAny(work, skew, '#ffffff');
      // 旋轉後四角會多出白邊:裁回原本的內容範圍
      const t = Math.abs(skew) * Math.PI / 180, dx = work.height * Math.sin(t), dy = work.width * Math.sin(t);
      work = crop(rotated, dx * 0.5, dy * 0.5, rotated.width - dx, rotated.height - dy);
      info.skew += skew;
    }
    const image = await toBlob(fit(work, 1600), 'image/jpeg', 0.88);
    return { canvas: work, image, rotate: 0, info };
  }

  /** OCR 用影像:放大到文字夠大、去陰影、深底白字反相 */
  function ocrCanvas(src, rot, targetW) {
    const w = rot === 90 || rot === 270 ? src.height : src.width;
    const scale = targetW ? Math.min(3, targetW / w) : IM().upscaleFactor(w);
    const c = orient(src, rot, scale);
    return putGray(c, IM().normalizeLighting(grayOf(c), c.width, c.height));
  }

  /* ---------- Tesseract ---------- */
  let tessWorker = null, tessLangs = '';
  function loadScript(src) {
    return new Promise((resolve, reject) => {
      if ([...document.scripts].some(s => s.src === src)) return resolve();
      const s = document.createElement('script');
      s.src = src; s.async = true; s.crossOrigin = 'anonymous';
      s.onload = resolve;
      s.onerror = () => reject(new Error('無法載入 OCR 引擎(需要網路連線下載一次)'));
      document.head.appendChild(s);
    });
  }

  async function getWorker(langs, onProgress) {
    await loadScript(TESSERACT_URL);
    if (!tessWorker || tessLangs !== langs) {
      if (tessWorker) await tessWorker.terminate();
      tessWorker = await root.Tesseract.createWorker(langs.split('+'), 1, {
        logger: m => onProgress.fn && onProgress.fn(m.status, m.progress),
      });
      tessLangs = langs;
    }
    return tessWorker;
  }
  const progressHolder = { fn: null };

  // 可信度 × 有效字數:倒置或側躺的文字會辨識成少量、低可信度的亂碼
  function orientationScore(data) {
    const chars = (String(data.text || '').match(/[㐀-鿿A-Za-z0-9@]/g) || []).length;
    return (data.confidence || 0) * Math.min(1, chars / 30);
  }

  async function tesseract(prep, { langs = 'chi_tra', onProgress } = {}) {
    progressHolder.fn = onProgress;
    const worker = await getWorker(langs, progressHolder);
    // PSM 11(稀疏文字):名片常是左右分欄、大小字混排,逐塊找字比預設的單一區塊(PSM 6)準
    await worker.setParameters({ preserve_interword_spaces: '1', tessedit_pageseg_mode: '11', user_defined_dpi: '300' });
    const src = prep.canvas;
    // 1) 判斷方向:在縮小的影像上試各方向,分數夠高就提前結束
    const portrait = src.height > src.width * 1.15;
    const order = portrait ? [90, 270, 0, 180] : [0, 180, 90, 270];
    let best = { rot: 0, score: -1, data: null };
    for (const rot of order) {
      onProgress && onProgress('判斷名片方向', null);
      const { data } = await worker.recognize(ocrCanvas(src, rot, 1000));
      const score = orientationScore(data);
      if (score > best.score) best = { rot, score, data };
      if (score >= 72) break;
    }
    // 2) 正式辨識(較大的尺寸);和方向判斷時的小尺寸結果互補:
    //    可信度高的為主,另一份補上主結果缺少的欄位
    onProgress && onProgress('辨識文字', null);
    const runs = [best.data, (await worker.recognize(ocrCanvas(src, best.rot))).data];
    // 3) 兩份都偏低時,再用自動版面分析(PSM 3)跑一次
    if (Math.max(runs[0].confidence, runs[1].confidence) < 70) {
      await worker.setParameters({ tessedit_pageseg_mode: '3' });
      runs.push((await worker.recognize(ocrCanvas(src, best.rot))).data);
    }
    runs.sort((a, b) => b.confidence - a.confidence);
    const parsed = root.CardParser.parseCardText(runs[0].text || '');
    for (const r of runs.slice(1)) {
      for (const [k, v] of Object.entries(root.CardParser.parseCardText(r.text || '').fields)) if (!parsed.fields[k]) parsed.fields[k] = v;
    }
    const text = runs[0].text || '', confidence = runs[0].confidence;
    if (best.rot) {
      prep.rotate = best.rot;
      prep.canvas = orient(src, best.rot);
      prep.image = await toBlob(fit(prep.canvas, 1600), 'image/jpeg', 0.88);
    }
    return { text, fields: parsed.fields, unmatched: parsed.unmatched, confidence, rotate: best.rot };
  }

  /* ---------- Claude ---------- */
  const CLAUDE_FIELDS = ['name', 'nameEn', 'company', 'companyEn', 'department', 'title', 'mobile', 'tel', 'fax',
    'email', 'website', 'address', 'taxId', 'lineId', 'other', 'rawText'];
  const SCHEMA = {
    type: 'object',
    properties: Object.fromEntries(CLAUDE_FIELDS.map(k => [k, { type: 'string' }])),
    required: CLAUDE_FIELDS,
    additionalProperties: false,
  };
  const PROMPT = `這是一張名片的照片(可能是中文、英文或日文,也可能正反面都在同一張圖)。請讀出名片上的所有資訊,填入 JSON 欄位:
- name:姓名(中文名優先;只有外文名就填外文名)。nameEn:英文/外文姓名(和 name 不同時才填)。
- company:公司全名(中文優先)。companyEn:公司英文名。department:部門。title:職稱(多個用「 / 」分隔)。
- mobile:手機;tel:市話/公司電話(含分機寫成「 #123」);fax:傳真。多個號碼用「 / 」分隔,保留原本的區碼與 + 國碼格式。
- email、website、address(完整地址,中文地址優先)、taxId(統一編號)、lineId。
- other:名片上其他有用但不屬於上述欄位的資訊(例如服務項目、其他社群帳號),沒有就空字串。
- rawText:名片上所有文字,依原本排列逐行抄寫。
看不清楚或名片上沒有的欄位填空字串,不要猜測或補造。`;

  async function claude(prep, { apiKey, model = 'claude-opus-5-5', onProgress } = {}) {
    if (!apiKey) throw new Error('請先在「設定」輸入 Anthropic API 金鑰');
    onProgress && onProgress('載入 Claude SDK', 0.1);
    let mod;
    try { mod = await import(ANTHROPIC_SDK_URL); } catch (e) { throw new Error('無法載入 Claude SDK(需要網路連線)'); }
    const Anthropic = mod.default || mod.Anthropic;
    const client = new Anthropic({ apiKey, dangerouslyAllowBrowser: true, maxRetries: 2 });
    const data = await blobToBase64(prep.image);
    onProgress && onProgress('Claude 辨識中', 0.4);
    const params = {
      model,
      max_tokens: 8000,
      output_config: { effort: 'low', format: { type: 'json_schema', schema: SCHEMA } },
      messages: [{
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data } },
          { type: 'text', text: PROMPT },
        ],
      }],
    };
    if (FALLBACK_MODELS.includes(model)) { // 模型婉拒時由伺服器改用備援模型重跑
      params.betas = ['server-side-fallback-2026-07-01'];
      params.fallbacks = 'default';
    }
    let msg;
    try {
      msg = await client.beta.messages.create(params);
    } catch (e) {
      if (e instanceof Anthropic.AuthenticationError) throw new Error('API 金鑰無效,請到「設定」確認');
      if (e instanceof Anthropic.PermissionDeniedError) throw new Error('這把金鑰沒有使用此模型的權限');
      if (e instanceof Anthropic.RateLimitError) throw new Error('呼叫太頻繁或額度不足,請稍後再試');
      if (e instanceof Anthropic.BadRequestError) throw new Error('請求被拒:' + (e.message || '格式錯誤'));
      if (e instanceof Anthropic.APIConnectionError) throw new Error('連不上 Claude API,請檢查網路');
      throw e;
    }
    if (msg.stop_reason === 'refusal') throw new Error('Claude 無法處理這張圖片,請改用本機 OCR');
    if (msg.stop_reason === 'max_tokens') throw new Error('回應被截斷,請再試一次');
    const block = msg.content.find(b => b.type === 'text');
    if (!block) throw new Error('Claude 沒有回傳內容');
    const out = JSON.parse(block.text);
    const fields = {};
    for (const k of CLAUDE_FIELDS) if (k !== 'rawText' && k !== 'other' && out[k]) fields[k] = String(out[k]).trim();
    onProgress && onProgress('完成', 1);
    return { text: out.rawText || '', fields, unmatched: out.other ? [out.other] : [], model: msg.model };
  }

  function blobToBase64(blob) {
    return new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(String(r.result).split(',')[1]);
      r.onerror = () => reject(r.error);
      r.readAsDataURL(blob);
    });
  }

  root.CardOCR = { prepare, tesseract, claude, blobToBase64, CLAUDE_FIELDS, ocrCanvas };
})(typeof self !== 'undefined' ? self : this);
