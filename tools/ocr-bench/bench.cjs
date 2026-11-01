// 辨識率基準測試:4 張合成名片 × 6 種拍攝狀況(乾淨、桌面傾斜、陰影低對比、轉 90°、小又模糊、倒置傾斜),
// 走 App 本身的前處理與 Tesseract 流程,計算欄位正確率。用法見 README.md。
const { chromium } = require('playwright');
const fs = require('fs'), path = require('path');
const NM = path.join(__dirname, 'node_modules');
const PAGE = process.argv[2] || path.join(__dirname, '..', '..', 'dist', 'index.html');
const ONLY = process.argv[3];
const OUT = path.join(__dirname, 'out'); fs.mkdirSync(OUT, { recursive: true });
const CARDS = [
  { id: 'A', truth: { name: '林雅婷', company: '星河光電股份有限公司', title: '資深採購專員', mobile: '0912-345-678', tel: '03-578-1234 #215', email: 'yating.lin@galaxy-opto.com.tw', address: '新竹市東區園區二路 18 號' },
    draw: `bg('#f7f3ea'); rect(0,0,18,600,'#173c66');
      t('星河光電股份有限公司',70,90,40,700,'#173c66'); t('Galaxy Opto Corp.',70,140,28);
      t('林雅婷',70,250,56,700); t('採購部 資深採購專員',70,310,30);
      t('M: 0912-345-678',600,250,28); t('T: 03-578-1234 #215',600,300,28); t('yating.lin@galaxy-opto.com.tw',600,350,26);
      t('新竹市東區園區二路 18 號',70,520,30);` },
  { id: 'B', truth: { name: '陳建宏', company: '宏碩真空設備有限公司', title: '業務經理', mobile: '0928-111-222', tel: '06-505-0001', email: 'kh.chen@hongshuo-vac.com', address: '台南市新市區南科三路 9 號' },
    draw: `bg('#ffffff'); rect(0,480,1050,120,'#0e5a8a');
      t('宏碩真空設備有限公司',520,80,34,700,'#0e5a8a'); t('陳建宏',90,220,60,700); t('業務經理',300,220,30,400,'#555');
      t('手機 0928-111-222',90,320,28); t('電話 06-505-0001',90,365,28); t('E-mail kh.chen@hongshuo-vac.com',90,410,26);
      t('台南市新市區南科三路 9 號',90,550,28,400,'#ffffff');` },
  { id: 'C', truth: { name: 'Emily Carter', company: 'Northwind Materials Inc.', title: 'Director of Sales, APAC', mobile: '', tel: '+1 (415) 555-0134', email: 'emily.carter@northwind.com' },
    draw: `bg('#1d2633');
      t('NORTHWIND',70,110,52,700,'#e9b44c'); t('Northwind Materials Inc.',70,160,26,400,'#d8dde5');
      t('Emily Carter',70,300,50,700,'#ffffff'); t('Director of Sales, APAC',70,350,28,400,'#d8dde5');
      t('Tel +1 (415) 555-0134',600,300,26,400,'#ffffff'); t('emily.carter@northwind.com',600,345,24,400,'#ffffff');` },
  { id: 'D', truth: { name: '王志明', company: '晶達半導體股份有限公司', title: '副理', tel: '03-563-6688 #7721', fax: '03-563-6689', email: 'cmwang@jingda-semi.com.tw', address: '新竹科學園區力行六路 8 號' },
    draw: `bg('#fbfbf8');
      t('晶達半導體股份有限公司',70,80,36,700,'#7a1f1f'); t('JINGDA SEMICONDUCTOR CORP.',70,120,22,400,'#7a1f1f');
      t('王志明',70,230,52,700); t('製程整合處 副理',260,230,28);
      t('TEL: 03-563-6688 #7721',70,330,26); t('FAX: 03-563-6689',70,370,26); t('cmwang@jingda-semi.com.tw',70,410,26);
      t('新竹科學園區力行六路 8 號',70,540,28);` },
];
const VARIANTS = ['clean', 'table-skew', 'shadow-lowcontrast', 'rot90', 'small-blurry', 'rot180-skew'];
const norm = s => String(s || '').normalize('NFKC').replace(/[\s\-()#.,]/g, '').toLowerCase();
(async () => {
  const b = await chromium.launch(); const ctx = await b.newContext();
  await ctx.route('https://cdn.jsdelivr.net/**', async route => {
    const u = new URL(route.request().url()); let file;
    if (u.pathname.startsWith('/npm/@tesseract.js-data/')) { const [, pkg, rest] = u.pathname.match(/^\/npm\/(@tesseract\.js-data\/[^/]+)\/(.*)$/); file = path.join(NM, pkg, rest); }
    else { const m = u.pathname.match(/^\/npm\/(@?[^@]+)@v?([^/]+)\/(.*)$/); file = m && path.join(NM, m[1], m[3]); }
    if (!file || !fs.existsSync(file)) return route.fulfill({ status: 404, body: '' });
    route.fulfill({ status: 200, body: fs.readFileSync(file), headers: { 'content-type': file.endsWith('.js') ? 'application/javascript' : 'application/octet-stream' } });
  });
  const p = await ctx.newPage(); p.on('pageerror', e => console.log('pageerror', e.message));
  const srv = require('http').createServer((q, r) => { r.setHeader('content-type', 'text/html; charset=utf-8'); r.end(fs.readFileSync(PAGE)); }).listen(8795);
  await p.goto('http://127.0.0.1:8795/');
  let tot = 0, ok = 0; const perVar = {}; const t0 = Date.now(); const misses = [];
  for (const card of CARDS) for (const v of VARIANTS) {
    if (ONLY && !(card.id + v).includes(ONLY)) continue;
    const dataUrl = await p.evaluate(({ draw, v }) => {
      const W = 1050, H = 600, c = document.createElement('canvas'); c.width = W; c.height = H; const g = c.getContext('2d');
      const bg = col => { g.fillStyle = col; g.fillRect(0, 0, W, H); };
      const rect = (x, y, w, h, col) => { g.fillStyle = col; g.fillRect(x, y, w, h); };
      const t = (s, x, y, size, w, col) => { g.font = `${w || 400} ${size}px "WenQuanYi Zen Hei"`; g.fillStyle = col || '#222'; g.fillText(s, x, y); };
      eval(draw);
      if (v === 'clean') return c.toDataURL('image/jpeg', 0.92);
      // photo of the card: on a table, maybe rotated / skewed / shadowed / small
      const P = document.createElement('canvas'); const pg = P.getContext('2d');
      let scale = 1, ang = 0, rot = 0;
      if (v === 'table-skew') { P.width = 1600; P.height = 1200; ang = 5; }
      if (v === 'shadow-lowcontrast') { P.width = 1400; P.height = 900; ang = -2; }
      if (v === 'rot90') { P.width = 900; P.height = 1400; rot = 90; }
      if (v === 'small-blurry') { P.width = 800; P.height = 600; scale = 0.55; ang = 2; }
      if (v === 'rot180-skew') { P.width = 1500; P.height = 1100; rot = 180; ang = -4; }
      const grd = pg.createLinearGradient(0, 0, P.width, P.height); grd.addColorStop(0, '#6b5a4a'); grd.addColorStop(1, '#3e342c');
      pg.fillStyle = grd; pg.fillRect(0, 0, P.width, P.height);
      pg.save(); pg.translate(P.width / 2 + 20, P.height / 2 - 10); pg.rotate((rot + ang) * Math.PI / 180);
      if (v === 'small-blurry') pg.filter = 'blur(1.2px)';
      pg.shadowColor = 'rgba(0,0,0,.5)'; pg.shadowBlur = 25;
      pg.drawImage(c, -W * scale / 2, -H * scale / 2, W * scale, H * scale); pg.restore(); pg.filter = 'none';
      if (v === 'shadow-lowcontrast') {
        const s = pg.createLinearGradient(0, 0, P.width, 0); s.addColorStop(0, 'rgba(0,0,0,0)'); s.addColorStop(0.5, 'rgba(0,0,0,.05)'); s.addColorStop(1, 'rgba(0,0,0,.55)');
        pg.fillStyle = s; pg.fillRect(0, 0, P.width, P.height);
        pg.fillStyle = 'rgba(255,240,200,.25)'; pg.fillRect(0, 0, P.width, P.height);
      }
      return P.toDataURL('image/jpeg', v === 'small-blurry' ? 0.6 : 0.85);
    }, { draw: card.draw, v });
    fs.writeFileSync(path.join(OUT, `${card.id}-${v}.jpg`), Buffer.from(dataUrl.split(',')[1], 'base64'));
    const fields = await p.evaluate(async url => {
      const blob = await (await fetch(url)).blob();
      const prep = await CardOCR.prepare(blob);
      const r = await CardOCR.tesseract(prep, { langs: 'chi_tra' });
      return r.fields;
    }, dataUrl);
    let n = 0, k = 0;
    for (const [f, val] of Object.entries(card.truth)) { if (!val) continue; k++; if (norm(fields[f]) === norm(val)) n++; else misses.push(`${card.id}/${v}/${f}: got ${JSON.stringify(fields[f] || '')}`); }
    tot += k; ok += n; (perVar[v] = perVar[v] || [0, 0]); perVar[v][0] += n; perVar[v][1] += k;
    console.log(card.id, v.padEnd(20), `${n}/${k}`);
  }
  console.log('\nby variant:', Object.entries(perVar).map(([k, [a, c]]) => `${k} ${a}/${c}`).join(' · '));
  console.log(`TOTAL ${ok}/${tot} = ${(100 * ok / tot).toFixed(1)}%  (${((Date.now() - t0) / 1000).toFixed(0)}s)`);
  fs.writeFileSync(path.join(OUT, 'misses.txt'), misses.join('\n'));
  await b.close(); srv.close();
})();
