/* 名片文字解析:把 OCR 出來的純文字拆成姓名、公司、職稱、電話、Email、地址等欄位。
 * 純函式、不碰 DOM,瀏覽器與 Node(測試)共用。 */
(function (root) {
  'use strict';

  const FIELDS = ['name', 'nameEn', 'company', 'department', 'title', 'mobile', 'tel', 'fax',
    'email', 'website', 'address', 'taxId', 'lineId'];

  // 全形英數與符號轉半形,統一各種破折號、冒號
  function toHalfWidth(s) {
    return String(s || '')
      .replace(/[！-～]/g, c => String.fromCharCode(c.charCodeAt(0) - 0xFEE0))
      .replace(/　/g, ' ')
      .replace(/[‐‑‒–—―﹣－]/g, '-')
      .replace(/[：﹕]/g, ':');
  }

  const CJK = '\\u3400-\\u9fff\\uf900-\\ufaff';
  const reCJK = new RegExp('[' + CJK + ']');
  const reCJKOnly = new RegExp('^[' + CJK + '·・]+$');

  const COMPANY_RE = /(股份有限公司|有限公司|公司|企業社|集團|事務所|工作室|研究院|研究所|基金會|協會|銀行|醫院|大學|工業|實業|科技|貿易|商行|株式会社|株式會社|\b(inc|corp|corporation|co|company|ltd|limited|llc|gmbh|plc|pte|s\.a|ag|group|technologies|technology|industries)\b\.?)/i;
  const TITLE_WORDS = ['董事長', '副董事長', '總裁', '執行長', '總經理', '副總經理', '副總', '協理', '經理', '副理', '襄理', '處長', '副處長',
    '廠長', '課長', '科長', '組長', '主任', '主管', '專員', '工程師', '研究員', '技術員', '業務代表', '業務', '總監', '特助', '秘書', '顧問',
    '會計師', '律師', '醫師', '教授', '助理', '店長', '負責人', '創辦人', '合夥人', '部長', '董事', '監事', '代表', '設計師', '採購'];
  const TITLE_RE = new RegExp('(' + TITLE_WORDS.join('|') + ')|\\b(ceo|cto|cfo|coo|cio|vp|svp|evp|president|vice president|director|manager|engineer|' +
    'sales|specialist|consultant|assistant|founder|co-founder|partner|owner|officer|representative|executive|supervisor|lead|head of|analyst|designer|buyer)\\b', 'i');
  const DEPT_RE = /([^\s]{1,12}(部|處|課|室|組|中心|事業群|事業部|實驗室))|\b(dept\.?|department|division|r&d|sales dept)\b/i;
  const ADDR_RE = /(縣|市|區|鄉|鎮|路|街|大道|巷|弄|段|號|樓|省)/;
  const ADDR_EN_RE = /\b(rd|road|st|street|ave|avenue|blvd|boulevard|lane|ln|alley|sec\.?|section|no\.|floor|fl\.?|suite|ste|bldg|building|dist\.?|district|city|county|taiwan|r\.o\.c|china|japan|usa)\b/i;
  const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/;
  const URL_RE = /((https?:\/\/)?(www\.)?[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)*\.(com|net|org|tw|cn|jp|kr|io|co|biz|info|edu|gov|hk|sg|de|uk|us)(\.[a-z]{2})?(\/[^\s]*)?)/i;
  const PHONE_RE = /(\+?\(?\d[\d\s\-().\/]{5,}\d)(\s*(#|ext\.?|轉|分機|x)\s*\d{1,6})?/i;

  // 長標籤冒號可省略;單一字母標籤(T、F、M、A…)必須接冒號,避免把「ACME」的 A 當成地址標籤
  const label = (long, short) => new RegExp('^(?:(?:' + long + ')\\s*[:.]?' + (short ? '|(?:' + short + ')\\s*[:.]' : '') + ')\\s*', 'i');
  const LABELS = {
    mobile: label('手機|行動電話|行動|mobile|mob|cell|cellphone', 'm'),
    fax: label('傳真|fax', 'f'),
    tel: label('電話|市話|公司電話|總機|專線|tel|telephone|phone|office', 't|o|p'),
    email: label('e-?mail|電子郵件|信箱|郵件', 'e'),
    website: label('網址|網站|website|web|url', 'w'),
    address: label('地址|公司地址|住址|address|addr|add', 'a'),
    taxId: label('統一編號|統編|tax\\s*id|vat'),
    lineId: label('line\\s*id|line'),
  };

  function cleanPhone(s) {
    return s.replace(/[^\d+#()\- ]/g, '').replace(/\s+/g, ' ').replace(/\s*-\s*/g, '-').trim();
  }
  function phoneDigits(s) { return String(s || '').replace(/\D/g, ''); }
  function isMobile(p) {
    const d = phoneDigits(p);
    const intl = /^\s*(\+|00)/.test(p);
    return (!intl && (/^09\d{8}$/.test(d) || /^1[3-9]\d{9}$/.test(d))) || /^(00)?8869\d{8}$/.test(d) || /^(00)?861[3-9]\d{9}$/.test(d);
  }
  function addTo(fields, key, value) {
    value = String(value || '').trim();
    if (!value) return;
    const parts = fields[key] ? fields[key].split(' / ') : [];
    if (!parts.includes(value)) parts.push(value);
    fields[key] = parts.join(' / ');
  }

  // 一行裡可能同時有「T: 02-1234 F: 02-5678」:依標籤切段
  function splitLabeled(line) {
    const re = /(手機|行動電話|電話|傳真|分機|統一編號|統編|E-?mail|Mobile|Mob|Cell|Tel|Phone|Fax|Office|\bT\b|\bF\b|\bM\b|\bO\b)\s*[:.]/gi;
    const idx = [];
    let m;
    while ((m = re.exec(line))) idx.push(m.index);
    if (idx.length < 2) return [line];
    if (idx[0] > 0) idx.unshift(0);
    return idx.map((s, i) => line.slice(s, idx[i + 1]).trim()).filter(Boolean);
  }

  function looksLikeName(line) {
    const compact = line.replace(/\s+/g, '');
    if (reCJKOnly.test(compact) && compact.length >= 2 && compact.length <= 4) return !COMPANY_RE.test(compact) && !TITLE_RE.test(compact) && !ADDR_RE.test(compact) && !DEPT_RE.test(compact);
    return false;
  }
  function looksLikeEnglishName(line) {
    const t = line.trim();
    if (!/^[A-Za-z][A-Za-z.'\- ,]{2,40}$/.test(t)) return false;
    if (COMPANY_RE.test(t) || TITLE_RE.test(t) || ADDR_EN_RE.test(t)) return false;
    const words = t.replace(/,/g, ' ').split(/\s+/).filter(Boolean);
    return words.length >= 2 && words.length <= 4 && words.every(w => /^[A-Z]/.test(w) || /^[a-z]{1,3}$/.test(w));
  }

  /* ---------- OCR 常見誤認的修正 ---------- */
  // 行尾 1–2 個英文字母的雜訊(大字姓名旁常被多辨識出「Mg」「jg」)
  function cleanNoise(l) {
    return l.replace(new RegExp('([' + CJK + '])\\s+[A-Za-z]{1,2}$'), '$1').replace(/^[A-Za-z]{1,2}\s+(?=[\u3400-\u9fff])/, '').trim();
  }
  // 號碼中的英文字母誤認:O→0、I/l/|→1、S→5、B→8(前後是數字時)
  function fixDigits(s) {
    if ((s.match(/\d/g) || []).length < 5) return s;
    return s.replace(/(?<=[\d\s\-().])[Oo](?=[\d\s\-().])|(?<=[\d\-])[Oo]|[Oo](?=\d)/g, '0')
      .replace(/(?<=\d)[Il|!](?=\d)|(?<=[\d\-])[Il|](?=[\d\-])/g, '1')
      .replace(/(?<=\d)S(?=\d)/g, '5').replace(/(?<=\d)B(?=\d)/g, '8');
  }
  function fixEmail(s) {
    return s.replace(/[©®]|\(at\)|\[at\]/gi, '@').replace(/\s*@\s*/g, '@').replace(/\s*\.\s*(?=[a-z]{2,}\b)/gi, '.')
      .replace(/\.(conm|corn|c0m|cotn|comn|cam|con)(?=\.|\b|$)/gi, '.com').replace(/\.c0(?=\.)/gi, '.co');
  }
  // 「@」常被誤認成「e@」:若去掉 e 後正好是英文姓名的結尾,就去掉
  function fixEmailName(email, nameEn) {
    const m = email.match(/^(.+)e@(.+)$/);
    if (!m || !nameEn) return email;
    const last = nameEn.toLowerCase().split(/\s+/).filter(Boolean).pop() || '';
    return last && m[1].endsWith(last) ? m[1] + '@' + m[2] : email;
  }
  function fixCompany(s) {
    return s.replace(/股份有.公司/, '股份有限公司').replace(/股.有限公司/, '股份有限公司').replace(/(?<!股份)有[^限]公司$/, '有限公司');
  }
  const TITLE_TAIL = ['專員', '經理', '副理', '協理', '襄理', '處長', '課長', '組長', '主任', '總監', '董事', '顧問', '秘書', '助理', '廠長', '部長', '科長', '技師', '店長'];
  function fixTitle(s) {
    const t = s.replace(/\s+$/, '');
    const tail = t.slice(-2);
    if (!/^[\u3400-\u9fff]{2}$/.test(tail) || TITLE_TAIL.includes(tail) || TITLE_RE.test(tail)) return s;
    const cand = TITLE_TAIL.filter(w => w[1] === tail[1] || w[0] === tail[0]);
    return cand.length === 1 ? t.slice(0, -2) + cand[0] : s;
  }

  /** 解析名片文字。回傳 {fields, unmatched}:fields 是各欄位字串,unmatched 是沒歸類的行。 */
  function parseCardText(text) {
    const fields = {};
    const unmatched = [];
    // OCR 常在中文字之間插入空白(「股 份 有 限 公 司」):整行多半是單字時才去掉中文字之間的空白,
    // 「王大明 業務經理」這種刻意分隔的不動
    const spacedOut = l => {
      const toks = l.split(' ').filter(t => reCJK.test(t));
      return toks.length >= 2 && toks.filter(t => t.length === 1).length / toks.length >= 0.7;
    };
    const joinCJK = new RegExp('([' + CJK + '])\\s+(?=[' + CJK + '])', 'g');
    // 左右分欄的名片:OCR 保留的大段空白(3 格以上)視為欄位分隔,拆成獨立的行
    const lines = toHalfWidth(text).split(/\r?\n|[ \t]{3,}/)
      .map(l => l.replace(/[|¦]/g, ' ').replace(/\s+/g, ' ').trim())
      .map(l => (spacedOut(l) ? l.replace(joinCJK, '$1') : l))
      .map(cleanNoise)
      .filter(l => (l.length > 1 || /^(號|樓|室)$/.test(l)) && !/^[^\w\u3400-\u9fff]+$/.test(l));
    const pending = []; // 先處理有明確格式的,剩下的再判斷姓名/公司/職稱

    for (const raw of lines) {
      for (let seg of splitLabeled(raw)) {
        let handled = false;
        // Email(OCR 常在 @ 兩側多出空白)
        const emailSeg = fixEmail(seg);
        const em = emailSeg.match(EMAIL_RE);
        if (em) { addTo(fields, 'email', em[0].toLowerCase()); seg = emailSeg.replace(em[0], '').replace(LABELS.email, '').trim(); handled = !seg || seg.length < 3; if (handled) continue; }

        if (LABELS.taxId.test(seg)) { const d = seg.match(/\d{8}/); if (d) { fields.taxId = d[0]; continue; } }
        if (LABELS.lineId.test(seg)) { addTo(fields, 'lineId', seg.replace(LABELS.lineId, '')); continue; }

        let label = null;
        for (const k of ['mobile', 'fax', 'tel']) if (LABELS[k].test(seg)) { label = k; break; }
        const body = fixDigits(label ? seg.replace(LABELS[label], '') : seg);
        const ph = body.match(PHONE_RE);
        const digits = ph ? phoneDigits(ph[1]) : '';
        if (ph && digits.length >= 7 && digits.length <= 15 && (label || ph[0].length >= body.replace(/\s/g, '').length * 0.6)) {
          const num = cleanPhone(ph[1]) + (ph[2] ? ' #' + phoneDigits(ph[2]) : '');
          addTo(fields, label || (isMobile(num) ? 'mobile' : 'tel'), num);
          continue;
        }

        if (LABELS.website.test(seg) || (!reCJK.test(seg) && URL_RE.test(seg) && !/\s/.test(seg.replace(LABELS.website, '').trim()))) {
          const u = seg.replace(LABELS.website, '').match(URL_RE);
          if (u) { addTo(fields, 'website', u[0].replace(/[),;]+$/, '')); continue; }
        }

        if (LABELS.address.test(seg)) { addTo(fields, 'address', seg.replace(LABELS.address, '')); continue; }
        const hasDigit = /\d/.test(seg);
        if (hasDigit && reCJK.test(seg) && (seg.match(new RegExp(ADDR_RE.source, 'g')) || []).length >= 2 && !COMPANY_RE.test(seg.replace(/\d.*$/, ''))) { addTo(fields, 'address', seg); continue; }
        const enHits = hasDigit && !reCJK.test(seg) ? (seg.match(new RegExp(ADDR_EN_RE.source, 'gi')) || []).length : 0;
        if (enHits >= 2 || (enHits === 1 && /^\s*(no\.?\s*)?\d/i.test(seg))) { addTo(fields, 'address', seg); continue; }
        pending.push(seg);
      }
    }

    for (const seg of pending) {
      const compact = seg.replace(/\s+/g, '');
      // 地址被拆成兩行(「…三路 9」+「號」或「…路」+「18 號 3 樓」)
      if (/^[\d\s\-之]*(號|樓|室|F)/.test(compact) && compact.length <= 10 && /[\u3400-\u9fff]/.test(compact)) {
        const last = fields.address ? fields.address.split(' / ').pop() : '';
        if (last && !/(號|樓|室)$/.test(last.replace(/\s+/g, ''))) { fields.address = fields.address + (/\d$/.test(last) ? ' ' : '') + seg; continue; }
      }
      if (!fields.address && /^[\u3400-\u9fff]{2,4}(市|縣)/.test(compact) && (compact.match(new RegExp(ADDR_RE.source, 'g')) || []).length >= 3 && !COMPANY_RE.test(compact)) {
        fields.address = seg; continue;
      }
      if (COMPANY_RE.test(seg) && !(TITLE_RE.test(seg) && seg.length <= 8)) {
        // 公司名常帶英文名,中文優先
        if (!fields.company || (!reCJK.test(fields.company) && reCJK.test(seg))) fields.company = fields.company && !reCJK.test(seg) ? fields.company : seg;
        else if (!fields.companyEn && !reCJK.test(seg)) fields.companyEn = seg;
        else unmatched.push(seg);
        continue;
      }
      // 「王大明 業務經理」:姓名與職稱同一行
      const nt = seg.match(new RegExp('^([' + CJK + ']{2,4})\\s+(.+)$'));
      if (nt && !fields.name && looksLikeName(nt[1]) && TITLE_RE.test(nt[2])) { fields.name = nt[1]; fields.title = nt[2]; continue; }
      if (!fields.name && looksLikeName(seg)) { fields.name = compact; continue; }
      if (/^[^\s]{1,12}(部|處|課|室|組|中心|事業群|事業部|實驗室)$/.test(compact) && !fields.department) { fields.department = compact; continue; }
      if (TITLE_RE.test(seg) && seg.length <= 40) {
        const dm = seg.match(DEPT_RE);
        if (dm && !fields.department && dm[0].length < seg.length) {
          fields.department = dm[0].trim();
          const rest = seg.replace(dm[0], '').trim();
          if (rest) addTo(fields, 'title', rest);
        } else addTo(fields, 'title', seg);
        continue;
      }
      if (DEPT_RE.test(seg) && seg.length <= 24 && !fields.department) { fields.department = seg; continue; }
      if (!fields.nameEn && looksLikeEnglishName(seg)) { fields.nameEn = seg; continue; }
      unmatched.push(seg);
    }

    if (fields.company) fields.company = fixCompany(fields.company);
    if (fields.title) fields.title = fixTitle(fields.title);
    if (fields.email) fields.email = fields.email.split(' / ').map(e => fixEmailName(e, fields.nameEn || (/^[a-z ]+$/i.test(fields.name || '') ? fields.name : ''))).join(' / ');
    // 沒抓到中文姓名時,用英文名
    if (!fields.name && fields.nameEn) { fields.name = fields.nameEn; delete fields.nameEn; }
    if (!fields.company && fields.companyEn) { fields.company = fields.companyEn; delete fields.companyEn; }
    // 沒公司名但有 Email 網域:用網域當線索
    if (!fields.company && fields.email && !/(gmail|yahoo|hotmail|outlook|icloud|msn|qq|163|126|hinet)\./i.test(fields.email)) {
      fields.companyHint = fields.email.split('@')[1].split('.')[0];
    }
    return { fields, unmatched };
  }

  const api = { parseCardText, toHalfWidth, phoneDigits, isMobile, FIELDS };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.CardParser = api;
})(typeof self !== 'undefined' ? self : this);
