/* ================================================================
 * 大学助手 · 主应用
 * 纯前端：登录 / 哈希路由 / 首页 / 我的 / 课程 / 知识总结 /
 *         我的整理（手写+拍照）/ 题库训练 / 模拟测试
 * 图片与笔记以原始 Blob 存入 IndexedDB，永久保存在本机、画质无损
 * ================================================================ */
(function () {
  'use strict';

  /* ---------------- 全局状态 ---------------- */
  var ctx = { id: null, mode: 'seq' };
  UH.ctx = ctx;
  var bank = [];
  var practice = null;          // { mode, list, pos, draft }
  var exam = null;              // { list, ans:[], startTs, timer }
  var loadedScripts = {};
  var currentTab = 'home';
  var editState = null;         // { cid, mode, files:File[], title, body }
  var editorUrls = [];          // 编辑器草稿图片预览URL
  var urlPool = [];             // 列表/详情/图库 Blob URL 池
  var pickerTarget = null;      // 'mine' | 'note'

  /* ---------------- AI 能力（智谱 GLM，浏览器直连） ---------------- */
  var ZHIPU_KEY = 'a1cd5a182ed6457f81b4fa63c364c439.kSgWyfgnu5r9sSWc';
  var ZHIPU_URL = 'https://open.bigmodel.cn/api/paas/v4/chat/completions';
  var ZHIPU_MODEL = 'glm-4-flash-250414';
  var aiChatHist = [];          // AI问答历史 {role,content}
  var aiTypeTimer = null;       // 打字机定时器
  var aiExam = null;            // { list, ans:[], pos, startTs, timer }
  var aiExamRetry = 0;          // AI 出题自动重试计数
  var BRIGHT = [
    'linear-gradient(135deg,#5b7cfa,#7a5cf0)',
    'linear-gradient(135deg,#22b8e6,#4f8df7)',
    'linear-gradient(135deg,#22c55e,#0ea5b7)',
    'linear-gradient(135deg,#8b5cf6,#6d5df0)',
    'linear-gradient(135deg,#ec4899,#f43f5e)',
    'linear-gradient(135deg,#f59e0b,#f97316)',
    'linear-gradient(135deg,#ea580c,#d97706)',
    'linear-gradient(135deg,#0d9488,#059669)',
    'linear-gradient(135deg,#6366f1,#4338ca)',
    'linear-gradient(135deg,#16a34a,#65a30d)',
    'linear-gradient(135deg,#6366f1,#8b5cf6)',
    'linear-gradient(135deg,#9333ea,#c026d3)',
    'linear-gradient(135deg,#0284c7,#0369a1)',
    'linear-gradient(135deg,#db2777,#9d174d)',
    'linear-gradient(135deg,#2563eb,#0891b2)',
    'linear-gradient(135deg,#d97706,#ca8a04)',
    'linear-gradient(135deg,#7c3aed,#4f46e5)'
  ];

  /* ---------------- 工具 ---------------- */
  function $(id) { return document.getElementById(id); }
  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }
  function metaOf(id) {
    for (var i = 0; i < UH.META.length; i++) if (UH.META[i].id === id) return UH.META[i];
    return window.UH_CATALOG ? UH_CATALOG.metaById(id) : null;
  }
  function toast(msg, ms) {
    var t = $('toast');
    t.textContent = msg; t.classList.remove('hidden');
    clearTimeout(t._timer);
    t._timer = setTimeout(function () { t.classList.add('hidden'); }, ms || 1800);
  }
  function bingUrl(q) { return 'https://www.bing.com/search?q=' + encodeURIComponent(q); }
  function searchNet(q) { window.open(bingUrl(q), '_blank'); }
  function fmtTime(sec) {
    var m = Math.floor(sec / 60), s = sec % 60;
    return (m < 10 ? '0' : '') + m + ':' + (s < 10 ? '0' : '') + s;
  }
  function pad2(n) { return (n < 10 ? '0' : '') + n; }
  function fmtFull(ts) {
    var d = new Date(ts);
    return d.getFullYear() + '/' + pad2(d.getMonth() + 1) + '/' + pad2(d.getDate())
      + ' ' + pad2(d.getHours()) + ':' + pad2(d.getMinutes()) + ':' + pad2(d.getSeconds());
  }

  /* ---------------- 本地存储：用户 / 进度 / 综合统计 ---------------- */
  function pKey(id) { return 'uh_p_' + id; }
  function eKey(id) { return 'uh_e_' + id; }
  function loadProgress(id) {
    try { return JSON.parse(localStorage.getItem(pKey(id))) || {}; } catch (e) { return {}; }
  }
  function saveProgress(id, data) {
    try { localStorage.setItem(pKey(id), JSON.stringify(data)); } catch (e) {}
  }
  function loadExamRec(id) {
    try { return JSON.parse(localStorage.getItem(eKey(id))) || { best: null }; } catch (e) { return { best: null }; }
  }
  function saveExamRec(id, rec) {
    try { localStorage.setItem(eKey(id), JSON.stringify(rec)); } catch (e) {}
  }
  function getUser() {
    try { return JSON.parse(localStorage.getItem('uh_user')); } catch (e) { return null; }
  }
  function setUser(u) { try { localStorage.setItem('uh_user', JSON.stringify(u)); } catch (e) {} }
  function defaultStats() {
    return { ans: 0, ok: 0, diffAll: 0, diffHit: 0, tIdxSum: 0, tCnt: 0, scoreSum: 0, examCnt: 0, subjects: {} };
  }
  function loadStats() {
    try {
      var s = JSON.parse(localStorage.getItem('uh_stats'));
      if (!s) return defaultStats();
      s.subjects = s.subjects || {};
      return s;
    } catch (e) { return defaultStats(); }
  }
  function saveStats(s) { try { localStorage.setItem('uh_stats', JSON.stringify(s)); } catch (e) {} }
  function bumpAnswer(cid, d, ok) {
    var s = loadStats();
    s.ans++; if (ok) s.ok++;
    s.diffAll += d; if (ok) s.diffHit += d;
    var sub = s.subjects[cid] || { ans: 0, ok: 0 };
    sub.ans++; if (ok) sub.ok++;
    s.subjects[cid] = sub;
    saveStats(s);
  }
  function bumpExam(score, timeIdx) {
    var s = loadStats();
    s.tIdxSum += timeIdx; s.tCnt++;
    s.scoreSum += score; s.examCnt++;
    saveStats(s);
  }
  function isCorrect(q, sel) {
    if (sel == null) return false;
    if (q.type === 'multi') {
      if (!Array.isArray(sel) || sel.length !== q.a.length) return false;
      var a = q.a.slice().sort(), b = sel.slice().sort();
      for (var i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
      return true;
    }
    return sel === q.a;
  }
  function answerText(q, idxArr) {
    if (!Array.isArray(idxArr)) idxArr = [idxArr];
    return idxArr.map(function (i) { return String.fromCharCode(65 + i) + '. ' + q.o[i]; }).join('　');
  }

  /* ---------------- IndexedDB：笔记 / 图库（原始 Blob，画质无损） ---------------- */
  var idbPromise = null;
  function openDB() {
    if (idbPromise) return idbPromise;
    idbPromise = new Promise(function (resolve, reject) {
      var r = indexedDB.open('uh_university_helper', 1);
      r.onupgradeneeded = function () {
        var db = r.result;
        if (!db.objectStoreNames.contains('notes')) db.createObjectStore('notes', { keyPath: 'id', autoIncrement: true });
        if (!db.objectStoreNames.contains('gallery')) db.createObjectStore('gallery', { keyPath: 'id', autoIncrement: true });
      };
      r.onsuccess = function () {
        if (navigator.storage && navigator.storage.persist) { try { navigator.storage.persist(); } catch (e) {} }
        resolve(r.result);
      };
      r.onerror = function () { reject(r.error); };
    });
    return idbPromise;
  }
  function dbTx(store, mode, fn) {
    return openDB().then(function (db) {
      return new Promise(function (resolve, reject) {
        var tx = db.transaction(store, mode), os = tx.objectStore(store), req;
        try { req = fn(os); } catch (e) { reject(e); return; }
        tx.oncomplete = function () { resolve(req && req.result !== undefined ? req.result : null); };
        tx.onerror = function () { reject(tx.error); };
      });
    });
  }
  function dbAdd(store, val) { return dbTx(store, 'readwrite', function (os) { return os.add(val); }); }
  function dbAll(store) {
    return dbTx(store, 'readonly', function (os) { return os.getAll(); });
  }
  function dbGet(store, id) {
    return dbTx(store, 'readonly', function (os) { return os.get(Number(id)); });
  }
  function dbPut(store, val) { return dbTx(store, 'readwrite', function (os) { return os.put(val); }); }
  function dbDel(store, id) { return dbTx(store, 'readwrite', function (os) { return os.delete(Number(id)); }); }
  function poolUrl(blob) {
    var u = URL.createObjectURL(blob);
    urlPool.push(u);
    return u;
  }
  function revokePool() {
    urlPool.forEach(function (u) { try { URL.revokeObjectURL(u); } catch (e) {} });
    urlPool = [];
  }
  /* 兼容新旧两种存图格式：dataURL字符串（新）/ Blob（旧） */
  function imgSrcOf(rec) {
    if (!rec) return '';
    if (rec.data) return rec.data;
    if (rec.blob) return poolUrl(rec.blob);
    return '';
  }
  /* 图片选择统一走 base64 dataURL：
     部分手机 WebView 把 Blob 存入 IndexedDB 后取出字节损坏（显示乱码），
     字符串在所有机型上都能安全存储；转换时同时验证图片可解码，坏图直接拦截 */
  function verifyImg(dataUrl) {
    return new Promise(function (res) {
      var im = new Image(), done = false;
      var t = setTimeout(function () { if (!done) { done = true; res(false); } }, 20000);
      im.onload = function () { if (!done) { done = true; clearTimeout(t); res(true); } };
      im.onerror = function () { if (!done) { done = true; clearTimeout(t); res(false); } };
      im.src = dataUrl;
    });
  }
  /* 魔数嗅探：部分手机 WebView 拍照返回的 File.type 为空或错误（如 application/octet-stream），
     FileReader 生成的 dataURL 前缀不是 data:image/，必须靠文件头判断真实图片格式 */
  function sniffImageMime(b64) {
    var bin;
    try { bin = atob(b64.slice(0, 24)); } catch (e) { return ''; }
    if (!bin) return '';
    var c = [];
    for (var i = 0; i < bin.length; i++) c.push(bin.charCodeAt(i));
    if (c[0] === 0xFF && c[1] === 0xD8 && c[2] === 0xFF) return 'image/jpeg';
    if (c[0] === 0x89 && c[1] === 0x50 && c[2] === 0x4E && c[3] === 0x47) return 'image/png';
    if (c[0] === 0x47 && c[1] === 0x49 && c[2] === 0x46 && c[3] === 0x38) return 'image/gif';
    if (c[0] === 0x42 && c[1] === 0x4D) return 'image/bmp';
    if (c[0] === 0x52 && c[1] === 0x49 && c[2] === 0x46 && c[3] === 0x46) return 'image/webp'; // RIFF....WEBP
    if (c[4] === 0x66 && c[5] === 0x74 && c[6] === 0x79 && c[7] === 0x70) { // ....ftyp
      var brand = String.fromCharCode(c[8] || 0, c[9] || 0, c[10] || 0, c[11] || 0);
      if (/^(heic|heix|hevc|mif1|msf1|avif)/i.test(brand)) return 'image/heic';
    }
    return '';
  }
  function toVerifiedDataUrl(file) {
    return new Promise(function (res) {
      var r = new FileReader();
      r.onload = function () {
        var d = String(r.result || '');
        var m = /^data:([^;,]+);base64,(.*)$/.exec(d);
        if (!m) return res(null);
        var real = sniffImageMime(m[2]);
        if (!real) return res(null);
        // 纠正错误/缺失的 mime：统一用嗅探出的真实格式重建 dataURL
        if (m[1].indexOf('image/') !== 0 || real !== m[1]) {
          d = 'data:' + real + ';base64,' + m[2];
        }
        // HEIC/HEIF（iPhone 拍照默认格式）：环境能解码则原样使用，否则自动转 JPEG
        if (/^image\/(heic|heif|avif)/i.test(real)) {
          handleHeicDataUrl(d).then(function (out) { res(out); });
        } else {
          verifyImg(d).then(function (ok) {
            if (ok) { res(d); return; }
            // 原图解码失败（常见于大尺寸照片在低内存 WebView 中）：降采样为 JPEG 兜底
            if (d.length > 4 * 1024 * 1024) {
              downscaleFallback(d, 1920).then(function (small) {
                if (small) toast('原图较大，已自动压缩保存');
                res(small);
              });
            } else {
              res(null);
            }
          });
        }
      };
      r.onerror = function () { res(null); };
      r.readAsDataURL(file);
    });
  }
  /* 大图降采样兜底：原图解码失败时，用 createImageBitmap（或 Image）解码后缩到 maxSide
     以内存为 JPEG，保证低内存 WebView 也能保存成功 */
  function downscaleFallback(dataUrl, maxSide) {
    var blob = dataUrlToBlob(dataUrl);
    if (!blob) return Promise.resolve(null);
    var dec;
    if (typeof createImageBitmap === 'function') {
      dec = createImageBitmap(blob).then(function (bmp) {
        return { bmp: bmp, w: bmp.width, h: bmp.height };
      });
    } else {
      dec = new Promise(function (res2) {
        var im = new Image();
        im.onload = function () { res2({ im: im, w: im.naturalWidth, h: im.naturalHeight }); };
        im.onerror = function () { res2(null); };
        im.src = dataUrl;
      });
    }
    return dec.then(function (src) {
      if (!src) return null;
      var scale = Math.min(1, maxSide / Math.max(src.w, src.h));
      var cw = Math.max(1, Math.round(src.w * scale)), ch = Math.max(1, Math.round(src.h * scale));
      var cv = document.createElement('canvas');
      cv.width = cw; cv.height = ch;
      var cx = cv.getContext('2d');
      if (src.bmp) cx.drawImage(src.bmp, 0, 0, cw, ch);
      else cx.drawImage(src.im, 0, 0, cw, ch);
      if (src.bmp && src.bmp.close) { try { src.bmp.close(); } catch (e) {} }
      try { return cv.toDataURL('image/jpeg', 0.88); } catch (e) { return null; }
    }).catch(function () { return null; });
  }
  /* HEIC/HEIF 兼容处理：优先原格式（iOS Safari 等支持直接显示），
     解码失败时用本地 heic2any 转 JPEG，保证所有机型都能显示 */
  function handleHeicDataUrl(dataUrl) {
    return verifyImg(dataUrl).then(function (ok) {
      if (ok) return dataUrl;
      return heic2anyToJpeg(dataUrl).then(function (jpegUrl) {
        if (jpegUrl) toast('HEIC 图片已自动转为 JPG 格式');
        return jpegUrl;
      });
    });
  }
  var heic2anyLoading = null;
  function loadHeic2Any() {
    if (window.heic2any) return Promise.resolve();
    if (heic2anyLoading) return heic2anyLoading;
    heic2anyLoading = new Promise(function (res, rej) {
      var s = document.createElement('script');
      s.src = 'js/vendor/heic2any.min.js';
      s.onload = function () { res(); };
      s.onerror = function () { heic2anyLoading = null; rej(new Error('HEIC 转码组件加载失败')); };
      document.body.appendChild(s);
    });
    return heic2anyLoading;
  }
  function dataUrlToBlob(dataUrl) {
    var m = /^data:([^;,]+);base64,(.+)$/.exec(dataUrl);
    if (!m) return null;
    var bin = atob(m[2]), len = bin.length, arr = new Uint8Array(len);
    for (var i = 0; i < len; i++) arr[i] = bin.charCodeAt(i);
    return new Blob([arr], { type: m[1] });
  }
  function blobToDataUrl(blob) {
    return new Promise(function (res, rej) {
      var r = new FileReader();
      r.onload = function () { res(String(r.result || '')); };
      r.onerror = function () { rej(new Error('转码结果读取失败')); };
      r.readAsDataURL(blob);
    });
  }
  function heic2anyToJpeg(dataUrl) {
    var blob = dataUrlToBlob(dataUrl);
    if (!blob) return Promise.resolve(null);
    return loadHeic2Any().then(function () {
      return window.heic2any({ blob: blob, toType: 'image/jpeg', quality: 0.92 });
    }).then(function (out) {
      return blobToDataUrl(Array.isArray(out) ? out[0] : out);
    }).catch(function () {
      return null;
    });
  }

  /* ---------------- 数据文件加载 ---------------- */
  function loadCourse(id) {
    return new Promise(function (resolve, reject) {
      if (UH.has(id)) return resolve();
      if (loadedScripts[id] === 'loading') {
        var wait = setInterval(function () {
          if (UH.has(id)) { clearInterval(wait); resolve(); }
        }, 60);
        return;
      }
      loadedScripts[id] = 'loading';
      var s = document.createElement('script');
      s.src = 'js/data/' + id + '.js';
      s.onload = function () { loadedScripts[id] = 'done'; resolve(); };
      s.onerror = function () { reject(new Error('课程数据加载失败：' + id)); };
      document.body.appendChild(s);
    });
  }

  /* ---------------- 视图切换 ---------------- */
  var VIEWS = ['viewHome', 'viewMine', 'viewCourse', 'viewKnowledge', 'viewNotes',
    'viewNoteEdit', 'viewNoteDetail', 'viewPractice', 'viewExam', 'viewResult',
    'viewVideo', 'viewCheckin', 'viewInsight', 'viewAiChat', 'viewAiExam', 'viewAiResult'];
  var TAB_VIEWS = { home: 'viewHome', mine: 'viewMine' };
  function clearTabAnim() {
    ['viewHome', 'viewMine'].forEach(function (v) {
      $(v).classList.remove('tab-leave', 'tab-out-l', 'tab-out-r', 'tab-in-r', 'tab-in-l');
    });
  }
  function showView(name) {
    clearTabAnim();
    VIEWS.forEach(function (v) { $(v).classList.toggle('hidden', v !== name); });
    $('tabbar').classList.toggle('hidden', name !== 'viewHome' && name !== 'viewMine');
    window.scrollTo(0, 0);
  }

  /* ================================================================
   * 登录：姓名 → 9位学号（验证码格子）→ 5秒加载动画
   * ================================================================ */
  var sidInputs = [];
  var pendingName = '';
  function initLogin() {
    var boxes = $('sidBoxes');
    for (var i = 0; i < 9; i++) {
      (function (idx) {
        var inp = document.createElement('input');
        inp.className = 'sid-box'; inp.type = 'tel';
        inp.setAttribute('inputmode', 'numeric');
        inp.maxLength = 1; inp.setAttribute('aria-label', '学号第' + (idx + 1) + '位');
        inp.addEventListener('input', function () {
          var v = inp.value.replace(/\D/g, '').slice(-1);
          inp.value = v;
          inp.classList.toggle('filled', !!v);
          if (v && idx < 8) sidInputs[idx + 1].focus();
          refreshSidState();
        });
        inp.addEventListener('keydown', function (e) {
          if (e.key === 'Backspace' && !inp.value && idx > 0) {
            sidInputs[idx - 1].focus();
            sidInputs[idx - 1].value = '';
            sidInputs[idx - 1].classList.remove('filled');
            refreshSidState();
          }
          if (e.key === 'Enter') $('doLogin').click();
        });
        inp.addEventListener('paste', function (e) {
          e.preventDefault();
          var text = (e.clipboardData.getData('text') || '').replace(/\D/g, '').slice(0, 9);
          for (var k = 0; k < 9; k++) {
            sidInputs[k].value = text[k] || '';
            sidInputs[k].classList.toggle('filled', !!text[k]);
          }
          refreshSidState();
          if (text.length < 9) sidInputs[text.length].focus();
        });
        boxes.appendChild(inp);
        sidInputs.push(inp);
      })(i);
    }

    $('loginName').addEventListener('keydown', function (e) { if (e.key === 'Enter') $('toStep2').click(); });
    $('toStep2').addEventListener('click', function () {
      var name = $('loginName').value.trim();
      if (!name) { toast('请先填写姓名'); $('loginName').focus(); return; }
      pendingName = name;
      $('lpNameShow').textContent = name;
      switchLoginPanel('lp1', 'lp2');
      setTimeout(function () { sidInputs[0].focus(); }, 320);
    });
    $('lpBack').addEventListener('click', function () {
      switchLoginPanel('lp2', 'lp1', true);
    });
    $('doLogin').addEventListener('click', function () {
      var sid = sidInputs.map(function (i) { return i.value; }).join('');
      if (!/^\d{9}$/.test(sid)) { $('sidErr').textContent = '请完整填写9位数字学号'; return; }
      $('sidErr').textContent = '';
      switchLoginPanel('lp2', 'lp3');
      setTimeout(function () {
        setUser({ name: pendingName, sid: sid });
        applyUser({ name: pendingName, sid: sid });
        var mask = $('loginMask');
        mask.classList.add('fade-out');
        setTimeout(function () { mask.classList.add('hidden'); }, 480);
      }, 5000);
    });
  }
  function refreshSidState() {
    var sid = sidInputs.map(function (i) { return i.value; }).join('');
    $('doLogin').disabled = sid.length !== 9;
    if (sid.length === 9) $('sidErr').textContent = '';
  }
  function switchLoginPanel(fromId, toId, back) {
    var from = $(fromId), to = $(toId);
    from.classList.add('out-left');
    if (back) { from.classList.remove('out-left'); from.style.animation = 'lpIn .3s reverse'; }
    setTimeout(function () {
      from.classList.add('hidden');
      from.classList.remove('out-left');
      from.style.animation = '';
      to.classList.remove('hidden');
      void to.offsetWidth;   // 重启动画
      to.style.animation = '';
    }, back ? 0 : 280);
  }
  function applyUser(u) {
    $('mineName').textContent = u.name;
    $('mineSid').textContent = '学号：' + u.sid;
  }
  /* 退出登录：清除登录态并退回登录界面（本机学习数据保留） */
  window.logoutMine = function () {
    if (!confirm('确定退出登录吗？本机学习数据仍会保留。')) return;
    try { localStorage.removeItem('uh_user'); } catch (e) {}
    document.querySelectorAll('#sidBoxes .sid-box').forEach(function (i) {
      i.value = ''; i.classList.remove('filled');
    });
    $('doLogin').disabled = true;
    $('sidErr').textContent = '';
    $('loginName').value = '';
    $('lpNameShow').textContent = '同学';
    var mask = $('loginMask');
    mask.classList.remove('fade-out');
    mask.classList.remove('hidden');
    $('lp1').classList.remove('hidden');
    ['lp2', 'lp3'].forEach(function (id) {
      var p = $(id);
      p.classList.add('hidden');
      p.classList.remove('out-left');
      p.style.animation = '';
    });
    setTimeout(function () { $('loginName').focus(); }, 420);
  };

  /* ================================================================
   * 路由
   * ================================================================ */
  function router() {
    var hash = location.hash || '#/';
    var parts = hash.replace(/^#\/?/, '').split('/').filter(Boolean);
    if (parts.length === 0) { renderHome(); return; }
    if (parts[0] === 'course' && parts[1]) { openCourse(parts[1]); return; }
    if (parts[0] === 'knowledge' && parts[1]) { openKnowledge(parts[1]); return; }
    if (parts[0] === 'ai-chat' && parts[1]) { openAiChat(parts[1]); return; }
    if (parts[0] === 'ai-exam' && parts[1]) { startAiExam(parts[1]); return; }
    if (parts[0] === 'practice' && parts[1]) { enterPractice(parts[1], parts[2] || 'seq'); return; }
    if (parts[0] === 'exam' && parts[1]) { startExamRoute(parts[1]); return; }
    if (parts[0] === 'notes' && parts[1]) { openNotesList(parts[1]); return; }
    if (parts[0] === 'note-edit' && parts[1]) { openNoteEditor(parts[1], parts[2] || 'hand', parts[3]); return; }
    if (parts[0] === 'note-detail' && parts[1] && parts[2]) { openNoteDetail(parts[1], parts[2]); return; }
    if (parts[0] === 'video' && parts[1]) { openVideoPage(parts[1], parts[2] ? parseInt(parts[2], 10) : -1); return; }
    if (parts[0] === 'checkin') { openCheckinPage(); return; }
    if (parts[0] === 'insight') { openInsightPage(); return; }
    renderHome();
  }
  window.addEventListener('hashchange', router);

  /* ---------------- 底部Tab切换（过渡动画） ---------------- */
  function switchTab(tab) {
    if (tab === currentTab) return;
    var fromId = TAB_VIEWS[currentTab], toId = TAB_VIEWS[tab];
    var f = $(fromId), t = $(toId);
    var toMine = tab === 'mine';
    $('tabbar').classList.remove('hidden');
    document.querySelectorAll('.tab-item').forEach(function (el) {
      el.classList.toggle('active', el.getAttribute('data-tab') === tab);
    });
    $('tabGlow').classList.toggle('right', toMine);

    t.classList.remove('hidden');
    window.scrollTo(0, 0);
    f.classList.add('tab-leave', toMine ? 'tab-out-l' : 'tab-out-r');
    t.classList.add(toMine ? 'tab-in-r' : 'tab-in-l');
    setTimeout(function () {
      f.classList.add('hidden');
      f.classList.remove('tab-leave', 'tab-out-l', 'tab-out-r');
      t.classList.remove('tab-in-r', 'tab-in-l');
    }, 310);
    currentTab = tab;
    if (tab === 'mine') renderMine();
  }
  document.querySelectorAll('.tab-item').forEach(function (el) {
    el.addEventListener('click', function () { switchTab(el.getAttribute('data-tab')); });
  });

  /* ================================================================
   * 首页
   * ================================================================ */
  function renderHome(flip) {
    stopExamTimer();
    currentTab = 'home';
    document.querySelectorAll('.tab-item').forEach(function (el) {
      el.classList.toggle('active', el.getAttribute('data-tab') === 'home');
    });
    $('tabGlow').classList.remove('right');
    showView('viewHome');

    /* 作用域标题与面包屑：基础学院 / 某学院某专业 */
    var sp = UH_CATALOG.scope();
    var heroSub = document.querySelector('.hero-sub');
    var scopeBar = $('scopeBar');
    if (!sp) {
      $('homeScopeTitle').textContent = '全部课程';
      heroSub.textContent = UH.META.length + '门核心课程 · 知识总结 / 题库训练 / 模拟测试';
      scopeBar.classList.add('hidden');
      scopeBar.innerHTML = '';
      $('courseCountTip').textContent = UH.META.length + '门 · 每门215题';
    } else {
      var col = UH_CATALOG.colleges[sp.c];
      var mj = col.m[sp.m];
      $('homeScopeTitle').textContent = mj.n;
      heroSub.textContent = col.n + ' · ' + mj.n + ' · ' + UH.META.length + '门专业课程';
      scopeBar.classList.remove('hidden');
      scopeBar.innerHTML =
        '<span class="scope-chip">📚 基础学院</span><span class="scope-sep">›</span>'
        + '<span class="scope-chip">' + esc(col.n) + '</span><span class="scope-sep">›</span>'
        + '<span class="scope-chip scope-chip-on">' + esc(mj.n) + '</span>'
        + '<button class="scope-reset" type="button" onclick="cpResetScope()">↩ 返回基础学院</button>';
      $('courseCountTip').textContent = UH.META.length + '门 · 每门250-300题';
    }

    var grid = $('courseGrid');
    grid.classList.remove('scope-flip');
    if (flip) { void grid.offsetWidth; grid.classList.add('scope-flip'); }
    grid.innerHTML = UH.META.map(function (m, idx) {
      var total = UH.sizeOf(m.id);
      var prog = loadProgress(m.id);
      var keys = Object.keys(prog);
      var wrong = keys.filter(function (k) { return !prog[k].ok; }).length;
      var rec = loadExamRec(m.id);
      var pct = Math.round(keys.length / total * 100);
      return '<div class="course-card" style="--i:' + Math.min(idx, 15) + '" onclick="location.hash=\'#/course/' + m.id + '\'">'
        + (rec.best != null ? '<span class="cc-best">最佳' + rec.best + '分</span>' : '')
        + '<div class="cc-icon" style="background:' + m.bg + '">' + m.icon + '</div>'
        + '<div class="cc-name">' + esc(m.name) + '</div>'
        + '<div class="cc-meta"><span>' + total + '题 · 已练' + keys.length + '</span><span>' + (wrong > 0 ? '错' + wrong : '全对✓') + '</span></div>'
        + '<div class="cc-bar"><i style="width:' + Math.min(100, pct) + '%"></i></div>'
        + '</div>';
    }).join('');

    renderHeroCheckin();
  }
  window.webSearchHome = function () {
    var v = $('heroSearchInput').value.trim();
    if (!v) { toast('请输入要搜索的问题'); return; }
    searchNet(v);
  };
  window.goBackHome = function () { location.hash = '#/'; };

  /* ================================================================
   * 课程功能页
   * ================================================================ */
  function openCourse(id) {
    var m = metaOf(id);
    if (!m) { location.hash = '#/'; return; }
    ctx.id = id;
    loadCourse(id).then(function () {
      showView('viewCourse');
      var allIdx = UH_CATALOG.allMetas().indexOf(m);
      $('courseBanner').style.background = BRIGHT[(allIdx >= 0 ? allIdx : UH.hashStr(id)) % BRIGHT.length];
      $('courseBannerIcon').textContent = m.icon;
      $('courseBannerName').textContent = m.name;
      $('courseBannerMeta').textContent = '重点知识总结 · 题库训练 · 模拟测试 · 视频学习';
      $('courseHeaderName').textContent = m.name;

      var prog = loadProgress(id), keys = Object.keys(prog);
      var wrong = keys.filter(function (k) { return !prog[k].ok; }).length;
      var rec = loadExamRec(id);
      $('statBankCount').textContent = UH.sizeOf(id);
      $('statPracticed').textContent = keys.length;
      $('statWrong').textContent = wrong;
      $('statBest').textContent = rec.best != null ? rec.best + '分' : '--';
    }).catch(function (e) { toast(e.message); });
  }

  window.goKnowledge = function () { location.hash = '#/knowledge/' + ctx.id; };
  window.goMyNotes = function () { location.hash = '#/notes/' + ctx.id; };

  /* ---------------- 训练模式弹层 ---------------- */
  window.openPracticeSheet = function () {
    var prog = loadProgress(ctx.id);
    var wrong = Object.keys(prog).filter(function (k) { return !prog[k].ok; }).length;
    $('sheetWrongCount').textContent = wrong;
    $('modeSheetMask').classList.remove('hidden');
  };
  window.closePracticeSheet = function (e) {
    if (e && e.target !== e.currentTarget) return;
    $('modeSheetMask').classList.add('hidden');
  };
  window.startPractice = function (mode) {
    closePracticeSheet();
    location.hash = '#/practice/' + ctx.id + '/' + mode;
  };
  window.exitPractice = function () { location.hash = '#/course/' + ctx.id; };

  /* ================================================================
   * 知识总结页
   * ================================================================ */
  function openKnowledge(id) {
    ctx.id = id;
    loadCourse(id).then(function () {
      var m = metaOf(id), def = UH.getDef(id);
      showView('viewKnowledge');
      var groups = UH.groups(id);
      var html = '<div class="kw-intro"><b>' + esc(m.name) + '</b><br>' + esc(def.intro || '') + '</div>';
      html += '<div class="kw-tips"><h3>🧠 记忆要点 & 学习方法</h3><ul>'
        + (def.tips || []).map(function (t) { return '<li>' + esc(t) + '</li>'; }).join('') + '</ul></div>';
      html += groups.map(function (g, gi) {
        return '<div class="kw-section">'
          + '<div class="kw-section-head" onclick="toggleKwSec(this)">'
          + '<h3>' + esc(g.tag) + '</h3><span class="kw-count">' + g.facts.length + '个核心知识点 ›</span></div>'
          + '<div class="kw-section-body"' + (gi === 0 ? '' : ' style="display:none"') + '>'
          + g.facts.map(function (f) {
            return '<div class="kw-point"><div class="kw-term">' + esc(f.t) + '</div>'
              + '<div class="kw-def">' + esc(f.d) + '</div></div>';
          }).join('')
          + '<a class="kw-more" href="' + bingUrl(m.name + ' ' + g.tag + ' 重点知识') + '" target="_blank">🔍 联网搜索“' + esc(g.tag) + '”更多资料</a>'
          + '</div></div>';
      }).join('');
      $('knowledgeWrap').innerHTML = html;
    });
  }
  window.toggleKwSec = function (head) {
    var body = head.nextElementSibling;
    body.style.display = body.style.display === 'none' ? 'block' : 'none';
  };
  window.searchCourseNet = function () {
    var m = metaOf(ctx.id);
    searchNet(m.name + ' 知识点总结 期末复习');
  };

  /* ================================================================
   * 我的整理：列表 / 添加（手写 / 拍照）/ 详情
   * ================================================================ */
  window.closeAddNoteSheet = function (e) {
    if (e && e.target !== e.currentTarget) return;
    $('addNoteSheetMask').classList.add('hidden');
  };
  window.chooseAddNote = function (mode) {
    closeAddNoteSheet();
    location.hash = '#/note-edit/' + ctx.id + '/' + mode;
  };

  function openNotesList(cid) {
    ctx.id = cid;
    showView('viewNotes');
    renderNotesVideoBanner(cid);
    var wrap = $('notesListWrap');
    wrap.innerHTML = '<div class="mine-empty">加载中…</div>';
    revokePool();
    $('noteAddBtn').onclick = function () { $('addNoteSheetMask').classList.remove('hidden'); };
    dbAll('notes').then(function (all) {
      var list = all.filter(function (n) { return String(n.cid) === String(cid); })
        .sort(function (a, b) { return b.ts - a.ts; });
      if (!list.length) {
        wrap.innerHTML = '<div class="mine-empty">还没有整理内容<br>点击右下角 ＋ 添加第一条知识吧</div>';
        return;
      }
      wrap.innerHTML = list.map(function (n) {
        var title = n.title || ('📷 拍照笔记' + (n.imgs && n.imgs.length ? '（' + n.imgs.length + '张）' : ''));
        var snippet = n.body || ((n.imgs && n.imgs.length) ? '包含 ' + n.imgs.length + ' 张图片，点击查看' : '');
        var thumbs = (n.imgs || []).slice(0, 4).map(function (im) {
          var u = imgSrcOf(im);
          return u ? '<img src="' + u + '" alt="">' : '';
        }).join('');
        return '<div class="note-card" role="button" tabindex="0" data-nid="' + n.id + '" data-cid="' + esc('' + cid) + '">'
          + '<div class="nc-top"><div class="nc-title">' + esc(title) + '</div>'
          + '<span class="nc-badge ' + (n.kind === 'hand' ? 'hand' : 'photo') + '">' + (n.kind === 'hand' ? '手写' : '拍照') + '</span></div>'
          + (snippet ? '<div class="nc-snippet">' + esc(snippet) + '</div>' : '')
          + (thumbs ? '<div class="nc-thumbs">' + thumbs + '</div>' : '')
          + '<div class="nc-foot"><div class="nc-time">🕒 ' + fmtFull(n.ts) + '</div>'
          + '<div class="nc-actions">'
          + '<button class="nc-act nc-edit" type="button" data-edit="' + n.id + '">✏️ 修改</button>'
          + '<button class="nc-act nc-del" type="button" data-del="' + n.id + '">🗑 删除</button>'
          + '</div></div>'
          + '</div>';
      }).join('');
    }).catch(function () {
      wrap.innerHTML = '<div class="mine-empty">本机存储不可用，请通过本地服务器或APK打开</div>';
    });
  }

  function openNoteEditor(cid, mode, editId) {
    ctx.id = cid;
    revokeEditorUrls();
    if (editId) {
      // 修改模式：读取原笔记并预填
      showView('viewNoteEdit');
      $('noteEditWrap').innerHTML = '<div class="mine-empty">加载中…</div>';
      dbGet('notes', editId).then(function (n) {
        if (!n || String(n.cid) !== String(cid)) {
          $('noteEditWrap').innerHTML = '<div class="mine-empty">内容不存在或已被移除</div>';
          return;
        }
        editState = {
          cid: cid, mode: n.kind || mode, editId: Number(n.id), ts: n.ts,
          files: (n.imgs || []).map(function (im) { return im.data || ''; })
            .filter(function (d) { return d && d.indexOf('data:image/') === 0; }),
          title: n.title || '', body: n.body || ''
        };
        renderNoteEditor();
      }).catch(function () {
        $('noteEditWrap').innerHTML = '<div class="mine-empty">读取失败</div>';
      });
      return;
    }
    editState = { cid: cid, mode: mode, files: [], title: '', body: '' };
    showView('viewNoteEdit');
    renderNoteEditor();
  }
  window.backFromEditor = function () {
    if (editState && !editState.editId && (editState.title || editState.body || editState.files.length)) {
      if (!confirm('当前内容尚未提交，退出后将丢失，确定返回吗？')) return;
    }
    revokeEditorUrls();
    editState = null;
    location.hash = '#/notes/' + ctx.id;
  };

  function renderNoteEditor() {
    $('noteEditTitle').textContent = editState.editId
      ? ('修改整理 · ' + (editState.mode === 'hand' ? '手写' : '拍照'))
      : (editState.mode === 'hand' ? '手写整理' : '拍照 / 相册');
    var mediaBtns =
      '<button class="btn-camera" type="button" onclick="editorPick(\'camera\')">📷 拍照</button>'
      + '<button class="btn-album" type="button" onclick="editorPick(\'album\')">🖼 相册</button>';

    var html = '';
    if (editState.mode === 'hand') {
      html += '<div class="ne-card">'
        + '<input class="ne-title-input" id="neTitle" maxlength="40" placeholder="标题（必填，加粗显示）" value="' + esc(editState.title) + '">'
        + '<textarea class="ne-body-input" id="neBody" placeholder="正文：把知识点全部写进来吧（必填）">' + esc(editState.body) + '</textarea>'
        + '<div class="ne-img-add"><span class="ne-add-label">添加图片（选做，最多5张）</span>' + mediaBtns + '</div>'
        + '<div class="ne-thumbs" id="neThumbs"></div>'
        + '</div>';
    } else {
      html += '<div class="ne-photo-hint">点击下方按钮拍摄，或从相册选择图片<br>（每次最多5张，原图保存）</div>'
        + '<div class="ne-card" style="margin-top:12px"><div class="ne-img-add" style="border:none;padding-top:0;margin-top:0">'
        + '<span class="ne-add-label">选择图片（至少1张才能提交）</span>' + mediaBtns + '</div>'
        + '<div class="ne-thumbs" id="neThumbs"></div></div>';
    }
    html += '<div class="ne-submit-bar"><button class="ne-submit" id="neSubmit" type="button">提交</button></div>';
    $('noteEditWrap').innerHTML = html;

    var titleEl = $('neTitle'), bodyEl = $('neBody');
    if (titleEl) titleEl.addEventListener('input', function () { editState.title = titleEl.value; refreshSubmitState(); });
    if (bodyEl) bodyEl.addEventListener('input', function () { editState.body = bodyEl.value; refreshSubmitState(); });
    $('neSubmit').addEventListener('click', submitNote);
    refreshEditorThumbs();
    refreshSubmitState();
  }
  function refreshSubmitState() {
    var btn = $('neSubmit');
    if (!btn || !editState) return;
    var ok = editState.mode === 'hand'
      ? (editState.title.trim() && editState.body.trim())
      : editState.files.length > 0;
    btn.disabled = !ok;
    var act = editState.editId ? '保存修改' : '提 交';
    btn.textContent = editState.mode === 'hand'
      ? (ok ? act : '填写标题和正文后可提交')
      : (ok ? act + '（' + editState.files.length + '张）' : '请先选择至少1张图片');
  }
  function refreshEditorThumbs() {
    var box = $('neThumbs');
    if (!box) return;
    revokeEditorUrls();
    box.innerHTML = editState.files.map(function (f, i) {
      // dataURL字符串直接作为src；兼容遗留Blob引用
      var u = typeof f === 'string' ? f : (function () { var x = URL.createObjectURL(f); editorUrls.push(x); return x; })();
      return '<div class="ne-thumb"><img src="' + u + '" alt=""><button class="ne-thumb-del" type="button" onclick="removeEditorImg(' + i + ')">×</button></div>';
    }).join('');
  }
  function revokeEditorUrls() {
    editorUrls.forEach(function (u) { try { URL.revokeObjectURL(u); } catch (e) {} });
    editorUrls = [];
  }
  window.removeEditorImg = function (i) {
    editState.files.splice(i, 1);
    refreshEditorThumbs();
    refreshSubmitState();
  };
  window.editorPick = function (source) {
    pickerTarget = 'note';
    if (source === 'camera') askCamera();
    else $('albumInput').click();
  };
  function submitNote() {
    if (!editState) return;
    if (editState.mode === 'hand') {
      if (!editState.title.trim() || !editState.body.trim()) { toast('标题和正文都必须填写'); return; }
    } else if (!editState.files.length) { toast('请至少选择1张图片'); return; }
    var note = {
      cid: editState.cid,
      kind: editState.mode === 'hand' ? 'hand' : 'photo',
      title: editState.mode === 'hand' ? editState.title.trim() : '',
      body: editState.mode === 'hand' ? editState.body.trim() : '',
      ts: editState.editId ? editState.ts : Date.now(),
      imgs: editState.files.map(function (d) { return { data: d, name: 'photo.jpg' }; })
    };
    var backCid = editState.cid, editing = editState.editId;
    var saving = editing
      ? dbPut('notes', Object.assign({ id: editing }, note))
      : dbAdd('notes', note);
    saving.then(function () {
      revokeEditorUrls();
      editState = null;
      toast(editing ? '修改已保存' : '已保存到我的整理');
      location.hash = '#/notes/' + backCid;   // 返回列表并自动刷新
    }).catch(function () { toast('保存失败：本机存储空间不足或不可用'); });
  }

  function openNoteDetail(cid, nid) {
    ctx.id = cid;
    showView('viewNoteDetail');
    $('noteDetailWrap').innerHTML = '<div class="mine-empty">加载中…</div>';
    revokePool();
    $('noteDetailBack').onclick = function () { location.hash = '#/notes/' + cid; };
    dbGet('notes', nid).then(function (n) {
      if (!n || String(n.cid) !== String(cid)) {
        $('noteDetailWrap').innerHTML = '<div class="mine-empty">内容不存在或已被移除</div>';
        return;
      }
      var title = n.title || '📷 拍照笔记';
      var imgs = (n.imgs || []).map(function (im) {
        var u = imgSrcOf(im);
        return u ? '<img src="' + u + '" data-viewurl="' + u + '" alt="笔记图片">' : '';
      }).join('');
      $('noteDetailWrap').innerHTML =
        '<div class="nd-card">'
        + '<div class="nd-title">' + esc(title) + '</div>'
        + '<div class="nd-time">🕒 ' + fmtFull(n.ts) + '</div>'
        + (n.body ? '<div class="nd-body">' + esc(n.body) + '</div>' : '')
        + (imgs ? '<div class="nd-imgs">' + imgs
          + '<div class="nd-tip">点击图片可放大：手机双指缩放（最大100倍），电脑滚轮缩放，点击空白退出</div></div>'
          : '<div class="nd-tip" style="margin-top:14px">本条为纯文字笔记</div>')
        + '</div>';
    }).catch(function () {
      $('noteDetailWrap').innerHTML = '<div class="mine-empty">读取失败</div>';
    });
  }

  /* ================================================================
   * 功能一：视频学习（B站视频 + 边看边记笔记）
   * 数据：localStorage 'uh_vnotes'，结构 { [cid]: [{id, ts, text}] }
   * ================================================================ */
  function vnLoad(cid) {
    try { var all = JSON.parse(localStorage.getItem('uh_vnotes')) || {}; return all[cid] || []; }
    catch (e) { return []; }
  }
  function vnSave(cid, list) {
    try {
      var all = JSON.parse(localStorage.getItem('uh_vnotes')) || {};
      all[cid] = list;
      localStorage.setItem('uh_vnotes', JSON.stringify(all));
    } catch (e) {}
  }
  window.openVideo = function () { location.hash = '#/video/' + ctx.id; };
  window.goVideoNotes = function () { location.hash = '#/notes/' + ctx.id; };

  /* ---------------- 视频学习（多视频 + 分P连续播放） ---------------- */
  var vdState = { list: [], vi: -1, curP: 1, pages: 1, auto: false, isSpace: false };

  /* 解析B站链接 → {bvid} 或 {aid}；无法嵌入（UP主空间等）返回 null */
  function vdPlayerParams(url) {
    var m;
    m = /\/video\/(BV[\w]+)/i.exec(url || '');
    if (m) return { bvid: m[1] };
    m = /\/video\/av(\d+)/i.exec(url || '');
    if (m) return { aid: m[1] };
    return null;
  }
  /* 解析链接中的起始分P（?p=N 或 &p=N） */
  function vdPageFromUrl(url) {
    var m = /[?&]p=(\d+)/.exec(url || '');
    return m ? Math.max(1, parseInt(m[1], 10)) : 1;
  }
  /* 拼接B站播放器地址（分P用 page=N） */
  function vdPlayerSrc(url, page) {
    var p = vdPlayerParams(url);
    if (!p) return null;
    return 'https://player.bilibili.com/player.html?' + (p.bvid ? 'bvid=' + p.bvid : 'aid=' + p.aid)
      + '&page=' + page + '&high_quality=1&danmaku=0';
  }

  function openVideoPage(cid, vi) {
    var m = metaOf(cid);
    if (!m) { location.hash = '#/'; return; }
    ctx.id = cid;
    showView('viewVideo');
    var wrap = $('videoWrap');
    var list = UH.findVideos(cid, m.name);
    if (!list || !list.length) {
      var near = UH.nearVideo(m.name);
      wrap.innerHTML = '<div class="vd-empty">🎬 暂未收录《' + esc(m.name) + '》的配套视频<br>'
        + (near
          ? '<a class="vd-near" href="#/video/' + near.cid + '">推荐相近课程：' + esc(near.v.title) + ' ›</a>'
          : '后续版本将逐步补充，敬请期待')
        + '</div>';
      return;
    }
    // 同科多视频且未指定 → 先展示选择列表，可点任意视频播放
    if (list.length > 1 && (vi == null || vi < 0 || vi >= list.length)) {
      renderVideoList(cid, m, list);
      return;
    }
    var idx = (vi != null && vi >= 0 && vi < list.length) ? vi : 0;
    renderVideoPlayer(cid, m, list, idx);
  }

  /* 视频选择列表：卡片展示标题/备注/hot 推荐标记 */
  function renderVideoList(cid, m, list) {
    vdState = { list: list, vi: -1, curP: 1, pages: 1, auto: false, isSpace: false };
    var wrap = $('videoWrap');
    wrap.innerHTML = '<div class="vd-card"><div class="vd-title">《' + esc(m.name) + '》精选视频</div>'
      + '<div class="vd-sub">共 ' + list.length + ' 个视频，点击即可播放</div></div>'
      + '<div class="vd-list">' + list.map(function (v, i) {
        return '<div class="vd-item" onclick="location.hash=\'#/video/' + cid + '/' + i + '\'">'
          + '<div class="vd-item-top">' + (v.hot === 1 ? '<span class="vd-tag-hot">🔥 推荐</span>' : '')
          + '<span class="vd-item-no">' + (i + 1) + '</span></div>'
          + '<div class="vd-item-title">' + esc(v.title) + '</div>'
          + (v.note ? '<div class="vd-item-note">' + esc(v.note) + '</div>' : '')
          + '<div class="vd-item-meta">' + (v.pages > 0 ? '共 ' + v.pages + ' 集' : 'UP主空间合集') + '</div>'
          + '</div>';
      }).join('') + '</div>';
    bumpDaily('video');   // 打开视频页即计入今日学习行为
  }

  /* 单个视频播放页：支持分P（下一P/自动连播）、pages=0 直接打开B站 */
  function renderVideoPlayer(cid, m, list, idx) {
    var v = list[idx];
    var wrap = $('videoWrap');
    var multi = list.length > 1;
    var isSpace = v.pages === 0 || !vdPlayerParams(v.url);
    var startP = v.pages > 0 ? Math.min(vdPageFromUrl(v.url), v.pages) : 1;
    vdState = { list: list, vi: idx, curP: startP, pages: v.pages > 0 ? v.pages : 1, auto: false, isSpace: isSpace };

    var html = '';
    if (multi) {
      html += '<div class="vd-back" onclick="location.hash=\'#/video/' + cid + '\'">‹ 切换其他视频</div>';
    }
    if (isSpace) {
      // pages=0 / UP主空间链接：无法内嵌，直接打开B站
      html += '<div class="vd-card"><div class="vd-title">' + esc(v.title) + '</div>'
        + (v.note ? '<div class="vd-note">' + esc(v.note) + '</div>' : '')
        + '<div class="vd-space-tip">该视频为UP主空间合集，无法在页面内嵌播放，已为你准备直接跳转B站观看</div>'
        + '<button class="vd-space-btn" type="button" onclick="window.open(\'' + (v.url || 'https://www.bilibili.com') + '\',\'_blank\')">前往B站观看 ↗</button>'
        + '</div>';
    } else {
      html += '<div class="vd-card">'
        + '<div class="vd-player"><iframe id="vdFrame" src="' + vdPlayerSrc(v.url, startP) + '" scrolling="no" border="0" frameborder="no" framespacing="0" allowfullscreen="true"></iframe></div>'
        + '<div class="vd-meta"><div class="vd-title">' + esc(v.title) + '</div>'
        + '<a class="vd-open" href="' + esc(v.url) + '" target="_blank" rel="noopener">B站原页 ↗</a></div>'
        + (v.note ? '<div class="vd-note">' + esc(v.note) + '</div>' : '');
      if (v.pages > 1) {
        html += '<div class="vd-pbar">'
          + '<span class="vd-pinfo">第 <b id="vdCurP">' + startP + '</b> / ' + v.pages + ' 集</span>'
          + '<button class="vd-pbtn" id="vdNextP" type="button"' + (startP >= v.pages ? ' disabled' : '') + '>⏭ 下一P</button>'
          + '<label class="vd-auto"><input type="checkbox" id="vdAutoNext"> 自动连播</label>'
          + '</div>';
      }
      html += '</div>';
    }
    // 笔记区（保留原功能）
    html += '<div class="vn-composer">'
      + '<h3>📝 边看边记笔记</h3>'
      + '<input class="ne-title-input" id="vnTitle" maxlength="40" placeholder="笔记标题（必填，如：第一章 极限与连续）">'
      + '<textarea id="vnInput" placeholder="记录本段视频的重点知识…（可先点“⏱ 记时间”插入当前播放位置，便于回看）"></textarea>'
      + '<div class="vn-foot">'
      + '<span class="vn-ts">播放定位：<b id="vnPos">00:00</b> <button class="vn-save" style="padding:8px 14px;font-size:12.5px" id="vnMark" type="button">⏱ 记时间</button></span>'
      + '<button class="vn-save" id="vnSave" type="button">保存笔记</button>'
      + '</div></div>'
      + '<div class="vn-list"><h3>🗒 我的视频笔记</h3><div class="vn-count" id="vnCount"></div><div id="vnList"></div></div>';
    wrap.innerHTML = html;

    var vdStart = Date.now();
    bumpDaily('video');   // 打开视频页即计入今日学习行为（简化估算，当天打开过即 video>0）

    // 分P控制：下一P / 自动连播
    var npBtn = $('vdNextP');
    if (npBtn) npBtn.addEventListener('click', function () { vdNextP(); });
    var autoBox = $('vdAutoNext');
    if (autoBox) autoBox.addEventListener('change', function () { vdState.auto = autoBox.checked; });

    $('vnMark').addEventListener('click', function () {
      var sec = Math.floor((Date.now() - vdStart) / 1000);
      var mm = String(Math.floor(sec / 60)).padStart(2, '0');
      var ss = String(sec % 60).padStart(2, '0');
      $('vnPos').textContent = mm + ':' + ss;
      var ta = $('vnInput');
      ta.value = (ta.value ? ta.value + '\n' : '') + '【' + mm + ':' + ss + '】';
      ta.focus();
    });
    $('vnSave').addEventListener('click', function () {
      var tEl = $('vnTitle'), ta = $('vnInput');
      var title = tEl.value.trim();
      var text = ta.value.trim();
      if (!title || !text) { toast('标题和笔记内容都要填写'); return; }
      var saved = vnLoad(cid);
      saved.unshift({ id: Date.now(), ts: Date.now(), title: title, body: text });
      vnSave(cid, saved);
      tEl.value = ''; ta.value = '';
      toast('视频笔记已保存');
      renderVnList(cid);
      bumpDaily('notes');
    });
    renderVnList(cid);
  }

  /* 下一P：拼接 ?p=N+1 连续播放，并更新 P数提示 */
  function vdNextP() {
    var st = vdState;
    if (st.isSpace || st.pages <= 1 || st.curP >= st.pages) return;
    st.curP += 1;
    var fr = $('vdFrame');
    var v = st.list[st.vi];
    if (fr && v) {
      fr.src = vdPlayerSrc(v.url, st.curP);
      var pinfo = $('vdCurP');
      if (pinfo) pinfo.textContent = st.curP;
      var nb = $('vdNextP');
      if (nb) nb.disabled = st.curP >= st.pages;
    }
  }

  /* 自动连播：监听B站播放器 ended 消息，开启自动连播时自动切下一P */
  window.addEventListener('message', function (e) {
    try {
      var d = JSON.parse(e.data);
      if (d && d.info && d.info.type === 'ended' && vdState.auto) vdNextP();
    } catch (err) {}
  });
  function renderVnList(cid) {
    var list = vnLoad(cid);
    var box = $('vnList');
    if (!box) return;
    $('vnCount').textContent = '共 ' + list.length + ' 条';
    if (!list.length) {
      box.innerHTML = '<div class="vn-empty">还没有视频笔记<br>看视频时在下方输入框记录吧</div>';
      return;
    }
    box.innerHTML = list.map(function (n) {
      var body = n.body || n.text || '';
      var m0 = /【(\d{2}:\d{2})】/.exec(body);
      var tag = m0 ? '<span class="vn-tag">⏱ ' + m0[1] + '</span>' : '';
      body = body.replace(/【\d{2}:\d{2}】\s*/, '');
      return '<div class="vn-item"><div class="vn-top">' + tag
        + '<span class="vn-time">' + fmtFull(n.ts) + '</span>'
        + '<button class="vn-del" type="button" data-vndel="' + n.id + '">删除</button></div>'
        + '<div class="vn-title">' + esc(n.title || '未命名笔记') + '</div>'
        + (body ? '<div class="vn-body">' + esc(body) + '</div>' : '')
        + '</div>';
    }).join('');
  }
  document.addEventListener('click', function (e) {
    var d = e.target.closest('[data-vndel]');
    if (!d) return;
    e.stopPropagation();
    var id = Number(d.getAttribute('data-vndel'));
    var list = vnLoad(ctx.id).filter(function (n) { return n.id !== id; });
    vnSave(ctx.id, list);
    renderVnList(ctx.id);
    toast('已删除该条视频笔记');
  });
  function renderNotesVideoBanner(cid) {
    var el = $('notesVideoBanner');
    if (!el) return;
    var m = metaOf(cid);
    var v = m && UH.findVideo(cid, m.name);
    if (!v) { el.style.display = 'none'; return; }
    el.style.display = 'flex';
    el.innerHTML = '<span class="nvb-ico">🎬</span>'
      + '<span class="nvb-body"><span class="nvb-title">看视频学《' + esc(m.name) + '》</span>'
      + '<span class="nvb-sub">' + esc(v.title) + ' · UP：' + esc(v.up || 'B站UP主') + '</span></span>'
      + '<span class="nvb-arrow">›</span>';
  }

  /* ================================================================
   * 功能二：每日打卡学习任务
   * 数据：localStorage 'uh_checkin' 打卡记录 { 'YYYY-MM-DD': {ts, extra} }
   *       localStorage 'uh_daily'   学习行为打点 { 'YYYY-MM-DD': {ans, ok, notes, video} }
   * 说明：答题 / 交卷 / 保存视频笔记 / 打开视频页等学习动作自动打点，也可手动打卡
   * ================================================================ */
  /* 打卡日历当前查看的年月（默认本月，可经年月选择器切换） */
  var ckView = (function () { var d = new Date(); return { y: d.getFullYear(), m: d.getMonth() + 1 }; })();
  function dailyKey(d) {
    var dt = d || new Date();
    return dt.getFullYear() + '-' + String(dt.getMonth() + 1).padStart(2, '0') + '-' + String(dt.getDate()).padStart(2, '0');
  }
  /* 打卡记录：uh_checkin = { 'YYYY-MM-DD': {ts, extra} } */
  function loadCheckin() {
    try { return JSON.parse(localStorage.getItem('uh_checkin')) || {}; } catch (e) { return {}; }
  }
  function saveCheckin(o) { try { localStorage.setItem('uh_checkin', JSON.stringify(o)); } catch (e) {} }
  /* 学习行为打点：uh_daily = { 'YYYY-MM-DD': {ans, ok, notes, video} } */
  function loadDaily() {
    try { return JSON.parse(localStorage.getItem('uh_daily')) || {}; } catch (e) { return {}; }
  }
  function saveDaily(o) { try { localStorage.setItem('uh_daily', JSON.stringify(o)); } catch (e) {} }
  function checkinStats(y, m) {
    var o = loadCheckin();
    var keys = Object.keys(o).sort();
    var streak = 0;
    var cursor = new Date();
    if (!o[dailyKey(cursor)]) cursor.setDate(cursor.getDate() - 1);  // 今天未打卡则从昨天起算
    for (var i = keys.length - 1; i >= 0; i--) {
      if (keys[i] === dailyKey(cursor)) { streak++; cursor.setDate(cursor.getDate() - 1); }
      else break;
    }
    var todayKey = dailyKey();
    var done = !!o[todayKey];
    /* 日历（周一开头），默认本月；年月选择器可切换查看任意月 */
    var cy = y || ckView.y, cm = m || ckView.m;
    var first = new Date(cy, cm - 1, 1);
    var lead = (first.getDay() + 6) % 7;
    var daysInMonth = new Date(cy, cm, 0).getDate();
    var cells = [];
    for (var p = 0; p < lead; p++) cells.push({ empty: true });
    for (var day = 1; day <= daysInMonth; day++) {
      var kk = cy + '-' + pad2(cm) + '-' + pad2(day);
      cells.push({ key: kk, day: day, on: !!o[kk], today: kk === todayKey, future: kk > todayKey });
    }
    return { o: o, total: keys.length, streak: streak, done: done, todayKey: todayKey, cells: cells };
  }
  window.bumpDaily = function (kind, ok) {
    var dl = loadDaily();
    var k = dailyKey();
    var rec = dl[k] || { ans: 0, ok: 0, notes: 0, video: 0 };
    if (kind === 'q') { rec.ans++; if (ok) rec.ok++; }
    else if (kind === 'notes') rec.notes++;
    else if (kind === 'video') rec.video++;
    dl[k] = rec;
    saveDaily(dl);
  };
  window.goCheckin = function () { location.hash = '#/checkin'; };
  window.backFromCheckin = function () { location.hash = '#/'; };
  window.doCheckinNow = function () {
    var dl = loadDaily();
    var todayD = dl[dailyKey()] || { ans: 0, ok: 0, notes: 0, video: 0 };
    var has = todayD.ans > 0 || todayD.notes > 0 || todayD.video > 0;
    function commit() {
      var o = loadCheckin();
      o[dailyKey()] = { ts: Date.now(), extra: has ? '有学习记录' : '手动补卡' };
      saveCheckin(o);
      toast('打卡成功，继续保持！');
      renderCheckin();
      renderHeroCheckin();
    }
    if (has) { commit(); return; }
    if (confirm('今天还没有学习记录（未做题 / 未记笔记 / 未看视频），确定要打卡吗？')) commit();
  };
  function openCheckinPage() {
    showView('viewCheckin');
    renderCheckin();
  }
  function renderCheckin() {
    var st = checkinStats(ckView.y, ckView.m);
    var wrap = $('checkinWrap');
    var now = new Date();
    var todayTxt = (now.getMonth() + 1) + '月' + now.getDate() + '日 周' + '日一二三四五六'[now.getDay()];
    var heads = ['一', '二', '三', '四', '五', '六', '日'].map(function (h) { return '<div class="ck-dow">' + h + '</div>'; }).join('');
    var cal = st.cells.map(function (c) {
      if (c.empty) return '<div class="ck-day empty"></div>';
      var cls = 'ck-day' + (c.on ? ' on' : '') + (c.today ? ' today' : '') + (c.future ? ' future' : '');
      return '<div class="' + cls + '">' + c.day + (c.on ? '<i class="ck-dot"></i>' : '') + '</div>';
    }).join('');
    var rec = loadDaily()[dailyKey()] || {};
    var dlTxt = [];
    if (rec.ans) dlTxt.push('答题 ' + rec.ans + ' 题（对 ' + (rec.ok || 0) + '）');
    if (rec.notes) dlTxt.push('笔记 ' + rec.notes + ' 条');
    if (rec.video) dlTxt.push('看过视频');
    var statusHtml = st.done
      ? '<div class="ck-status"><span class="ck-emoji">🎉</span><div class="ck-today-txt">今日已打卡</div>'
        + '<div class="ck-sub">' + todayTxt + (dlTxt.length ? ' · ' + dlTxt.join('，') : '') + '<br>坚持就是胜利，明天继续！</div></div>'
        + '<button class="ck-do-btn done" type="button">✅ 今日已打卡</button>'
      : '<div class="ck-status"><span class="ck-emoji">📅</span><div class="ck-today-txt">今天还没打卡</div>'
        + '<div class="ck-sub">' + todayTxt + '<br>完成任意学习动作（看视频 / 记笔记 / 答题）即可满足打卡条件<br>也可以直接点下方按钮打卡</div></div>'
        + '<button class="ck-do-btn" type="button" onclick="doCheckinNow()">立即打卡</button>';
    var stats = '<div class="ck-card"><h3>📊 打卡统计</h3><div class="ck-stats">'
      + '<div class="ck-stat"><b>' + st.total + '</b><span>累计打卡</span></div>'
      + '<div class="ck-stat"><b>' + st.streak + '</b><span>连续打卡</span></div>'
      + '<div class="ck-stat"><b>' + (st.done ? '✓' : '待') + '</b><span>今日状态</span></div>'
      + '</div></div>';
    var monthHtml = '<div class="ck-card"><div class="ck-cal-head"><h3>🗓 打卡日历</h3>'
      + '<button class="ck-month-btn" type="button" onclick="openCkPicker()">' + ckView.y + '年' + ckView.m + '月 ▾</button></div>'
      + '<div class="ck-cal">' + heads + cal + '</div>'
      + '<div class="ck-tip" style="margin-top:12px">💡 每日目标：观看1段视频并记录1条笔记，或完成10道练习，即为高质量打卡。</div></div>';
    var histKeys = Object.keys(st.o).sort().reverse().slice(0, 7);
    var hist = histKeys.map(function (k) {
      var d = loadDaily()[k];
      var parts = [];
      if (d) {
        if (d.ans) parts.push('答题' + d.ans + '题');
        if (d.notes) parts.push('笔记' + d.notes + '条');
        if (d.video) parts.push('视频');
      }
      if (!parts.length) parts.push('打卡');
      return '<div class="vn-item"><div class="vn-top"><span class="vn-tag">' + k + '</span>'
        + '<span class="vn-time">' + parts.join(' · ') + '</span></div></div>';
    }).join('');
    var histHtml = '<div class="ck-card"><h3>🕐 最近打卡记录</h3>'
      + (hist || '<div class="vn-empty">还没有打卡记录，开始今天的第一项学习吧</div>') + '</div>';
    wrap.innerHTML = '<div class="ck-card">' + statusHtml + '</div>' + stats + monthHtml + histHtml;
  }

  /* 打卡日历：年月分层选择器（点按钮 → 先选年份 → 再选月份 → 展示该月打卡情况） */
  window.openCkPicker = function () {
    var mask = $('ckPickMask');
    if (!mask) {
      mask = document.createElement('div');
      mask.id = 'ckPickMask';
      mask.className = 'ck-pick-mask hidden';
      mask.addEventListener('click', function (e) {
        if (e.target === mask) closeCkPicker();
      });
      document.body.appendChild(mask);
    }
    var nowY = new Date().getFullYear();
    var years = [];
    for (var i = nowY - 2; i <= nowY + 2; i++) years.push(i);
    var yHtml = years.map(function (y) {
      return '<button class="ck-pick-cell' + (y === ckView.y ? ' cur' : '') + '" type="button" data-y="' + y + '">' + y + '年</button>';
    }).join('');
    mask.innerHTML = '<div class="ck-pick-panel">'
      + '<div class="ck-pick-head"><b>选择年份</b><button class="ck-pick-close" type="button" onclick="closeCkPicker()">✕</button></div>'
      + '<div class="ck-pick-grid">' + yHtml + '</div>'
      + '<button class="ck-pick-now" type="button" onclick="ckGoNow()">回到本月</button>'
      + '</div>';
    mask.querySelectorAll('.ck-pick-cell').forEach(function (el) {
      el.addEventListener('click', function () {
        renderCkPickerMonths(mask, parseInt(el.getAttribute('data-y'), 10));
      });
    });
    mask.classList.remove('hidden');
  };
  window.closeCkPicker = function () {
    var mask = $('ckPickMask');
    if (mask) mask.classList.add('hidden');
  };
  window.ckGoNow = function () {
    var d = new Date();
    ckView.y = d.getFullYear();
    ckView.m = d.getMonth() + 1;
    closeCkPicker();
    renderCheckin();
  };
  function renderCkPickerMonths(mask, year) {
    var mHtml = [];
    for (var i = 1; i <= 12; i++) {
      var cur = (year === ckView.y && i === ckView.m);
      mHtml.push('<button class="ck-pick-cell' + (cur ? ' cur' : '') + '" type="button" data-m="' + i + '">' + i + '月</button>');
    }
    mask.innerHTML = '<div class="ck-pick-panel">'
      + '<div class="ck-pick-head"><b>' + year + '年 · 选择月份</b>'
      + '<button class="ck-pick-close" type="button" onclick="closeCkPicker()">✕</button></div>'
      + '<div class="ck-pick-grid">' + mHtml.join('') + '</div>'
      + '<button class="ck-pick-back" type="button" onclick="openCkPicker()">← 重新选年</button>'
      + '</div>';
    mask.querySelectorAll('.ck-pick-cell').forEach(function (el) {
      el.addEventListener('click', function () {
        ckView.y = year;
        ckView.m = parseInt(el.getAttribute('data-m'), 10);
        closeCkPicker();
        renderCheckin();
      });
    });
  }

  /* ================================================================
   * 功能三：智能发现学习情况
   * 数据源：uh_stats（答题统计）/ uh_checkin（打卡）/ uh_vnotes（视频笔记）
   * ================================================================ */
  window.backFromInsight = function () { location.hash = '#/'; };
  function openInsightPage() {
    showView('viewInsight');
    renderInsight();
  }
  function renderInsight() {
    var wrap = $('insightWrap');
    var s = loadStats();
    var allMeta = UH_CATALOG.allMetas();
    var ck = checkinStats();
    var dl = loadDaily();

    var acc = s.ans ? Math.round(s.ok / s.ans * 100) : 0;

    /* 近7天做题趋势（每日 ans） */
    var days = [];
    var now = new Date(); now.setHours(0, 0, 0, 0);
    for (var i = 6; i >= 0; i--) {
      var dd = new Date(now); dd.setDate(now.getDate() - i);
      var k = dailyKey(dd);
      var rec = dl[k] || {};
      days.push({ k: k, cnt: rec.ans || 0, today: i === 0, label: '周' + '日一二三四五六'[dd.getDay()] });
    }
    var maxCnt = 1;
    days.forEach(function (x) { if (x.cnt > maxCnt) maxCnt = x.cnt; });
    var trendHtml = days.map(function (x) {
      var h = Math.max(3, Math.round(x.cnt / maxCnt * 78));
      return '<div class="it-col"><div class="it-num">' + (x.cnt || '') + '</div>'
        + '<div class="it-bar' + (x.cnt > 0 ? ' done' : '') + (x.today ? ' today' : '') + '" style="height:' + h + 'px"></div>'
        + '<div class="it-day">' + x.label + '</div></div>';
    }).join('');

    /* 各科掌握度排行：ok/(ok+wrong)，按正确率升序取TOP5薄弱（点击进入错题重练） */
    var weak = allMeta.map(function (m) {
      var prog = loadProgress(m.id);
      var ks = Object.keys(prog);
      var ok = 0, wrong = 0;
      ks.forEach(function (kk) { if (prog[kk].ok === 1) ok++; else wrong++; });
      if (ok + wrong === 0) return null;
      return { m: m, pct: Math.round(ok / (ok + wrong) * 100), wrong: wrong };
    }).filter(Boolean).sort(function (a, b) { return a.pct - b.pct; }).slice(0, 5);
    var weakHtml = weak.length
      ? weak.map(function (w) {
        return '<button class="in-weak-item" type="button" onclick="location.hash=\'#/practice/' + w.m.id + '/wrong\'">'
          + '<span class="iw-ico" style="background:' + w.m.bg + '">' + w.m.icon + '</span>'
          + '<div class="iw-body"><div class="iw-name">' + esc(w.m.name) + '</div>'
          + '<div class="iw-bar"><i class="iw-fill" style="width:' + w.pct + '%"></i></div></div>'
          + '<span class="iw-pct">' + w.pct + '%<small>错' + w.wrong + '题</small></span></button>';
      }).join('')
      : '<div class="vn-empty">还没有答题数据，先去题库练几题吧</div>';

    /* 智能建议（规则生成） */
    var tips = [];
    if (weak.length && weak[0].wrong > 0) tips.push({ ico: '📝', txt: '建议优先重练《' + esc(weak[0].m.name) + '》的 ' + weak[0].wrong + ' 道错题（点击下方薄弱科目卡片即可进入错题重练）。' });
    if (weak.length) {
      var wv = UH.findVideo(weak[0].m.id, weak[0].m.name);
      if (wv) tips.push({ ico: '🎬', txt: '《' + esc(weak[0].m.name) + '》已匹配到视频《' + esc(wv.title) + '》，建议观看视频巩固基础。' });
    }
    if (ck.streak >= 3) tips.push({ ico: '🔥', txt: '已连续学习 ' + ck.streak + ' 天，保持节奏，习惯正在养成！' });
    if (!ck.done) tips.push({ ico: '⏰', txt: '今天还没有打卡，记得完成学习任务（看视频 / 记笔记 / 答题）。' });
    if (acc > 0 && acc < 60) tips.push({ ico: '📖', txt: '练习正确率仅 ' + acc + '%，偏低，建议先复习该科“重点知识总结”再刷题。' });
    else if (acc >= 85) tips.push({ ico: '🌟', txt: '整体正确率 ' + acc + '%，基础扎实，建议挑战模拟测试检验综合能力。' });
    else if (acc > 0) tips.push({ ico: '📈', txt: '整体正确率 ' + acc + '%，配合“错题重练”稳步提升。' });
    if (s.ans === 0) tips.push({ ico: '🚀', txt: '还没有做题记录，先进入任意课程完成一组题库训练吧。' });

    wrap.innerHTML =
      '<div class="in-card"><h3>📊 学习总览</h3><div class="in-grid">'
      + '<div class="in-stat"><b>' + (s.ans || 0) + '</b><span>累计做题</span></div>'
      + '<div class="in-stat"><b>' + acc + '%</b><span>平均正确率</span></div>'
      + '<div class="in-stat"><b>' + ck.streak + '</b><span>连续打卡(天)</span></div>'
      + '<div class="in-stat"><b>' + ck.total + '</b><span>累计打卡(天)</span></div>'
      + '</div></div>'
      + '<div class="in-card"><h3>📈 近7天做题趋势</h3><div class="in-trend">' + trendHtml + '</div></div>'
      + '<div class="in-card"><h3>⚠️ 薄弱科目排行（点击进入错题重练）</h3>' + weakHtml + '</div>'
      + '<div class="in-card"><h3>💡 智能学习建议</h3>'
      + (tips.map(function (t) { return '<div class="in-tip"><span class="it-ico">' + t.ico + '</span><span>' + t.txt + '</span></div>'; }).join('') || '<div class="vn-empty">暂无建议</div>')
      + '</div>';
  }

  /* 首页打卡快捷条 + 我的页打卡状态角标 */
  function renderHeroCheckin() {
    var el = $('heroCheckinBar');
    if (!el) return;
    var st = checkinStats();
    var todayD = loadDaily()[dailyKey()] || {};
    var todayCnt = (todayD.ans || 0) + (todayD.notes || 0) + (todayD.video ? 1 : 0);
    var sub = st.done
      ? '今日已打卡 · 连续 ' + st.streak + ' 天 · 累计 ' + st.total + ' 天'
      : (todayCnt > 0 ? '今日进行中（' + todayCnt + ' 个学习动作）· 连续 ' + st.streak + ' 天' : '今天还没有学习，点我开始打卡');
    el.innerHTML = '<span class="hcb-ico">' + (st.done ? '🎉' : '📅') + '</span>'
      + '<span class="hcb-body"><span class="hcb-title">' + (st.done ? '今日打卡已完成' : '每日打卡学习任务') + '</span>'
      + '<span class="hcb-sub">' + sub + '</span></span>'
      + '<span class="hcb-arrow">›</span>';
  }
  function renderMineCheckinMini() {
    var el = $('mineCheckinSub');
    if (!el) return;
    var st = checkinStats();
    el.textContent = st.done ? '今日已打卡 ✓ · 连续 ' + st.streak + ' 天' : '今天还未打卡，点我查看';
  }

  /* ================================================================
   * 我的：五边形综合统计 / 错题整理 / 笔记图库
   * ================================================================ */
  function mineStats() {
    var s = loadStats();
    var acc = s.ans ? Math.round(s.ok / s.ans * 100) : 0;
    var diff = s.diffAll ? Math.round(s.diffHit / s.diffAll * 100) : 0;
    var time = s.tCnt ? Math.round(s.tIdxSum / s.tCnt) : 0;
    var subjN = Object.keys(s.subjects).filter(function (k) { return s.subjects[k].ans > 0; }).length;
    var subjTotal = UH_CATALOG.allMetas().length;
    var subj = Math.round(subjN / subjTotal * 100);
    var grade = s.examCnt ? Math.round(s.scoreSum / s.examCnt) : acc;
    return { acc: acc, time: time, subj: subj, subjN: subjN, diff: diff, grade: grade, raw: s };
  }

  function drawPolyRadar(svg, vals, labels, colors) {
    var n = vals.length, cx = 110, cy = 108, R = 70;
    function pt(i, r) {
      var ang = (-90 + 360 / n * i) * Math.PI / 180;
      return [cx + r * Math.cos(ang), cy + r * Math.sin(ang)];
    }
    var html = '';
    [0.2, 0.4, 0.6, 0.8, 1].forEach(function (k) {
      var p = [];
      for (var i = 0; i < n; i++) p.push(pt(i, R * k).join(','));
      html += '<polygon points="' + p.join(' ') + '" fill="none" stroke="#e6e9f4" stroke-width="1"/>';
    });
    for (var a = 0; a < n; a++) {
      var p0 = pt(a, 0), p1 = pt(a, R);
      html += '<line x1="' + p0[0] + '" y1="' + p0[1] + '" x2="' + p1[0] + '" y2="' + p1[1] + '" stroke="#dfe4f2"/>';
    }
    var dp = vals.map(function (v, i) { return pt(i, R * Math.max(0, Math.min(100, v)) / 100).join(','); }).join(' ');
    html += '<polygon points="' + dp + '" fill="rgba(91,110,247,.28)" stroke="#5b6ef7" stroke-width="2"/>';
    vals.forEach(function (v, i) {
      var p = pt(i, R * v / 100);
      html += '<circle cx="' + p[0] + '" cy="' + p[1] + '" r="3.4" fill="' + colors[i] + '"/>';
    });
    for (var b = 0; b < n; b++) {
      var lp = pt(b, R + 19);
      var anchor = Math.abs(lp[0] - cx) < 14 ? 'middle' : (lp[0] < cx ? 'end' : 'start');
      html += '<text x="' + lp[0] + '" y="' + (lp[1] + 4) + '" text-anchor="' + anchor
        + '" font-size="11.5" font-weight="700" fill="' + colors[b] + '">' + labels[b] + ' ' + vals[b] + '%</text>';
    }
    // 动态扩展 viewBox，保证四周标签文字完整显示不被裁剪
    var minX = cx - R, maxX = cx + R, minY = cy - R, maxY = cy + R;
    for (var c = 0; c < n; c++) {
      var lp2 = pt(c, R + 19);
      if (lp2[0] - 84 < minX) minX = lp2[0] - 84;
      if (lp2[0] + 84 > maxX) maxX = lp2[0] + 84;
      if (lp2[1] - 17 < minY) minY = lp2[1] - 17;
      if (lp2[1] + 17 > maxY) maxY = lp2[1] + 17;
    }
    svg.setAttribute('viewBox',
      (minX - 3) + ' ' + (minY - 3) + ' ' + (maxX - minX + 6) + ' ' + (maxY - minY + 6));
    svg.innerHTML = html;
  }

  function renderMine() {
    var u = getUser();
    if (u) applyUser(u);
    var st = mineStats();
    var colors = ['#22c55e', '#3b82f6', '#8b5cf6', '#f59e0b', '#ef4444'];
    var labels = ['准确率', '用时', '学习科目', '难度', '评级认定'];

    // 错题整理（覆盖基础学院与各学院专业全部课程）
    var allMeta = UH_CATALOG.allMetas();
    var wrongs = allMeta.map(function (m, mi) {
      var prog = loadProgress(m.id);
      var n = Object.keys(prog).filter(function (k) { return !prog[k].ok; }).length;
      return { m: m, n: n, bg: BRIGHT[mi % BRIGHT.length] };
    }).filter(function (x) { return x.n > 0; }).sort(function (a, b) { return b.n - a.n; });
    var wrongHtml = wrongs.length
      ? wrongs.map(function (w) {
        return '<button class="mine-wrong-item" type="button" onclick="location.hash=\'#/practice/' + w.m.id + '/wrong\'">'
          + '<span class="mw-ico" style="background:' + w.bg + '">' + w.m.icon + '</span>'
          + '<span class="mw-body"><span class="mw-name">' + esc(w.m.name) + '</span>'
          + '<span class="mw-sub">错题 ' + w.n + ' 道 · 点击进入错题重练</span></span>'
          + '<span class="mw-arrow">›</span></button>';
      }).join('')
      : '<div class="mine-empty">暂时没有错题，继续保持！</div>';

    $('mineBody').innerHTML =
      '<div class="mine-card"><h3>📊 综合能力五边形（实时更新）</h3>'
      + '<svg class="mine-radar-svg" id="mineRadarSvg" viewBox="0 0 220 216"></svg>'
      + '<div class="mine-radar-nums">'
      + '<span><i style="background:#22c55e"></i>准确率 <b>' + st.acc + '%</b></span>'
      + '<span><i style="background:#3b82f6"></i>用时 <b>' + st.time + '%</b></span>'
      + '<span><i style="background:#8b5cf6"></i>学习科目 <b>' + st.subjN + '/' + UH_CATALOG.allMetas().length + '</b></span>'
      + '<span><i style="background:#f59e0b"></i>难度 <b>' + st.diff + '%</b></span>'
      + '<span><i style="background:#ef4444"></i>评级认定 <b>' + st.grade + '%</b></span>'
      + '</div></div>'
      + '<div class="mine-card"><h3>📆 学习计划与智能发现</h3><div class="mine-quick">'
      + '<button class="mine-quick-btn" type="button" onclick="location.hash=\'#/checkin\'">'
      + '<span class="mq-ico">📅</span><span class="mq-name">每日打卡</span><span class="mq-sub" id="mineCheckinSub">坚持学习，连续打卡</span></button>'
      + '<button class="mine-quick-btn alt" type="button" onclick="location.hash=\'#/insight\'">'
      + '<span class="mq-ico">💡</span><span class="mq-name">智能发现</span><span class="mq-sub">学习情况分析与建议</span></button>'
      + '</div></div>'
      + '<div class="mine-card"><h3>❤️ 每科错题整理</h3>' + wrongHtml + '</div>'
      + '<div class="mine-card"><h3>🖼 笔记整理（原图永久保存在本机）</h3>'
      + '<div class="mine-upload-row">'
      + '<button class="btn-camera" type="button" onclick="minePick(\'camera\')">📷 拍照上传</button>'
      + '<button class="btn-album" type="button" onclick="minePick(\'album\')">🖼 相册选择</button>'
      + '</div><div class="gallery-grid" id="galleryGrid"><div class="mine-empty" style="grid-column:1/-1">还没有上传图片</div></div></div>';

    drawPolyRadar($('mineRadarSvg'), [st.acc, st.time, st.subj, st.diff, st.grade], labels, colors);
    loadGallery();
    renderMineCheckinMini();
  }

  function loadGallery() {
    dbAll('gallery').then(function (all) {
      var grid = $('galleryGrid');
      if (!grid) return;
      if (!all.length) { grid.innerHTML = '<div class="mine-empty" style="grid-column:1/-1">还没有上传图片</div>'; return; }
      all.sort(function (a, b) { return b.ts - a.ts; });
      grid.innerHTML = all.map(function (g) {
        var u = imgSrcOf(g);
        if (!u) return '';
        return '<div class="gallery-item">'
          + '<div class="gi-img" data-viewurl="' + u + '"><img src="' + u + '" alt="笔记图片"></div>'
          + '<span class="gi-time">' + fmtFull(g.ts) + '</span>'
          + '<div class="gi-actions">'
          + '<button class="gi-act" type="button" title="修改" data-gedit="' + g.id + '">✏️</button>'
          + '<button class="gi-act" type="button" title="删除" data-gdel="' + g.id + '">🗑</button>'
          + '</div></div>';
      }).join('');
    }).catch(function () {});
  }

  /* 图库：删除 / 修改（拍照或相册替换原图，画质仍为原图保存） */
  var galleryEditId = null;
  window.closeGalleryEditSheet = function (e) {
    if (e && e.target !== e.currentTarget) return;
    $('galleryEditSheetMask').classList.add('hidden');
  };
  window.galleryEditPick = function (source) {
    $('galleryEditSheetMask').classList.add('hidden');
    pickerTarget = 'gEdit:' + galleryEditId;
    if (source === 'camera') askCamera();
    else $('albumInput').click();
  };
  function deleteGallery(id) {
    if (!confirm('确定删除这张图片吗？删除后无法恢复。')) return;
    dbDel('gallery', id).then(function () {
      toast('图片已删除');
      revokePool();
      loadGallery();
    }).catch(function () { toast('删除失败'); });
  }
  function deleteNote(id) {
    if (!confirm('确定删除这条整理吗？删除后无法恢复。')) return;
    dbDel('notes', id).then(function () {
      toast('已删除');
      openNotesList(ctx.id);
    }).catch(function () { toast('删除失败'); });
  }

  window.minePick = function (source) {
    pickerTarget = 'mine';
    if (source === 'camera') askCamera();
    else $('albumInput').click();
  };

  /* ---------------- 相机权限询问 + 文件选择 ---------------- */
  function askCamera() {
    $('camPermMask').classList.remove('hidden');
  }
  $('camAllow').addEventListener('click', function () {
    $('camPermMask').classList.add('hidden');
    // 延迟唤起：部分 WebView 在遮罩隐藏的同一事件栈内立即 click() 会导致相机/选择器不弹出
    setTimeout(function () { $('cameraInput').click(); }, 60);
  });
  $('camDeny').addEventListener('click', function () {
    $('camPermMask').classList.add('hidden');
    toast('已取消相机授权，可改用相册选择');
  });

  function handlePicked(fileList) {
    var files;
    try { files = Array.prototype.slice.call(fileList || []); } catch (e) { files = []; }
    if (!files.length) { toast('未获取到照片，请重试或改用相册选择'); return; }
    files = files.filter(function (f) {
      // 放宽预过滤：部分 WebView 拍照返回 type 为空，交由魔数嗅探 + 解码验证兜底判断
      return /^image\//.test(f.type) || /\.(jpe?g|png|gif|webp|bmp|heic|heif)$/i.test(f.name) || !f.type;
    });
    if (!files.length) { toast('请选择图片文件'); return; }
    if (files.length > 5) { files = files.slice(0, 5); toast('每次最多5张，已自动截取前5张'); }
    toast('正在处理图片…');
    // 统一转为 base64 字符串并验证可解码后再保存（避免手机端 Blob 存储损坏导致乱码）
    Promise.all(files.map(toVerifiedDataUrl)).then(function (results) {
      var urls = results.filter(Boolean);
      var failed = results.length - urls.length;
      if (!urls.length) { toast('图片无法识别（当前设备不支持该格式）'); return; }
      if (failed) toast(failed + ' 张图片格式无法识别，已跳过');
      if (pickerTarget && pickerTarget.indexOf('gEdit:') === 0) {
        var gid = pickerTarget.split(':')[1];
        dbGet('gallery', gid).then(function (g) {
          if (!g) { toast('原图不存在'); return null; }
          g.data = urls[0]; delete g.blob; g.name = 'photo.jpg';
          return dbPut('gallery', g);
        }).then(function (ok) {
          if (ok === null) return;
          toast('图片已替换');
          revokePool();
          loadGallery();
        }).catch(function () { toast('替换失败：本机存储空间不足'); });
        return;
      }
      if (pickerTarget === 'mine') {
        var t0 = Date.now();
        Promise.all(urls.map(function (d, i) {
          return dbAdd('gallery', { ts: t0 + i, data: d, name: 'photo.jpg' });
        })).then(function () {
          toast('已保存 ' + urls.length + ' 张图片');
          revokePool();
          loadGallery();
        }).catch(function () { toast('保存失败：本机存储空间不足'); });
      } else if (pickerTarget === 'note') {
        if (!editState) { toast('编辑器未就绪，请重新打开整理页'); return; }
        var room = 5 - editState.files.length;
        if (room <= 0) { toast('最多只能添加5张图片'); return; }
        var add = urls.slice(0, room);
        if (urls.length > room) toast('最多5张，已选取前' + room + '张');
        editState.files = editState.files.concat(add);
        refreshEditorThumbs();
        refreshSubmitState();
      }
    });
  }
  $('cameraInput').addEventListener('change', function () {
    handlePicked(this.files);
    this.value = '';
  });
  $('albumInput').addEventListener('change', function () {
    handlePicked(this.files);
    this.value = '';
  });

  /* ---------------- 事件委托：笔记卡片 / 图库操作 / 图片放大 ---------------- */
  document.addEventListener('click', function (e) {
    // 我的整理：修改 / 删除
    var nDel = e.target.closest('[data-del]');
    if (nDel) { e.stopPropagation(); deleteNote(nDel.getAttribute('data-del')); return; }
    var nEdit = e.target.closest('[data-edit]');
    if (nEdit) {
      e.stopPropagation();
      var card0 = nEdit.closest('.note-card');
      location.hash = '#/note-edit/' + (card0 ? card0.getAttribute('data-cid') : ctx.id) + '/hand/' + nEdit.getAttribute('data-edit');
      return;
    }
    // 图库：删除 / 修改
    var gDel = e.target.closest('[data-gdel]');
    if (gDel) { e.stopPropagation(); deleteGallery(gDel.getAttribute('data-gdel')); return; }
    var gEdit = e.target.closest('[data-gedit]');
    if (gEdit) {
      e.stopPropagation();
      galleryEditId = gEdit.getAttribute('data-gedit');
      $('galleryEditSheetMask').classList.remove('hidden');
      return;
    }
    var card = e.target.closest('.note-card');
    if (card && !$('viewNotes').classList.contains('hidden')) {
      location.hash = '#/note-detail/' + card.getAttribute('data-cid') + '/' + card.getAttribute('data-nid');
      return;
    }
    var viewable = e.target.closest('[data-viewurl]');
    if (viewable) { openViewer(viewable.getAttribute('data-viewurl')); }
  });

  /* ---------------- 图片全屏查看器（初始完整展示，双指/滚轮，最大100倍） ---------------- */
  var iv = { s: 1, base: 1, x: 0, y: 0, pointers: {}, pinch: null, moved: false, lastTap: 0 };
  function fitIv() {
    var img = $('ivImg'), nw = img.naturalWidth || 1, nh = img.naturalHeight || 1;
    var vw = window.innerWidth, vh = window.innerHeight;
    var pad = 12, hintH = 44;   // 四周留白 + 顶部提示条
    iv.base = Math.min(1, (vw - pad * 2) / nw, (vh - pad * 2 - hintH) / nh);
    iv.s = iv.base;
    iv.x = (vw - iv.s * nw) / 2;
    iv.y = (vh - iv.s * nh) / 2 + hintH / 2;
    applyIv();
  }
  function openViewer(url) {
    var img = $('ivImg');
    $('imgViewer').classList.add('show');
    iv.s = 1; iv.base = 1; iv.x = 0; iv.y = 0; iv.pointers = {}; iv.pinch = null; iv.moved = false;
    img.style.transform = 'translate(-9999px,0) scale(1)';
    img.onload = function () { fitIv(); };
    img.src = url;
    if (img.complete && img.naturalWidth) fitIv();
  }
  function closeViewer() { $('imgViewer').classList.remove('show'); iv.pointers = {}; iv.pinch = null; }
  function applyIv() {
    $('ivImg').style.transform = 'translate(' + iv.x + 'px,' + iv.y + 'px) scale(' + iv.s + ')';
  }
  function clampIv(v) { return Math.max(iv.base, Math.min(100, v)); }
  /* 双击/双指轻点：完整显示 ⇄ 原图大小（再继续可放到100倍） */
  function toggleIvAt(cx, cy) {
    var ns = (Math.abs(iv.s - iv.base) < 0.02 && iv.base < 1) ? 1 : iv.base;
    ns = clampIv(ns);
    var ratio = ns / iv.s;
    iv.x = cx - (cx - iv.x) * ratio;
    iv.y = cy - (cy - iv.y) * ratio;
    iv.s = ns;
    iv.moved = true;
    applyIv();
  }
  $('imgViewer').addEventListener('click', function (e) {
    if (iv.moved) { iv.moved = false; return; }
    if (e.target === $('imgViewer')) closeViewer();
  });
  $('ivImg').addEventListener('wheel', function (e) {
    e.preventDefault();
    var factor = e.deltaY < 0 ? 1.18 : 1 / 1.18;
    var ns = clampIv(iv.s * factor), ratio = ns / iv.s;
    iv.x = e.clientX - (e.clientX - iv.x) * ratio;
    iv.y = e.clientY - (e.clientY - iv.y) * ratio;
    iv.s = ns;
    applyIv();
  }, { passive: false });
  $('ivImg').addEventListener('dblclick', function (e) { toggleIvAt(e.clientX, e.clientY); });
  $('imgViewer').addEventListener('pointerdown', function (e) {
    if (e.target !== $('ivImg')) return;
    iv.pointers[e.pointerId] = { x: e.clientX, y: e.clientY };
    try { $('ivImg').setPointerCapture(e.pointerId); } catch (err) {}
    var keys = Object.keys(iv.pointers);
    if (keys.length === 2) {
      var a = iv.pointers[keys[0]], b = iv.pointers[keys[1]];
      iv.pinch = {
        dist: Math.hypot(a.x - b.x, a.y - b.y) || 1,
        s: iv.s, x: iv.x, y: iv.y,
        mx: (a.x + b.x) / 2, my: (a.y + b.y) / 2
      };
    }
  });
  $('imgViewer').addEventListener('pointermove', function (e) {
    if (!iv.pointers[e.pointerId]) return;
    var prev = iv.pointers[e.pointerId];
    iv.pointers[e.pointerId] = { x: e.clientX, y: e.clientY };
    var keys = Object.keys(iv.pointers);
    if (keys.length === 2 && iv.pinch) {
      var a = iv.pointers[keys[0]], b = iv.pointers[keys[1]];
      var dist = Math.hypot(a.x - b.x, a.y - b.y) || 1;
      var mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
      var ns = clampIv(iv.pinch.s * dist / iv.pinch.dist);
      var ratio = ns / iv.pinch.s;
      iv.x = mx - (iv.pinch.mx - iv.pinch.x) * ratio;
      iv.y = my - (iv.pinch.my - iv.pinch.y) * ratio;
      iv.s = ns;
      iv.moved = true;
      applyIv();
    } else if (keys.length === 1 && !iv.pinch) {
      iv.x += e.clientX - prev.x;
      iv.y += e.clientY - prev.y;
      if (Math.abs(e.clientX - prev.x) + Math.abs(e.clientY - prev.y) > 6) iv.moved = true;
      applyIv();
    }
  });
  function ivUp(e) {
    var wasPinch = !!iv.pinch;
    delete iv.pointers[e.pointerId];
    if (Object.keys(iv.pointers).length < 2) iv.pinch = null;
    // 手机端双击切换：完整显示 ⇄ 原图
    if (!wasPinch && !iv.moved && e.target === $('ivImg')) {
      var now = Date.now();
      if (now - iv.lastTap < 300) {
        toggleIvAt(e.clientX, e.clientY);
        iv.lastTap = 0;
      } else { iv.lastTap = now; }
    }
    if (Math.abs(iv.s - iv.base) < 0.001) {
      var img = $('ivImg');
      iv.x = (window.innerWidth - iv.base * (img.naturalWidth || 1)) / 2;
      iv.y = (window.innerHeight - iv.base * (img.naturalHeight || 1)) / 2 + 22;
      applyIv();
    }
  }
  $('imgViewer').addEventListener('pointerup', ivUp);
  $('imgViewer').addEventListener('pointercancel', ivUp);

  /* ================================================================
   * 题库训练
   * ================================================================ */
  function enterPractice(id, mode) {
    ctx.id = id; ctx.mode = mode;
    loadCourse(id).then(function () {
      bank = UH.getBank(id);
      var prog = loadProgress(id);
      var list;
      if (mode === 'rand') {
        list = UH.shuffle(bank, (Date.now() >>> 0));
      } else if (mode === 'wrong') {
        list = bank.filter(function (q) { return prog[q.no] && !prog[q.no].ok; });
        if (list.length === 0) { toast('暂无错题，先去练习吧～'); setTimeout(function () { location.hash = '#/course/' + id; }, 600); return; }
      } else {
        list = bank;
      }
      practice = { mode: mode, list: list, pos: 0, draft: {} };
      showView('viewPractice');
      $('practiceModeTag').textContent = mode === 'rand' ? '随机练习' : (mode === 'wrong' ? '错题重练' : '顺序练习');
      renderPractice();
    });
  }

  window.practiceMove = function (delta) {
    if (!practice) return;
    var np = practice.pos + delta;
    if (np < 0 || np >= practice.list.length) return;
    practice.pos = np;
    renderPractice();
  };

  function renderPractice() {
    var q = practice.list[practice.pos];
    var prog = loadProgress(ctx.id);
    var saved = prog[q.no];

    $('practicePos').textContent = (practice.pos + 1) + ' / ' + practice.list.length;
    $('practicePrev').disabled = practice.pos === 0;
    $('practiceNext').disabled = practice.pos === practice.list.length - 1;

    $('practiceBody').innerHTML = renderQuestion(q, saved);
  }

  function typeBadge(q) {
    if (q.type === 'multi') return '<span class="q-type-badge multi">多选题</span>';
    if (q.type === 'judge') return '<span class="q-type-badge judge">判断题</span>';
    return '<span class="q-type-badge">单选题</span>';
  }
  function stars(d) { return '★'.repeat(d) + '☆'.repeat(3 - d); }

  /* 渲染题干（练习用，saved=作答记录则锁定并显示结果） */
  function renderQuestion(q, saved) {
    var locked = !!saved;

    var opts = q.o.map(function (text, i) {
      var cls = 'q-option';
      if (locked) {
        cls += ' locked';
        var inSel = Array.isArray(saved.a) ? saved.a.indexOf(i) >= 0 : saved.a === i;
        var isAns = Array.isArray(q.a) ? q.a.indexOf(i) >= 0 : q.a === i;
        if (isAns) cls += ' correct';
        else if (inSel) cls += ' wrong';
      }
      return '<div class="' + cls + '" data-i="' + i + '">'
        + '<span class="opt-key">' + String.fromCharCode(65 + i) + '</span>'
        + '<span>' + esc(text) + '</span></div>';
    }).join('');

    var ansLine = Array.isArray(q.a)
      ? q.a.map(function (i) { return String.fromCharCode(65 + i); }).sort().join('')
      : String.fromCharCode(65 + q.a);

    var result = '';
    if (locked) {
      var ok = saved.ok;
      result = '<div class="q-result show ' + (ok ? 'right' : 'error') + '">'
        + '<div class="q-verdict">' + (ok ? '✔ 回答正确' : '✘ 回答错误') + '</div>'
        + '<div class="q-answer-line">✔ 正确答案：' + ansLine + '　' + esc(answerText(q, q.a)) + '</div>'
        + '<div class="q-explain"><b>解析：</b>' + esc(q.e) + '</div>'
        + '</div>';
    }

    return '<div class="q-card">'
      + '<div class="q-meta">' + typeBadge(q)
      + '<span class="q-diff">' + stars(q.d) + '</span>'
      + '<span class="q-tag">' + esc(q.tag) + '</span>'
      + '<span class="q-tag">第' + q.no + '题</span>'
      + '<span class="q-tag">' + esc(q.src || '') + '</span></div>'
      + '<div class="q-text">' + esc(q.q) + '</div>'
      + '<div class="q-options">' + opts + '</div>'
      + (locked ? result
        : '<div class="q-actions">'
          + '<button class="q-submit" disabled onclick="submitPractice()">提交答案</button>'
          + '<button class="q-search-btn" onclick="searchThisQuestion()">🔍搜题</button>'
          + '</div>'
          + '<div class="q-result"></div>')
      + '</div>';
  }

  /* 选项点击（事件委托：练习与考试共用） */
  document.addEventListener('click', function (e) {
    var opt = e.target.closest('.q-option');
    if (!opt || opt.classList.contains('locked')) return;

    // 考试页作答
    if (!$('viewExam').classList.contains('hidden') && exam) {
      var pos = exam.pos;
      var q = exam.list[pos];
      var i = parseInt(opt.getAttribute('data-i'), 10);
      if (!exam.ans[pos]) exam.ans[pos] = { sel: null };
      if (q.type === 'multi') {
        var arr = Array.isArray(exam.ans[pos].sel) ? exam.ans[pos].sel.slice() : [];
        var at = arr.indexOf(i);
        if (at >= 0) arr.splice(at, 1); else arr.push(i);
        exam.ans[pos].sel = arr;
      } else {
        exam.ans[pos].sel = i;
      }
      exam.ans[pos].ts = exam.ans[pos].ts || (Date.now() - exam.startTs) / 1000;
      paintExamOptions();
      return;
    }

    // 练习页作答（仅暂存，点提交后判分）
    if (!$('viewPractice').classList.contains('hidden') && practice) {
      var card = opt.closest('.q-card');
      if (!card || card.querySelector('.q-result.show')) return;
      var pq = practice.list[practice.pos];
      var pi = parseInt(opt.getAttribute('data-i'), 10);
      if (!practice.draft) practice.draft = {};
      var no = pq.no;
      if (pq.type === 'multi') {
        var pa = practice.draft[no] && Array.isArray(practice.draft[no]) ? practice.draft[no].slice() : [];
        var pat = pa.indexOf(pi);
        if (pat >= 0) pa.splice(pat, 1); else pa.push(pi);
        practice.draft[no] = pa;
      } else {
        practice.draft[no] = pi;
      }
      paintPracticeSelection(card, pq);
    }
  });

  function paintPracticeSelection(card, q) {
    var draft = (practice.draft || {})[q.no];
    card.querySelectorAll('.q-option').forEach(function (el) {
      var i = parseInt(el.getAttribute('data-i'), 10);
      var on = Array.isArray(draft) ? draft.indexOf(i) >= 0 : draft === i;
      el.classList.toggle('selected', !!on);
    });
    var btn = card.querySelector('.q-submit');
    if (btn) {
      var has = Array.isArray(draft) ? draft.length > 0 : draft != null;
      btn.disabled = !has;
      btn.textContent = (q.type === 'multi') ? '提交答案（多选）' : '提交答案';
    }
  }

  window.submitPractice = function () {
    var q = practice.list[practice.pos];
    var sel = (practice.draft || {})[q.no];
    if (sel == null || (Array.isArray(sel) && sel.length === 0)) { toast('请先作答'); return; }
    var ok = isCorrect(q, sel);

    var prog = loadProgress(ctx.id);
    prog[q.no] = { ok: ok ? 1 : 0, a: Array.isArray(sel) ? sel.slice().sort() : sel, ts: Date.now() };
    saveProgress(ctx.id, prog);
    bumpAnswer(ctx.id, q.d, ok);   // 综合五边形实时累计
    bumpDaily('q', ok);   // 每日打卡：完成1题（记录对错）

    renderPractice();
  };

  window.searchThisQuestion = function () {
    var q = practice.list[practice.pos];
    searchNet(metaOf(ctx.id).name + ' ' + q.q);
  };

  /* ================================================================
   * 模拟测试（答题过程不显示能力图，提交后才在结果页展示）
   * ================================================================ */
  function startExamRoute(id) {
    ctx.id = id;
    loadCourse(id).then(function () { beginExam(); });
  }
  window.startExam = function () { location.hash = '#/exam/' + ctx.id; };
  window.exitExam = function () {
    if (!confirm('模拟测试还未提交，退出后本次作答将丢失，确定返回吗？')) return;
    stopExamTimer();
    exam = null;
    location.hash = '#/course/' + ctx.id;
  };

  function beginExam() {
    bank = UH.getBank(ctx.id);
    var list = UH.shuffle(bank, (Date.now() >>> 0)).slice(0, 20);
    exam = {
      list: list,
      pos: 0,
      ans: new Array(20).fill(null),
      startTs: Date.now()
    };
    showView('viewExam');
    renderExam();
    startExamTimer();
  }

  function startExamTimer() {
    stopExamTimer();
    exam.timer = setInterval(function () {
      var sec = Math.floor((Date.now() - exam.startTs) / 1000);
      $('examTimer').textContent = fmtTime(sec);
    }, 500);
  }
  function stopExamTimer() {
    if (exam && exam.timer) { clearInterval(exam.timer); exam.timer = null; }
  }

  window.examMove = function (delta) {
    if (!exam) return;
    var np = exam.pos + delta;
    if (np < 0 || np >= 20) return;
    exam.pos = np;
    renderExam();
  };
  window.examGo = function (p) { exam.pos = p; renderExam(); };
  // 第20题时右侧按钮即为“提交”，其余题为“下一题”
  window.examNextClick = function () {
    if (!exam) return;
    if (exam.pos === 19) submitExam();
    else examMove(1);
  };

  function renderExam() {
    var q = exam.list[exam.pos];
    $('examPos').textContent = (exam.pos + 1) + ' / 20';
    // 第1题不出现“上一题”（占位隐藏，保持中间标题居中）
    $('examPrev').style.visibility = exam.pos === 0 ? 'hidden' : 'visible';
    // 第20题“下一题”变为“提交”
    var nx = $('examNext');
    if (exam.pos === 19) {
      nx.textContent = '提交';
      nx.classList.add('is-submit');
    } else {
      nx.textContent = '下一题';
      nx.classList.remove('is-submit');
    }

    var opts = q.o.map(function (text, i) {
      return '<div class="q-option" data-i="' + i + '"><span class="opt-key">'
        + String.fromCharCode(65 + i) + '</span><span>' + esc(text) + '</span></div>';
    }).join('');

    var dots = exam.list.map(function (_, i) {
      var cls = 'q-dot';
      if (exam.ans[i] && exam.ans[i].sel != null && !(Array.isArray(exam.ans[i].sel) && exam.ans[i].sel.length === 0)) cls += ' done-ok';
      if (i === exam.pos) cls += ' current';
      return '<span class="' + cls + '" onclick="examGo(' + i + ')">' + (i + 1) + '</span>';
    }).join('');

    $('examBody').innerHTML =
      '<div class="q-card">'
      + '<div class="q-meta">' + typeBadge(q)
      + '<span class="q-diff">' + stars(q.d) + '</span>'
      + '<span class="q-tag">' + esc(q.tag) + '</span></div>'
      + '<div class="q-text">' + esc(q.q) + '</div>'
      + '<div class="q-options">' + opts + '</div>'
      + '<div style="font-size:12px;color:#9aa0b5;margin-top:4px">'
      + (q.type === 'multi' ? '提示：多选题，点击多个选项后继续下一题即可' : '提示：答案可随时修改，做完20题后点底部“提交试卷”')
      + '</div></div>'
      + '<div class="q-dot-bar">' + dots + '</div>';

    paintExamOptions();
  }

  function paintExamOptions() {
    var card = $('examBody').querySelector('.q-card');
    if (!card) return;
    var q = exam.list[exam.pos];
    var rec = exam.ans[exam.pos];
    var sel = rec ? rec.sel : null;
    card.querySelectorAll('.q-option').forEach(function (el) {
      var i = parseInt(el.getAttribute('data-i'), 10);
      var on = Array.isArray(sel) ? sel.indexOf(i) >= 0 : sel === i;
      el.classList.toggle('selected', !!on);
    });
    var dots = document.querySelectorAll('#examBody .q-dot');
    dots.forEach(function (d, i) {
      var a = exam.ans[i];
      var has = a && a.sel != null && !(Array.isArray(a.sel) && a.sel.length === 0);
      d.classList.toggle('done-ok', !!has);
    });
  }
  /* ---------------- 交卷统计（三角雷达仅在结果页使用） ---------------- */
  function radarStats() {
    var answered = 0, correct = 0, diffAll = 0, diffHit = 0, timeRatioSum = 0;
    var lastTs = 0;
    exam.list.forEach(function (q, i) {
      diffAll += q.d;
      var a = exam.ans[i];
      if (a && a.sel != null && !(Array.isArray(a.sel) && a.sel.length === 0)) {
        answered++;
        var ok = isCorrect(q, a.sel);
        if (ok) { correct++; diffHit += q.d; }
        var expected = 12 + q.d * 10;
        var nowTs = a.ts || (Date.now() - exam.startTs) / 1000;
        var actual = Math.max(3, nowTs - lastTs);
        lastTs = nowTs;
        timeRatioSum += Math.min(1, expected / actual);
      }
    });
    var acc = answered ? correct / answered * 100 : 0;
    var timePct = answered ? (timeRatioSum / answered) * (answered / 20) * 100 : 0;
    var diffPct = diffAll ? diffHit / diffAll * 100 : 0;
    return {
      answered: answered, correct: correct,
      acc: Math.round(acc), time: Math.round(timePct), diff: Math.round(diffPct)
    };
  }

  /* ---------------- SVG三角雷达（结果总结） ---------------- */
  function drawRadar(svg, acc, time, diff, big) {
    var cx = 100, cy = big ? 108 : 100, R = big ? 78 : 66;
    var ang = [-90, 150, 30];
    function pt(i, r) {
      var rad = ang[i] * Math.PI / 180;
      return [cx + r * Math.cos(rad), cy + r * Math.sin(rad)];
    }
    var vals = [acc, time, diff];
    var html = '';
    [0.25, 0.5, 0.75, 1].forEach(function (k) {
      var p = [0, 1, 2].map(function (i) { return pt(i, R * k).join(','); }).join(' ');
      html += '<polygon points="' + p + '" fill="none" stroke="#e6e9f4" stroke-width="1"/>';
    });
    for (var i = 0; i < 3; i++) {
      var p0 = pt(i, 0), p1 = pt(i, R);
      html += '<line x1="' + p0[0] + '" y1="' + p0[1] + '" x2="' + p1[0] + '" y2="' + p1[1] + '" stroke="#dfe4f2" stroke-width="1"/>';
    }
    var dp = vals.map(function (v, i) { return pt(i, R * Math.max(0, Math.min(100, v)) / 100).join(','); }).join(' ');
    html += '<polygon points="' + dp + '" fill="rgba(91,110,247,.30)" stroke="#5b6ef7" stroke-width="2"/>';
    vals.forEach(function (v, i) {
      var p = pt(i, R * v / 100);
      html += '<circle cx="' + p[0] + '" cy="' + p[1] + '" r="' + (big ? 4 : 3) + '" fill="#5b6ef7"/>';
    });
    var labels = ['准确率', '时间', '难度'];
    var colors = ['#22c55e', '#3b82f6', '#f59e0b'];
    for (var j = 0; j < 3; j++) {
      var lp = pt(j, R + (big ? 20 : 16));
      var anchor = j === 0 ? 'middle' : (j === 1 ? 'end' : 'start');
      html += '<text x="' + lp[0] + '" y="' + (lp[1] + 3) + '" text-anchor="' + anchor
        + '" font-size="' + (big ? 13 : 9.5) + '" font-weight="700" fill="' + colors[j] + '">' + labels[j]
        + (big ? ' ' + vals[j] + '%' : '') + '</text>';
    }
    svg.innerHTML = html;
  }

  /* ---------------- 提交试卷（必须20题全部作答） ---------------- */
  window.submitExam = function () {
    if (!exam) return;
    var unanswered = 0, firstUn = -1;
    exam.ans.forEach(function (a, i) {
      if (!a || a.sel == null || (Array.isArray(a.sel) && a.sel.length === 0)) {
        unanswered++;
        if (firstUn < 0) firstUn = i;
      }
    });
    if (unanswered > 0) {
      toast('还有 ' + unanswered + ' 题未作答，全部完成后才能提交');
      examGo(firstUn);   // 跳到第一道未作的题
      return;
    }
    if (!confirm('确定提交试卷吗？提交后不可修改。')) return;
    stopExamTimer();
    showResult(0);
  };

  function showResult(unanswered) {
    var s = radarStats();
    var totalSec = Math.floor((Date.now() - exam.startTs) / 1000);
    var score = s.correct * 5;

    // 综合统计累计（五边形实时数据）
    var expectedSum = 0;
    exam.list.forEach(function (q, i) {
      var a = exam.ans[i];
      if (a && a.sel != null && !(Array.isArray(a.sel) && a.sel.length === 0)) {
        var ok = isCorrect(q, a.sel);
        bumpAnswer(ctx.id, q.d, ok);
        bumpDaily('q', ok);   // 每日打卡：交卷累计答题与答对
        expectedSum += 12 + q.d * 10;
      }
    });
    var timeIdx = Math.round(Math.min(1, expectedSum / Math.max(1, totalSec)) * 100);
    bumpExam(score, timeIdx);

    // 错题写入练习进度（便于错题重练）
    var prog = loadProgress(ctx.id), updated = false;
    var wrongTags = {};
    var details = exam.list.map(function (q, i) {
      var a = exam.ans[i];
      var sel = a ? a.sel : null;
      var ok = isCorrect(q, sel);
      if (!ok) {
        wrongTags[q.tag] = (wrongTags[q.tag] || 0) + 1;
        if (sel != null && !(Array.isArray(sel) && sel.length === 0)) {
          prog[q.no] = { ok: 0, a: Array.isArray(sel) ? sel.slice().sort() : sel, ts: Date.now() };
          updated = true;
        }
      }
      return { q: q, sel: sel, ok: ok };
    });
    if (updated) saveProgress(ctx.id, prog);

    // 保存最佳成绩
    var rec = loadExamRec(ctx.id);
    if (rec.best == null || score > rec.best) rec.best = score;
    rec.last = { score: score, sec: totalSec, date: Date.now() };
    saveExamRec(ctx.id, rec);

    // 评价
    var level, evalText;
    if (s.acc >= 90) {
      level = '🏆 优秀';
      evalText = '本套试卷你答对了 ' + s.correct + '/20 题，准确率高达 ' + s.acc + '%，说明你对《' + metaOf(ctx.id).name
        + '》的核心概念掌握非常扎实，难题应对能力（难度掌握 ' + s.diff + '%）和答题节奏（时间指数 ' + s.time
        + '%）都很出色。建议保持现有节奏，把剩余少量错题对应知识点再过一遍即可冲击满分。';
    } else if (s.acc >= 80) {
      level = '👍 良好';
      evalText = '你答对了 ' + s.correct + '/20 题，准确率 ' + s.acc + '%，整体知识体系比较完整，但在部分易混概念或难题上还会丢分（难度掌握 '
        + s.diff + '%）。建议针对下方“推荐复习方向”集中突破，做题时注意审题速度与选项辨析。';
    } else if (s.acc >= 70) {
      level = '🙂 中等';
      evalText = '你答对了 ' + s.correct + '/20 题，准确率 ' + s.acc + '%，基础题能拿到分，但中高难度题目（难度掌握 '
        + s.diff + '%）和答题速度（时间指数 ' + s.time + '%）都有提升空间。建议先回顾“重点知识总结”，再配合题库顺序练习夯实基础。';
    } else if (s.acc >= 60) {
      level = '⚠️ 及格边缘';
      evalText = '你答对了 ' + s.correct + '/20 题，准确率 ' + s.acc + '%，处于及格边缘，多个章节存在知识漏洞。建议立刻查看“重点知识总结”中的相关章节，并进入错题重练，直到把本套错题全部做对。';
    } else {
      level = '📚 需要加强';
      evalText = '你只答对了 ' + s.correct + '/20 题，准确率 ' + s.acc + '%，当前对《' + metaOf(ctx.id).name
        + '》的知识掌握还比较薄弱。请不要灰心：建议先通读“重点知识总结”，再用顺序练习从第1题开始逐题刷起，每题认真看解析，坚持一周后再来模拟测试，一定会有明显进步！';
    }

    var reviewTags = Object.keys(wrongTags).sort(function (a, b) { return wrongTags[b] - wrongTags[a]; }).slice(0, 4);

    var detailHtml = details.map(function (d, i) {
      var yourAns = (d.sel == null || (Array.isArray(d.sel) && d.sel.length === 0))
        ? '<span style="color:#9aa0b5">未作答</span>'
        : esc(answerText(d.q, d.sel));
      var rightAns = esc(answerText(d.q, d.q.a));
      return '<div class="res-qitem ' + (d.ok ? 'ok' : 'no') + '">'
        + '<div class="rq-head">' + (d.ok ? '✔' : '✘') + ' 第' + (i + 1) + '题　<span style="color:#6b7186;font-weight:400;font-size:12.5px">[' + esc(d.q.tag) + ']</span></div>'
        + '<div class="rq-detail">题目：' + esc(d.q.q) + '</div>'
        + '<div class="rq-detail">你的答案：' + yourAns + '</div>'
        + '<div class="rq-detail" style="color:#16a34a;font-weight:700">正确答案：' + rightAns + '</div>'
        + '<div class="rq-detail">解析：' + esc(d.q.e) + '</div>'
        + '</div>';
    }).join('');

    $('resultWrap').innerHTML =
      '<div class="res-score-card"><div class="res-score">' + score + '<small>分</small></div>'
      + '<div class="res-score-label">满分100分 · 用时 ' + fmtTime(totalSec) + '</div>'
      + '<div class="res-level">' + level + '</div></div>'
      + '<div class="res-row3">'
      + '<div class="res-mini"><b>' + s.correct + '/20</b><span>答对题数</span></div>'
      + '<div class="res-mini"><b>' + s.acc + '%</b><span>准确率</span></div>'
      + '<div class="res-mini"><b>' + (unanswered) + '</b><span>未作答题数</span></div>'
      + '</div>'
      + '<div class="res-radar-card"><h3>三角能力总结图</h3>'
      + '<svg id="resultRadarSvg" viewBox="0 0 200 190"></svg>'
      + '<div class="radar-legend">'
      + '<span><i style="background:#22c55e"></i>准确率 ' + s.acc + '%</span>'
      + '<span><i style="background:#3b82f6"></i>时间指数 ' + s.time + '%</span>'
      + '<span><i style="background:#f59e0b"></i>难度掌握 ' + s.diff + '%</span>'
      + '</div></div>'
      + '<div class="res-block"><h3>📝 测试总结与评价</h3><div class="res-eval">' + evalText + '</div></div>'
      + '<div class="res-block"><h3>📌 推荐复习方向</h3>'
      + (reviewTags.length
        ? '<div class="res-eval">以下章节/知识点在本次测试中失分最多，建议优先复习：</div>'
          + '<div class="res-review-tags">' + reviewTags.map(function (t) {
            return '<span>⚠ ' + esc(t) + '（失' + wrongTags[t] + '题）</span>';
          }).join('') + '</div>'
        : '<div class="res-eval">全部答对，无需特别补强，继续保持！</div>')
      + '</div>'
      + '<div class="res-block res-qlist"><h3>🔍 逐题详情（' + s.correct + '对' + (20 - s.correct) + '错）</h3>' + detailHtml + '</div>'
      + '<div class="res-actions">'
      + '<button class="res-retry" onclick="location.hash=\'#/exam/' + ctx.id + '\'">再测一次</button>'
      + '<button class="res-home" onclick="location.hash=\'#/course/' + ctx.id + '\'">返回课程</button>'
      + '</div>';

    showView('viewResult');
    drawRadar($('resultRadarSvg'), s.acc, s.time, s.diff, true);
  }

  /* ================================================================
   * AI 智能问答 + AI 建题训练（智谱 GLM，纯前端直连）
   * ================================================================ */
  function aiTypeBadge(q) {
    if (q.type === 'multi') return '<span class="q-type-badge multi">多选题</span>';
    if (q.type === 'judge') return '<span class="q-type-badge judge">判断题</span>';
    if (q.type === 'short') return '<span class="q-type-badge" style="background:#e6fdf3;color:#0d9f6e">简答题</span>';
    if (q.type === 'long') return '<span class="q-type-badge" style="background:#fff3e8;color:#e07b39">大题</span>';
    return '<span class="q-type-badge">单选题</span>';
  }
  /* ---------------- AI 基础能力 ---------------- */
  function glmChat(messages, opts) {
    opts = opts || {};
    return fetch(ZHIPU_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + ZHIPU_KEY },
      body: JSON.stringify({
        model: opts.model || ZHIPU_MODEL,
        messages: messages,
        temperature: opts.temperature != null ? opts.temperature : 0.7,
        max_tokens: opts.max_tokens || 4096
      })
    }).then(function (r) {
      if (!r.ok) return r.json().then(function (j) { throw new Error((j.error && j.error.message) || ('AI 服务错误 ' + r.status)); });
      return r.json();
    }).then(function (j) {
      if (j.choices && j.choices[0] && j.choices[0].message) return j.choices[0].message.content;
      throw new Error('AI 返回异常');
    });
  }
  function repairJsonText(t) {
    // AI 常在 JSON 字符串里输出 LaTeX 裸反斜杠（\xi \lim \frac 等），导致 JSON 非法。
    // 仅在 JSON.parse 失败时调用：将"反斜杠+字母且后跟字母"修复为字面反斜杠（\\x）。
    return t.replace(/\\([a-zA-Z])(?=[a-zA-Z])/g, '\\\\$1');
  }
  function extractJson(text) {
    var t = String(text || '').trim();
    t = t.replace(/```(?:json)?/gi, '');
    var s = t.indexOf('{'), e = t.lastIndexOf('}');
    if (s < 0 || e <= s) return null;
    var sub = t.slice(s, e + 1);
    try { return JSON.parse(sub); } catch (err) {
      try { return JSON.parse(repairJsonText(sub)); } catch (err2) { return null; }
    }
  }
  /* ---------------- AI 记忆系统 ---------------- */
  var AI_MEMORY_KEY = 'uh_ai_memory';
  var AI_MEMORY_MAX = 20;
  function loadAiMemory() {
    try { return JSON.parse(localStorage.getItem(AI_MEMORY_KEY)) || []; } catch (e) { return []; }
  }
  function saveAiMemory(mem) {
    try { localStorage.setItem(AI_MEMORY_KEY, JSON.stringify(mem.slice(-AI_MEMORY_MAX))); } catch (e) {}
  }
  function addAiMemory(question, answer) {
    var mem = loadAiMemory();
    var now = new Date();
    var timeStr = now.getFullYear() + '年' + (now.getMonth() + 1) + '月' + now.getDate() + '日 '
      + String(now.getHours()).padStart(2, '0') + ':' + String(now.getMinutes()).padStart(2, '0');
    mem.push({ q: String(question || '').slice(0, 60), a: String(answer || '').slice(0, 120), t: timeStr });
    saveAiMemory(mem);
  }
  function aiMemorySummary() {
    var mem = loadAiMemory();
    if (!mem.length) return '';
    return mem.map(function (it, i) { return (i + 1) + '. [' + it.t + '] 问：' + it.q + ' → 答要点：' + it.a; }).join('\n');
  }
  window.clearAiMemory = function () {
    saveAiMemory([]);
    toast('AI 记忆已清除');
  };
  function buildAiSystemPrompt() {
    var lines = ['你是"大学助手"的 AI 学习导师，已完整掌握大学阶段各学院、各专业、各学科的全部知识体系，并能准确运用它们解答问题：'];
    lines.push('【基础学院】公共核心课：' + UH.META.map(function (m) { return m.name; }).join('、'));
    UH_CATALOG.colleges.forEach(function (col) {
      lines.push('【' + col.n + '】');
      col.m.forEach(function (mj) {
        lines.push('  · ' + mj.n + '：' + mj.k.map(function (k) { return k.n; }).join('、'));
      });
    });
    var cur = metaOf(ctx.id);
    lines.push('回答要求：');
    lines.push('1. 用中文作答，先给出简洁精炼的直接答案（3-5句话以内），再按需分点补充关键信息；');
    lines.push('2. 关键术语和重点结论用**两个星号**包裹突出显示，除此之外回复正文中不得出现星号、井号、减号、反引号等特殊符号；');
    lines.push('3. 回答末尾可自然加一句反问引导深入学习（如"需要我详细讲解吗？"）；当用户明确说"详细/展开/具体讲讲"时，再给出详尽展开讲解；');
    lines.push('4. 若用户提及"之前/上次/刚才/我前面问过"等关联话题，优先结合下方【历史记忆】中的问答记录衔接回答；');
    if (cur) lines.push('5. 当前用户正在学习《' + cur.name + '》，优先围绕该课程回答，也可回答其他课程的问题。');
    var mem = aiMemorySummary();
    if (mem) lines.push('【历史记忆】以下是用户此前问过的问题与回答要点（按时间倒序）：\n' + mem);
    return lines.join('\n');
  }
  /* ---------------- 富文本打字机（15字/秒） ---------------- */
  function stopTypewriter() {
    if (aiTypeTimer) { clearInterval(aiTypeTimer); aiTypeTimer = null; }
  }
  function tokenizeRich(text) {
    var tokens = [];
    var re = /\*\*([^*]+)\*\*/g;
    var last = 0, m;
    function clean(s) { return esc(s.replace(/[*#\-`]/g, '')); }
    while ((m = re.exec(text)) !== null) {
      if (m.index > last) tokens.push({ t: clean(text.slice(last, m.index)), b: false });
      tokens.push({ t: clean(m[1]), b: true });
      last = re.lastIndex;
    }
    if (last < text.length) tokens.push({ t: clean(text.slice(last)), b: false });
    if (!tokens.length) tokens.push({ t: '', b: false });
    return tokens;
  }
  function typewriterInto(el, tokens, done) {
    stopTypewriter();
    el.innerHTML = '';
    var flat = [];
    tokens.forEach(function (tk) { for (var i = 0; i < tk.t.length; i++) flat.push({ c: tk.t[i], b: tk.b }); });
    var pos = 0;
    aiTypeTimer = setInterval(function () {
      if (pos >= flat.length) {
        clearInterval(aiTypeTimer); aiTypeTimer = null;
        el.innerHTML = flat.map(function (p) { return p.b ? '<b>' + p.c + '</b>' : p.c; }).join('');
        if (done) done();
        return;
      }
      el.innerHTML = flat.slice(0, pos + 1).map(function (p) { return p.b ? '<b>' + p.c + '</b>' : p.c; }).join('') + '<span class="tw-caret"></span>';
      pos++;
    }, 1000 / 15);
  }
  /* ---------------- AI 智能问答 ---------------- */
  /* 返回键安全化：有课程 id 回课程页，否则回首页 */
  window.goBackFromAiChat = function () {
    var cid = ctx && ctx.id ? ctx.id : '';
    var target = cid ? '#/knowledge/' + cid : '#/';
    if (location.hash === target) {
      // 进入 AI 问答用的是 showView，hash 未变化时设置相同 hash 不会触发 hashchange，需手动路由
      router();
    } else {
      location.hash = target;
    }
  };
  function openAiChatView(id) {
    ctx.id = id || '';
    stopTypewriter();
    aiChatHist = [];
    showView('viewAiChat');
    var wrap = $('aiChatWrap');
    wrap.innerHTML = '<div class="ai-chat-tip">' + (ctx.id ? '我掌握各学院、各专业、各学科知识，随时为你解答' : '全局 AI 问答：不限定课程，大学阶段所有学科问题都可以问我') + '</div>';
    var mm = addAiMsg('ai', '');
    var bubble = mm.querySelector('.ai-msg-bubble');
    bubble.classList.add('ai-msg-typing');
    typewriterInto(bubble, tokenizeRich('你好，我是大学助手！专门解答你的学习问题！'), function () {
      bubble.classList.remove('ai-msg-typing');
    });
    var inp = $('aiChatInput');
    inp.value = '';
    inp.onkeydown = function (e) {
      if (e.key === 'Enter') { e.preventDefault(); aiChatSend(); }
    };
    inp.focus();
  }
  window.openAiChat = function (id) { openAiChatView(id || ctx.id); };
  window.openGlobalAiChat = function () { openAiChatView(''); };
  function addAiMsg(role, html) {
    var wrap = $('aiChatWrap');
    var div = document.createElement('div');
    div.className = 'ai-msg ' + (role === 'user' ? 'ai-user' : 'ai-ai');
    div.innerHTML = '<div class="ai-msg-avatar">' + (role === 'user' ? '🧑' : '🤖') + '</div>'
      + '<div class="ai-msg-bubble">' + html + '</div>';
    wrap.appendChild(div);
    wrap.scrollTop = wrap.scrollHeight;
    return div;
  }
  function isDetailRequest(v) {
    return /详细|展开|具体讲讲|深入|详细讲|展开讲|多说|讲讲细节|仔细讲讲/.test(v);
  }
  window.aiChatSend = function () {
    var inp = $('aiChatInput');
    var v = inp.value.trim();
    if (!v) return;
    if (aiTypeTimer) stopTypewriter();
    inp.value = '';
    addAiMsg('user', esc(v));
    aiChatHist.push({ role: 'user', content: v });
    if (aiChatHist.length > 10) aiChatHist = aiChatHist.slice(-10);
    var sendBtn = $('aiChatSend');
    sendBtn.disabled = true;
    var mm = addAiMsg('ai', '<span style="color:#9aa0b5">思考中…</span>');
    var bubble = mm.querySelector('.ai-msg-bubble');
    // 检测"详细"等关键词，触发一次详细展开
    var hist = aiChatHist.slice();
    if (isDetailRequest(v)) {
      hist[hist.length - 1] = { role: 'user', content: v + '\n（用户要求详细展开，请给出详尽、深入的讲解）' };
    }
    var messages = [{ role: 'system', content: buildAiSystemPrompt() }].concat(hist);
    glmChat(messages, { temperature: 0.6, max_tokens: 2048 }).then(function (txt) {
      aiChatHist.push({ role: 'assistant', content: txt });
      if (aiChatHist.length > 10) aiChatHist = aiChatHist.slice(-10);
      addAiMemory(v, txt);
      bubble.classList.add('ai-msg-typing');
      bubble.innerHTML = '';
      typewriterInto(bubble, tokenizeRich(txt), function () { bubble.classList.remove('ai-msg-typing'); });
      sendBtn.disabled = false;
    }).catch(function (e) {
      bubble.innerHTML = '<span style="color:#dc2626">' + esc(e.message || 'AI 服务暂时不可用，请稍后重试') + '</span>';
      sendBtn.disabled = false;
    });
  };
  /* ---------------- AI 建题训练 ---------------- */
  window.startAiExam = function () { location.hash = '#/ai-exam/' + ctx.id; };
  function startAiExam(id) {
    id = id || ctx.id;
    ctx.id = id;
    var m = metaOf(id);
    if (!m) { location.hash = '#/'; return; }
    stopAiExamTimer();
    aiExam = null;
    showView('viewAiExam');
    $('aiExamPrev').style.visibility = 'hidden';
    $('aiExamNext').style.visibility = 'hidden';
    $('aiExamTimer').textContent = '00:00';
    var body = $('aiExamBody');
    body.innerHTML = '<div class="ai-exam-loading"><div class="ael-ring"></div>'
      + '<b>AI 正在为《' + esc(m.name) + '》生成20题…</b>'
      + '<div>客观题15道（单选/多选/判断）+ 主观题5道（简答/编程计算）</div></div>';
    var prompt = '你是大学课程出题专家，请为《' + m.name + '》生成一套20题训练试卷。'
      + '题目结构固定：客观题15道（10道单选题 type=single、2道多选题 type=multi、3道判断题 type=judge），主观题5道（2道学科知识点简答 type=short、3道编程或计算大题 type=long）。'
      + '每题必须包含字段：q（题干）、o（选项数组：单选/多选4个选项，判断2个选项["正确","错误"]，主观题不写o）、'
      + 'a（客观题：正确选项下标，多选为下标数组；主观题：写参考标准答案全文）、'
      + 'e（解析：客观题写为什么对为什么错，主观题写评分要点）、d（难度1-3）、tag（所属章节）、type（题型）。'
      + '题目要覆盖该课程核心知识点，难度适中，符合大学期末考核水平。'
      + '只输出一个JSON对象，格式：{"questions":[{"type":"single","q":"...","o":["A","B","C","D"],"a":0,"e":"...","d":2,"tag":"..."}]}，不要输出JSON以外的任何文字。'
      + '重要：JSON字符串内禁止出现反斜杠"\\"字符，数学公式一律用中文或Unicode符号描述（如：极限lim、积分∫、无穷∞、希腊字母ξ、π），否则JSON无法解析。';
    glmChat([{ role: 'user', content: prompt }], { temperature: 0.7, max_tokens: 8192 })
      .then(function (txt) { return normalizeAiExam(txt); })
      .then(function (list) { beginAiExam(list); })
      .catch(function (e) {
        // 偶发波动自动重试一次（共2次机会）
        if (!aiExamRetry) {
          aiExamRetry = 1;
          startAiExam(id);
          return;
        }
        aiExamRetry = 0;
        body.innerHTML = '<div class="ai-exam-loading"><div style="font-size:40px;margin-bottom:10px">😵</div>'
          + '<b>AI 出题失败</b><div style="margin-bottom:16px;color:#9aa0b5">' + esc(e.message || '网络异常，请重试') + '</div>'
          + '<button class="res-retry" style="border:none;padding:12px 30px;border-radius:24px;color:#fff;background:linear-gradient(135deg,#5b6ef7,#7a5cf0);font-weight:800" onclick="location.hash=\'#/ai-exam/' + ctx.id + '\'">重新生成</button></div>';
      });
  }
  function normalizeAiExam(txt) {
    var j = extractJson(txt);
    var qs = j && (Array.isArray(j.questions) ? j.questions
      : (j.exam && Array.isArray(j.exam.questions) ? j.exam.questions
        : (j.data && Array.isArray(j.data.questions) ? j.data.questions : null)));
    if (!qs || !qs.length) return Promise.reject(new Error('AI 返回的题目格式无法解析'));
    var list = qs.slice(0, 20).map(function (q, i) {
      var type = q.type || 'single';
      var norm = {
        no: i + 1, type: type, q: String(q.q || ''), d: Math.min(3, Math.max(1, parseInt(q.d, 10) || 2)),
        tag: String(q.tag || '综合'), e: String(q.e || ''), src: 'AI生成'
      };
      if (type === 'short' || type === 'long') {
        norm.answer = String(q.a || '');
      } else {
        var opts = (q.o || []).map(function (x) { return String(x); });
        if (opts.length < 2) opts = ['正确', '错误'];
        if (type === 'judge' && opts.length !== 2) { opts = ['正确', '错误']; }
        norm.o = opts;
        norm.a = Array.isArray(q.a) ? q.a.map(function (x) { return parseInt(x, 10); }) : parseInt(q.a, 10);
        if (Array.isArray(norm.a)) norm.a = norm.a.filter(function (x) { return x >= 0 && x < opts.length; });
        else if (isNaN(norm.a) || norm.a < 0 || norm.a >= opts.length) norm.a = 0;
      }
      return norm;
    });
    return Promise.resolve(list);
  }
  function beginAiExam(list) {
    aiExam = { list: list, ans: new Array(list.length).fill(null), pos: 0, startTs: Date.now(), timer: null };
    $('aiExamNext').style.visibility = 'visible';
    $('aiExamNext').textContent = '下一题';
    $('aiExamNext').classList.remove('is-submit');
    renderAiExam();
    aiExam.timer = setInterval(function () {
      var sec = Math.floor((Date.now() - aiExam.startTs) / 1000);
      $('aiExamTimer').textContent = fmtTime(sec);
    }, 500);
  }
  function stopAiExamTimer() {
    if (aiExam && aiExam.timer) { clearInterval(aiExam.timer); aiExam.timer = null; }
  }
  window.exitAiExam = function () {
    if (!aiExam) { location.hash = '#/course/' + ctx.id; return; }
    if (!confirm('AI建题训练还未提交，退出后本次作答将丢失，确定返回吗？')) return;
    stopAiExamTimer();
    aiExam = null;
    location.hash = '#/course/' + ctx.id;
  };
  window.aiExamMove = function (delta) {
    if (!aiExam) return;
    var np = aiExam.pos + delta;
    if (np < 0 || np >= aiExam.list.length) return;
    aiExam.pos = np;
    renderAiExam();
  };
  window.aiExamGo = function (p) { if (aiExam) { aiExam.pos = p; renderAiExam(); } };
  window.aiExamNextClick = function () {
    if (!aiExam) return;
    if (aiExam.pos === aiExam.list.length - 1) submitAiExam();
    else aiExamMove(1);
  };
  function aiAnswered(q, a) {
    if (!a) return false;
    if (q.type === 'short' || q.type === 'long') return !!(a.text && a.text.trim());
    return a.sel != null && !(Array.isArray(a.sel) && a.sel.length === 0);
  }
  function renderAiExam() {
    var q = aiExam.list[aiExam.pos];
    $('aiExamPos').textContent = (aiExam.pos + 1) + ' / ' + aiExam.list.length;
    $('aiExamPrev').style.visibility = aiExam.pos === 0 ? 'hidden' : 'visible';
    var nx = $('aiExamNext');
    if (aiExam.pos === aiExam.list.length - 1) { nx.textContent = '提交'; nx.classList.add('is-submit'); }
    else { nx.textContent = '下一题'; nx.classList.remove('is-submit'); }
    var rec = aiExam.ans[aiExam.pos];
    var subj = q.type === 'short' || q.type === 'long';
    var html = '<div class="q-card"><div class="q-meta">' + aiTypeBadge(q)
      + '<span class="q-diff">' + stars(q.d) + '</span><span class="q-tag">' + esc(q.tag) + '</span></div>'
      + '<div class="q-text">' + esc(q.q) + '</div>';
    if (subj) {
      html += '<textarea class="q-textarea" id="aiSubjInput" placeholder="在此输入你的作答…">' + esc(rec && rec.text ? rec.text : '') + '</textarea>'
        + '<div class="q-subj-note">主观题：完成后点击右下角继续作答，全部答完才能提交</div>';
    } else {
      html += '<div class="q-options">' + q.o.map(function (text, i) {
        return '<div class="q-option" data-i="' + i + '"><span class="opt-key">' + String.fromCharCode(65 + i)
          + '</span><span>' + esc(text) + '</span></div>';
      }).join('') + '</div>';
      html += '<div style="font-size:12px;color:#9aa0b5;margin-top:4px">'
        + (q.type === 'multi' ? '提示：多选题，可点选多个选项' : '提示：点击选项作答，可随时修改')
        + '</div>';
    }
    html += '<div class="q-dot-bar">' + aiExam.list.map(function (_, i) {
      var cls = 'q-dot';
      if (aiAnswered(aiExam.list[i], aiExam.ans[i])) cls += ' done-ok';
      if (i === aiExam.pos) cls += ' current';
      return '<span class="' + cls + '" onclick="aiExamGo(' + i + ')">' + (i + 1) + '</span>';
    }).join('') + '</div></div>';
    $('aiExamBody').innerHTML = html;
    if (subj) {
      var ta = $('aiSubjInput');
      if (ta) ta.addEventListener('input', function () {
        if (!aiExam.ans[aiExam.pos]) aiExam.ans[aiExam.pos] = {};
        aiExam.ans[aiExam.pos].text = ta.value;
        refreshAiDots();
      });
    } else {
      var card = $('aiExamBody').querySelector('.q-card');
      var sel = rec ? rec.sel : null;
      card.querySelectorAll('.q-option').forEach(function (el) {
        var i = parseInt(el.getAttribute('data-i'), 10);
        var on = Array.isArray(sel) ? sel.indexOf(i) >= 0 : sel === i;
        el.classList.toggle('selected', !!on);
        el.addEventListener('click', function () { aiPick(i); });
      });
    }
  }
  function aiPick(i) {
    var q = aiExam.list[aiExam.pos];
    if (!aiExam.ans[aiExam.pos]) aiExam.ans[aiExam.pos] = {};
    var rec = aiExam.ans[aiExam.pos];
    if (q.type === 'multi') {
      var arr = Array.isArray(rec.sel) ? rec.sel.slice() : [];
      var at = arr.indexOf(i);
      if (at >= 0) arr.splice(at, 1); else arr.push(i);
      arr.sort(function (a, b) { return a - b; });
      rec.sel = arr;
    } else {
      rec.sel = (rec.sel === i) ? null : i;
    }
    renderAiExam();
  }
  function refreshAiDots() {
    document.querySelectorAll('#aiExamBody .q-dot').forEach(function (d, i) {
      d.classList.toggle('done-ok', aiAnswered(aiExam.list[i], aiExam.ans[i]));
    });
  }
  window.submitAiExam = function () {
    if (!aiExam) return;
    var unanswered = 0, firstUn = -1;
    aiExam.ans.forEach(function (a, i) {
      if (!aiAnswered(aiExam.list[i], a)) { unanswered++; if (firstUn < 0) firstUn = i; }
    });
    if (unanswered > 0) {
      toast('还有 ' + unanswered + ' 题未作答，全部完成后才能提交');
      aiExam.pos = firstUn;
      renderAiExam();
      return;
    }
    if (!confirm('确定提交试卷吗？提交后将进行 AI 判卷，不可再修改。')) return;
    stopAiExamTimer();
    var body = $('aiExamBody');
    body.innerHTML = '<div class="ai-exam-loading"><div class="ael-ring"></div><b>AI 正在判卷…</b><div>客观题自动判分，主观题由 AI 批改</div></div>';
    judgeAiExam();
  };
  function judgeAiExam() {
    var list = aiExam.list, ans = aiExam.ans;
    var subjs = [];
    list.forEach(function (q, i) {
      if (q.type === 'short' || q.type === 'long') {
        subjs.push({ idx: i, type: q.type === 'short' ? '简答题' : '编程/计算大题', q: q.q, answer: ans[i].text, standard: q.answer });
      }
    });
    var p;
    if (subjs.length) {
      var prompt = '你是大学课程阅卷老师（风格自然、贴近真人老师），请批改以下' + subjs.length + '道主观题。判分原则：\n'
        + '1. 按"参考标准答案"的要点逐条比对学生作答，按要点命中率酌情给分：命中90%以上给90-100分，命中60%-90%给60-90分，命中不足60%给低分；\n'
        + '2. 完全空白、乱答、只抄题干或只有个别字词凑巧对上但未构成有效作答的，给0-10分，不要给同情分；\n'
        + '3. 每道题给分必须附简短理由（comment中写明：答对了哪几点、缺了哪几点，用一两句话）；\n'
        + '4. ok取值：1正确（90分以上）、0.5部分正确（30-90分）、0错误（30分以下）；score为0-100整数。\n'
        + '题目与学生作答：\n'
        + subjs.map(function (s, k) { return '第' + (k + 1) + '题【' + s.type + '】\n题目：' + s.q + '\n参考标准答案：' + s.standard + '\n学生作答：' + (s.answer || '（空白）'); }).join('\n\n')
        + '\n只输出一个JSON对象：{"grades":[{"score":80,"ok":1,"comment":"...","standard":"标准答案要点"}]}，不要输出JSON以外的任何文字。';
      p = glmChat([{ role: 'user', content: prompt }], { temperature: 0.3, max_tokens: 4096 }).then(function (txt) {
        var j = extractJson(txt);
        if (!j || !Array.isArray(j.grades)) throw new Error('判卷结果无法解析');
        j.grades.forEach(function (g, k) {
          var s = subjs[k];
          if (!s) return;
          var sc = parseInt(g.score, 10);
          if (isNaN(sc)) sc = 0;
          sc = Math.max(0, Math.min(100, sc));
          var ok = g.ok === 1 ? 1 : (g.ok === 0.5 || g.ok === 0.5 ? 0.5 : (sc >= 60 ? 1 : 0));
          aiExam.ans[s.idx].grade = {
            score: sc, ok: ok,
            comment: String(g.comment || ''), standard: String(g.standard || s.standard || '')
          };
        });
      });
    } else p = Promise.resolve();
    p.then(function () { showAiResult(); }).catch(function (e) {
      var body = $('aiExamBody');
      body.innerHTML = '<div class="ai-exam-loading"><div style="font-size:40px;margin-bottom:10px">😵</div><b>AI 判卷失败</b>'
        + '<div style="margin-bottom:16px;color:#9aa0b5">' + esc(e.message || '网络异常，请重试') + '</div>'
        + '<button class="res-retry" style="border:none;padding:12px 30px;border-radius:24px;color:#fff;background:linear-gradient(135deg,#5b6ef7,#7a5cf0);font-weight:800" onclick="judgeAiExam()">重新判卷</button></div>';
    });
  }
  /* ---------------- AI 建题训练：结果与总结 ---------------- */
  function drawAiRadar(svg, acc, time, diff) {
    var cx = 100, cy = 108, R = 78;
    var ang = [-90, 150, 30];
    function pt(i, r) {
      var rad = ang[i] * Math.PI / 180;
      return [cx + r * Math.cos(rad), cy + r * Math.sin(rad)];
    }
    var vals = [acc, time, diff];
    var html = '';
    [0.25, 0.5, 0.75, 1].forEach(function (k) {
      var p = [0, 1, 2].map(function (i) { return pt(i, R * k).join(','); }).join(' ');
      html += '<polygon points="' + p + '" fill="none" stroke="#e6e9f4" stroke-width="1"/>';
    });
    for (var i = 0; i < 3; i++) {
      var p0 = pt(i, 0), p1 = pt(i, R);
      html += '<line x1="' + p0[0] + '" y1="' + p0[1] + '" x2="' + p1[0] + '" y2="' + p1[1] + '" stroke="#dfe4f2" stroke-width="1"/>';
    }
    var dp = vals.map(function (v, i) { return pt(i, R * Math.max(0, Math.min(100, v)) / 100).join(','); }).join(' ');
    html += '<polygon points="' + dp + '" fill="rgba(13,159,110,.30)" stroke="#0d9f6e" stroke-width="2"/>';
    vals.forEach(function (v, i) {
      var p = pt(i, R * Math.max(0, Math.min(100, v)) / 100);
      html += '<circle cx="' + p[0] + '" cy="' + p[1] + '" r="4" fill="#0d9f6e"/>';
    });
    var labels = ['准确性', '时间', '难度'];
    var colors = ['#22c55e', '#3b82f6', '#f59e0b'];
    for (var j = 0; j < 3; j++) {
      var lp = pt(j, R + 20);
      var anchor = j === 0 ? 'middle' : (j === 1 ? 'end' : 'start');
      html += '<text x="' + lp[0] + '" y="' + (lp[1] + 3) + '" text-anchor="' + anchor + '" font-size="13" font-weight="700" fill="' + colors[j] + '">' + labels[j] + ' ' + vals[j] + '%</text>';
    }
    svg.innerHTML = html;
  }
  function showAiResult() {
    var s = aiRadarStats();
    var totalSec = Math.floor((Date.now() - aiExam.startTs) / 1000);
    var score = Math.round(s.correct / aiExam.list.length * 100);
    var mName = metaOf(ctx.id) ? metaOf(ctx.id).name : '本课程';
    var level, evalText;
    if (s.acc >= 90) {
      level = '🏆 优秀';
      evalText = '本次 AI 训练你答对了 ' + s.correct + '/20 题，准确率高达 ' + s.acc + '%，对《' + mName + '》的核心知识掌握非常扎实，难题应对（难度 ' + s.diff + '%）与答题节奏（时间 ' + s.time + '%）都很出色。';
    } else if (s.acc >= 80) {
      level = '👍 良好';
      evalText = '你答对了 ' + s.correct + '/20 题，准确率 ' + s.acc + '%，整体掌握不错，但在部分易混概念与难题上仍有丢分（难度掌握 ' + s.diff + '%）。建议针对下方复习方向重点突破。';
    } else if (s.acc >= 70) {
      level = '🙂 中等';
      evalText = '你答对了 ' + s.correct + '/20 题，准确率 ' + s.acc + '%，基础题表现尚可，中高难度与答题速度（时间 ' + s.time + '%）还有提升空间，建议先回顾重点知识总结再重练。';
    } else if (s.acc >= 60) {
      level = '⚠️ 及格边缘';
      evalText = '你答对了 ' + s.correct + '/20 题，准确率 ' + s.acc + '%，处于及格边缘，部分章节存在知识漏洞，建议结合错题解析逐题复盘，再重新训练。';
    } else {
      level = '📚 需要加强';
      evalText = '你只答对了 ' + s.correct + '/20 题，准确率 ' + s.acc + '%，当前对《' + mName + '》掌握较薄弱。建议先通读重点知识总结，再回到题库顺序练习夯实基础。';
    }
    var wrongTags = {};
    aiExam.list.forEach(function (q, i) {
      var a = aiExam.ans[i];
      var ok = (q.type === 'short' || q.type === 'long') ? (a && a.grade && a.grade.ok === 1) : isCorrect(q, a.sel);
      if (!ok) wrongTags[q.tag] = (wrongTags[q.tag] || 0) + 1;
    });
    var reviewTags = Object.keys(wrongTags).sort(function (a, b) { return wrongTags[b] - wrongTags[a]; }).slice(0, 4);
    var detailHtml = aiExam.list.map(function (q, i) {
      var a = aiExam.ans[i];
      var subj = q.type === 'short' || q.type === 'long';
      var ok, headIcon, headColor;
      if (subj) {
        ok = a && a.grade && a.grade.ok === 1;
        headIcon = ok ? '✔' : (a && a.grade && a.grade.ok === 0.5 ? '◐' : '✘');
        headColor = ok ? '#16a34a' : (a && a.grade && a.grade.ok === 0.5 ? '#e07b39' : '#dc2626');
      } else {
        ok = isCorrect(q, a.sel);
        headIcon = ok ? '✔' : '✘';
        headColor = ok ? '#16a34a' : '#dc2626';
      }
      var h = '<div class="res-qitem ' + (ok ? 'ok' : 'no') + '">'
        + '<div class="rq-head" style="color:' + headColor + '">' + headIcon + ' 第' + (i + 1) + '题　<span style="color:#6b7186;font-weight:400;font-size:12.5px">[' + esc(q.tag) + ' · ' + aiTypeBadge(q) + ']</span></div>'
        + '<div class="rq-detail">题目：' + esc(q.q) + '</div>';
      if (subj) {
        h += '<div class="rq-detail">你的答案：</div><div class="rq-subj-ans">' + esc(a ? a.text : '') + '</div>';
        if (a && a.grade) {
          h += '<div class="rq-detail" style="color:#16a34a;font-weight:700">正确答案（绿色标出）：' + esc(a.grade.standard || q.answer) + '</div>'
            + '<div class="rq-detail">评分：' + a.grade.score + ' 分 · 评语：' + esc(a.grade.comment || '') + '</div>';
        } else {
          h += '<div class="rq-detail" style="color:#16a34a;font-weight:700">参考答案：' + esc(q.answer) + '</div>';
        }
      } else {
        var yourAns = (a && a.sel != null && !(Array.isArray(a.sel) && a.sel.length === 0)) ? esc(answerText(q, a.sel)) : '<span style="color:#9aa0b5">未作答</span>';
        h += '<div class="rq-detail">你的答案：' + yourAns + '</div>'
          + '<div class="rq-detail" style="color:#16a34a;font-weight:700">正确答案：' + esc(answerText(q, q.a)) + '</div>';
      }
      h += '<div class="rq-detail">解析：' + esc(q.e || '无') + '</div></div>';
      return h;
    }).join('');
    $('aiResultWrap').innerHTML =
      '<div class="res-score-card"><div class="res-score">' + score + '<small>分</small></div>'
      + '<div class="res-score-label">满分100分 · 用时 ' + fmtTime(totalSec) + '</div>'
      + '<div class="res-level">' + level + '</div></div>'
      + '<div class="res-row3">'
      + '<div class="res-mini"><b>' + s.correct + '/20</b><span>答对题数</span></div>'
      + '<div class="res-mini"><b>' + s.acc + '%</b><span>准确性</span></div>'
      + '<div class="res-mini"><b>0</b><span>未作答题数</span></div>'
      + '</div>'
      + '<div class="res-radar-card"><h3>三角总结图</h3>'
      + '<svg id="aiResultRadarSvg" viewBox="0 0 200 190"></svg>'
      + '<div class="radar-legend">'
      + '<span><i style="background:#22c55e"></i>准确性 ' + s.acc + '%</span>'
      + '<span><i style="background:#3b82f6"></i>时间 ' + s.time + '%</span>'
      + '<span><i style="background:#f59e0b"></i>难度 ' + s.diff + '%</span>'
      + '</div></div>'
      + '<div class="res-block"><h3>📝 测试总结与评价</h3><div class="res-eval">' + evalText + '</div></div>'
      + '<div class="res-block"><h3>📌 推荐复习方向</h3>'
      + (reviewTags.length
        ? '<div class="res-eval">以下章节/知识点在本次训练中失分最多，建议优先复习：</div>'
          + '<div class="res-review-tags">' + reviewTags.map(function (t) { return '<span>⚠ ' + esc(t) + '（失' + wrongTags[t] + '题）</span>'; }).join('') + '</div>'
        : '<div class="res-eval">全部答对，无需特别补强，继续保持！</div>')
      + '</div>'
      + '<div class="res-block res-qlist"><h3>🔍 逐题分析与正确性（' + s.correct + '对' + (aiExam.list.length - s.correct) + '错）</h3>' + detailHtml + '</div>'
      + '<div class="res-actions">'
      + '<button class="res-retry" onclick="location.hash=\'#/ai-exam/' + ctx.id + '\'">再练一次</button>'
      + '<button class="res-home" onclick="location.hash=\'#/course/' + ctx.id + '\'">返回课程</button>'
      + '</div>';
    showView('viewAiResult');
    drawAiRadar($('aiResultRadarSvg'), s.acc, s.time, s.diff);
  }
  function aiRadarStats() {
    var answered = 0, correct = 0, diffAll = 0, diffHit = 0, timeRatioSum = 0;
    aiExam.list.forEach(function (q, i) {
      diffAll += q.d;
      var a = aiExam.ans[i];
      var ok = (q.type === 'short' || q.type === 'long') ? (a && a.grade && a.grade.ok === 1) : isCorrect(q, a.sel);
      if (aiAnswered(q, a)) {
        answered++;
        if (ok) { correct++; diffHit += q.d; }
        var expected = 12 + q.d * 10;
        var actual = Math.max(3, (Date.now() - aiExam.startTs) / 1000 / aiExam.list.length);
        timeRatioSum += Math.min(1, expected / actual);
      }
    });
    var acc = answered ? correct / answered * 100 : 0;
    var timePct = answered ? (timeRatioSum / answered) * (answered / aiExam.list.length) * 100 : 0;
    var diffPct = diffAll ? diffHit / diffAll * 100 : 0;
    return { answered: answered, correct: correct, acc: Math.round(acc), time: Math.round(timePct), diff: Math.round(diffPct) };
  }

  /* ================================================================
   * 各级学院：级联下拉（学院 → 专业）
   * ================================================================ */
  var cpBackdrop = null;
  function cpEnsureBackdrop() {
    if (!cpBackdrop) {
      cpBackdrop = document.createElement('div');
      cpBackdrop.className = 'cp-backdrop hidden';
      document.body.appendChild(cpBackdrop);
      cpBackdrop.addEventListener('click', cpCloseAll);
    }
    return cpBackdrop;
  }
  function cpReplay(panel, cls) {
    panel.classList.remove('hidden', cls);
    void panel.offsetWidth;
    panel.classList.add(cls);
  }
  function cpCloseAll() {
    $('cpBtn').classList.remove('cp-open');
    $('cpCollegePanel').classList.add('hidden');
    $('cpMajorPanel').classList.add('hidden');
    cpEnsureBackdrop().classList.add('hidden');
  }
  window.cpToggle = function (e) {
    if (e) e.stopPropagation();
    var panel = $('cpCollegePanel');
    var btn = $('cpBtn');
    if (!panel.classList.contains('hidden')) { cpCloseAll(); return; }
    cpEnsureBackdrop().classList.remove('hidden');
    btn.classList.add('cp-open');
    renderCollegePanel();
    cpReplay(panel, 'cp-in-college');
    $('cpMajorPanel').classList.add('hidden');
  };
  function renderCollegePanel() {
    var sp = UH_CATALOG.scope();
    var h = '<div class="cp-pane-title" style="--i:0">选择学院</div>';
    h += '<button type="button" class="cp-item' + (!sp ? ' cp-current' : '') + '" style="--i:1" onclick="cpPickBase()">'
      + '<span class="cp-i">📚</span><span class="cp-n">基础学院（当前首页）<span class="cp-sub">高等数学、大学物理等17门公共核心课</span></span>'
      + '<span class="cp-check">✓</span></button>';
    h += '<div class="cp-divider" style="--i:2"></div>';
    UH_CATALOG.colleges.forEach(function (col, c) {
      var cur = sp && sp.c === c;
      h += '<button type="button" class="cp-item' + (cur ? ' cp-current' : '') + '" style="--i:' + (c + 3) + '" onclick="cpPickCollege(' + c + ',event)">'
        + '<span class="cp-i">' + col.icon + '</span><span class="cp-n">' + esc(col.n)
        + '<span class="cp-sub">' + col.m.length + '个专业 · 点击展开专业列表</span></span>'
        + '<span class="cp-check">' + (cur ? '✓' : '›') + '</span></button>';
    });
    $('cpCollegePanel').innerHTML = h;
  }
  window.cpPickCollege = function (c, e) {
    if (e) e.stopPropagation();
    var col = UH_CATALOG.colleges[c];
    var sp = UH_CATALOG.scope();
    var h = '<div class="cp-pane-title" style="--i:0">' + col.icon + ' ' + esc(col.n) + '</div>';
    col.m.forEach(function (mj, m) {
      var cur = sp && sp.c === c && sp.m === m;
      var n = UH_CATALOG.majorMetas(c, m).length;
      h += '<button type="button" class="cp-item' + (cur ? ' cp-current' : '') + '" style="--i:' + (m + 1) + '" onclick="cpPickMajor(' + c + ',' + m + ',event)">'
        + '<span class="cp-i">📘</span><span class="cp-n">' + esc(mj.n)
        + '<span class="cp-sub">' + n + '门专业课程（250-300题/门）</span></span>'
        + '<span class="cp-check">✓</span></button>';
    });
    var mp = $('cpMajorPanel');
    mp.innerHTML = h;
    cpReplay(mp, 'cp-in-major');
  };
  window.cpPickMajor = function (c, m, e) {
    if (e) e.stopPropagation();
    cpCloseAll();
    UH_CATALOG.selectMajor(c, m);
    location.hash = '#/';
    showView('viewHome');
    renderHome(true);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };
  window.cpPickBase = function () {
    cpCloseAll();
    UH_CATALOG.selectBase();
    location.hash = '#/';
    renderHome(true);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };
  window.cpResetScope = cpPickBase;

  /* ---------------- 启动 ---------------- */
  UH_CATALOG.restoreScope();
  initLogin();
  var savedUser = getUser();
  if (savedUser) {
    applyUser(savedUser);
    $('loginMask').classList.add('hidden');
  } else {
    $('lp2').classList.add('hidden');
    $('lp3').classList.add('hidden');
  }
  if (!location.hash) location.hash = '#/';
  router();
})();
