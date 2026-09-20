/* ================================================================
 * 大学助手 · B站视频学习映射表（升级版：每科多视频 + 分P连续播放）
 * 说明：
 *   1. UH_VIDEOS         ：按课程 id 映射到「视频数组」（每科多视频）
 *   2. UH_VIDEOS_BY_NAME ：课程名称归一化映射（课程名/别名 → 视频数组）
 *   3. UH.findVideo(cid,name)  ：返回该课程第一个视频（兼容旧调用）
 *   4. UH.findVideos(cid,name) ：返回该课程全部视频数组
 *   5. UH.nearVideo(name)      ：相近课程推荐（无视频时展示推荐入口）
 * 视频字段：title 标题；url B站链接（可带 p= 起始分P）；pages 分P数（0=UP主空间/未知）；
 *          note 简介/备注；hot 1=最推荐
 * 播放地址：https://player.bilibili.com/player.html?bvid=BVxxxx&page=N&high_quality=1&danmaku=0
 *           （aid 视频使用 aid= 参数；page 为分P序号）
 * ================================================================ */
(function () {
  'use strict';

  /* 每科多视频（id 规则与 common.js 的 META 一致；pages=0 表示UP主空间/单视频） */
  var UH_VIDEOS = {
    gaoshu: [
      { title: '高等数学 全程2.0版【宋浩老师】', url: 'https://www.bilibili.com/video/BV1CAxaeHEeH', pages: 100, note: '108小时全程，上百P自动连播，下册含黑板版', hot: 1 },
      { title: '高等数学 同济版全程【宋浩老师】', url: 'https://www.bilibili.com/video/BV1Eb411u7Fw', pages: 50, note: '经典教材全程课，适合跟教材同步学', hot: 1 }
    ],
    wuli: [
      { title: '大学物理 3小时速成【猴博士】', url: 'https://www.bilibili.com/video/BV1L5411b7eB', pages: 20, note: '力学/电磁学/热学分P连续播放，期末突击神器', hot: 1 },
      { title: '大学物理 期末速成【数学建模老哥】', url: 'https://space.bilibili.com/3690997263370571', pages: 0, note: '含振动与波动、热学、力学等多集速成课，考前冲刺', hot: 0 }
    ],
    python: [
      { title: '零基础入门学习Python【小甲鱼】', url: 'https://www.bilibili.com/video/BV1xs411Q799', pages: 100, note: '经典Python入门，幽默风趣，适合零基础', hot: 1 },
      { title: 'Python数据分析与展示【北理工】', url: 'https://www.bilibili.com/video/av10101509', pages: 10, note: '数据清洗/分析/可视化，学完基础后进阶', hot: 0 },
      { title: 'MIT 计算机科学导论及Python编程', url: 'https://www.bilibili.com/video/av10497433', pages: 26, note: 'MIT公开课中文字幕，编程思维启蒙', hot: 0 },
      { title: '数据结构与算法Python版【北大陈斌】', url: 'https://www.bilibili.com/video/BV1VC4y1x7uv', pages: 50, note: '用Python学数据结构，进阶必看', hot: 0 }
    ],
    xiandai: [
      { title: '线性代数 教学视频3.0版【宋浩老师】', url: 'https://www.bilibili.com/video/BV1d7wAzsE8V', pages: 100, note: '28小时全程，2024年新版', hot: 1 },
      { title: '线性代数 2.0版（同济）【宋浩老师】', url: 'https://www.bilibili.com/video/BV1h7pteyEww', pages: 60, note: '配套同济教材经典版本', hot: 0 }
    ],
    lisan: [
      { title: '离散数学 全集【北京大学】', url: 'https://www.bilibili.com/video/av78497922', pages: 60, note: '北大体系完整讲解，覆盖数理逻辑/集合/图论', hot: 1 },
      { title: '离散数学 教学视频全合集', url: 'https://www.bilibili.com/video/BV1V4411n7Cr', pages: 50, note: '完整合集版，分P连续播放', hot: 0 },
      { title: '离散数学 期末不挂科【GUO】', url: 'https://www.bilibili.com/video/BV1BU8kzyEBp', pages: 10, note: '考前速成，重点题型突击', hot: 0 }
    ],
    gailv: [
      { title: '概率论与数理统计 教学视频全集【宋浩】', url: 'https://www.bilibili.com/video/BV1ot411y7mU', pages: 80, note: '36小时全程，知识点全覆盖', hot: 1 },
      { title: '概率论与数理统计 2.0版本【宋浩老师】', url: 'https://www.bilibili.com/video/BV1JXppejE8q', pages: 80, note: '2024新版，内容更新更清晰', hot: 0 }
    ],
    java: [
      { title: 'Java零基础入门到精通【尚硅谷宋红康】', url: 'https://www.bilibili.com/video/BV1PY411e7J6', pages: 600, note: '147小时神作，案例式教学+大厂真题', hot: 1 },
      { title: 'Java基础入门【尚硅谷宋红康经典版】', url: 'https://www.bilibili.com/video/BV1Kb411W75N', pages: 300, note: '1500万+播放经典，JDK17+IDEA2022', hot: 0 },
      { title: 'Java零基础入门教程', url: 'https://www.bilibili.com/video/BV1Wx411f7qN', pages: 100, note: '绝对零基础向，环境搭建到面向对象', hot: 0 }
    ],
    mysql: [
      { title: 'MySQL基础+高级【尚硅谷宋红康】', url: 'https://www.bilibili.com/video/BV12b411K7Zu', pages: 200, note: '从小白到大神，含索引/事务/锁/MVCC', hot: 1 },
      { title: 'MySQL数据库全套【宋红康】', url: 'https://www.bilibili.com/video/BV1iq4y1u7vj', pages: 150, note: '基础篇+高级特性篇完整版', hot: 0 }
    ],
    javaee: [
      { title: 'Spring教程【狂神说】', url: 'https://www.bilibili.com/video/BV1WE411d7Dv', pages: 40, note: 'Spring核心，8小时入门', hot: 1 },
      { title: 'SpringBoot教程【狂神说】', url: 'https://www.bilibili.com/video/BV1PE411i7CV', pages: 60, note: '19小时，微服务开发主力框架', hot: 1 },
      { title: 'Mybatis教程【狂神说】', url: 'https://www.bilibili.com/video/BV1NE411Q7Nx', pages: 20, note: 'ORM框架入门', hot: 0 },
      { title: 'SpringMVC教程【狂神说】', url: 'https://www.bilibili.com/video/BV1aE41167Tu', pages: 30, note: 'MVC分层开发', hot: 0 },
      { title: 'SSM整合教程【狂神说】', url: 'https://www.bilibili.com/video/BV1RE41127rv', pages: 15, note: '三大框架整合实战', hot: 0 },
      { title: 'JavaWeb零基础入门完整版【尚硅谷】', url: 'https://www.bilibili.com/video/BV1Y7411K7zz', pages: 100, note: '46小时，Tomcat/Servlet/JSP/JDBC全套', hot: 0 }
    ],
    shuju: [
      { title: '数据结构与算法【青岛大学王卓】', url: 'https://www.bilibili.com/video/BV1nJ411V7bd', pages: 100, note: '考研/期末公认神课，讲解极其清晰', hot: 1 },
      { title: '数据结构与算法【清华大学邓俊辉】', url: 'https://www.bilibili.com/video/BV1jt4y117KR', pages: 100, note: '清华学堂在线录制，深度进阶', hot: 0 },
      { title: '数据结构入门【郝斌】', url: 'https://www.bilibili.com/video/BV11s41167h6', pages: 40, note: 'C语言实现，入门友好', hot: 0 },
      { title: '红黑树手写实现【B站经典】', url: 'https://www.bilibili.com/video/BV1Ss411F76x', pages: 5, note: '红黑树专项突破', hot: 0 }
    ],
    zucheng: [
      { title: '计算机组成原理【哈工大刘宏伟】', url: 'https://www.bilibili.com/video/BV1WW411Q7PF', pages: 50, note: '考研首选，讲解细致', hot: 1 },
      { title: '计算机组成原理【国防科技大学】', url: 'https://www.bilibili.com/video/BV12741147J3', pages: 40, note: '精简清晰，适合巩固复习', hot: 0 },
      { title: '计算机组成原理【清华大学刘卫东】', url: 'https://www.bilibili.com/video/BV1c4411w7nd', pages: 40, note: '清华名师，逻辑清晰', hot: 0 },
      { title: '计算机科学速成课 Crash Course', url: 'https://www.bilibili.com/video/av21376839', pages: 40, note: '生动科普，零基础建立整体认知', hot: 0 }
    ],
    caozuo: [
      { title: '操作系统【哈工大李治军】32讲全', url: 'https://www.bilibili.com/video/BV1d4411v7u7', pages: 32, note: 'Linux内核角度讲解，考研经典', hot: 1 },
      { title: '操作系统【清华大学向勇/陈渝】', url: 'https://www.bilibili.com/video/BV1uW411f72n', pages: 40, note: '清华MOOC，精炼系统', hot: 0 },
      { title: '操作系统：设计与实现【南京大学蒋炎岩】', url: 'https://www.bilibili.com/video/BV1N741177F5', pages: 40, note: '手写OS实验，硬核进阶', hot: 0 },
      { title: 'MIT 6.S081 操作系统', url: 'https://www.bilibili.com/video/BV1rS4y1n7y1', pages: 40, note: 'MIT公开课，实验驱动', hot: 0 }
    ],
    wangluo: [
      { title: '计算机网络【湖科大教书匠】', url: 'https://www.bilibili.com/video/BV1yE411G7Ma', pages: 80, note: '配套谢希仁教材，408考研必备', hot: 1 },
      { title: '计算机网络微课堂【湖科大教书匠】', url: 'https://www.bilibili.com/video/BV1c4411d7jb', pages: 100, note: '深入浅出，含实验与习题', hot: 0 },
      { title: '计算机网络【王道考研】', url: 'https://www.bilibili.com/video/BV19E411D78Q', pages: 40, note: '思维导图梳理，快速建体系', hot: 0 },
      { title: '计算机网络【韩立刚】', url: 'https://www.bilibili.com/video/BV1gV411h7r7', pages: 100, note: '配套谢希仁教材，讲解细致', hot: 0 },
      { title: '计算机网络（谢希仁第七版）【方老师】', url: 'https://www.bilibili.com/video/BV1Nv41137XD', pages: 60, note: '通俗易懂，弹幕互动多', hot: 0 }
    ],
    ruangong: [
      { title: '软件工程【清华大学】', url: 'https://www.bilibili.com/video/BV1eE411V7Cr', pages: 60, note: '系统化课程，覆盖全流程', hot: 1 }
    ],
    fenxi: [
      { title: 'UML2面向对象分析与设计【北航谭火彬】', url: 'https://www.bilibili.com/video/BV1fq4y1q7KP', pages: 60, note: '配套教材第2版，活动图/用例/顺序图全覆盖', hot: 1 },
      { title: 'UML期末复习视频合集', url: 'https://www.bilibili.com/video/BV1Vb411U7BC', pages: 5, note: '考前复习，重点题型讲解', hot: 0 }
    ],
    xiangmu: [
      { title: '软件项目管理【学堂在线】', url: 'https://www.bilibili.com/video/BV1r4411B7Cf', pages: 60, note: '项目管理全流程课程', hot: 1 }
    ],
    agent: [
      { title: '大模型RAG与Agent智能体项目实战【黑马程序员】', url: 'https://www.bilibili.com/video/BV1yjz5BLEoY', pages: 100, note: 'RAG+Agent实战，紧跟大模型应用开发', hot: 1 },
      { title: 'LangChain大模型全套', url: 'https://www.bilibili.com/video/BV1BgfBYoEpQ', pages: 60, note: 'LangChain框架从入门到实战', hot: 0 },
      { title: 'LangChain+LangGraph开发实战【黑马2026】', url: 'https://www.bilibili.com/video/BV178w1z7EHQ', pages: 100, note: '2026最新，LangGraph工作流开发', hot: 0 },
      { title: '零基础玩转Dify【黑马程序员】', url: 'https://www.bilibili.com/video/BV116w5zuEbo', pages: 20, note: '5小时极速入门Agent开发', hot: 0 }
    ],
    ai: [
      { title: '吴恩达机器学习【中英字幕】', url: 'https://www.bilibili.com/video/BV164411S78V', pages: 110, note: '公认机器学习启蒙神课', hot: 1 },
      { title: '吴恩达深度学习', url: 'https://www.bilibili.com/video/BV164411m79z', pages: 100, note: '神经网络与深度学习进阶', hot: 0 },
      { title: '机器学习【浙江大学胡浩基】', url: 'https://www.bilibili.com/video/BV1dJ411B7gh', pages: 60, note: '板书推导，知其所以然', hot: 0 },
      { title: '深度学习与神经网络【复旦邱锡鹏】', url: 'https://www.bilibili.com/video/BV13b4y1177W', pages: 60, note: '配套蒲公英书，推导全面', hot: 0 },
      { title: '机器学习【李宏毅】白板手推', url: 'https://www.bilibili.com/video/BV1aE411o7qd', pages: 100, note: '中文授课，轻松愉快', hot: 0 }
    ],
    cyuyan: [
      { title: 'C语言程序设计【浙江大学翁恺】', url: 'https://www.bilibili.com/video/av15267247', pages: 60, note: '234万播放经典，中国大学MOOC', hot: 1 },
      { title: 'C语言自学教程【郝斌】', url: 'https://www.bilibili.com/video/av8074534', pages: 80, note: '237万播放，非常适合初学者', hot: 0 },
      { title: 'C语言程序设计【浙大翁凯新版】', url: 'https://www.bilibili.com/video/BV1dr4y1n7vA', pages: 60, note: '新版课程，环境更友好', hot: 0 }
    ],
    bianyi: [
      { title: '编译原理【哈工大陈鄞】', url: 'https://www.bilibili.com/video/BV1zW411t7YE', pages: 50, note: '考研公认神课，全程无废话', hot: 1 },
      { title: '编译原理【哈工大陈鄞新版】', url: 'https://www.bilibili.com/video/BV1dL4y1H7T8', pages: 50, note: '新版上传，画质更清晰', hot: 0 },
      { title: '斯坦福CS143 编译原理', url: 'https://www.bilibili.com/video/BV1b41hYREg7', pages: 50, note: '斯坦福公开课，中文字幕', hot: 0 }
    ],
    webqianduan: [
      { title: 'Web前端基础 HTML5+CSS3【尚硅谷】', url: 'https://www.bilibili.com/video/BV1p84y1P7Z5', pages: 100, note: '入门神课，基础全掌握', hot: 1 },
      { title: 'JavaScript基础与实战【尚硅谷】', url: 'https://www.bilibili.com/video/BV1YW411T7GX', pages: 200, note: '500万播放经典JS课程', hot: 1 },
      { title: 'ES6-ES11新特性【尚硅谷】', url: 'https://www.bilibili.com/video/BV1uK411H7on', pages: 50, note: '现代JS必备', hot: 0 },
      { title: 'AJAX从入门到精通【尚硅谷】', url: 'https://www.bilibili.com/video/BV1WC4y1b78y', pages: 20, note: '前后端交互核心', hot: 0 },
      { title: 'Node.js从入门到实战【尚硅谷】', url: 'https://www.bilibili.com/video/BV1bs411E7pD', pages: 100, note: '服务端JS开发', hot: 0 },
      { title: 'Git教程【尚硅谷】', url: 'https://www.bilibili.com/video/BV15J411973T', pages: 30, note: '版本管理必学', hot: 0 }
    ],
    houduan: [
      { title: 'JavaWeb零基础入门完整版【尚硅谷】', url: 'https://www.bilibili.com/video/BV1Y7411K7zz', pages: 100, note: 'Tomcat/Servlet/JSP/JDBC全套46小时', hot: 1 },
      { title: 'SpringBoot教程【狂神说】', url: 'https://www.bilibili.com/video/BV1PE411i7CV', pages: 60, note: '19小时，后端主力框架', hot: 1 }
    ],
    yunjisuan: [
      { title: 'Hadoop2.x入门【尚硅谷】', url: 'https://www.bilibili.com/video/BV1cW411r7c5', pages: 60, note: '大数据生态基础', hot: 1 },
      { title: 'Hive【尚硅谷】', url: 'https://www.bilibili.com/video/BV1W4411B7cN', pages: 60, note: '数据仓库工具', hot: 0 },
      { title: 'Kafka【尚硅谷】', url: 'https://www.bilibili.com/video/BV1a4411B7V9', pages: 50, note: '消息队列核心', hot: 0 },
      { title: 'Spark【尚硅谷】', url: 'https://www.bilibili.com/video/BV11A411L7CK', pages: 80, note: '大数据计算引擎', hot: 0 },
      { title: 'Flink(Java)【尚硅谷】', url: 'https://www.bilibili.com/video/BV1qy4y1q728', pages: 80, note: '流式计算框架', hot: 0 }
    ],
    qianrushiiot: [
      { title: '正点原子 STM32 手把手系列', url: 'https://space.bilibili.com/394620890', pages: 100, note: 'STM32入门到进阶全系列，含51/ESP32/Linux驱动', hot: 1 },
      { title: 'C语言程序设计【浙江大学翁恺】', url: 'https://www.bilibili.com/video/av15267247', pages: 60, note: '嵌入式前置C语言基础', hot: 0 }
    ],
    ceshi: [
      { title: '软件测试零基础入门到精通【黑马程序员】', url: 'https://www.bilibili.com/video/BV1Y4421Q7ej', pages: 200, note: '含Web测试/App测试/AI测试提效，全套通关', hot: 1 }
    ],
    shujuku: [
      { title: '数据库系统【哈工大战德臣】', url: 'https://www.bilibili.com/video/BV1HY4y1b72A', pages: 60, note: '数据库原理+实战案例，讲得好到看上瘾', hot: 1 }
    ]
  };

  /* 课程名/别名 → 课程id */
  var ALIAS = {
    '高等数学': 'gaoshu', '高数': 'gaoshu', '微积分': 'gaoshu',
    '大学物理': 'wuli', '物理': 'wuli', '大物': 'wuli',
    'python': 'python', 'Python': 'python',
    '线性代数': 'xiandai', '线代': 'xiandai',
    '离散数学': 'lisan', '离散': 'lisan',
    '概率论': 'gailv', '概率论与数理统计': 'gailv', '概率': 'gailv',
    'java': 'java', 'Java': 'java',
    'mysql': 'mysql', 'MySQL': 'mysql', '数据库': 'mysql',
    'javaee': 'javaee', 'spring': 'javaee', 'Spring': 'javaee', '框架': 'javaee',
    '数据结构': 'shuju', '算法': 'shuju',
    '计算机组成原理': 'zucheng', '组成原理': 'zucheng', '计组': 'zucheng',
    '操作系统': 'caozuo',
    '计算机网络': 'wangluo', '网络': 'wangluo',
    '软件工程': 'ruangong', '软工': 'ruangong',
    'uml': 'fenxi', 'UML': 'fenxi', '面向对象分析': 'fenxi',
    '软件项目管理': 'xiangmu', '项目管理': 'xiangmu',
    'agent': 'agent', 'Agent': 'agent', '大模型': 'agent', '智能体': 'agent',
    '机器学习': 'ai', '深度学习': 'ai', '人工智能': 'ai', 'ai': 'ai', 'AI': 'ai',
    'c语言': 'cyuyan', 'C语言': 'cyuyan', 'c': 'cyuyan', 'C': 'cyuyan',
    '编译原理': 'bianyi',
    'web前端': 'webqianduan', '前端': 'webqianduan', 'html': 'webqianduan', 'JavaScript': 'webqianduan',
    '后端': 'houduan', '后端开发': 'houduan',
    '云计算': 'yunjisuan', '大数据': 'yunjisuan', 'hadoop': 'yunjisuan',
    '嵌入式': 'qianrushiiot', '物联网': 'qianrushiiot', '单片机': 'qianrushiiot', 'stm32': 'qianrushiiot',
    '软件测试': 'ceshi', '测试': 'ceshi',
    '数据库系统': 'shujuku'
  };

  /* 旧版归一化键补充（兼容历史课程名） */
  var LEGACY_ALIAS = {
    'python程序设计': 'python', 'python编程': 'python',
    '数据库原理': 'mysql', '数据库原理及应用': 'mysql',
    '面向对象程序设计': 'java',
    '框架程序设计': 'javaee',
    '人工智能开发技术': 'ai',
    '现代软件工程': 'ruangong', '软件工程导论': 'ruangong', '软件工程与uml建模': 'ruangong',
    'uml面向对象分析与设计': 'fenxi', '面向对象分析设计与建模': 'fenxi',
    '计算机网络原理': 'wangluo', '计算机网络教程': 'wangluo',
    '复合型aiagent开发': 'agent', '智能体应用开发': 'agent'
  };

  /* 课程名/别名 → 视频数组 */
  var UH_VIDEOS_BY_NAME = (function () {
    var map = {};
    Object.keys(UH_VIDEOS).forEach(function (k) { map[k] = UH_VIDEOS[k]; });
    Object.keys(ALIAS).forEach(function (n) { map[n] = UH_VIDEOS[ALIAS[n]]; });
    Object.keys(LEGACY_ALIAS).forEach(function (n) { map[n] = UH_VIDEOS[LEGACY_ALIAS[n]]; });
    return map;
  })();

  /* 名称归一化：去括号内容、去空白与常见分隔符、忽略大小写 */
  function normVideoName(name) {
    return String(name == null ? '' : name)
      .replace(/[（(][^）)]*[）)]/g, '')
      .replace(/[\s\u3000\u00b7·_\-—–]+/g, '')
      .toLowerCase();
  }

  /* 查找该课程全部视频数组 */
  function findVideos(cid, name) {
    if (cid && UH_VIDEOS[cid]) return UH_VIDEOS[cid];
    var n = normVideoName(name);
    if (!n) return [];
    if (UH_VIDEOS_BY_NAME[n]) return UH_VIDEOS_BY_NAME[n];
    var keys = Object.keys(UH_VIDEOS_BY_NAME);
    for (var i = 0; i < keys.length; i++) {
      if (normVideoName(keys[i]) === n) return UH_VIDEOS_BY_NAME[keys[i]];
    }
    for (var j = 0; j < keys.length; j++) {
      var k = normVideoName(keys[j]);
      if (k && k.length >= 2 && (n.indexOf(k) >= 0 || k.indexOf(n) >= 0)) {
        return UH_VIDEOS_BY_NAME[keys[j]];
      }
    }
    return [];
  }

  /* 查找视频（兼容旧调用：返回该课程第一个视频，未收录返回 null） */
  window.UH.findVideo = function (cid, name) {
    var arr = findVideos(cid, name);
    return arr && arr.length ? arr[0] : null;
  };

  /* 查找全部视频（新：返回数组） */
  window.UH.findVideos = function (cid, name) {
    return findVideos(cid, name);
  };

  /* 相近视频推荐：按别名做包含匹配（无视频时展示推荐入口） */
  window.UH.nearVideo = function (name) {
    var n = normVideoName(name);
    if (!n) return null;
    var keys = Object.keys(ALIAS);
    for (var i = 0; i < keys.length; i++) {
      var kn = normVideoName(keys[i]);
      if (!kn || kn.length < 2) continue;
      if (n.indexOf(kn) >= 0 || kn.indexOf(n) >= 0) {
        var cid = ALIAS[keys[i]];
        var arr = UH_VIDEOS[cid];
        if (arr && arr.length) return { cid: cid, v: arr[0] };
      }
    }
    return null;
  };

  window.UH_VIDEOS = UH_VIDEOS;
  window.UH_VIDEOS_BY_NAME = UH_VIDEOS_BY_NAME;
})();
