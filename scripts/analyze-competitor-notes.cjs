#!/usr/bin/env node

const fs = require("node:fs");
const path = require("node:path");

const datasetPath = process.argv[2];

if (!datasetPath) {
  console.error("Usage: node scripts/analyze-competitor-notes.cjs <dataset-json>");
  process.exit(1);
}

function median(values) {
  if (!values.length) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2
    ? sorted[middle]
    : Number(((sorted[middle - 1] + sorted[middle]) / 2).toFixed(1));
}

function round(value) {
  return Number(value.toFixed(1));
}

function stats(notes, baselineMedian) {
  if (!notes.length) {
    return {
      count: 0,
      medianLikes: 0,
      averageLikes: 0,
      maxLikes: 0,
      liftVsBaselinePct: 0,
      examples: []
    };
  }

  const likes = notes.map((note) => Number(note.likes || 0));
  const medianLikes = median(likes);
  return {
    count: notes.length,
    medianLikes,
    averageLikes: round(likes.reduce((sum, value) => sum + value, 0) / likes.length),
    maxLikes: Math.max(...likes),
    liftVsBaselinePct: baselineMedian
      ? Math.round(((medianLikes - baselineMedian) / baselineMedian) * 100)
      : 0,
    examples: [...notes]
      .sort((left, right) => Number(right.likes || 0) - Number(left.likes || 0))
      .slice(0, 2)
      .map((note) => ({
        title: note.title,
        likes: Number(note.likes || 0)
      }))
  };
}

function buildStrategy(notes, baselineMedian, definition) {
  const matched = notes.filter((note) => definition.matches(note.title || ""));
  return {
    id: definition.id,
    name: definition.name,
    ...stats(matched, baselineMedian),
    verdict: definition.verdict
  };
}

function buildHistoricalComparison(dataset, currentNotes, baselineMedian) {
  const historical = dataset.scanSummary?.historicalTopNotes || [];
  const historicalOutcome = historical.filter((note) =>
    /下车|已回|被问爆|勇闯|听我一句劝|不踩坑/.test(note.title || "")
  );
  const currentOutcome = currentNotes.filter((note) =>
    /我|我们|闺蜜|终于|下车|回程|被问爆|赢麻|爽感|后悔了|找到/.test(note.title || "")
  );

  return {
    scope: "历史数据仅来自账号页可见Top样本，用于比较表达方式，不代表全量历史中位数。",
    historicalTopOutcomeSampleCount: historicalOutcome.length,
    historicalTopOutcomeMedianLikes: median(
      historicalOutcome.map((note) => Number(note.likes || 0))
    ),
    currentOutcomeLikeSampleCount: currentOutcome.length,
    currentOutcomeLikeMedianLikes: median(
      currentOutcome.map((note) => Number(note.likes || 0))
    ),
    baselineMedianLikes: baselineMedian,
    conclusion:
      "历史爆款靠真实用户结果叙事；近期只套“我、终于、后悔”等口吻并没有带来同等效果。要复用的是客户证据和结果，不是语气词。"
  };
}

function main() {
  const resolvedPath = path.resolve(datasetPath);
  const dataset = JSON.parse(fs.readFileSync(resolvedPath, "utf8"));
  const indexedNotes = Array.isArray(dataset.notes) ? dataset.notes : [];
  const measurableNotes = indexedNotes.filter((note) => Number.isFinite(Number(note.likes)));
  const unpinnedNotes = measurableNotes.filter((note) => !note.isPinned);
  const unpinnedLikes = unpinnedNotes.map((note) => Number(note.likes || 0));
  const baselineMedian = median(unpinnedLikes);
  const baselineAverage = unpinnedLikes.length
    ? round(unpinnedLikes.reduce((sum, value) => sum + value, 0) / unpinnedLikes.length)
    : 0;
  const topCount = Math.max(1, Math.ceil(unpinnedNotes.length * 0.2));
  const sortedByLikes = [...unpinnedNotes].sort(
    (left, right) => Number(right.likes || 0) - Number(left.likes || 0)
  );
  const totalLikes = unpinnedLikes.reduce((sum, value) => sum + value, 0);
  const topLikes = sortedByLikes
    .slice(0, topCount)
    .reduce((sum, note) => sum + Number(note.likes || 0), 0);

  const strategyDefinitions = [
    {
      id: "contrast",
      name: "反差 / 拒绝常规玩法",
      matches: (title) => /不在|国内版|放弃|拒绝|别让|后悔/.test(title),
      verdict: "优先复用结构：先否定常规玩法，再给具体替代结果。"
    },
    {
      id: "route-scene",
      name: "路线信息 + 画面场景",
      matches: (title) =>
        /攻略|路线|环线|请查收|抄作业/.test(title) &&
        /住进|推窗|温泉|私汤|雪山|草甸|瀑|星空|沙滩|风景|电影|绿野仙踪|蓝绿宝石|水墨画|治愈|震撼/.test(
          title
        ),
      verdict: "样本少但表现好，适合扩大测试；标题同时回答“怎么玩”和“能看到什么”。"
    },
    {
      id: "pain",
      name: "痛点 / 避坑",
      matches: (title) =>
        /避坑|不踩|踩雷|后悔|听劝|拒绝|别让|不赶|不累|不费|不用操心|少操心|低价团|拉练/.test(
          title
        ),
      verdict: "可以稳定使用，但必须补车程、住宿、体力或费用证据，不能只喊“避坑”。"
    },
    {
      id: "emotion",
      name: "强情绪符号",
      matches: (title) => /[！!❗‼😱😭😁🙏✨🍃🌿💫✔✅]/.test(title),
      verdict: "使用频率高，但中位表现接近基线；它是包装，不是增长原因。"
    },
    {
      id: "service",
      name: "高端 / 定制承诺",
      matches: (title) =>
        /定制|私定|私导|高端|高奢|1v1|一价全含|纯玩|专车|私享/.test(title),
      verdict: "适合作为筛客信息，不适合单独承担点击；需要和真实场景或结果组合。"
    },
    {
      id: "family",
      name: "亲子 / 带娃",
      matches: (title) => /亲子|带娃|遛娃|溜娃|娃|妈躺平|家庭/.test(title),
      verdict: "供给过多且同质化。减少“带娃不累”口号，改写成年龄、车程和体力取舍。"
    }
  ];

  const strategies = strategyDefinitions
    .map((definition) => buildStrategy(unpinnedNotes, baselineMedian, definition))
    .sort((left, right) => right.liftVsBaselinePct - left.liftVsBaselinePct);

  dataset.analysisCoverage = {
    level: "B",
    label: "标题策略可决策，成交归因待补证",
    accountNotesScanned: Number(dataset.scanSummary?.visibleNotesScanned || 0),
    indexedNotes: indexedNotes.length,
    stableNoteLinks: indexedNotes.filter((note) => note.id && note.url).length,
    coverSnapshots: indexedNotes.filter((note) => note.coverUrl).length,
    bodySamples: Array.isArray(dataset.deepSamples) ? dataset.deepSamples.length : 0,
    commentSamples: 0,
    complete: [
      "账号规模与近期互动基线",
      "标题、点赞、目的地和内容角度",
      "历史爆款标题样本",
      "可搜索、筛选和排序的笔记索引"
    ],
    missing: [
      "代表笔记完整正文",
      "评论区高频问题与异议",
      "收藏、分享和发布时间",
      "私信到成交的真实转化数据"
    ],
    nextMilestone: "补8-12篇代表笔记正文和每篇20条高赞评论，再判断开头、正文结构与转化话术。"
  };

  dataset.titleAnalysis = {
    scope: `${unpinnedNotes.length}篇非置顶、带点赞的标题样本；所有互动数为采集时快照。`,
    baseline: {
      noteCount: unpinnedNotes.length,
      medianLikes: baselineMedian,
      averageLikes: baselineAverage,
      recent30MedianLikes: Number(dataset.scanSummary?.latest30MedianLikes || 0),
      recent30AverageLikes: Number(dataset.scanSummary?.latest30AverageLikes || 0),
      top20PercentNoteCount: topCount,
      top20PercentLikeSharePct: totalLikes ? round((topLikes / totalLikes) * 100) : 0,
      pinnedLikes: Number(dataset.scanSummary?.pinnedNoteLikes || 0)
    },
    decisionSummary: {
      copy: "反差/拒绝常规玩法 + 具体路线或住宿场景 + 明确体验结果。",
      avoid: "只写“高端定制、带娃不累、暑期必去”这类抽象承诺。",
      testNext: "真实客户结果 + 行程取舍证据，例如少去两个点后每天少坐多久车。",
      measurement: "以发布7天后的收藏率、私信率和有效咨询数为主，点赞只作辅助。"
    },
    strategies,
    historicalComparison: buildHistoricalComparison(
      dataset,
      unpinnedNotes,
      baselineMedian
    ),
    conclusions: [
      `非置顶样本中位${baselineMedian}赞，近30篇中位${Number(
        dataset.scanSummary?.latest30MedianLikes || 0
      )}赞，近期内容效率低于这批索引的整体基线。`,
      "“反差/拒绝常规玩法”标题的中位表现最高；真正起作用的是清晰取舍，不是感叹号。",
      "“路线信息+画面场景”兼顾搜索价值和向往感，是比泛泛“高端定制”更值得持续测试的组合。",
      "亲子内容量大但中位表现偏低，说明人群标签已经不稀缺，必须用年龄、体力、车程和住宿证据区分。",
      "置顶与历史爆款会显著抬高观感，评估竞品时应始终分开看历史上限、近期基线和单篇异常值。"
    ]
  };

  fs.writeFileSync(resolvedPath, `${JSON.stringify(dataset, null, 2)}\n`, "utf8");
  console.log(
    JSON.stringify({
      datasetPath: resolvedPath,
      notes: indexedNotes.length,
      baselineMedian,
      strategies: strategies.map((strategy) => ({
        name: strategy.name,
        count: strategy.count,
        medianLikes: strategy.medianLikes,
        liftVsBaselinePct: strategy.liftVsBaselinePct
      }))
    })
  );
}

main();
