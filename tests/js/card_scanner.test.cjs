// Node unit tests for the card scanner's parser and search index (run by tests/test_card_scanner.py).
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const web = path.join(__dirname, '..', '..', 'card_scanner', 'web');
const P = require(path.join(web, 'parser.js'));
const S = require(path.join(web, 'search.js'));

const TW = `鑫科材料科技股份有限公司
Thintech Materials Technology Co., Ltd.
王大明 業務經理
David Wang
業務部
T: 06-5052-690 #123  F: 06-5052-691
M: 0912-345-678
E-mail: david.wang @ thintech.com.tw
台南市新市區南科三路 15 號 3 樓
www.thintech.com.tw
統一編號: 12345678`;

test('parses a Taiwanese bilingual card', () => {
  const f = P.parseCardText(TW).fields;
  assert.equal(f.name, '王大明');
  assert.equal(f.nameEn, 'David Wang');
  assert.equal(f.title, '業務經理');
  assert.equal(f.department, '業務部');
  assert.equal(f.company, '鑫科材料科技股份有限公司');
  assert.equal(f.companyEn, 'Thintech Materials Technology Co., Ltd.');
  assert.equal(f.tel, '06-5052-690 #123');
  assert.equal(f.fax, '06-5052-691');
  assert.equal(f.mobile, '0912-345-678');
  assert.equal(f.email, 'david.wang@thintech.com.tw');
  assert.equal(f.address, '台南市新市區南科三路 15 號 3 樓');
  assert.equal(f.website, 'www.thintech.com.tw');
  assert.equal(f.taxId, '12345678');
});

test('parses an English card without mistaking single letters for labels', () => {
  const f = P.parseCardText('ACME Corp.\nJane Doe\nSenior Sales Manager\n+1 (415) 555-0100\njane.doe@acme.com\n1 Market Street, Suite 300, San Francisco, CA').fields;
  assert.equal(f.company, 'ACME Corp.');
  assert.equal(f.name, 'Jane Doe');
  assert.equal(f.title, 'Senior Sales Manager');
  assert.equal(f.tel, '+1 (415) 555-0100'); // international number is not a mobile
  assert.equal(f.address, '1 Market Street, Suite 300, San Francisco, CA');
});

test('joins OCR spaces between CJK characters and full-width digits', () => {
  const f = P.parseCardText('台 灣 積 體 電 路 製 造 股 份 有 限 公 司\n林 志 明\n資 深 經 理\n手機：０９２８－１１１２２２').fields;
  assert.equal(f.company, '台灣積體電路製造股份有限公司');
  assert.equal(f.name, '林志明');
  assert.equal(f.title, '資深經理');
  assert.equal(f.mobile, '0928-111222');
});

const cards = [
  { id: 'a', ...P.parseCardText(TW).fields, tags: ['客戶'], notes: '展覽認識' },
  { id: 'b', name: 'Jane Doe', company: 'ACME Corp.', title: 'Sales Manager', tel: '+1 (415) 555-0100', email: 'jane.doe@acme.com', tags: ['海外'] },
  { id: 'c', name: '陳小華', company: '台灣積體電路製造股份有限公司', title: '資深工程師', mobile: '0928-111222', tags: ['客戶', '半導體'] },
];
const ids = (ix, q) => ix.search(q).map(r => r.card.id);

test('search: CJK substrings, prefixes, phone suffixes, fields, tags, negation', () => {
  const ix = new S.CardIndex(cards);
  assert.deepEqual(ids(ix, '大明'), ['a']);
  assert.deepEqual(ids(ix, '積體'), ['c']);
  assert.deepEqual(ids(ix, 'thin'), ['a']);
  assert.deepEqual(ids(ix, '5678'), ['a']);           // mobile 0912-345-678
  assert.deepEqual(ids(ix, '0100'), ['b']);
  assert.deepEqual(ids(ix, '#客戶').sort(), ['a', 'c']);
  assert.deepEqual(ids(ix, '公司:acme'), ['b']);
  assert.deepEqual(ids(ix, 'company:台灣'), ['c']);
  assert.deepEqual(ids(ix, '#客戶 -半導體'), ['a']);
  assert.deepEqual(ids(ix, '"sales manager"'), ['b']);
  assert.deepEqual(ids(ix, '展覽'), ['a']);            // notes are searchable
  assert.deepEqual(ids(ix, '12345678'), ['a']);        // tax id (digits outside phone fields)
  assert.deepEqual(ids(ix, '不存在'), []);
  assert.equal(ix.search('').length, 3);
});

test('search: name hits rank above incidental hits, index stays in sync', () => {
  const ix = new S.CardIndex([
    { id: 'x', name: '王小明', company: '甲公司' },
    { id: 'y', name: '李四', company: '王氏企業' },
  ]);
  assert.deepEqual(ids(ix, '王'), ['x', 'y']);
  ix.remove('x');
  assert.deepEqual(ids(ix, '王'), ['y']);
  ix.add({ id: 'y', name: '李四', company: '乙公司' }); // update replaces old tokens
  assert.deepEqual(ids(ix, '王'), []);
  assert.equal(ix.size, 1);
});

test('grouping sorts Latin initials first, then CJK by stroke order', () => {
  const g = S.groupCards([{ name: '陳' }, { name: 'bob' }, { name: '王' }, { name: '' , company: '' }, { name: 'Amy' }], 'name');
  assert.deepEqual(g.map(x => x.key), ['A', 'B', '王', '陳', '#']);
});

test('highlight escapes HTML and marks phone digits across separators', () => {
  assert.equal(S.highlight('0912-345-678', '345678'), '0912-<mark>345-678</mark>');
  assert.equal(S.highlight('<b>鑫科</b>', '鑫科'), '&lt;b&gt;<mark>鑫科</mark>&lt;/b&gt;');
});

test('splits two-column OCR lines on wide gaps', () => {
  const f = P.parseCardText('星河光電股份有限公司\n林雅婷                               M: 0912-345-678\n採購部 資深採購專員                         T: 03-578-1234 #215').fields;
  assert.equal(f.name, '林雅婷');
  assert.equal(f.mobile, '0912-345-678');
  assert.equal(f.department, '採購部');
  assert.equal(f.title, '資深採購專員');
  assert.equal(f.tel, '03-578-1234 #215');
});

/* ---------- image analysis (imaging.js) ---------- */
const IM = require(path.join(web, 'imaging.js'));

// RGBA test image: a light card (rotated by `deg`) on a dark, slightly graded table
function cardOnTable(W, H, cw, ch, deg) {
  const rgba = new Uint8ClampedArray(W * H * 4), t = deg * Math.PI / 180, c = Math.cos(t), s = Math.sin(t);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const dx = x - W / 2, dy = y - H / 2, u = dx * c + dy * s, v = -dx * s + dy * c, i = (y * W + x) * 4;
    const inside = Math.abs(u) < cw / 2 && Math.abs(v) < ch / 2;
    const tone = inside ? 245 : 70 + (x / W) * 25;
    rgba[i] = tone; rgba[i + 1] = inside ? 242 : tone - 10; rgba[i + 2] = inside ? 235 : tone - 20; rgba[i + 3] = 255;
  }
  return rgba;
}

test('detectCard finds a tilted card on a table and its angle', () => {
  const r = IM.detectCard(cardOnTable(400, 300, 220, 133, 6), 400, 300);
  assert.equal(r.found, true);
  assert.ok(Math.abs(r.angle - 6) < 1.5, `angle ${r.angle}`);
  assert.ok(r.box.w > 200 && r.box.w < 260, `box ${JSON.stringify(r.box)}`);
});

test('detectCard declines when the card fills the frame or the blob is not card-shaped', () => {
  const full = new Uint8ClampedArray(300 * 200 * 4).fill(240);
  assert.equal(IM.detectCard(full, 300, 200).found, false);
  // a thin colour band (logo strip) is not a card
  const band = cardOnTable(400, 300, 380, 30, 0);
  assert.equal(IM.detectCard(band, 400, 300).found, false);
});

// grayscale "text lines": dark horizontal bars of short dashes on white, rotated by deg
function textLines(W, H, deg, dark = 30, light = 240) {
  const g = new Uint8ClampedArray(W * H).fill(light), t = deg * Math.PI / 180, c = Math.cos(t), s = Math.sin(t);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const dx = x - W / 2, dy = y - H / 2, u = dx * c + dy * s, v = -dx * s + dy * c;
    if (Math.abs(u) < W * 0.4 && ((v + 1000) % 40) < 10 && ((u + 1000) % 14) < 9) g[y * W + x] = dark;
  }
  return g;
}

test('textSkew measures the tilt of text lines', () => {
  assert.ok(Math.abs(IM.textSkew(textLines(500, 300, 0), 500, 300)) <= 0.3);
  const a = IM.textSkew(textLines(500, 300, 4), 500, 300);
  assert.ok(Math.abs(a + 4) < 0.6 || Math.abs(a - 4) < 0.6, `skew ${a}`); // sign follows the rotation convention
  assert.ok(Math.abs(Math.abs(a) - 4) < 0.6);
});

test('normalizeLighting turns white-on-dark into dark-on-white and removes a shadow gradient', () => {
  const W = 480, H = 240;
  // left half: dark text on white with a strong shadow towards the right edge; right half: white text on navy
  const g = new Uint8ClampedArray(W * H);
  const txt = textLines(W, H, 0, 1, 0); // 1 where text
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = y * W + x, isText = txt[i] === 1;
    if (x < W / 2) { const shade = 1 - 0.45 * (x / (W / 2)); g[i] = (isText ? 40 : 235) * shade; }
    else g[i] = isText ? 235 : 45;
  }
  const out = IM.normalizeLighting(g, W, H);
  const mean = (x0, x1, wantText) => { let s = 0, n = 0; for (let y = 0; y < H; y++) for (let x = x0; x < x1; x++) if ((txt[y * W + x] === 1) === wantText) { s += out[y * W + x]; n++; } return s / n; };
  assert.ok(mean(10, 200, false) > 200, 'shadowed paper becomes white');
  assert.ok(mean(10, 200, true) < 110, 'text stays dark');
  assert.ok(mean(280, 470, false) > 200, 'navy background becomes white');
  assert.ok(mean(280, 470, true) < 110, 'white text becomes dark');
});

/* ---------- OCR error corrections (parser.js) ---------- */
test('fixes common OCR confusions', () => {
  const f = P.parseCardText('宏碩真空設備有眼公司\n陳建宏 Mg\n資深採購事員\nM: O912-345-6l8\nkh.chen © hongshuo.conm\n台南市新市區南科三路 9\n號').fields;
  assert.equal(f.company, '宏碩真空設備有限公司');
  assert.equal(f.name, '陳建宏');
  assert.equal(f.title, '資深採購專員');
  assert.equal(f.mobile, '0912-345-618');
  assert.equal(f.email, 'kh.chen@hongshuo.com');
  assert.equal(f.address, '台南市新市區南科三路 9 號');
  const e = P.parseCardText('Emily Carter\nemily.cartere@northwind.com\nACME Inc.').fields;
  assert.equal(e.email, 'emily.carter@northwind.com');
});

/* ---------- MiniCPM-OCR client helpers (ocr.js) ---------- */
const { CardOCR } = require(path.join(web, 'ocr.js'));

test('MiniCPM-OCR endpoint accepts host, /v1, full path or the same-origin proxy', () => {
  const e = CardOCR.minicpmEndpoint;
  assert.equal(e('http://127.0.0.1:18499'), 'http://127.0.0.1:18499/v1/chat/completions');
  assert.equal(e('http://127.0.0.1:18499/'), 'http://127.0.0.1:18499/v1/chat/completions');
  assert.equal(e('http://gpu-box:8000/v1'), 'http://gpu-box:8000/v1/chat/completions');
  assert.equal(e('http://x/v1/chat/completions'), 'http://x/v1/chat/completions');
  assert.equal(e('/minicpm'), '/minicpm/v1/chat/completions');
  assert.throws(() => e(''), /伺服器網址/);
});

test('MiniCPM-OCR key-information JSON is mapped to card fields', () => {
  const f = CardOCR.parseKie('<think></think>```json\n{"姓名": "王大明", "英文姓名": "###", "公司": "鑫科材料科技股份有限公司", "手機": ["0912-345-678", "0988-000-111"], "Email": "david@x.com", "地址": "###"}\n```');
  assert.deepEqual(f, { name: '王大明', company: '鑫科材料科技股份有限公司', mobile: '0912-345-678 / 0988-000-111', email: 'david@x.com' });
  assert.throws(() => CardOCR.parseKie('沒有 JSON'), /JSON/);
});

/* ---------- reference rules: labelled phone lines are phones; names are unlabelled ---------- */
test('anything after a phone label is a phone number, in the labelled field', () => {
  const f = (t) => P.parseCardText(t).fields;
  assert.deepEqual(f('(O)02-2345-6789 (M)0912-345-678'), { tel: '02-2345-6789', mobile: '0912-345-678' });
  assert.deepEqual(f('電 話:02-1234-5678 傳 真:02-1234-5679'), { tel: '02-1234-5678', fax: '02-1234-5679' });
  assert.deepEqual(f('☎ 06-505-0001 📱 0928-111-222'), { tel: '06-505-0001', mobile: '0928-111-222' });
  assert.deepEqual(f('手機\n0912-345-678'), { mobile: '0912-345-678' });              // label alone, number on the next line
  assert.deepEqual(f('M: 0912-345-678 / 0988-111-222'), { mobile: '0912-345-678 / 0988-111-222' });
  assert.deepEqual(f('TEL: O6-5O5-OOO1'), { tel: '06-505-0001' });                     // OCR letters for digits
  assert.deepEqual(f('電話:(02)2345-6789 轉 l23'), { tel: '(02)2345-6789 #123' });
  assert.deepEqual(f('電話 06-5S0'), { tel: '06-550' });                               // damaged number stays in the phone field
});

test('names are recognised without a label, preferring common surnames over other short words', () => {
  const f = (t) => P.parseCardText(t).fields;
  assert.equal(f('台灣\n星河光電股份有限公司\n林雅婷\n資深採購專員').name, '林雅婷');
  assert.equal(f('敬上\n王 大 明\n業務部').name, '王大明');
  assert.equal(f('新竹\n張簡美玲\n負責人').name, '張簡美玲');
  assert.deepEqual(f('歐陽志明 David Ouyang\nACME Inc.'), { name: '歐陽志明', nameEn: 'David Ouyang', company: 'ACME Inc.' });
  assert.deepEqual(f('研發 中心\n陳 小 華 資深工程師'), { department: '研發中心', name: '陳小華', title: '資深工程師' });
  assert.equal(f('姓名:李四\n總經理').name, '李四');
});

test('English phone labels must be whole words (Director is not "direct", Officer is not "office")', () => {
  const f = P.parseCardText('Emily Carter\nDirector of Sales, APAC\nChief Financial Officer\nDirect: 02-1234-5678').fields;
  assert.equal(f.title, 'Director of Sales, APAC / Chief Financial Officer');
  assert.equal(f.tel, '02-1234-5678');
});
