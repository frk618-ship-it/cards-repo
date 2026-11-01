/* 相機取景:即時畫面 + 名片框,按快門只裁下框內(含一點邊界)的高解析影像。
 * 對準框拍攝能讓名片占滿畫面、文字夠大,是提高辨識率最有效的方法。
 * 需要 HTTPS(或 localhost)與相機權限;不支援時呼叫端改用檔案選擇。 */
(function (root) {
  'use strict';
  const $ = s => document.querySelector(s);
  const CARD_RATIO = 1.65; // 90×55 mm 左右
  let stream = null, opts = null, shots = [], portrait = false, torchOn = false;

  const supported = () => !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia) && root.isSecureContext !== false;

  /** 依目前的畫面大小算出名片框的位置(CSS 像素,相對於 .cam-view) */
  function layoutFrame() {
    const view = $('.cam-view'), frame = $('#cam-frame');
    const W = view.clientWidth, H = view.clientHeight;
    const ratio = portrait ? 1 / CARD_RATIO : CARD_RATIO;
    let w = Math.min(W * 0.9, (H - 110) * ratio), h = w / ratio;
    if (h > H - 110) { h = H - 110; w = h * ratio; }
    Object.assign(frame.style, { width: w + 'px', height: h + 'px', left: (W - w) / 2 + 'px', top: (H - h) / 2 + 'px' });
    frame.classList.toggle('portrait', portrait);
  }

  async function start() {
    stop();
    const video = $('#cam-video');
    const attempts = [
      { video: { facingMode: { ideal: 'environment' }, width: { ideal: 3840 }, height: { ideal: 2160 } }, audio: false },
      { video: { facingMode: { ideal: 'environment' } }, audio: false },
      { video: true, audio: false },
    ];
    let err;
    for (const c of attempts) {
      try { stream = await navigator.mediaDevices.getUserMedia(c); break; } catch (e) { err = e; }
    }
    if (!stream) throw err || new Error('無法開啟相機');
    video.srcObject = stream;
    await video.play().catch(() => {});
    const track = stream.getVideoTracks()[0];
    // 連續對焦(支援的裝置)
    try { await track.applyConstraints({ advanced: [{ focusMode: 'continuous' }] }); } catch (e) { /* 不支援就算了 */ }
    const caps = track.getCapabilities ? track.getCapabilities() : {};
    $('#cam-torch').hidden = !caps.torch;
    torchOn = false; $('#cam-torch').setAttribute('aria-pressed', 'false');
    layoutFrame();
  }

  function stop() {
    if (stream) { stream.getTracks().forEach(t => t.stop()); stream = null; }
    const v = $('#cam-video'); if (v) v.srcObject = null;
  }

  /** 把畫面上的名片框對應回影片原始像素(video 以 object-fit:cover 顯示),裁下並略放寬 6% */
  function grab() {
    const video = $('#cam-video'), view = $('.cam-view'), frame = $('#cam-frame');
    const vw = video.videoWidth, vh = video.videoHeight;
    if (!vw || !vh) return null;
    const W = view.clientWidth, H = view.clientHeight;
    const k = Math.max(W / vw, H / vh); // cover 的縮放
    const offX = (W - vw * k) / 2, offY = (H - vh * k) / 2;
    const fx = frame.offsetLeft, fy = frame.offsetTop, fw = frame.offsetWidth, fh = frame.offsetHeight;
    const pad = 0.06;
    let sx = (fx - fw * pad - offX) / k, sy = (fy - fh * pad - offY) / k, sw = fw * (1 + 2 * pad) / k, sh = fh * (1 + 2 * pad) / k;
    sx = Math.max(0, sx); sy = Math.max(0, sy); sw = Math.min(vw - sx, sw); sh = Math.min(vh - sy, sh);
    const c = document.createElement('canvas');
    c.width = Math.round(sw); c.height = Math.round(sh);
    c.getContext('2d').drawImage(video, sx, sy, sw, sh, 0, 0, c.width, c.height);
    return c;
  }

  async function shoot() {
    const c = grab();
    if (!c) return;
    const frame = $('#cam-frame');
    frame.classList.remove('flash'); void frame.offsetWidth; frame.classList.add('flash');
    if (navigator.vibrate) try { navigator.vibrate(30); } catch (e) { /* ignore */ }
    const blob = await new Promise(r => c.toBlob(r, 'image/jpeg', 0.93));
    const file = new File([blob], `card-${Date.now()}.jpg`, { type: 'image/jpeg' });
    if ($('#cam-burst').getAttribute('aria-pressed') === 'true') {
      shots.push(file);
      const img = document.createElement('img'); img.src = URL.createObjectURL(blob); img.alt = '';
      const box = $('#cam-shots'); box.appendChild(img); while (box.children.length > 4) box.firstChild.remove();
      $('#cam-count').textContent = shots.length; $('#cam-done').hidden = false;
      $('#cam-tip').textContent = `已拍 ${shots.length} 張,換下一張名片或按「完成」`;
    } else {
      close();
      opts.onShots([file]);
    }
  }

  function close() {
    stop();
    const d = $('#dlg-cam'); if (d.open) d.close();
    $('#cam-shots').innerHTML = '';
  }

  async function open(o) {
    opts = o; shots = [];
    $('#cam-count').textContent = '0'; $('#cam-done').hidden = true; $('#cam-shots').innerHTML = '';
    $('#cam-tip').textContent = '把名片放進框內,平放、避免反光';
    const d = $('#dlg-cam');
    d.showModal();
    try { await start(); }
    catch (e) {
      close();
      o.onError && o.onError(e.name === 'NotAllowedError' ? '沒有相機權限,請在瀏覽器設定允許,或改用相簿選擇照片' : '無法開啟相機:' + (e.message || e.name));
    }
  }

  function bind() {
    $('#cam-shoot').onclick = shoot;
    $('#cam-close').onclick = () => { const s = shots; close(); if (s.length) opts.onShots(s); };
    $('#cam-done').onclick = () => { const s = shots; close(); opts.onShots(s); };
    $('#cam-file').onclick = () => { close(); opts.onPickFile && opts.onPickFile(); };
    $('#cam-burst').onclick = e => { const b = e.currentTarget; b.setAttribute('aria-pressed', String(b.getAttribute('aria-pressed') !== 'true')); };
    $('#cam-orient').onclick = e => { portrait = !portrait; e.currentTarget.setAttribute('aria-pressed', String(portrait)); layoutFrame(); };
    $('#cam-torch').onclick = async e => {
      const track = stream && stream.getVideoTracks()[0]; if (!track) return;
      torchOn = !torchOn;
      try { await track.applyConstraints({ advanced: [{ torch: torchOn }] }); e.currentTarget.setAttribute('aria-pressed', String(torchOn)); } catch (x) { torchOn = false; }
    };
    $('#dlg-cam').addEventListener('cancel', e => { e.preventDefault(); $('#cam-close').click(); });
    addEventListener('resize', () => { if ($('#dlg-cam').open) layoutFrame(); });
    document.addEventListener('keydown', e => { if ($('#dlg-cam').open && (e.key === ' ' || e.key === 'Enter') && e.target.tagName !== 'BUTTON') { e.preventDefault(); shoot(); } });
  }

  root.CardCamera = { supported, open, close, bind };
})(typeof self !== 'undefined' ? self : this);
