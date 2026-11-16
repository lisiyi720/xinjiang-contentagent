#!/usr/bin/env node

const fs = require("node:fs");
const path = require("node:path");

const datasetPath = path.resolve(
  process.argv[2] || "data/competitor-notes/5eddafae000000000101f5e1.json"
);
const outputPath = path.resolve(
  process.argv[3] || "data/viral-templates.json"
);
const secondaryDatasetPath = path.resolve(
  process.argv[4] || "data/competitor-notes/639a9a4b000000002702af91.json"
);

function searchUrl(title) {
  return `https://www.xiaohongshu.com/search_result/?keyword=${encodeURIComponent(
    title
  )}&source=web_user_page`;
}

function normalizeSample(note, source = "current") {
  return {
    id: note.id || "",
    title: note.title || "未命名笔记",
    likes: Number(note.likes || 0),
    likesText: note.likesText || String(note.likes || 0),
    url: note.url || searchUrl(note.title || ""),
    coverUrl: note.coverUrl || "",
    localCoverPath: note.localCoverPath || "",
    coverStatus: note.localCoverPath
      ? "localized"
      : note.coverUrl
        ? "remote-only"
        : "missing",
    source
  };
}

function referenceImages(samples, role = "direct-sample") {
  return samples
    .filter((sample) => sample.localCoverPath || sample.coverUrl)
    .map((sample) => ({
      noteId: sample.id || "",
      title: sample.title,
      likes: sample.likes,
      likesText: sample.likesText,
      noteUrl: sample.url,
      sourceUrl: sample.coverUrl,
      localPath: sample.localCoverPath,
      role
    }));
}

function topMatches(notes, matcher, count = 3) {
  return notes
    .filter((note) => matcher(note.title || ""))
    .sort((left, right) => Number(right.likes || 0) - Number(left.likes || 0))
    .slice(0, count)
    .map((note) => normalizeSample(note));
}

function topVisualMatches(notes, matcher, count = 3) {
  return notes
    .filter(
      (note) =>
        matcher(note.title || "") &&
        Boolean(note.localCoverPath || note.coverUrl)
    )
    .sort((left, right) => Number(right.likes || 0) - Number(left.likes || 0))
    .slice(0, count)
    .map((note) => normalizeSample(note));
}

function main() {
  const dataset = JSON.parse(fs.readFileSync(datasetPath, "utf8"));
  const secondaryDataset = fs.existsSync(secondaryDatasetPath)
    ? JSON.parse(fs.readFileSync(secondaryDatasetPath, "utf8"))
    : null;
  const titleAnalysis = dataset.titleAnalysis || {};
  const baseline = titleAnalysis.baseline || {};
  const strategies = Array.isArray(titleAnalysis.strategies)
    ? titleAnalysis.strategies
    : [];
  const notes = Array.isArray(dataset.notes)
    ? dataset.notes.filter((note) => !note.isPinned)
    : [];
  const historical = dataset.scanSummary?.historicalTopNotes || [];
  const byAngle = dataset.quantitativeAnalysis?.byAngle || [];

  const strategy = (id) => strategies.find((item) => item.id === id) || {};
  const angle = (name) => byAngle.find((item) => item.name === name) || {};
  const comparison = titleAnalysis.historicalComparison || {};
  const secondaryTitleAnalysis = secondaryDataset?.titleAnalysis || {};
  const secondaryBaseline = secondaryTitleAnalysis.baseline || {};
  const secondaryStrategies = Array.isArray(secondaryTitleAnalysis.strategies)
    ? secondaryTitleAnalysis.strategies
    : [];
  const secondaryStrategy = (id) =>
    secondaryStrategies.find((item) => item.id === id) || {};
  const secondaryBudget = secondaryStrategy("budget");
  const secondaryNotes = Array.isArray(secondaryDataset?.notes)
    ? secondaryDataset.notes.filter((note) => !note.isPinned)
    : [];
  const contrast = strategy("contrast");
  const routeScene = strategy("route-scene");
  const pain = strategy("pain");
  const destination = angle("目的地种草");

  const historicalOutcome = historical
    .filter((note) => /下车|已回|被问爆|勇闯|听我一句劝|不踩坑/.test(note.title || ""))
    .sort((left, right) => Number(right.likes || 0) - Number(left.likes || 0))
    .slice(0, 3)
    .map((note) => normalizeSample(note, "historical-top"));

  const resultCoverSamples = topVisualMatches(
    notes,
    (title) =>
      /不在|国内版|拒绝|蓝绿宝石|住进|推窗|温度|雪山|草甸|风景|电影/.test(
        title
      ),
    3
  );
  const routeEditorialSamples = topVisualMatches(
    notes,
    (title) => /攻略|路线|环线|请查收/.test(title),
    3
  );
  const lifestyleSamples = notes
    .filter((note) => note.localCoverPath || note.coverUrl)
    .slice(0, 4)
    .map((note) => normalizeSample(note));
  const customerProofSamples = topVisualMatches(
    notes,
    (title) => /客户|回程|好评|安全感|赢麻了/.test(title),
    3
  );
  const premiumOfferSamples = topMatches(
    secondaryNotes,
    (title) =>
      /预算|6k|1w|高预算|价格|差距|贵|伊犁旅行|秋日限定/.test(title),
    4
  ).map((sample) => ({ ...sample, source: "competitor-2-candidate" }));
  const premiumOfferVisualSamples = topVisualMatches(
    secondaryNotes,
    (title) =>
      /预算|6k|1w|高预算|差距|伊犁旅行|秋日限定|北疆/.test(title),
    4
  ).map((sample) => ({ ...sample, source: "competitor-2-visual" }));

  const templates = [
    {
      id: "customer-result-proof",
      rank: 1,
      name: "真实客户结果复盘",
      shortName: "客户结果",
      status: "historical-signal",
      confidence: "历史强信号",
      score: 96,
      summary: "先给真实旅行结果，再解释路线、住宿和服务为什么让这次旅行顺利。",
      topicTypes: ["story", "case", "parent", "graduation", "couple", "scenery"],
      evidence: {
        scope: "历史主页 Top 样本",
        sampleCount: Number(comparison.historicalTopOutcomeSampleCount || 0),
        medianLikes: Number(comparison.historicalTopOutcomeMedianLikes || 0),
        baselineMedianLikes: Number(baseline.medianLikes || 0),
        liftVsBaselinePct: null,
        note: "历史爆款上限很高，但只有具备真实客户授权素材时才能使用。"
      },
      titleFormula: "{真实客户身份} + {旅行结果} + {一个具体体验证据}",
      titleFrames: [
        "{人群}刚从{目的地}回来，最庆幸提前改了这段路线",
        "{目的地}{天数}顺利结束，客户说最值的是这3个安排",
        "带{家人/朋友}去{目的地}，这次终于没有一路赶"
      ],
      openingHook: "用真实回程反馈开场，明确谁、去了哪里、得到了什么结果。",
      bodyStructure: [
        "真实客户和出行背景",
        "出发前最担心的问题",
        "做出的路线或服务取舍",
        "住宿、车程、领队等具体证据",
        "最终反馈与适用人群",
        "低门槛私信诊断"
      ],
      requiredEvidence: ["真实客户授权", "具体出行人数或身份", "至少2个可核验服务细节"],
      avoid: ["伪装成游客口吻", "照搬“安全下车/被问爆”原句", "没有证据只写客户夸赞"],
      recommendedVisualStyleIds: ["customer-proof", "result-cover"],
      sampleNotes: historicalOutcome
    },
    {
      id: "contrast-alternative",
      rank: 2,
      name: "拒绝常规玩法 + 替代结果",
      shortName: "反差替代",
      status: "validated",
      confidence: "当前样本已验证",
      score: 92,
      summary: "先否定用户熟悉但不理想的玩法，再给一个更具体、更舒服的替代方案。",
      topicTypes: ["avoid", "budget", "parent", "season", "guide", "vehicle"],
      evidence: {
        scope: "当前非置顶标题样本",
        sampleCount: Number(contrast.count || 0),
        medianLikes: Number(contrast.medianLikes || 0),
        baselineMedianLikes: Number(baseline.medianLikes || 0),
        liftVsBaselinePct: Number(contrast.liftVsBaselinePct || 0),
        note: "当前策略中位表现最高，关键变量是明确取舍，不是感叹号。"
      },
      titleFormula: "拒绝/放弃{常规玩法} + {目的地/人群} + {更好的具体结果}",
      titleFrames: [
        "第一次去{目的地}，拒绝{常规玩法}！这样玩才舒服",
        "别把{时间/预算}花在{错误选择}上，{替代方案}更值",
        "{目的地}{天数}适合谁？先看车程、住宿和同行人"
      ],
      openingHook: "第一段直接说清不推荐什么，并给出车程、体力、住宿或费用原因。",
      bodyStructure: [
        "否定一种常见玩法",
        "说明它会带来的真实损失",
        "给出自己的替代方案",
        "用2至4个数字或事实证明",
        "说明适合与不适合谁",
        "邀请用户提交条件做判断"
      ],
      requiredEvidence: ["明确被否定的选择", "至少1个量化差异", "自己的真实替代方案"],
      avoid: [
        "只喊拒绝特种兵",
        "制造虚假焦虑",
        "把高端定制当成唯一结论",
        "使用普通游客、高端玩家等贬低式圈层表达"
      ],
      recommendedVisualStyleIds: ["result-cover", "route-editorial"],
      sampleNotes: topMatches(
        notes,
        (title) => /不在|国内版|放弃|拒绝|别让|后悔/.test(title),
        3
      )
    },
    {
      id: "route-scene-collection",
      rank: 3,
      name: "路线信息 + 画面场景",
      shortName: "路线场景",
      status: "expanding",
      confidence: "高表现小样本",
      score: 84,
      summary: "标题同时回答“怎么玩”和“能看到什么”，兼顾搜索价值与收藏动机。",
      topicTypes: ["guide", "scenery", "season", "hotel", "graduation", "couple"],
      evidence: {
        scope: "当前非置顶标题样本",
        sampleCount: Number(routeScene.count || 0),
        medianLikes: Number(routeScene.medianLikes || 0),
        baselineMedianLikes: Number(baseline.medianLikes || 0),
        liftVsBaselinePct: Number(routeScene.liftVsBaselinePct || 0),
        note: "样本只有3篇，表现好但仍需要在新疆主题上继续扩大验证。"
      },
      titleFormula: "{路线/天数}｜{可收藏动作}：{具体画面或体验结果}",
      titleFrames: [
        "{目的地}{天数}路线｜请查收：住进{具体风景}的慢游安排",
        "{起点}到{终点}怎么走？这条路线每天都有不同画面",
        "{目的地}{天数}｜少赶路的价值，藏在这3个安排里"
      ],
      openingHook: "先交代路线适合谁和最值得收藏的安排，再解释每天节奏。",
      bodyStructure: [
        "路线适用季节和人群",
        "3至5个核心场景",
        "每天车程和停留节奏",
        "住宿或拍照体验",
        "最关键的一次路线取舍",
        "领取完整路线"
      ],
      requiredEvidence: ["真实路线", "明确天数或起止点", "至少3个真实场景素材"],
      avoid: ["景点堆砌", "没有车程的空泛攻略", "使用不属于自己的酒店或机位"],
      recommendedVisualStyleIds: ["route-editorial", "premium-offer-card", "lifestyle-grid"],
      sampleNotes: topMatches(
        notes,
        (title) =>
          /攻略|路线|环线|请查收|抄作业/.test(title) &&
          /住进|推窗|温泉|私汤|雪山|草甸|瀑|星空|风景|电影|蓝绿宝石|水墨画|震撼/.test(
            title
          ),
        3
      )
    },
    {
      id: "pain-evidence-checklist",
      rank: 4,
      name: "痛点问题 + 证据清单",
      shortName: "避坑证据",
      status: "stable",
      confidence: "稳定基线模板",
      score: 72,
      summary: "把泛泛的“避坑”改成车程、住宿、体力和费用清单，适合持续获取搜索流量。",
      topicTypes: ["avoid", "budget", "vehicle", "parent", "hotel", "guide"],
      evidence: {
        scope: "当前非置顶标题样本",
        sampleCount: Number(pain.count || 0),
        medianLikes: Number(pain.medianLikes || 0),
        baselineMedianLikes: Number(baseline.medianLikes || 0),
        liftVsBaselinePct: Number(pain.liftVsBaselinePct || 0),
        note: "互动只略高于基线，适合做稳定内容，不应包装成必爆模板。"
      },
      titleFormula: "{具体人群/场景} + 最怕的{问题} + {数字化检查方法}",
      titleFrames: [
        "{目的地}{人群}避坑：报名前一定问清这4件事",
        "同样是{天数}，{真实价格}应该重点看哪4项配置？",
        "带{老人/孩子}去{目的地}，先算清每天坐车多久"
      ],
      openingHook: "先复述用户真实顾虑，再承诺给出可检查的判断标准。",
      bodyStructure: [
        "一个具体顾虑",
        "为什么容易踩坑",
        "4项检查清单",
        "自己的真实配置",
        "不适合人群",
        "私信提交日期人数预算"
      ],
      requiredEvidence: ["车程或费用数字", "真实住宿/车型/线路信息", "明确服务边界"],
      avoid: ["泛泛写不踩坑", "攻击同行", "用夸张承诺代替证据"],
      recommendedVisualStyleIds: ["route-editorial", "premium-offer-card", "result-cover"],
      sampleNotes: topMatches(
        notes,
        (title) =>
          /避坑|不踩|踩雷|听劝|拒绝|别让|不赶|不累|少操心|低价团|拉练/.test(
            title
          ),
        3
      )
    },
    {
      id: "destination-scene-hook",
      rank: 5,
      name: "目的地 + 具体感官场景",
      shortName: "场景种草",
      status: "stable",
      confidence: "稳定基线模板",
      score: 69,
      summary: "用温度、光线、地貌或住宿画面替代“绝美、必去”等泛词。",
      topicTypes: ["scenery", "season", "hotel", "couple", "graduation"],
      evidence: {
        scope: "当前目的地种草样本",
        sampleCount: Number(destination.count || 0),
        medianLikes: Number(destination.medianLikes || 0),
        baselineMedianLikes: Number(baseline.medianLikes || 0),
        liftVsBaselinePct: baseline.medianLikes
          ? Math.round(
              ((Number(destination.medianLikes || 0) -
                Number(baseline.medianLikes || 0)) /
                Number(baseline.medianLikes || 0)) *
                100
            )
          : 0,
        note: "整体接近基线，只有场景足够具体时才有突破机会。"
      },
      titleFormula: "{目的地} + {温度/光线/地貌} + {生活方式结果}",
      titleFrames: [
        "{温度}、{雪山/草原/湖泊}，{目的地}的夏天太会了",
        "不在{海外目的地}，这里是{目的地}的{具体场景}",
        "住进{具体风景}里，{目的地}这晚比景点更值得"
      ],
      openingHook: "第一屏给一个可被看见或感受到的场景，随后落到真实路线。",
      bodyStructure: [
        "具体感官画面",
        "出现的时间与位置",
        "怎么抵达或安排",
        "住宿与停留建议",
        "适合人群",
        "获取同款路线"
      ],
      requiredEvidence: ["真实场景照片", "明确月份或时段", "真实地点"],
      avoid: ["空泛绝美形容词", "盗用海外对比图", "图片与路线不一致"],
      recommendedVisualStyleIds: ["result-cover", "lifestyle-grid"],
      sampleNotes: topMatches(
        notes,
        (title) =>
          /温度|℃|住进|推窗|雪山|草甸|瀑|星空|风景|电影|绿野仙踪|瑞士|冰岛|水墨画|蓝绿宝石|美疯/.test(
            title
          ),
        3
      )
    }
  ];

  templates.forEach((template) => {
    template.tier = "validated";
    template.goal = "traffic";
    template.sourceAccounts = [dataset.account?.id || "5eddafae000000000101f5e1"];
  });

  templates.push({
    id: "premium-offer-explainer",
    rank: 6,
    name: "高客单路线报价说明书",
    shortName: "报价说明书",
    status: "conversion-candidate",
    tier: "candidate",
    goal: "conversion",
    confidence: "转化候选·待验证",
    score: 78,
    summary: "先公开真实价格边界，再用住宿、车辆、行程节奏和体验配置解释钱花在哪里。",
    topicTypes: ["budget", "guide", "hotel", "vehicle", "parent", "season"],
    evidence: {
      scope: "竞品2非置顶预算标题与产品封面",
      sampleCount: Number(secondaryBudget.count || 0),
      visualSampleCount: Number(secondaryDataset?.assetArchive?.availableCoverCount || 0),
      medianLikes: Number(secondaryBudget.medianLikes || 0),
      baselineMedianLikes: Number(secondaryBaseline.medianLikes || 0),
      liftVsBaselinePct: Number(secondaryBudget.liftVsBaselinePct || 0),
      validationMetric: "有效咨询率",
      note: "价格标题没有证明互动优势；本模板只作为高预算筛客与产品解释候选，以有效咨询率验证。"
    },
    titleFormula: "{目的地}{天数}｜{真实价格}/人 + 住宿/用车/体验包含什么",
    titleFrames: [
      "{目的地}{天数}｜{真实价格}/人，住宿和用车包含什么",
      "预算{真实价格}去{目的地}，钱主要花在这4个地方",
      "同样去{目的地}，怎么判断一条高客单路线值不值？"
    ],
    openingHook: "第一段先说真实价格范围与包含、不包含项目，再解释每项配置解决什么问题。",
    bodyStructure: [
      "真实价格与适用人数",
      "住宿、车辆、车程和体验配置",
      "每项配置解决的具体问题",
      "包含与不包含项目",
      "适合与不适合人群",
      "提交日期、人数、预算和住宿偏好"
    ],
    requiredEvidence: [
      "当前线路真实价格",
      "真实住宿或车型信息",
      "至少3项可核验配置",
      "明确包含与不包含项目"
    ],
    avoid: [
      "只报高价不解释配置",
      "用高奢、圈层、少数人等抽象词替代证据",
      "贬低低预算客户或普通游客",
      "照搬竞品品牌、价格、人物背书和版式"
    ],
    validationPlan: {
      status: "pending-first-party-test",
      primaryMetric: "提交日期、人数、预算的有效咨询率",
      secondaryMetrics: ["收藏率", "私信率", "报价后继续沟通率"],
      promotionRule: "同一结构至少发布6篇，观察中位表现；不能用单篇异常值升级为已验证模板。"
    },
    sourceAccounts: [secondaryDataset?.account?.id || "639a9a4b000000002702af91"],
    recommendedVisualStyleIds: ["premium-offer-card", "route-editorial"],
    sampleNotes: premiumOfferSamples
  });

  const visualStyles = [
    {
      id: "customer-proof",
      name: "客户反馈证据封面",
      shortName: "客户证据",
      cssClass: "proof",
      description: "真实客户反馈截图或授权合影作为主证据，隐去隐私后只突出一个可核验结果。",
      evidenceLabel: "来自当前客户反馈与品牌结果样本",
      evidenceNote: "只允许使用已授权的真实反馈；历史爆款原图尚未恢复时，以当前同账号证据样本作视觉代理。",
      layout: ["真实反馈截图或授权合影", "隐私打码", "一句结果摘要", "自己的路线信息"],
      visualFingerprint: {
        composition: "证据截图或客户素材占主要画面，标题只总结一个结果，不覆盖关键反馈。",
        typography: "结果摘要采用高对比粗体，聊天原文保持可读，附加信息控制在一行。",
        colorAndLight: "保留真实截图或照片质感，不用夸张滤镜伪造证据。",
        subject: "真实客户反馈、回程评价、授权合影或服务交付记录。",
        personalization: "只能使用自己的客户授权素材，隐藏姓名、头像、手机号和聊天账号等隐私。"
      },
      referenceImages: referenceImages(customerProofSamples, "same-account-proof-proxy")
    },
    {
      id: "result-cover",
      name: "目的地大字结果封面",
      shortName: "目的地大字",
      cssClass: "result",
      description: "全幅真实风景或人物中远景，主标题只保留一个结果，底部补路线信息。",
      evidenceLabel: "来自历史结果型爆款与当前高互动封面",
      evidenceNote: "标题结果有强信号，视觉贡献尚不能单独归因。",
      layout: ["全幅实景", "大字结果标题", "一行路线信息", "人物不做正脸特写"],
      visualFingerprint: {
        composition: "单张全幅实景，人物或景观为主视觉，标题集中在画面上半部或下半部。",
        typography: "高对比粗体中文标题，信息层级不超过三级，主结果最大。",
        colorAndLight: "真实自然光、清晰通透、绿色与蓝色场景保持自然饱和。",
        subject: "路线真实风景、客户中远景或背影，不使用陌生人物正脸。",
        personalization: "保留竞品的构图层级，用自己的路线、住宿、车辆、领队和客户授权素材替换主体。"
      },
      referenceImages: referenceImages(resultCoverSamples)
    },
    {
      id: "route-editorial",
      name: "高端路线实景海报",
      shortName: "路线海报",
      cssClass: "route",
      description: "以自己的路线实景铺满画面，用超大目的地标题、天数、纵向路线节点、三项服务证据和价格建立高端产品感。",
      evidenceLabel: `路线场景 ${Number(routeScene.count || 0)} 篇，中位 ${Number(
        routeScene.medianLikes || 0
      )} 赞`,
      evidenceNote: "已按直接样本校准封面结构；互动数据仍是小样本，版式用于复用视觉层级，不承诺必爆。",
      layout: ["全屏自有路线实景", "上半部超大目的地与天数", "右侧纵向路线节点", "下部3项服务证据与价格"],
      visualFingerprint: {
        composition: "单张竖版实景铺满画面，天空或远景承载主标题；右侧排列纵向路线节点，左下是三项服务证据，右下是价格，底部收束完整路线。",
        typography: "目的地与天数使用高对比大号宋体，英文细线作为装饰层；服务证据、路线节点和价格形成清晰的次级信息区。",
        colorAndLight: "保留真实自然光和通透蓝绿色，底部只做轻微暗化以保证白字可读，不使用白色信息卡遮挡风景。",
        subject: "优先使用自己的道路、湖泊、雪山或草原纵向实拍，保留真实车辆、人物背影和路线环境。",
        personalization: "只迁移竞品的全屏构图与信息层级；地点、天数、价格、服务证据、品牌和照片全部替换为自己的真实资料。"
      },
      referenceImages: referenceImages(routeEditorialSamples)
    },
    {
      id: "lifestyle-grid",
      name: "一页一场景四宫格",
      shortName: "四宫格",
      cssClass: "grid",
      description: "远景、生活方式、人物和住宿细节组成四宫格，每页只讲一个场景。",
      evidenceLabel: "来自竞品内页结构分析",
      evidenceNote: "目前只有视觉结构样本，暂不声称能提升互动。",
      layout: ["远景环境", "生活方式", "人物中远景", "住宿或服务细节"],
      visualFingerprint: {
        composition: "2×2 四宫格，每格承担不同证据，整页只表达一个场景主题。",
        typography: "标题放在留白区或半透明浅底，避免遮挡人物和关键景物。",
        colorAndLight: "四张照片统一色温与曝光，保持真实旅行记录感。",
        subject: "远景、生活方式、人物中远景、住宿或服务细节各一张。",
        personalization: "四格全部优先使用自己的同一路线素材，缺失的格子再生成，不混入竞品地点或品牌。"
      },
      referenceImages: referenceImages(lifestyleSamples)
    }
  ];

  visualStyles.splice(3, 0, {
    id: "premium-offer-card",
    name: "高端路线实景海报 · 报价版",
    shortName: "配置报价卡",
    cssClass: "route",
    tier: "candidate",
    goal: "conversion",
    description: "用自己的路线实景承载目的地、天数和真实价格，再用住宿、车辆、节奏与体验配置解释价值。",
    evidenceLabel: `竞品2 ${premiumOfferVisualSamples.length} 张直接版式样本`,
    evidenceNote: "只验证了信息层级与高预算筛客用途，互动提升尚未验证；必须换成自己的图片、价格和服务证据。",
    layout: [
      "低干扰自有路线实景",
      "目的地与天数作为第一视觉",
      "真实价格作为第二视觉",
      "住宿、车辆、节奏、体验3至5项配置",
      "包含范围与咨询入口"
    ],
    visualFingerprint: {
      composition: "竖版实景或留白海报，上部放目的地与天数，中部保留路线主场景，下部依次放真实价格、3至5项配置和包含范围。",
      typography: "目的地与天数使用清晰的大号中文标题，价格是第二层级；配置保持短句，不堆满小字和装饰英文。",
      colorAndLight: "根据自己的路线照片选择米白、深绿或低饱和秋色，只迁移克制层级，不复刻竞品黑金配色。",
      subject: "必须使用自己的住宿、车辆、路线和体验实景，价格与包含项目来自当前真实产品。",
      personalization: "不得出现竞品品牌、人物背书、原价格、logo或水印；不使用普通游客与高端玩家的对立表达。"
    },
    referenceImages: referenceImages(
      premiumOfferVisualSamples,
      "competitor-2-conversion-structure"
    )
  });

  const primarySource = {
    competitorId: dataset.account?.id || "5eddafae000000000101f5e1",
    competitorName: dataset.account?.nickname || dataset.account?.name || "奢享家定制游",
    datasetPath: path.relative(path.dirname(outputPath), datasetPath),
    role: "已验证爆款来源",
    tier: "validated",
    notesScanned: Number(dataset.scanSummary?.visibleNotesScanned || 0),
    indexedNotes: Array.isArray(dataset.notes) ? dataset.notes.length : 0,
    measurableNotes: Number(baseline.noteCount || 0),
    baselineMedianLikes: Number(baseline.medianLikes || 0),
    localizedCoverCount: Number(dataset.assetArchive?.availableCoverCount || 0),
    imageManifestPath: dataset.assetArchive?.manifestPath || ""
  };
  const secondarySource = secondaryDataset
    ? {
        competitorId: secondaryDataset.account?.id || "639a9a4b000000002702af91",
        competitorName:
          secondaryDataset.account?.nickname ||
          secondaryDataset.account?.name ||
          "愈见风高端定制旅行",
        datasetPath: path.relative(path.dirname(outputPath), secondaryDatasetPath),
        role: "高客单转化候选来源",
        tier: "candidate",
        notesScanned: Number(secondaryDataset.scanSummary?.visibleNotesScanned || 0),
        indexedNotes: Array.isArray(secondaryDataset.notes)
          ? secondaryDataset.notes.length
          : 0,
        measurableNotes: Number(secondaryBaseline.noteCount || 0),
        baselineMedianLikes: Number(secondaryBaseline.medianLikes || 0),
        localizedCoverCount: Number(
          secondaryDataset.assetArchive?.availableCoverCount || 0
        ),
        imageManifestPath: secondaryDataset.assetArchive?.manifestPath || ""
      }
    : null;
  const sources = [primarySource, secondarySource].filter(Boolean);

  const result = {
    version: 3,
    generatedAt: new Date().toISOString(),
    source: {
      competitorId: "multi-source",
      competitorName: `${sources.length}个竞品分层提炼`,
      notesScanned: sources.reduce((sum, item) => sum + item.notesScanned, 0),
      indexedNotes: sources.reduce((sum, item) => sum + item.indexedNotes, 0),
      measurableNotes: sources.reduce((sum, item) => sum + item.measurableNotes, 0),
      baselineMedianLikes: null,
      baselineLabel: sources
        .map((item) => `${item.baselineMedianLikes}赞`)
        .join(" / "),
      localizedCoverCount: sources.reduce(
        (sum, item) => sum + item.localizedCoverCount,
        0
      )
    },
    sources,
    methodology: {
      principle: "已验证模板与转化候选分层展示；竞品2只提供高客单产品结构，不冒充爆款结论。",
      metric: "各账号按自己的点赞中位基线判断，不直接合并绝对点赞；转化候选以有效咨询率为主要验证指标。",
      limitation: "竞品2缺少正文、收藏、分享与成交数据；候选模板必须经过我方至少6篇发布测试后才能升级。"
    },
    templates,
    visualStyles
  };

  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, `${JSON.stringify(result, null, 2)}\n`, "utf8");
  console.log(
    JSON.stringify({
      outputPath,
      templates: templates.length,
      visualStyles: visualStyles.length,
      sourceNotes: result.source.indexedNotes
    })
  );
}

main();
