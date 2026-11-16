import multer from "multer";
import OpenAI from "openai";

export const config = {
  api: {
    bodyParser: false
  }
};

const provider = (
  process.env.AI_PROVIDER ||
  (process.env.ARK_API_KEY || process.env.VOLCENGINE_API_KEY ? "volcengine" : "") ||
  (process.env.DEEPSEEK_API_KEY ? "deepseek" : "openai")
).toLowerCase();
const openaiModel = process.env.OPENAI_MODEL || "gpt-4.1-mini";
const deepseekModel = process.env.DEEPSEEK_MODEL || "deepseek-v4-flash";
const deepseekBaseURL = process.env.DEEPSEEK_BASE_URL || "https://api.deepseek.com";
const arkModel = process.env.ARK_MODEL || process.env.VOLCENGINE_MODEL || "";
const arkBaseURL = process.env.ARK_BASE_URL || process.env.VOLCENGINE_BASE_URL || "https://ark.cn-beijing.volces.com/api/v3";

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    files: 12,
    fileSize: 8 * 1024 * 1024
  }
});

function runUpload(req, res) {
  return new Promise((resolve, reject) => {
    upload.array("screenshots", 12)(req, res, (error) => {
      if (error) reject(error);
      else resolve();
    });
  });
}

function extractJson(text) {
  const cleaned = String(text || "").trim().replace(/^```json\s*/i, "").replace(/^```\s*/i, "").replace(/```$/i, "").trim();
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

function field(value) {
  return String(value || "").trim() || "未填写";
}

function getProviderConfig() {
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
      model: arkModel,
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
    if (activeProvider.name === "deepseek") return "部署环境还没有设置 DEEPSEEK_API_KEY。请在 Vercel Project Settings > Environment Variables 中配置。";
    if (activeProvider.name === "volcengine") return "部署环境还没有设置 ARK_API_KEY 或 VOLCENGINE_API_KEY。请在 Vercel Project Settings > Environment Variables 中配置。";
    return "部署环境还没有设置 OPENAI_API_KEY。请在 Vercel Project Settings > Environment Variables 中配置。";
  }

  if (!activeProvider.model) {
    if (activeProvider.name === "volcengine") return "火山方舟还缺少 ARK_MODEL。请在 Vercel 环境变量里填写视觉模型 ID 或 Endpoint ID。";
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
      { role: "system", content: "你只输出合法 JSON，不输出 Markdown，不输出解释。" },
      { role: "user", content: prompt }
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
      { role: "system", content: "你只输出合法 JSON，不输出 Markdown，不输出解释。" },
      { role: "user", content }
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
    input: [{ role: "user", content }]
  });

  return response.output_text || "";
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    res.status(204).end();
    return;
  }

  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  try {
    await runUpload(req, res);

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

    res.status(200).json({
      analysis: extractJson(raw),
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
}
