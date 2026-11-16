#!/usr/bin/env node

const fs = require("node:fs");
const path = require("node:path");
const { chromium } = require("playwright");

const profileUrl = process.argv[2];
const outputPath = process.argv[3];

if (!profileUrl || !outputPath) {
  console.error("Usage: node scripts/collect-xhs-public-profile.cjs <profile-url> <output-json>");
  process.exit(1);
}

const profileMatch = profileUrl.match(/\/user\/profile\/([a-zA-Z0-9]+)/);
if (!profileMatch) {
  console.error("The URL does not contain a Xiaohongshu profile ID.");
  process.exit(1);
}

const accountId = profileMatch[1];
const canonicalProfileUrl = `https://www.xiaohongshu.com/user/profile/${accountId}`;
const publicUserAgent =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) " +
  "AppleWebKit/537.36 (KHTML, like Gecko) " +
  "Chrome/138.0.0.0 Safari/537.36";
const chromeCandidates = [
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/Applications/Chromium.app/Contents/MacOS/Chromium"
];

function parseLikeCount(value) {
  const text = String(value || "").replace(/\s|\+/g, "");
  const tenThousands = text.match(/^([\d.]+)万$/);
  if (tenThousands) return Math.round(Number(tenThousands[1]) * 10000);
  const count = Number(text.replace(/,/g, ""));
  return Number.isFinite(count) ? count : null;
}

function canonicalizeNoteUrl(href) {
  if (!href) return "";
  const url = new URL(href, "https://www.xiaohongshu.com");
  url.search = "";
  url.hash = "";
  return url.toString();
}

function replaceUndefinedLiterals(source) {
  let output = "";
  let inString = false;
  let escaped = false;

  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];
    if (inString) {
      output += character;
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === '"') inString = false;
      continue;
    }

    if (character === '"') {
      inString = true;
      output += character;
      continue;
    }

    if (source.startsWith("undefined", index)) {
      const before = source[index - 1] || "";
      const after = source[index + "undefined".length] || "";
      const isIdentifier = /[a-zA-Z0-9_$]/;
      if (!isIdentifier.test(before) && !isIdentifier.test(after)) {
        output += "null";
        index += "undefined".length - 1;
        continue;
      }
    }

    output += character;
  }

  return output;
}

function extractInitialStateFromHtml(html) {
  const marker = "window.__INITIAL_STATE__=";
  const start = html.indexOf(marker);
  if (start < 0) throw new Error("The public profile response has no initial state.");
  const valueStart = start + marker.length;
  const valueEnd = html.indexOf("</script>", valueStart);
  if (valueEnd < 0) throw new Error("The public profile initial state is incomplete.");
  return JSON.parse(replaceUndefinedLiterals(html.slice(valueStart, valueEnd)));
}

function buildInitialSnapshot(initialState, id) {
  const userState = initialState?.user || {};
  const pageData = userState.userPageData || {};
  const initialNotes = Array.isArray(userState.notes?.[0]) ? userState.notes[0] : [];
  const notes = initialNotes.map((entry) => {
    const card = entry?.noteCard || {};
    const cover = card.cover || {};
    const defaultCover = Array.isArray(cover.infoList)
      ? cover.infoList.find((item) => item.imageScene === "WB_DFT")?.url
      : "";
    return {
      id: card.noteId || entry?.id || "",
      title: String(card.displayTitle || "").trim(),
      likesText: String(card.interactInfo?.likedCount || "").trim(),
      href: card.noteId ? `/user/profile/${id}/${card.noteId}` : "",
      coverUrl: cover.urlDefault || defaultCover || cover.urlPre || "",
      isPinned: Boolean(card.interactInfo?.sticky)
    };
  });

  return {
    profile: {
      nickname: pageData.basicInfo?.nickname || "",
      redId: pageData.basicInfo?.redId || "",
      ipLocation: pageData.basicInfo?.ipLocation || "",
      description: pageData.basicInfo?.desc || "",
      avatarUrl: pageData.basicInfo?.images || ""
    },
    interactions: Array.isArray(pageData.interactions)
      ? pageData.interactions.map((item) => ({
          type: item.type || "",
          name: item.name || "",
          count: item.count || ""
        }))
      : [],
    pagination: {
      cursor: userState.noteQueries?.[0]?.cursor || "",
      hasMore: Boolean(userState.noteQueries?.[0]?.hasMore)
    },
    notes
  };
}

async function main() {
  const executablePath = chromeCandidates.find((candidate) => fs.existsSync(candidate));
  const browser = await chromium.launch({
    headless: true,
    ...(executablePath ? { executablePath } : {}),
    args: ["--disable-blink-features=AutomationControlled"]
  });

  try {
    const context = await browser.newContext({
      viewport: { width: 1440, height: 1000 },
      locale: "zh-CN",
      userAgent: publicUserAgent
    });
    const page = await context.newPage();
    let navigationError;
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      try {
        await page.goto(profileUrl, { waitUntil: "domcontentloaded", timeout: 60000 });
        navigationError = null;
        break;
      } catch (error) {
        navigationError = error;
        console.error(`navigation attempt=${attempt} failed`);
        if (attempt < 3) await page.waitForTimeout(attempt * 1500);
      }
    }
    let usedHtmlFallback = false;
    let initialSnapshot;
    let publicHtmlSnapshot;
    try {
      const response = await fetch(profileUrl, {
        headers: {
          "accept-language": "zh-CN,zh;q=0.9",
          "user-agent": publicUserAgent
        }
      });
      if (response.ok) {
        publicHtmlSnapshot = buildInitialSnapshot(
          extractInitialStateFromHtml(await response.text()),
          accountId
        );
      }
    } catch (error) {
      console.error(`public HTML snapshot unavailable: ${error.message}`);
    }

    if (navigationError) {
      console.error("browser navigation unavailable; using public HTML fallback");
      if (!publicHtmlSnapshot) throw navigationError;
      initialSnapshot = publicHtmlSnapshot;
      usedHtmlFallback = true;
    } else {
      await page.waitForTimeout(4000);
      const browserSnapshot = await page.evaluate((id) => {
        const userState = window.__INITIAL_STATE__?.user || {};
        const pageData = userState.userPageData || {};
        const initialNotes = Array.isArray(userState.notes?.[0]) ? userState.notes[0] : [];
        const notes = initialNotes.map((entry) => {
          const card = entry?.noteCard || {};
          const cover = card.cover || {};
          const defaultCover = Array.isArray(cover.infoList)
            ? cover.infoList.find((item) => item.imageScene === "WB_DFT")?.url
            : "";
          return {
            id: card.noteId || entry?.id || "",
            title: String(card.displayTitle || "").trim(),
            likesText: String(card.interactInfo?.likedCount || "").trim(),
            href: card.noteId ? `/user/profile/${id}/${card.noteId}` : "",
            coverUrl: cover.urlDefault || defaultCover || cover.urlPre || "",
            isPinned: Boolean(card.interactInfo?.sticky)
          };
        });

        return {
          profile: {
            nickname: pageData.basicInfo?.nickname || "",
            redId: pageData.basicInfo?.redId || "",
            ipLocation: pageData.basicInfo?.ipLocation || "",
            description: pageData.basicInfo?.desc || "",
            avatarUrl: pageData.basicInfo?.images || ""
          },
          interactions: Array.isArray(pageData.interactions)
            ? pageData.interactions.map((item) => ({
                type: item.type || "",
                name: item.name || "",
                count: item.count || ""
              }))
            : [],
          pagination: {
            cursor: userState.noteQueries?.[0]?.cursor || "",
            hasMore: Boolean(userState.noteQueries?.[0]?.hasMore)
          },
          notes
        };
      }, accountId);
      const htmlProfile = publicHtmlSnapshot?.profile || {};
      const browserProfile = browserSnapshot.profile || {};
      initialSnapshot = {
        profile: {
          nickname: browserProfile.nickname || htmlProfile.nickname || "",
          redId: browserProfile.redId || htmlProfile.redId || "",
          ipLocation: browserProfile.ipLocation || htmlProfile.ipLocation || "",
          description: browserProfile.description || htmlProfile.description || "",
          avatarUrl: browserProfile.avatarUrl || htmlProfile.avatarUrl || ""
        },
        interactions: browserSnapshot.interactions.length
          ? browserSnapshot.interactions
          : publicHtmlSnapshot?.interactions || [],
        pagination: {
          cursor:
            browserSnapshot.pagination.cursor ||
            publicHtmlSnapshot?.pagination?.cursor ||
            "",
          hasMore:
            browserSnapshot.pagination.hasMore ||
            Boolean(publicHtmlSnapshot?.pagination?.hasMore)
        },
        notes: [
          ...(publicHtmlSnapshot?.notes || []),
          ...browserSnapshot.notes
        ]
      };
    }

    const seen = new Map();
    const mergeCard = (card, source) => {
      if (!card.title) return;
      const key = `${card.title}::${card.likesText}`;
      const previous = seen.get(key) || {};
      const next = { ...previous };
      for (const [field, value] of Object.entries(card)) {
        if (value !== "" && value !== null && value !== undefined) next[field] = value;
      }
      next.collectionSources = Array.from(
        new Set([...(previous.collectionSources || []), source])
      );
      seen.set(key, next);
    };
    initialSnapshot.notes.forEach((card) => mergeCard(card, "initial-state"));

    let stalledRounds = 0;
    let previousSize = 0;

    for (let round = 0; !usedHtmlFallback && round < 60 && stalledRounds < 7; round += 1) {
      const cards = await page.locator("section.note-item").evaluateAll((sections, id) =>
        sections.map((section) => {
          const title = (section.querySelector(".title")?.textContent || "").trim();
          const href =
            section.querySelector("a.cover")?.getAttribute("href") ||
            section.querySelector("a.title")?.getAttribute("href") ||
            "";
          const hrefMatch = href.match(new RegExp(`/user/profile/${id}/([a-zA-Z0-9]+)`));
          const noteId = section.getAttribute("data-note-id") || hrefMatch?.[1] || "";
          const counts = Array.from(section.querySelectorAll(".count"));
          const likesText = (counts.at(-1)?.textContent || "").trim();
          const cover = section.querySelector("a.cover img");
          const coverUrl =
            cover?.getAttribute("src") ||
            cover?.getAttribute("data-src") ||
            "";

          return {
            id: noteId,
            title,
            likesText,
            href,
            coverUrl,
            isPinned: Boolean(section.querySelector(".top-wrapper"))
          };
        }),
      accountId);

      for (const card of cards) {
        mergeCard(card, "rendered-profile");
      }

      stalledRounds = seen.size === previousSize ? stalledRounds + 1 : 0;
      previousSize = seen.size;
      console.error(`round=${round + 1} notes=${seen.size} stalled=${stalledRounds}`);

      await page.evaluate(() => {
        const candidates = [
          document.scrollingElement,
          ...document.querySelectorAll(
            ".tab-content-item, .feeds-tab-container, .user-page-container, main"
          )
        ].filter(Boolean);
        const target = candidates
          .filter((element) => element.scrollHeight > element.clientHeight + 20)
          .sort(
            (left, right) =>
              right.scrollHeight -
              right.clientHeight -
              (left.scrollHeight - left.clientHeight)
          )[0];

        if (target) target.scrollBy(0, 1500);
        else window.scrollBy(0, 1500);
      });
      await page.waitForTimeout(850);
    }

    const notes = Array.from(seen.values()).map((card, index) => {
      const fullUrl = card.id && card.href
        ? new URL(card.href, "https://www.xiaohongshu.com").toString()
        : "";
      return {
        order: index + 1,
        id: card.id,
        title: card.title,
        isPinned: card.isPinned,
        likesText: card.likesText,
        likes: parseLikeCount(card.likesText),
        url: card.id ? canonicalizeNoteUrl(card.href) : "",
        accessUrl: fullUrl,
        coverUrl: card.coverUrl,
        collectionSources: card.collectionSources || []
      };
    });

    const payload = {
      version: 1,
      collectedAt: new Date().toISOString(),
      collectionMethod: usedHtmlFallback
        ? "public-profile-html-fallback"
        : "public-profile-initial-state-and-browser",
      account: {
        id: accountId,
        profileUrl: canonicalProfileUrl,
        ...initialSnapshot.profile,
        interactions: initialSnapshot.interactions
      },
      pagination: {
        ...initialSnapshot.pagination,
        noteIdsMayBeRedacted: notes.some((note) => !note.id)
      },
      fields: ["title", "likes", "noteUrl", "coverUrl"],
      limitations: [
        "Only public notes visible from the profile page are included.",
        "Like counts are snapshots and may change.",
        "Full note bodies, comments, saves and shares require a second-stage detail collection."
      ],
      noteCount: notes.length,
      notes
    };

    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    fs.writeFileSync(outputPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
    console.log(JSON.stringify({ outputPath, noteCount: notes.length }));
  } finally {
    await browser.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
