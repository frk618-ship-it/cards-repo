/* 名片照片的影像分析(純函式,不碰 DOM;瀏覽器與 Node 測試共用):
 *  - detectCard:從桌面背景中找出名片的位置與傾斜角(背景色差 → 最大連通區 → 二階矩主軸)
 *  - textSkew:以文字列投影找出剩餘的小角度傾斜
 *  - normalizeLighting:估計背景亮度並除掉(去陰影、反光),深色底白字區域自動反相成白底黑字
 *  - upscaleFactor:依名片大小決定要放大多少,讓文字達到 Tesseract 擅長的高度 */
(function (root) {
  'use strict';

  function toGray(rgba, n) {
    const g = new Uint8ClampedArray(n);
    for (let i = 0, j = 0; j < n; i += 4, j++) g[j] = (rgba[i] * 299 + rgba[i + 1] * 587 + rgba[i + 2] * 114) / 1000;
    return g;
  }

  function otsu(values, max) {
    const hist = new Float64Array(max + 1);
    let n = 0;
    for (const v of values) { hist[Math.min(max, v | 0)]++; n++; }
    let sum = 0;
    for (let i = 0; i <= max; i++) sum += i * hist[i];
    let sumB = 0, wB = 0, best = 0, thr = 0;
    for (let t = 0; t <= max; t++) {
      wB += hist[t]; if (!wB) continue;
      const wF = n - wB; if (!wF) break;
      sumB += t * hist[t];
      const mB = sumB / wB, mF = (sum - sumB) / wF;
      const between = wB * wF * (mB - mF) * (mB - mF);
      if (between > best) { best = between; thr = t; }
    }
    return thr;
  }

  const median = arr => { const a = Array.from(arr).sort((x, y) => x - y); return a[a.length >> 1]; };

  /**
   * 在縮小的 RGBA 影像(建議長邊 400–700 px)中找名片。
   * 回傳 {found, angle(度,已化到 -45..45), box:{x,y,w,h}, area(占畫面比例)}。
   * 名片占滿畫面或與背景同色時 found=false,呼叫端改用整張圖。
   */
  function detectCard(rgba, w, h) {
    const n = w * h;
    // 1) 邊框一圈的中位數當背景色
    const m = Math.max(2, Math.round(Math.min(w, h) * 0.02));
    const rs = [], gs = [], bs = [];
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      if (x >= m && x < w - m && y >= m && y < h - m) continue;
      const i = (y * w + x) * 4; rs.push(rgba[i]); gs.push(rgba[i + 1]); bs.push(rgba[i + 2]);
    }
    // 背景可能有漸層、木紋:取約 48 個邊框顏色樣本,每個像素和「最接近的」樣本比色差
    const step = Math.max(1, Math.floor(rs.length / 48)), samples = [];
    for (let k = 0; k < rs.length; k += step) samples.push(rs[k], gs[k], bs[k]);
    const dist = new Uint16Array(n);
    for (let j = 0, i = 0; j < n; j++, i += 4) {
      const r = rgba[i], g = rgba[i + 1], b = rgba[i + 2];
      let best = 765;
      for (let k = 0; k < samples.length; k += 3) {
        const d = Math.abs(r - samples[k]) + Math.abs(g - samples[k + 1]) + Math.abs(b - samples[k + 2]);
        if (d < best) { best = d; if (d < 20) break; }
      }
      dist[j] = best;
    }
    const thr = Math.max(40, Math.min(otsu(dist, 765), 90));
    const mask = new Uint8Array(n);
    for (let j = 0; j < n; j++) mask[j] = dist[j] > thr ? 1 : 0;
    // 2) 最大的 4 連通區域
    const label = new Int32Array(n).fill(-1);
    const stack = new Int32Array(n);
    let bestId = -1, bestArea = 0;
    for (let s = 0; s < n; s++) {
      if (!mask[s] || label[s] !== -1) continue;
      let top = 0, area = 0; stack[top++] = s; label[s] = s;
      while (top) {
        const p = stack[--top]; area++;
        const x = p % w, y = (p / w) | 0;
        if (x > 0 && mask[p - 1] && label[p - 1] === -1) { label[p - 1] = s; stack[top++] = p - 1; }
        if (x < w - 1 && mask[p + 1] && label[p + 1] === -1) { label[p + 1] = s; stack[top++] = p + 1; }
        if (y > 0 && mask[p - w] && label[p - w] === -1) { label[p - w] = s; stack[top++] = p - w; }
        if (y < h - 1 && mask[p + w] && label[p + w] === -1) { label[p + w] = s; stack[top++] = p + w; }
      }
      if (area > bestArea) { bestArea = area; bestId = s; }
    }
    const frac = bestArea / n;
    if (bestId < 0 || frac < 0.1) return { found: false, angle: 0, area: frac };
    // 3) 外框與二階矩
    let x0 = w, y0 = h, x1 = 0, y1 = 0, sx = 0, sy = 0;
    for (let p = 0; p < n; p++) if (label[p] === bestId) {
      const x = p % w, y = (p / w) | 0;
      if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
      sx += x; sy += y;
    }
    const cx = sx / bestArea, cy = sy / bestArea;
    let mu20 = 0, mu02 = 0, mu11 = 0;
    for (let p = 0; p < n; p++) if (label[p] === bestId) {
      const dx = p % w - cx, dy = ((p / w) | 0) - cy;
      mu20 += dx * dx; mu02 += dy * dy; mu11 += dx * dy;
    }
    let angle = 0.5 * Math.atan2(2 * mu11, mu20 - mu02) * 180 / Math.PI;
    while (angle > 45) angle -= 90;
    while (angle <= -45) angle += 90;
    const bw = x1 - x0 + 1, bh = y1 - y0 + 1;
    // 外框幾乎就是整張圖:名片占滿畫面(或背景偵測失敗),不裁切
    const fills = bw > w * 0.97 && bh > h * 0.97;
    // 區域在外框中的填滿率太低:多半是雜訊(文字、木紋)而不是一張矩形名片
    const rectangular = bestArea / (bw * bh) > 0.5;
    // 名片的長寬比約 1.2–2.4(橫式或直式);細長的色帶、Logo 不算
    const t = Math.abs(angle) * Math.PI / 180, c = Math.cos(t), sn = Math.sin(t);
    const L = Math.abs(bw * c - bh * sn) / Math.max(1e-6, c * c - sn * sn), S = Math.abs(bh * c - bw * sn) / Math.max(1e-6, c * c - sn * sn);
    const ratio = Math.max(L, S) / Math.max(1, Math.min(L, S));
    const cardLike = ratio >= 1.2 && ratio <= 2.4 && frac >= 0.15;
    return { found: !fills && rectangular && cardLike, angle, box: { x: x0, y: y0, w: bw, h: bh }, area: frac, ratio };
  }

  /** 以文字列的水平投影找傾斜角(度);gray 為白底黑字的灰階影像 */
  function textSkew(gray, w, h, range = 10, step = 0.5) {
    const pts = [];
    const stride = Math.max(1, Math.round(Math.sqrt((w * h) / 60000)));
    for (let y = 0; y < h; y += stride) for (let x = 0; x < w; x += stride) if (gray[y * w + x] < 110) pts.push(x - w / 2, y - h / 2);
    if (pts.length < 200) return 0;
    const H = Math.ceil(Math.hypot(w, h)) + 2;
    const score = deg => {
      const t = deg * Math.PI / 180, s = Math.sin(t), c = Math.cos(t);
      const bins = new Float64Array(H);
      for (let k = 0; k < pts.length; k += 2) bins[Math.round(-pts[k] * s + pts[k + 1] * c + H / 2)]++;
      let q = 0; for (let i = 0; i < H; i++) q += bins[i] * bins[i];
      return q;
    };
    let best = 0, bestScore = score(0);
    for (let a = -range; a <= range + 1e-9; a += step) { const sc = score(a); if (sc > bestScore * 1.0001) { bestScore = sc; best = a; } }
    for (let a = best - step; a <= best + step + 1e-9; a += step / 5) { const sc = score(a); if (sc > bestScore) { bestScore = sc; best = a; } }
    return Math.round(best * 10) / 10;
  }

  /**
   * 去除不均勻照明(陰影、反光)並把深色底的白字反相,輸出白底黑字的灰階影像。
   * 以約 1/24 寬的區塊統計亮度分布:背景通常占區塊多數,所以中位數靠近亮端 → 白底黑字,
   * 靠近暗端 → 深底白字。背景亮度取 90 百分位(白底)或 10 百分位(深底),再雙線性插值。
   */
  function normalizeLighting(gray, w, h) {
    const B = Math.max(32, Math.round(Math.max(w, h) / 24));
    const bw = Math.ceil(w / B), bh = Math.ceil(h / B), nb = bw * bh;
    const p10 = new Float32Array(nb), p50 = new Float32Array(nb), p90 = new Float32Array(nb);
    const hist = new Uint32Array(256);
    for (let by = 0; by < bh; by++) for (let bx = 0; bx < bw; bx++) {
      hist.fill(0);
      let n = 0;
      for (let y = by * B; y < Math.min(h, (by + 1) * B); y += 2) for (let x = bx * B; x < Math.min(w, (bx + 1) * B); x += 2) { hist[gray[y * w + x]]++; n++; }
      const at = q => { let acc = 0, t = q * n; for (let v = 0; v < 256; v++) { acc += hist[v]; if (acc >= t) return v; } return 255; };
      const k = by * bw + bx;
      p10[k] = at(0.08); p50[k] = at(0.5); p90[k] = at(0.92);
    }
    // 極性:1 = 深底白字(反相),0 = 白底黑字,-1 = 對比太低無法判斷(空白區)
    const pol0 = new Int8Array(nb);
    for (let k = 0; k < nb; k++) {
      if (p90[k] - p10[k] < 40) pol0[k] = -1;
      else pol0[k] = (p90[k] - p50[k]) < (p50[k] - p10[k]) ? 0 : 1;
    }
    // 3×3 多數決平滑;無法判斷的區塊往外找鄰近的多數,再沒有就看亮度
    const pol = new Int8Array(nb);
    for (let y = 0; y < bh; y++) for (let x = 0; x < bw; x++) {
      const k = y * bw + x;
      let inv = 0, keep = 0;
      for (let r = 1; r <= 6 && inv + keep < 2; r++) {
        inv = 0; keep = 0;
        for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
          const yy = y + dy, xx = x + dx;
          if (yy < 0 || xx < 0 || yy >= bh || xx >= bw) continue;
          const v = pol0[yy * bw + xx];
          if (v === 1) inv++; else if (v === 0) keep++;
        }
        if (pol0[k] !== -1 && r === 1) break;
      }
      if (pol0[k] !== -1) pol[k] = inv + keep >= 5 && (pol0[k] ? keep > inv * 2 : inv > keep * 2) ? 1 - pol0[k] : pol0[k];
      else pol[k] = inv + keep ? (inv > keep ? 1 : 0) : (p50[k] < 90 ? 1 : 0);
    }
    // 背景亮度圖(以反相後的座標:一律是「背景亮、文字暗」)
    const bgb = new Float32Array(nb);
    for (let k = 0; k < nb; k++) {
      if (pol0[k] === -1) bgb[k] = pol[k] ? 255 - p50[k] : p50[k];
      else bgb[k] = pol[k] ? 255 - p10[k] : p90[k];
    }
    // 3×3 中位數去掉離群區塊
    const bgm = new Float32Array(nb), win = [];
    for (let y = 0; y < bh; y++) for (let x = 0; x < bw; x++) {
      win.length = 0;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const yy = y + dy, xx = x + dx;
        if (yy < 0 || xx < 0 || yy >= bh || xx >= bw) continue;
        if (pol[yy * bw + xx] === pol[y * bw + x]) win.push(bgb[yy * bw + xx]);
      }
      win.sort((a, b) => a - b);
      bgm[y * bw + x] = win[win.length >> 1];
    }
    const out = new Uint8ClampedArray(w * h);
    for (let y = 0; y < h; y++) {
      const fy = Math.min(bh - 1.001, Math.max(0, y / B - 0.5)), y0 = fy | 0, ty = fy - y0, y1 = Math.min(bh - 1, y0 + 1);
      const rowPol = ((y / B) | 0) * bw;
      for (let x = 0; x < w; x++) {
        const fx = Math.min(bw - 1.001, Math.max(0, x / B - 0.5)), x0 = fx | 0, tx = fx - x0, x1 = Math.min(bw - 1, x0 + 1);
        const inv = pol[rowPol + ((x / B) | 0)];
        // 只用同極性的鄰近區塊插值,避免深色帶與白底交界處出現灰色殘影
        let bg = 0, ws = 0;
        const add = (k, wt) => { if (wt > 0 && pol[k] === inv) { bg += bgm[k] * wt; ws += wt; } };
        add(y0 * bw + x0, (1 - tx) * (1 - ty)); add(y0 * bw + x1, tx * (1 - ty)); add(y1 * bw + x0, (1 - tx) * ty); add(y1 * bw + x1, tx * ty);
        bg = ws ? bg / ws : bgm[rowPol + ((x / B) | 0)];
        const v = inv ? 255 - gray[y * w + x] : gray[y * w + x];
        out[y * w + x] = Math.max(0, Math.min(255, v / Math.max(24, bg) * 255));
      }
    }
    // 對比拉伸
    const hs = new Uint32Array(256);
    for (let i = 0; i < out.length; i++) hs[out[i]]++;
    let lo = 0, acc = 0;
    while (lo < 200 && (acc += hs[lo]) < out.length * 0.003) lo++;
    const span = Math.max(1, 250 - lo);
    for (let i = 0; i < out.length; i++) out[i] = (out[i] - lo) * 255 / span;
    return clearLines(clearSolids(out, w, h, Math.max(9, Math.round(B / 3))), w, h);
  }

  /** 去掉長直線(色塊邊緣、底線、名片邊框):連續的暗色像素超過寬度 1/6(或高度 1/4)就清成白色 */
  function clearLines(img, w, h) {
    const minH = Math.max(120, w / 6), minV = Math.max(120, h / 4);
    for (let y = 0; y < h; y++) {
      let start = -1;
      for (let x = 0; x <= w; x++) {
        const dark = x < w && img[y * w + x] < 128;
        if (dark && start < 0) start = x;
        if (!dark && start >= 0) { if (x - start >= minH) img.fill(255, y * w + start, y * w + x); start = -1; }
      }
    }
    for (let x = 0; x < w; x++) {
      let start = -1;
      for (let y = 0; y <= h; y++) {
        const dark = y < h && img[y * w + x] < 128;
        if (dark && start < 0) start = y;
        if (!dark && start >= 0) { if (y - start >= minV) for (let k = start; k < y; k++) img[k * w + x] = 255; start = -1; }
      }
    }
    return img;
  }

  /** 把大片實心的暗色區(色塊交界、陰影殘留)清成白色:文字筆畫不會把 r×r 的窗格塗滿 85% 以上 */
  function clearSolids(img, w, h, r) {
    const W = w + 1, ii = new Uint32Array(W * (h + 1));
    for (let y = 0; y < h; y++) { let row = 0; for (let x = 0; x < w; x++) { row += img[y * w + x] < 128 ? 1 : 0; ii[(y + 1) * W + x + 1] = ii[y * W + x + 1] + row; } }
    const solid = new Uint8Array(w * h), half = r >> 1, lim = 0.85;
    for (let y = 0; y < h; y++) {
      const y0 = Math.max(0, y - half), y1 = Math.min(h, y + half + 1);
      for (let x = 0; x < w; x++) {
        if (img[y * w + x] >= 128) continue;
        const x0 = Math.max(0, x - half), x1 = Math.min(w, x + half + 1);
        const dark = ii[y1 * W + x1] - ii[y0 * W + x1] - ii[y1 * W + x0] + ii[y0 * W + x0];
        if (dark >= lim * (x1 - x0) * (y1 - y0)) solid[y * w + x] = 1;
      }
    }
    // 實心區向外擴一個窗格半徑(邊緣也清掉)
    const out = img.slice();
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (solid[y * w + x]) {
      for (let dy = -half; dy <= half; dy += half || 1) for (let dx = -half; dx <= half; dx += half || 1) {
        const yy = y + dy, xx = x + dx;
        if (yy >= 0 && xx >= 0 && yy < h && xx < w && img[yy * w + xx] < 128) out[yy * w + xx] = 255;
      }
      out[y * w + x] = 255;
    }
    return out;
  }

  /** 名片寬度(px)→ 建議的縮放倍數:目標寬約 1500 px(相當 420 dpi 的 9 cm 名片;實測再大反而容易漏字) */
  function upscaleFactor(cardWidth) {
    return Math.max(0.5, Math.min(3, api.targetWidth / Math.max(1, cardWidth)));
  }

  const api = { toGray, otsu, detectCard, textSkew, normalizeLighting, upscaleFactor, targetWidth: 1500 };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.CardImaging = api;
})(typeof self !== 'undefined' ? self : this);
