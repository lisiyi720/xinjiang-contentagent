#!/usr/bin/env node

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const rootDir = path.resolve(__dirname, "..");
const datasetPath = path.resolve(
  rootDir,
  process.argv[2] || "data/competitor-notes/5eddafae000000000101f5e1.json"
);
const manifestPath = path.resolve(
  rootDir,
  process.argv[3] || "data/template-image-manifest.json"
);

function hash(value) {
  return crypto.createHash("sha1").update(String(value)).digest("hex").slice(0, 12);
}

function extensionFor(contentType) {
  if (/png/i.test(contentType)) return "png";
  if (/jpe?g/i.test(contentType)) return "jpg";
  return "webp";
}

function webPath(absolutePath) {
  return path.relative(rootDir, absolutePath).split(path.sep).join("/");
}

async function fetchImage(url) {
  const response = await fetch(url, {
    headers: {
      Accept: "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8",
      Referer: "https://www.xiaohongshu.com/",
      "User-Agent":
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/126 Safari/537.36"
    },
    signal: AbortSignal.timeout(25000)
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const contentType = response.headers.get("content-type") || "image/webp";
  if (!contentType.startsWith("image/")) {
    throw new Error(`unexpected content-type ${contentType}`);
  }
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length < 1024) throw new Error("image payload is too small");
  return { bytes, contentType };
}

async function runPool(items, concurrency, worker) {
  let cursor = 0;
  const workers = Array.from({ length: concurrency }, async () => {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      await worker(items[index], index);
    }
  });
  await Promise.all(workers);
}

async function main() {
  const dataset = JSON.parse(fs.readFileSync(datasetPath, "utf8"));
  const accountId = dataset.account?.id || "unknown-account";
  const outputDir = path.join(
    rootDir,
    "assets",
    "competitor-templates",
    accountId,
    "covers"
  );
  fs.mkdirSync(outputDir, { recursive: true });

  const notes = (dataset.notes || []).filter((note) => note.coverUrl);
  const entries = [];
  const failures = [];

  await runPool(notes, 4, async (note, index) => {
    const stableId = note.id || `visible-${String(index + 1).padStart(2, "0")}-${hash(note.title)}`;
    try {
      const { bytes, contentType } = await fetchImage(note.coverUrl);
      const filename = `${stableId}.${extensionFor(contentType)}`;
      const destination = path.join(outputDir, filename);
      fs.writeFileSync(destination, bytes);
      const localCoverPath = webPath(destination);
      note.localCoverPath = localCoverPath;
      note.coverStatus = "localized";
      entries.push({
        noteId: note.id || "",
        title: note.title || "未命名笔记",
        likes: Number(note.likes || 0),
        likesText: note.likesText || String(note.likes || 0),
        noteUrl: note.url || "",
        sourceUrl: note.coverUrl,
        localPath: localCoverPath,
        widthHint: 640,
        aspectRatioHint: "3:4",
        isPinned: Boolean(note.isPinned)
      });
      process.stdout.write(`saved ${entries.length}/${notes.length} ${filename}\n`);
    } catch (error) {
      note.coverStatus = "download-failed";
      failures.push({
        title: note.title || "未命名笔记",
        sourceUrl: note.coverUrl,
        error: error.message
      });
      process.stderr.write(`failed ${note.title || index}: ${error.message}\n`);
    }
  });

  entries.sort((left, right) => right.likes - left.likes);
  dataset.assetArchive = {
    updatedAt: new Date().toISOString(),
    accountId,
    availableCoverCount: entries.length,
    failedCoverCount: failures.length,
    manifestPath: webPath(manifestPath)
  };

  fs.writeFileSync(datasetPath, `${JSON.stringify(dataset, null, 2)}\n`, "utf8");
  fs.mkdirSync(path.dirname(manifestPath), { recursive: true });
  fs.writeFileSync(
    manifestPath,
    `${JSON.stringify(
      {
        version: 1,
        generatedAt: new Date().toISOString(),
        source: {
          platform: "xiaohongshu",
          accountId,
          accountName: dataset.account?.nickname || ""
        },
        summary: {
          requested: notes.length,
          localized: entries.length,
          failed: failures.length
        },
        images: entries,
        failures
      },
      null,
      2
    )}\n`,
    "utf8"
  );

  console.log(
    JSON.stringify({
      datasetPath,
      manifestPath,
      localized: entries.length,
      failed: failures.length
    })
  );
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
