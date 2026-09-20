/* ================================================================
 * 大学助手 · 通用题库构建器
 * 课程数据文件调用 UH.reg(id, def) 注册：
 *   def = {
 *     intro:'课程简介',
 *     tips:['记忆要点1', ...],
 *     facts:[ {t:'术语', d:'准确陈述/定义', tag:'所属章节'}, ... ], // ≥45条
 *     core:[ {q,o,a,d:难度,tag,e,m?} ... ]                          // ≥20道精编题
 *   }
 * 构建器会把每条知识点自动扩展为4道题（定义选择/术语选择/正确判断/错误判断），
 * 再用“选项乱序变式”把题库补足到 215 题，保证每门课在 200~300 题之间。
 * ================================================================ */
(function () {
  'use strict';

  /* 17门课程元信息（首页宫格） */
  var META = [
    { id:'gaoshu',  name:'高等数学',               icon:'📐', bg:'linear-gradient(135deg,#e8f0ff,#dbe6ff)' },
    { id:'wuli',    name:'大学物理',               icon:'⚛️', bg:'linear-gradient(135deg,#e5f7ff,#d6efff)' },
    { id:'python',  name:'Python程序设计',         icon:'🐍', bg:'linear-gradient(135deg,#e6f8ee,#d7f3e3)' },
    { id:'xiandai', name:'线性代数',               icon:'🔢', bg:'linear-gradient(135deg,#f0ebff,#e5dcff)' },
    { id:'lisan',   name:'离散数学',               icon:'🔣', bg:'linear-gradient(135deg,#fdeef5,#fbdde9)' },
    { id:'gailv',   name:'概率论与数理统计',       icon:'🎲', bg:'linear-gradient(135deg,#fff3e0,#ffe4c4)' },
    { id:'java',    name:'面向对象程序设计(Java)', icon:'☕', bg:'linear-gradient(135deg,#ffeede,#ffd9bc)' },
    { id:'mysql',   name:'数据库原理(MySQL)',      icon:'🗄️', bg:'linear-gradient(135deg,#e6f9f4,#cdeee4)' },
    { id:'zucheng', name:'计算机组成原理',         icon:'💾', bg:'linear-gradient(135deg,#eceffc,#dde3f8)' },
    { id:'shuju',   name:'数据结构与算法',         icon:'🌲', bg:'linear-gradient(135deg,#e9f7ef,#d2efdd)' },
    { id:'javaee',  name:'框架程序设计(JavaEE)',   icon:'🧩', bg:'linear-gradient(135deg,#eef1ff,#dfe5ff)' },
    { id:'ai',      name:'人工智能开发技术',       icon:'🤖', bg:'linear-gradient(135deg,#f3e8ff,#e7d4ff)' },
    { id:'ruangong',name:'现代软件工程',           icon:'🏗️', bg:'linear-gradient(135deg,#e8f6ff,#d2ecff)' },
    { id:'fenxi',   name:'面向对象分析设计与建模', icon:'📊', bg:'linear-gradient(135deg,#fff0f6,#ffdbe8)' },
    { id:'wangluo', name:'计算机网络教程',         icon:'🌐', bg:'linear-gradient(135deg,#e6f4ff,#cfe6ff)' },
    { id:'xiangmu', name:'软件项目管理',           icon:'📋', bg:'linear-gradient(135deg,#fef6e0,#fbe7b8)' },
    { id:'agent',   name:'复合型AI Agent开发',     icon:'🧠', bg:'linear-gradient(135deg,#f1ecff,#ddd2ff)' }
  ];

  var registry = {};       // id -> def
  var bankCache = {};      // id -> 构建好的题库数组
  var TARGET = 215;        // 构建目标题量（200~300之间）

  /* ---------- 确定性随机（mulberry32），保证题库每次刷新顺序一致 ---------- */
  function hashStr(s) {
    var h = 1779033703 ^ s.length;
    for (var i = 0; i < s.length; i++) {
      h = Math.imul(h ^ s.charCodeAt(i), 3432918353);
      h = (h << 13) | (h >>> 19);
    }
    return (h ^= h >>> 16) >>> 0;
  }
  function rng(seed) {
    var a = seed >>> 0;
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function shuffleArr(arr, r) {
    var a = arr.slice();
    for (var i = a.length - 1; i > 0; i--) {
      var j = Math.floor(r() * (i + 1));
      var tmp = a[i]; a[i] = a[j]; a[j] = tmp;
    }
    return a;
  }

  /* ---------- 注册课程数据 ---------- */
  function reg(id, def) { registry[id] = def; }

  /* ---------- 取n个不与self重复的下标 ---------- */
  function pickOthers(r, len, self, n) {
    var pool = [];
    for (var i = 0; i < len; i++) if (i !== self) pool.push(i);
    return shuffleArr(pool, r).slice(0, Math.min(n, pool.length));
  }

  /* ---------- 核心构建 ---------- */
  function buildBank(id) {
    if (bankCache[id]) return bankCache[id];
    var def = registry[id];
    if (!def) return [];

    var r = rng(hashStr('bank_' + id));
    var facts = (def.facts || []).filter(function (f) { return f && f.t && f.d; });
    var core = (def.core || []).map(function (q) {
      return {
        q: q.q, o: q.o.slice(),
        a: Array.isArray(q.a) ? q.a.slice() : q.a,
        d: q.d || 2, tag: q.tag || '综合', e: q.e || '',
        m: q.m ? 1 : 0,
        type: q.type === 'judge' ? 'judge' : (q.m ? 'multi' : 'single'),
        src: '精编核心题'
      };
    });

    var list = core.slice();

    facts.forEach(function (f, idx) {
      // —— 题型1：根据术语选正确定义 ——
      var oIdx1 = pickOthers(r, facts.length, idx, 3);
      var opts1 = [f.d].concat(oIdx1.map(function (i) { return facts[i].d; }));
      // 纠正定义长度（乱序选项）
      var order1 = shuffleArr([0,1,2,3], r);
      var shuffled1 = order1.map(function (k) { return opts1[k]; });
      list.push({
        q: '关于「' + f.t + '」，下列描述正确的是（　）。',
        o: shuffled1, a: order1.indexOf(0), d: 1, tag: f.tag, type: 'single',
        e: '「' + f.t + '」：' + f.d, src: '知识点'
      });

      // —— 题型2：根据定义选术语 ——
      var oIdx2 = pickOthers(r, facts.length, idx, 3);
      var opts2 = [f.t].concat(oIdx2.map(function (i) { return facts[i].t; }));
      var order2 = shuffleArr([0,1,2,3], r);
      var shuffled2 = order2.map(function (k) { return opts2[k]; });
      list.push({
        q: '“' + f.d + '” 这描述的是下列哪个概念？',
        o: shuffled2, a: order2.indexOf(0), d: 2, tag: f.tag, type: 'single',
        e: '该概念为「' + f.t + '」：' + f.d, src: '知识点'
      });

      // —— 题型3：正确陈述判断 ——
      list.push({
        q: '判断：' + f.d + '（　）',
        o: ['正确', '错误'], a: 0, d: 1, tag: f.tag, type: 'judge',
        e: '表述正确。该知识点为「' + f.t + '」：' + f.d, src: '知识点'
      });

      // —— 题型4：张冠李戴的错误陈述判断 ——
      var wrong = facts[(idx + 1 + Math.floor(r() * (facts.length - 1))) % facts.length];
      if (wrong.t === f.t) wrong = facts[(idx + 2) % facts.length];
      list.push({
        q: '判断：' + f.t + '指的是' + wrong.d + '。（　）',
        o: ['正确', '错误'], a: 1, d: 2, tag: f.tag, type: 'judge',
        e: '表述错误。「' + f.t + '」实际是：' + f.d, src: '知识点'
      });
    });

    /* ---------- 选项乱序变式，补足题量到 TARGET ---------- */
    if (list.length < TARGET) {
      var singles = list.filter(function (q) { return q.type === 'single' && q.o.length === 4; });
      var seq = shuffleArr(singles.map(function (_, i) { return i; }), r);
      var need = TARGET - list.length;
      for (var k = 0; k < seq.length && need > 0; k++) {
        var src = singles[seq[k]];
        var ord = shuffleArr([0,1,2,3], r);
        if (ord.join('') === '0123') { ord = [1,0,2,3]; }
        list.push({
          q: src.q,
          o: ord.map(function (x) { return src.o[x]; }),
          a: ord.indexOf(src.a),
          d: Math.min(3, src.d + 1), tag: src.tag, type: 'single',
          e: src.e, src: '变式训练'
        });
        need--;
      }
    }

    // 编号
    list.forEach(function (q, i) { q.no = i + 1; });
    bankCache[id] = list;
    return list;
  }

  /* ---------- 按标签分组知识点（用于知识总结页） ---------- */
  function groupedFacts(id) {
    var def = registry[id];
    if (!def) return [];
    var map = {}, order = [];
    (def.facts || []).forEach(function (f) {
      var g = f.tag || '其他';
      if (!map[g]) { map[g] = []; order.push(g); }
      map[g].push(f);
    });
    return order.map(function (g) { return { tag: g, facts: map[g] }; });
  }

  window.UH = {
    META: META,
    reg: reg,
    getDef: function (id) { return registry[id]; },
    getBank: buildBank,
    groups: groupedFacts,
    has: function (id) { return !!registry[id]; },
    hashStr: hashStr,
    shuffle: function (arr, seed) { return shuffleArr(arr, rng((seed >>> 0) || (Date.now() >>> 0))); }
  };
})();
