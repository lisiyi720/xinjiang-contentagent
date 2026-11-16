import "dotenv/config";
import express from "express";
import multer from "multer";
import OpenAI from "openai";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const app = express();
const port = Number(process.env.PORT || 8787);
const isReadOnlyRuntime = Boolean(
  process.env.VERCEL ||
  process.env.AWS_LAMBDA_FUNCTION_NAME ||
  process.env.NOW_REGION
);
const provider = (
  process.env.AI_PROVIDER ||
  (process.env.ARK_API_KEY || process.env.VOLCENGINE_API_KEY ? "volcengine" : "") ||
  (process.env.DEEPSEEK_API_KEY ? "deepseek" : "openai")
).toLowerCase();
const openaiModel = process.env.OPENAI_MODEL || "gpt-4.1-mini";
const deepseekModel = process.env.DEEPSEEK_MODEL || "deepseek-v4-flash";
const deepseekBaseURL = process.env.DEEPSEEK_BASE_URL || "https://api.deepseek.com";
const arkModel = process.env.ARK_MODEL || process.env.VOLCENGINE_MODEL || "";
const arkTextModel = process.env.ARK_TEXT_MODEL || "doubao-seed-2-0-lite-260215";
const arkBaseURL = process.env.ARK_BASE_URL || process.env.VOLCENGINE_BASE_URL || "https://ark.cn-beijing.volces.com/api/v3";

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    files: 12,
    fileSize: 8 * 1024 * 1024
  }
});

app.use((req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,DELETE,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") {
    res.sendStatus(204);
    return;
  }
  next();
});

app.use(express.static(__dirname));
app.use(express.json({ limit: "2mb" }));

const arkImageModel = process.env.ARK_IMAGE_MODEL || "doubao-seedream-4-0-250828";
const dataDir = path.join(__dirname, "data");
const competitorsFile = path.join(dataDir, "competitors.json");

function readCompetitors() {
  try {
    const list = JSON.parse(fs.readFileSync(competitorsFile, "utf8"));
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

function writeCompetitors(list) {
  fs.mkdirSync(dataDir, { recursive: true });
  fs.writeFileSync(competitorsFile, JSON.stringify(list, null, 2), "utf8");
}

function extractJson(text) {
  const cleaned = text.trim().replace(/^```json\s*/i, "").replace(/^```\s*/i, "").replace(/```$/i, "").trim();
  try {
    return JSON.parse(cleaned);
  } catch {
    const match = cleaned.match(/\{[\s\S]*\}/);
    if (!match) return null;
    try {
      return JSON.parse(match[0]);
    } catch {
      return null;
    }
  }
}

function field(value, fallback = "未填写") {
  return String(value || "").trim() || fallback;
}

function getProviderConfig(purpose = "vision") {
  if (provider === "deepseek") {
    return {
      name: "deepseek",
      model: deepseekModel,
      apiKey: process.env.DEEPSEEK_API_KEY,
      baseURL: deepseekBaseURL,
      supportsImages: false
    };
  }

  if (provider === "volcengine" || provider === "ark") {
    return {
      name: "volcengine",
      model: purpose === "text" ? arkTextModel : arkModel,
      apiKey: process.env.ARK_API_KEY || process.env.VOLCENGINE_API_KEY,
      baseURL: arkBaseURL,
      supportsImages: true
    };
  }

  return {
    name: "openai",
    model: openaiModel,
    apiKey: process.env.OPENAI_API_KEY,
    supportsImages: true
  };
}

function getConfigError(activeProvider) {
  if (!activeProvider.apiKey) {
    if (activeProvider.name === "deepseek") return "本地服务已启动，但还没有设置 DEEPSEEK_API_KEY。请在 .env 中配置后重新启动服务。";
    if (activeProvider.name === "volcengine") return "本地服务已启动，但还没有设置 ARK_API_KEY 或 VOLCENGINE_API_KEY。请在 .env 中配置后重新启动服务。";
    return "本地服务已启动，但还没有设置 OPENAI_API_KEY。请在 .env 中配置后重新启动服务。";
  }

  if (!activeProvider.model) {
    if (activeProvider.name === "volcengine") return "火山方舟还缺少 ARK_MODEL。请填写控制台里的视觉模型 ID 或 Endpoint ID 后重新启动服务。";
    return "当前 AI 提供商还缺少模型配置。";
  }

  return "";
}

function buildAnalysisPrompt(req, files, activeProvider) {
  const imageNote = activeProvider.supportsImages
    ? `用户上传了 ${files.length} 张截图，请结合截图里的封面、正文页、评论区信息一起分析。`
    : `用户上传了 ${files.length} 张截图，但当前 DeepSeek 官方文本接口不能直接读取图片。请只基于账号链接、笔记链接、互动数据、正文/评论区文字进行风格分析，并在 visualStyle.imageSignals 中明确写出“截图视觉信息待补充 OCR 或视觉模型识别”。`;

  return `
你是一个小红书旅游账号竞品分析师。请根据用户提供的竞品账号链接、爆款笔记链接、互动数据、正文/评论文字，以及可用的截图信息，分析这个竞品的爆款风格。

${imageNote}

账号链接：${field(req.body.accountLink)}
爆款笔记链接：${field(req.body.noteLinks)}
互动数据：${field(req.body.metrics)}
重点想学：${field(req.body.focus)}
正文/评论区文字：${field(req.body.noteText)}

请只输出一个 JSON 对象，不要输出 Markdown。JSON 字段必须是：
{
  "summary": "一句话总结竞品整体风格",
  "titlePatterns": ["标题结构1", "标题结构2", "标题结构3"],
  "openingHooks": ["开头钩子1", "开头钩子2", "开头钩子3"],
  "visualStyle": {
    "cover": "封面视觉和标题排版特征",
    "innerPages": "内页结构和信息层级",
    "imageSignals": "从截图里看到的画面、色彩、字体或构图特点；如果模型不能读取图片，请说明待补充"
  },
  "copywritingStyle": {
    "tone": "语气",
    "structure": "正文结构",
    "proofPoints": "它如何建立信任感"
  },
  "conversionStyle": {
    "cta": "结尾或评论区怎么引导咨询",
    "leadQuestions": ["引导用户留下的信息1", "信息2", "信息3"]
  },
  "contentAngles": ["可复用的选题角度1", "角度2", "角度3", "角度4"],
  "risks": ["不能照抄或需要避开的点1", "点2", "点3"]
}

要求：只学习结构、节奏、视觉方法和转化方式；不要建议照抄竞品原文、图片、账号名或品牌名；输出要能直接帮助新疆旅游账号生成自己的笔记。
`.trim();
}

async function analyzeWithDeepSeek(prompt, activeProvider) {
  const client = new OpenAI({
    apiKey: activeProvider.apiKey,
    baseURL: activeProvider.baseURL
  });

  const response = await client.chat.completions.create({
    model: activeProvider.model,
    messages: [
      {
        role: "system",
        content: "你只输出合法 JSON，不输出 Markdown，不输出解释。"
      },
      {
        role: "user",
        content: prompt
      }
    ],
    response_format: { type: "json_object" },
    temperature: 0.4
  });

  return response.choices?.[0]?.message?.content || "";
}

async function analyzeWithArk(prompt, files, activeProvider) {
  const client = new OpenAI({
    apiKey: activeProvider.apiKey,
    baseURL: activeProvider.baseURL
  });

  const content = [{ type: "text", text: prompt }];
  for (const file of files) {
    if (!file.mimetype.startsWith("image/")) continue;
    content.push({
      type: "image_url",
      image_url: {
        url: `data:${file.mimetype};base64,${file.buffer.toString("base64")}`,
        detail: "high"
      }
    });
  }

  const request = {
    model: activeProvider.model,
    messages: [
      {
        role: "system",
        content: "你只输出合法 JSON，不输出 Markdown，不输出解释。"
      },
      {
        role: "user",
        content
      }
    ],
    temperature: 0.3,
    max_tokens: 4096
  };

  if (process.env.ARK_THINKING !== "on") {
    request.thinking = { type: "disabled" };
  }

  if (process.env.ARK_RESPONSE_FORMAT !== "off") {
    request.response_format = { type: "json_object" };
  }

  try {
    const response = await client.chat.completions.create(request);
    return response.choices?.[0]?.message?.content || "";
  } catch (error) {
    const message = error?.message || "";
    let shouldRetry = false;
    if (request.response_format && /response_format|json/i.test(message)) {
      delete request.response_format;
      shouldRetry = true;
    }
    if (request.thinking && /thinking/i.test(message)) {
      delete request.thinking;
      shouldRetry = true;
    }
    if (shouldRetry) {
      const response = await client.chat.completions.create(request);
      return response.choices?.[0]?.message?.content || "";
    }
    throw error;
  }
}

async function analyzeWithOpenAI(prompt, files, activeProvider) {
  const client = new OpenAI({ apiKey: activeProvider.apiKey });
  const content = [{ type: "input_text", text: prompt }];

  for (const file of files) {
    if (!file.mimetype.startsWith("image/")) continue;
    content.push({
      type: "input_image",
      image_url: `data:${file.mimetype};base64,${file.buffer.toString("base64")}`,
      detail: "high"
    });
  }

  const response = await client.responses.create({
    model: activeProvider.model,
    input: [
      {
        role: "user",
        content
      }
    ]
  });

  return response.output_text || "";
}

app.post("/api/analyze-competitor", upload.array("screenshots", 12), async (req, res) => {
  try {
    const activeProvider = getProviderConfig();
    const configError = getConfigError(activeProvider);
    if (configError) {
      res.status(400).json({ error: configError });
      return;
    }

    const files = req.files || [];
    const prompt = buildAnalysisPrompt(req, files, activeProvider);
    let raw = "";
    if (activeProvider.name === "deepseek") {
      raw = await analyzeWithDeepSeek(prompt, activeProvider);
    } else if (activeProvider.name === "volcengine") {
      raw = await analyzeWithArk(prompt, files, activeProvider);
    } else {
      raw = await analyzeWithOpenAI(prompt, files, activeProvider);
    }
    const analysis = extractJson(raw);
    res.json({
      analysis,
      raw,
      imageCount: files.length,
      model: activeProvider.model,
      provider: activeProvider.name,
      supportsImages: activeProvider.supportsImages
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({
      error: error.message || "竞品分析失败"
    });
  }
});

async function runTextModel(prompt) {
  const activeProvider = getProviderConfig("text");
  const configError = getConfigError(activeProvider);
  if (configError) throw new Error(configError);
  if (activeProvider.name === "deepseek") return { raw: await analyzeWithDeepSeek(prompt, activeProvider), provider: activeProvider };
  if (activeProvider.name === "volcengine") return { raw: await analyzeWithArk(prompt, [], activeProvider), provider: activeProvider };
  return { raw: await analyzeWithOpenAI(prompt, [], activeProvider), provider: activeProvider };
}

// ---------- 自检 ----------
app.get("/api/health", async (req, res) => {
  const activeProvider = getProviderConfig("text");
  const configError = getConfigError(activeProvider);
  const result = {
    provider: activeProvider.name,
    model: activeProvider.model || "",
    visionModel: arkModel,
    imageModel: arkImageModel,
    configOk: !configError,
    configError: configError || "",
    ping: null
  };
  if (configError || req.query.ping !== "1") {
    res.json(result);
    return;
  }
  try {
    const { raw } = await runTextModel('请只输出 JSON：{"ok":true}');
    result.ping = /ok/i.test(raw) ? "ok" : "unexpected";
  } catch (error) {
    result.ping = "error";
    result.pingError = error.message || String(error);
  }
  res.json(result);
});

// ---------- 竞品画像存档 ----------
app.get("/api/competitors", (req, res) => {
  res.json({ competitors: readCompetitors() });
});

app.post("/api/competitors", upload.array("screenshots", 12), (req, res) => {
  let { name, profile, source, status } = req.body || {};
  if (typeof profile === "string") {
    try { profile = JSON.parse(profile); } catch { profile = null; }
  }
  if (typeof source === "string") {
    try { source = JSON.parse(source); } catch { source = {}; }
  }
  if (!profile || typeof profile !== "object") {
    res.status(400).json({ error: "缺少竞品画像内容" });
    return;
  }
  const list = readCompetitors();
  const id = `cp-${Date.now()}`;
  const images = [];
  const files = req.files || [];
  if (files.length && !isReadOnlyRuntime) {
    const imageDir = path.join(__dirname, "assets", "competitors", id);
    fs.mkdirSync(imageDir, { recursive: true });
    files.forEach((file, index) => {
      if (!file.mimetype.startsWith("image/")) return;
      const ext = (path.extname(file.originalname) || ".jpg").toLowerCase();
      const fileName = `${String(index + 1).padStart(2, "0")}${ext}`;
      fs.writeFileSync(path.join(imageDir, fileName), file.buffer);
      images.push(`assets/competitors/${id}/${fileName}`);
    });
  }
  const entry = {
    id,
    name: String(name || "").trim() || `竞品画像 ${list.length + 1}`,
    savedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    status: status === "pending" ? "pending" : "analyzed",
    storage: isReadOnlyRuntime ? "browser" : "server",
    source: source || {},
    images,
    profile
  };
  const competitors = [entry, ...list];
  if (!isReadOnlyRuntime) writeCompetitors(competitors);
  res.json({
    ok: true,
    localOnly: isReadOnlyRuntime,
    competitor: entry,
    competitors
  });
});

app.delete("/api/competitors/:id", (req, res) => {
  const id = req.params.id;
  const list = readCompetitors().filter((item) => item.id !== id);
  if (!isReadOnlyRuntime) writeCompetitors(list);
  if (!isReadOnlyRuntime && /^cp-[\w-]+$/.test(id)) {
    fs.rmSync(path.join(__dirname, "assets", "competitors", id), { recursive: true, force: true });
  }
  res.json({ ok: true, localOnly: isReadOnlyRuntime, competitors: list });
});

// ---------- AI 生成笔记 ----------
function buildNotePrompt(body) {
  const route = body.route || {};
  const client = body.client || {};
  const competitor = body.competitorProfile
    ? `\n【竞品风格画像（学结构和节奏，禁止照抄原文/账号名/品牌名）】\n${JSON.stringify(body.competitorProfile, null, 2)}\n`
    : "";
  const template = body.viralTemplate || null;
  const templateForPrompt = template
    ? {
        id: template.id,
        name: template.name,
        tier: template.tier,
        goal: template.goal,
        summary: template.summary,
        evidence: template.evidence,
        titleFormula: template.titleFormula,
        titleFrames: template.titleFrames,
        openingHook: template.openingHook,
        bodyStructure: template.bodyStructure,
        requiredEvidence: template.requiredEvidence,
        avoid: template.avoid,
        validationPlan: template.validationPlan,
        sourceSamples: (template.sampleNotes || []).slice(0, 3).map((item) => ({
          title: item.title,
          likesText: item.likesText,
          source: item.source
        }))
      }
    : null;
  const viralTemplate = templateForPrompt
    ? `\n【本次必须采用的数据模板】\n${JSON.stringify(templateForPrompt, null, 2)}\n`
    : "";
  const style = body.visualStyle || null;
  const styleForPrompt = style
    ? {
        id: style.id,
        name: style.name,
        description: style.description,
        layout: style.layout,
        visualFingerprint: style.visualFingerprint,
        evidenceLabel: style.evidenceLabel,
        evidenceNote: style.evidenceNote
      }
    : null;
  const visualStyle = styleForPrompt
    ? `\n【本次图片风格】\n${JSON.stringify(styleForPrompt, null, 2)}\n`
    : "";
  const visualVariant = ((Number(body.visualVariant || 0) % 3) + 3) % 3;
  const visualVariantPlans = [
    "纵向引导线与开阔远景，主体居中或位于中上部",
    "不对称侧向构图，主体偏右，左侧保留标题与信息空间",
    "分层远景或低机位构图，主体偏左，右上保留干净留白"
  ];
  const visualVariation = `\n【本次视觉变化方案】\n构图${["A", "B", "C"][visualVariant]}：${visualVariantPlans[visualVariant]}。五张图片分别使用全景、道路或交通、代表性景点、人物背影、住宿或服务细节，不能重复同一景别和主体位置。\n`;
  const visualReferences = Array.isArray(body.visualReferences) && body.visualReferences.length
    ? `\n【竞品图片参考证据】\n${JSON.stringify(
        body.visualReferences.map((item) => ({
          title: item.title || "",
          likes: Number(item.likes || 0),
          role: item.role || ""
        })),
        null,
        2
      )}\n`
    : "";
  const personalMaterials = Array.isArray(body.personalMaterialImages) && body.personalMaterialImages.length
    ? `\n【商家自己的图片素材】\n${JSON.stringify(
        body.personalMaterialImages.map((item) => ({
          title: item.title || "",
          role: item.role || "owned-material"
        })),
        null,
        2
      )}\n`
    : "";
  const routeSceneAssets = Array.isArray(route.sceneAssets) && route.sceneAssets.length
    ? `\n【用户当前线路可用的真实场景图】\n${JSON.stringify(
        route.sceneAssets.map((item) => ({
          label: item.label || "线路场景",
          places: item.places || [],
          tags: item.tags || [],
          roles: item.roles || []
        })),
        null,
        2
      )}\n`
    : "";
  return `
你是一个专门服务新疆旅游商家的小红书内容策划。请基于以下真实资料，生成一篇能获客的小红书笔记。

【商家人设】
身份定位：${field(client.role)}
表达风格：${field(client.tone)}
服务差异：${field(client.difference)}
目标客户：${field(client.client)}

【推广线路】
线路名称：${field(route.name)}
价格区间：${field(route.price)}｜成团人数：${field(route.people)}
住宿标准：${field(route.hotel)}
适合季节：${field(route.season)}｜适合人群：${field(route.audience)}
核心路线：${field(route.spots)}
主打卖点：${field(route.selling)}
用户常见顾虑：${field(route.concerns)}
每日行程：${field(route.itinerary)}

【本次内容方向】${field(body.typeLabel)}
【补充需求 / 参考素材】
${field(body.brief)}
${competitor}
${viralTemplate}
${visualStyle}
${visualVariation}
${visualReferences}
${personalMaterials}
${routeSceneAssets}

模板使用规则：
1. 优先遵循数据模板的标题公式、开头钩子和正文结构，但不能照抄 sampleNotes 中的原句。
2. requiredEvidence 中缺失的事实不得编造；如果“真实客户结果”证据不足，改写成主理人专业判断，不得伪装游客或虚构客户反馈。
3. 标题必须使用自己的目的地、路线、人群和事实，不能出现竞品品牌名。
4. imageScenes 必须逐张声明地点、场景角色和关键词。优先选择“用户当前线路可用的真实场景图”中能够精确匹配的地点与角色；如果确实没有匹配素材，仍要写清真实线路中需要补拍或补生成的场景，供系统自动调用生图模型。
5. imagePrompts 必须同时遵循本次图片风格的 visualFingerprint、description、layout 和本次视觉变化方案；同模板保留品牌气质，但主体位置、景别、引导线和素材顺序必须明显变化。
6. 竞品图片只用于提取构图、景别、信息层级和色彩节奏；主体、目的地、住宿、车辆、人物和服务证据必须来自商家自己的资料。
7. 不得在 imagePrompts 中要求复刻竞品品牌、logo、价格、人物身份、地点、原文或水印。没有商家真实授权素材时，不得生成聊天记录、客户评价或其他伪造证明。
8. cards 是直接展示给游客看的成品文案。chip 只写2-6字的读者标签，例如“出发必看”“路线亮点”“适合人群”“获取路线”；不得出现“图1/图二/卡片3/封面/先问清/证据待补/发布前/模板”等页码、制作指令或内部策略词。
9. 如果模板 tier 为 candidate，只把它当作高客单转化实验：不得写“爆款、已验证、一定有效”等结论；价格必须使用当前线路真实价格，配置必须来自真实资料，并明确包含、不包含与服务边界。
10. 如果模板 id 为 premium-offer-explainer，5张 cards 依次承担：真实价格与产品识别、住宿/车辆/节奏/体验配置、包含与不包含边界、适合与不适合人群、日期/人数/住宿/预算咨询入口。资料缺失时写“需确认”，不得补造配置。

请只输出一个 JSON 对象，不要输出 Markdown。字段必须是：
{
  "cover": "封面主标题，15字以内，有钩子",
  "titles": ["笔记标题1", "标题2", "标题3"],
  "body": "正文，300-500字，用\\n分段。像本地领队真人分享，先痛点后干货，结尾引导私信发出发日期/人数/酒店要求/预算。不写空话，不过度承诺。",
  "tags": ["8个话题标签，不带#"],
  "comments": {
    "pinned": "评论区置顶引导",
    "dmOpening": "私信开场话术",
    "filter": "筛选客户话术"
  },
  "publishTips": "一句发布建议（发布时间/@位置/首图选择等）",
  "cards": [
    {"chip": "路线速览", "title": "这条路线怎么玩更舒服", "subtitle": "适合季节｜小团人数｜住宿特点", "footer": "线路关键信息"},
    {"chip": "出发必看", "title": "出发前重点确认这4项", "list": ["每日车程","住宿位置","成团人数","费用范围"], "footer": "重要信息提前确认"},
    {"chip": "路线亮点", "title": "代表性风景这样安排", "list": ["核心景点","停留节奏","拍照时间","住宿衔接"], "footer": "慢慢玩，才能看见更多"},
    {"chip": "适合人群", "title": "这些客人更适合小团", "list": ["情侣出行","亲子家庭","朋友结伴","摄影爱好者"], "footer": "根据同行人选择路线"},
    {"chip": "获取路线", "title": "想要路线，发我这4项", "list": ["出发日期","同行人数","住宿要求","人均预算"], "footer": "按需求给路线建议"}
  ],
  "imageScenes": [
    {"place": "真实线路中的具体地点", "scene": "目的地代表性主场景", "role": "landscape", "keywords": ["2-4个场景关键词"]},
    {"place": "真实线路中的具体地点或沿途", "scene": "道路或车辆场景", "role": "transport", "keywords": ["公路", "车辆"]},
    {"place": "真实线路中的具体景点", "scene": "代表性景点远景", "role": "landscape", "keywords": ["地貌", "光线"]},
    {"place": "真实线路中的具体地点", "scene": "同行人物背影或互动", "role": "people", "keywords": ["人物背影", "同行"]},
    {"place": "真实线路中的具体地点", "scene": "住宿或服务细节", "role": "service", "keywords": ["住宿", "服务"]}
  ],
  "imagePrompts": ["5条中文生图提示词，分别对应5张卡片的摄影底图。每条都要结合已选 visualStyle 的构图与景别，并明确为后续文字、路线图或证据区预留低干扰空间；只描述我方真实新疆线路素材中的地点、住宿、车辆与体验，不生成海报文字、聊天记录、评价截图、logo、水印或人脸特写。"]
}
`.trim();
}

function enforceCustomerProofPolicy(note, body) {
  if (body?.viralTemplate?.id !== "customer-result-proof" || body?.authorizedCustomerProof === true) {
    return note;
  }
  const route = body.route || {};
  const routeName = field(route.name, "当前线路");
  const short = field(route.short, routeName);
  const area = field(route.area, "新疆");
  const typeLabel = field(body.typeLabel, "旅行内容");
  const people = field(route.people, "按实际人数确认");
  const hotel = field(route.hotel, "按实际订单确认");
  const price = field(route.price, "按实际方案报价");
  const selling = String(route.selling || "路线节奏、住宿标准、领队服务")
    .split("、")
    .filter(Boolean)
    .slice(0, 4);
  const titles = [
    `${short}${typeLabel}，出发前先核对4项`,
    `去${area}前，路线要先看这些证据`,
    `${routeName}怎么判断是否适合自己`
  ];
  return {
    ...note,
    cover: titles[0],
    titles,
    body: `【发布前请补充真实客户授权素材】\n\n当前先用${routeName}的真实线路资料搭建复盘结构，不使用模型生成客户人数、评价、照片数量或旅行结果。\n\n发布前请补齐：客户身份与出行日期、出发前真实顾虑、可核验的路线调整、实际住宿与服务、授权反馈或合影。\n\n证据齐全后，再把事实写成客户结果复盘；没有真实素材时，只发布路线说明和主理人专业判断。`,
    cards: [
      { chip: "真实线路信息", title: titles[0], subtitle: `${routeName}的车程、住宿和服务信息`, footer: routeName },
      { chip: "每日车程", title: "每天车程提前确认", list: ["最长车程逐日确认", "尽量避免夜间赶路", "根据天气和路况调整", "老人孩子单独评估"], footer: "实际安排会结合当日路况" },
      { chip: "住宿安排", title: "住宿标准提前说清", list: [hotel, "房型与位置提前确认", "住宿以实际订单为准", "升级费用提前说明"], footer: price },
      { chip: "服务说明", title: "这些服务包含在行程里", list: selling, footer: `${people} · ${field(route.season, "季节待确认")}` },
      { chip: "获取路线", title: "想要路线，发我这4项", list: ["出发日期", "同行人数", "住宿要求", "人均预算"], footer: "按你的需求给路线建议" }
    ],
    comments: {
      pinned: `想看${short}真实行程资料，可以留下出发日期和人数。`,
      dmOpening: `我先帮你判断${routeName}是否适合。请发出发日期、人数、住宿要求和预算。`,
      filter: "客户结果与评价只使用真实授权素材；当前先提供可核对的路线信息。"
    },
    publishTips: "当前为证据待补草稿，补入真实授权反馈或合影后再发布。"
  };
}

app.post("/api/generate-note", async (req, res) => {
  try {
    const prompt = buildNotePrompt(req.body || {});
    const { raw, provider: activeProvider } = await runTextModel(prompt);
    const note = extractJson(raw);
    if (!note) {
      res.status(502).json({ error: "AI 返回了非结构化结果，请重试", raw });
      return;
    }
    const guardedNote = enforceCustomerProofPolicy(note, req.body || {});
    res.json({ note: guardedNote, provider: activeProvider.name, model: activeProvider.model });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: error.message || "生成笔记失败" });
  }
});

// ---------- AI 生图 ----------
function imageMimeType(filePath) {
  const extension = path.extname(filePath).toLowerCase();
  if (extension === ".png") return "image/png";
  if (extension === ".webp") return "image/webp";
  if (extension === ".gif") return "image/gif";
  return "image/jpeg";
}

function loadImageReference(reference) {
  const localPath = String(reference?.localPath || reference?.path || "").trim();
  if (localPath) {
    const normalized = localPath.replace(/^\/+/, "");
    const absolutePath = path.resolve(__dirname, normalized);
    const rootPrefix = `${path.resolve(__dirname)}${path.sep}`;
    if (!absolutePath.startsWith(rootPrefix)) {
      throw new Error("参考图路径不在项目目录中");
    }
    if (!fs.existsSync(absolutePath) || !fs.statSync(absolutePath).isFile()) {
      throw new Error(`参考图不存在：${localPath}`);
    }
    const bytes = fs.readFileSync(absolutePath);
    if (bytes.length > 8 * 1024 * 1024) {
      throw new Error(`参考图超过 8MB：${localPath}`);
    }
    return `data:${imageMimeType(absolutePath)};base64,${bytes.toString("base64")}`;
  }

  const sourceUrl = String(reference?.sourceUrl || reference?.url || "").trim();
  if (/^https:\/\//i.test(sourceUrl)) return sourceUrl;
  return "";
}

function loadImageReferences(references) {
  if (!Array.isArray(references)) return [];
  return references
    .slice(0, 6)
    .map(loadImageReference)
    .filter(Boolean);
}

async function arkGenerateImage(prompt, size, referenceImages = []) {
  const apiKey = process.env.ARK_API_KEY || process.env.VOLCENGINE_API_KEY;
  if (!apiKey) throw new Error("还没有配置 ARK_API_KEY，无法生图");
  const requestBody = {
    model: arkImageModel,
    prompt,
    size,
    response_format: "b64_json",
    watermark: false,
    sequential_image_generation: "disabled"
  };
  if (referenceImages.length) requestBody.image = referenceImages;
  const response = await fetch(`${arkBaseURL}/images/generations`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`
    },
    body: JSON.stringify(requestBody)
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = payload?.error?.message || `生图接口返回 ${response.status}`;
    const err = new Error(message);
    err.sizeIssue = /size|resolution|width|height/i.test(message);
    throw err;
  }
  const item = payload?.data?.[0];
  if (!item) throw new Error("生图接口没有返回图片");
  return item.b64_json ? `data:image/jpeg;base64,${item.b64_json}` : item.url;
}

app.post("/api/generate-image", async (req, res) => {
  const prompt = String(req.body?.prompt || "").trim();
  if (!prompt) {
    res.status(400).json({ error: "缺少生图提示词" });
    return;
  }
  let referenceImages = [];
  try {
    referenceImages = loadImageReferences(req.body?.referenceImages);
  } catch (error) {
    res.status(400).json({ error: error.message || "参考图读取失败" });
    return;
  }
  const sizes = req.body?.size ? [req.body.size] : ["1728x2304", "1536x2048", "1024x1024"];
  let lastError = null;
  for (const size of sizes) {
    try {
      const image = await arkGenerateImage(prompt, size, referenceImages);
      res.json({
        image,
        size,
        model: arkImageModel,
        referenceCount: referenceImages.length
      });
      return;
    } catch (error) {
      lastError = error;
      if (!error.sizeIssue) break;
    }
  }
  console.error(lastError);
  res.status(500).json({ error: lastError?.message || "生图失败" });
});

export default app;

const isMainModule = process.argv[1] && path.resolve(process.argv[1]) === __filename;
if (isMainModule) {
  app.listen(port, () => {
    console.log(`新疆获客工具已启动：http://localhost:${port}`);
    console.log(`竞品截图分析接口：http://localhost:${port}/api/analyze-competitor`);
    console.log(`当前 AI 提供商：${provider}`);
  });
}
