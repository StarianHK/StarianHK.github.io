import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { chromium } from "playwright-core";

const DEFAULT_LOGIN_URL = "https://mp.weixin.qq.com/";
const DEFAULT_CONTENT_DIR = path.join("content", "events");
const DEFAULT_SESSION_DIR = path.join(".cache", "wechat-session");
const DEFAULT_WAIT_TIMEOUT_MS = 10 * 60 * 1000;
const SHANGHAI_OFFSET = "+08:00";
const TARGET_ACCOUNT = {
  nickname:
    process.env.WECHAT_TARGET_NICKNAME || "\u661f\u5b78\u6ed9Starian",
  userName: process.env.WECHAT_TARGET_USER_NAME || "gh_e137b4390a48",
  biz: process.env.WECHAT_TARGET_BIZ || "MzU1MjI5NTM3NA==",
};

function parseArgs(argv) {
  const options = {
    help: false,
    push: false,
    dryRun: false,
    build: true,
    headless: false,
    loginUrl: process.env.WECHAT_LOGIN_URL || DEFAULT_LOGIN_URL,
    articleUrl: process.env.WECHAT_ARTICLE_URL || "",
    browserChannel: process.env.WECHAT_BROWSER_CHANNEL || "msedge",
    browserExecutablePath: process.env.WECHAT_BROWSER_EXECUTABLE_PATH || "",
    contentDir: process.env.WECHAT_CONTENT_DIR || DEFAULT_CONTENT_DIR,
    sessionDir: process.env.WECHAT_SESSION_DIR || DEFAULT_SESSION_DIR,
    waitTimeoutMs: Number.parseInt(
      process.env.WECHAT_WAIT_TIMEOUT_MS || `${DEFAULT_WAIT_TIMEOUT_MS}`,
      10,
    ),
    commitMessage: process.env.WECHAT_COMMIT_MESSAGE || "",
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === "--help" || arg === "-h") {
      options.help = true;
      continue;
    }

    if (arg === "--push") {
      options.push = true;
      continue;
    }

    if (arg === "--dry-run") {
      options.dryRun = true;
      continue;
    }

    if (arg === "--no-build") {
      options.build = false;
      continue;
    }

    if (arg === "--headless") {
      options.headless = true;
      continue;
    }

    if (arg === "--headed") {
      options.headless = false;
      continue;
    }

    const next = argv[index + 1];
    if (!next) {
      throw new Error(`Missing value for ${arg}`);
    }

    if (arg === "--login-url") {
      options.loginUrl = next;
      index += 1;
      continue;
    }

    if (arg === "--article-url") {
      options.articleUrl = next;
      index += 1;
      continue;
    }

    if (arg === "--browser-channel") {
      options.browserChannel = next;
      index += 1;
      continue;
    }

    if (arg === "--browser-executable-path") {
      options.browserExecutablePath = next;
      index += 1;
      continue;
    }

    if (arg === "--content-dir") {
      options.contentDir = next;
      index += 1;
      continue;
    }

    if (arg === "--session-dir") {
      options.sessionDir = next;
      index += 1;
      continue;
    }

    if (arg === "--wait-timeout-ms") {
      options.waitTimeoutMs = Number.parseInt(next, 10);
      index += 1;
      continue;
    }

    if (arg === "--commit-message") {
      options.commitMessage = next;
      index += 1;
      continue;
    }

    throw new Error(`Unknown argument: ${arg}`);
  }

  if (!Number.isFinite(options.waitTimeoutMs) || options.waitTimeoutMs <= 0) {
    throw new Error("WECHAT_WAIT_TIMEOUT_MS must be a positive integer.");
  }

  return options;
}

function printHelp() {
  console.log(`Usage:
  npm run sync:wechat:auto
  npm run sync:wechat -- [options]

Default flow:
  1. Open the WeChat Official Accounts backend and wait for QR-code sign-in.
  2. Open the normal article-management page automatically.
  3. Read all published article links returned by that page.
  4. Compare article IDs with content/events and import every missing article.
  5. Build the site and optionally commit + push.

Options:
  --push                            Commit and push after content creation.
  --dry-run                         Preview build + git actions without commit/push.
  --no-build                        Skip the Hugo build step.
  --headless                        Run browser hidden.
  --headed                          Force a visible browser window.
  --login-url <url>                 Override the login page URL.
  --article-url <url>               Import a specific article directly.
  --browser-channel <channel>       Browser channel for Playwright (default: msedge).
  --browser-executable-path <path>  Use a specific browser executable.
  --content-dir <path>              Directory for generated event content.
  --session-dir <path>              Persistent browser session directory.
  --wait-timeout-ms <ms>            Max wait time for QR-code login.
  --commit-message <message>        Commit message used with --push.
`);
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd || process.cwd(),
    stdio: options.stdio || "inherit",
    encoding: "utf8",
    env: process.env,
  });

  if (result.error) {
    throw result.error;
  }

  if (result.status !== 0) {
    throw new Error(
      `${command} ${args.join(" ")} exited with code ${result.status ?? 1}`,
    );
  }

  return result;
}

function capture(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd || process.cwd(),
    stdio: ["ignore", "pipe", "pipe"],
    encoding: "utf8",
    env: process.env,
  });

  if (result.error) {
    throw result.error;
  }

  if (result.status !== 0) {
    const stderr = result.stderr?.trim();
    throw new Error(
      stderr || `${command} ${args.join(" ")} exited with code ${result.status ?? 1}`,
    );
  }

  return result.stdout.trim();
}

function captureBuffer(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd || process.cwd(),
    stdio: ["ignore", "pipe", "pipe"],
    encoding: null,
    env: process.env,
  });

  if (result.error) {
    throw result.error;
  }

  if (result.status !== 0) {
    const stderr = result.stderr?.toString("utf8").trim();
    throw new Error(
      stderr || `${command} ${args.join(" ")} exited with code ${result.status ?? 1}`,
    );
  }

  return result.stdout;
}

function toTomlString(value) {
  return JSON.stringify(value ?? "");
}

function normalizeGitPath(value) {
  return String(value || "").replace(/\\/g, "/");
}

function sanitizeFileSegment(value) {
  return value
    .normalize("NFKC")
    .replace(/[<>:"/\\|?*\u0000-\u001F]/g, "-")
    .replace(/[\s,.;:!?()[\]{}]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .replace(/\.+$/g, "")
    .slice(0, 120);
}

function formatDateParts(date, options = {}) {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: options.withTime ? "2-digit" : undefined,
    minute: options.withTime ? "2-digit" : undefined,
    second: options.withTime ? "2-digit" : undefined,
    hourCycle: "h23",
  });

  return Object.fromEntries(
    formatter
      .formatToParts(date)
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, part.value]),
  );
}

function formatShanghaiDateTime(date = new Date()) {
  const parts = formatDateParts(date, { withTime: true });
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:${parts.second}${SHANGHAI_OFFSET}`;
}

function parsePublishDate(meta) {
  if (meta.unixTimestamp) {
    return formatShanghaiDateTime(new Date(meta.unixTimestamp * 1000));
  }

  const candidates = [meta.publishedAt, meta.publishText].filter(Boolean);
  for (const candidate of candidates) {
    const normalized = candidate.replace(/\u00a0/g, " ").trim();
    const directIso = normalized.match(
      /^(\d{4})[-/](\d{1,2})[-/](\d{1,2})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?)?/,
    );
    if (directIso) {
      const [, year, month, day, hour = "10", minute = "00", second = "00"] =
        directIso;
      return `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}T${hour.padStart(2, "0")}:${minute}:${second.padStart(2, "0")}${SHANGHAI_OFFSET}`;
    }

    const cn = normalized.match(
      /^(\d{4})年(\d{1,2})月(\d{1,2})日(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?)?/,
    );
    if (cn) {
      const [, year, month, day, hour = "10", minute = "00", second = "00"] = cn;
      return `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}T${hour.padStart(2, "0")}:${minute}:${second.padStart(2, "0")}${SHANGHAI_OFFSET}`;
    }
  }

  return formatShanghaiDateTime();
}

function extractArticleKey(sourceLink) {
  const url = new URL(sourceLink);
  const pathMatch = url.pathname.match(/^\/s\/([A-Za-z0-9_-]{8,})\/?$/);
  if (pathMatch) {
    return pathMatch[1];
  }

  const sn = url.searchParams.get("sn");
  if (sn) {
    return sn;
  }

  const mid = url.searchParams.get("mid");
  const idx = url.searchParams.get("idx");
  if (mid && idx) {
    return `${mid}-${idx}`;
  }

  return crypto.createHash("sha1").update(sourceLink).digest("hex").slice(0, 16);
}

function buildStubContent(sourceLink) {
  return `Source link: ${sourceLink}\n`;
}

async function findExistingEventFile(contentDir, articleKey) {
  const entries = await fs.readdir(contentDir, { withFileTypes: true });
  const targetSuffix = `-${articleKey}.md`.toLowerCase();
  const match = entries.find(
    (entry) => entry.isFile() && entry.name.toLowerCase().endsWith(targetSuffix),
  );

  return match ? path.join(contentDir, match.name) : "";
}

async function writeEventFile(repoRoot, article, options) {
  const contentDir = path.resolve(repoRoot, options.contentDir);
  await fs.mkdir(contentDir, { recursive: true });

  const publishDateTime = parsePublishDate(article);
  const datePrefix = publishDateTime.slice(0, 10);
  const articleKey = extractArticleKey(article.sourceLink);
  const safeTitle = sanitizeFileSegment(article.title) || "wechat-event";
  const existingFile = await findExistingEventFile(contentDir, articleKey);
  if (existingFile) {
  return {
    path: existingFile,
    relativePath: path.relative(repoRoot, existingFile),
    gitPath: normalizeGitPath(path.relative(repoRoot, existingFile)),
    skipped: true,
  };
  }

  const fileName = `${datePrefix}-${safeTitle}-${articleKey}.md`;
  const absolutePath = path.join(contentDir, fileName);
  const frontMatter = [
    "+++",
    `date = '${publishDateTime}'`,
    "draft = false",
    `title = ${toTomlString(article.title)}`,
    `article_id = ${toTomlString(articleKey)}`,
    `source_link = ${toTomlString(article.sourceLink)}`,
    "+++",
    "",
  ].join("\n");

  await fs.writeFile(
    absolutePath,
    `${frontMatter}${buildStubContent(article.sourceLink)}`,
    "utf8",
  );

  return {
    path: absolutePath,
    relativePath: path.relative(repoRoot, absolutePath),
    gitPath: normalizeGitPath(path.relative(repoRoot, absolutePath)),
    skipped: false,
  };
}

function parseNulSeparatedPaths(buffer) {
  return buffer
    .toString("utf8")
    .split("\0")
    .filter(Boolean);
}

function getChangedPathsSinceHead(repoRoot) {
  const tracked = parseNulSeparatedPaths(
    captureBuffer("git", ["diff", "--name-only", "-z", "HEAD"], {
      cwd: repoRoot,
    }),
  );
  const untracked = parseNulSeparatedPaths(
    captureBuffer("git", ["ls-files", "--others", "--exclude-standard", "-z"], {
      cwd: repoRoot,
    }),
  );

  return new Set([...tracked, ...untracked]);
}

function stageCommitAndPush(repoRoot, commitMessage, pathsToStage) {
  if (pathsToStage.length === 0) {
    console.log("No new Git changes detected after sync.");
    return false;
  }

  run("git", ["add", "-A", "--", ...pathsToStage], { cwd: repoRoot });
  const staged = capture("git", ["diff", "--cached", "--name-only"], {
    cwd: repoRoot,
  });

  if (!staged) {
    console.log("No Git changes detected after sync.");
    return false;
  }

  run("git", ["commit", "-m", commitMessage], { cwd: repoRoot });
  run("git", ["push"], { cwd: repoRoot });
  return true;
}

function dryRunStageCommitAndPush(commitMessage, pathsToStage) {
  if (pathsToStage.length === 0) {
    console.log("Dry run: no new Git changes detected after sync.");
    return false;
  }

  console.log("Dry run: build succeeded.");
  console.log(`Dry run: would stage ${pathsToStage.length} path(s):`);
  for (const filePath of pathsToStage) {
    console.log(`  ${filePath}`);
  }
  console.log(`Dry run: would commit with message: ${commitMessage}`);
  console.log("Dry run: would push to the current Git remote.");
  return true;
}

function runBuild(repoRoot) {
  run(process.execPath, ["scripts/build-deploy.mjs"], { cwd: repoRoot });
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function normalizeWeChatUrl(raw) {
  if (!raw) {
    return "";
  }

  try {
    const value = String(raw).trim();
    if (!value) {
      return "";
    }

    if (value.startsWith("//")) {
      return `https:${value}`;
    }

    if (value.startsWith("/")) {
      return new URL(value, "https://mp.weixin.qq.com").toString();
    }

    return new URL(value).toString();
  } catch {
    return "";
  }
}

function isWeChatArticleUrl(raw) {
  try {
    const url = new URL(raw);
    return /(^|\.)mp\.weixin\.qq\.com$/i.test(url.hostname) && url.pathname.startsWith("/s");
  } catch {
    return false;
  }
}

async function openBrowserContext(options) {
  const launchOptions = {
    headless: options.headless,
    viewport: null,
  };

  if (options.browserExecutablePath) {
    launchOptions.executablePath = options.browserExecutablePath;
  } else if (options.browserChannel) {
    launchOptions.channel = options.browserChannel;
  }

  const sessionDir = path.resolve(process.cwd(), options.sessionDir);
  await fs.mkdir(sessionDir, { recursive: true });
  return chromium.launchPersistentContext(sessionDir, launchOptions);
}

async function waitForQuietPage(page) {
  await page.waitForLoadState("domcontentloaded");
  try {
    await page.waitForLoadState("networkidle", { timeout: 8_000 });
  } catch {
    // Some pages keep long-lived requests open.
  }
}

async function waitForBackendLogin(context, timeoutMs) {
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    const pages = [...context.pages()].reverse();

    for (const page of pages) {
      const currentUrl = page.url();
      if (!currentUrl || !currentUrl.includes("mp.weixin.qq.com")) {
        continue;
      }

      try {
        const parsed = new URL(currentUrl);
        const token = parsed.searchParams.get("token");
        if (token) {
          return { page, token, homeUrl: currentUrl };
        }
      } catch {
        // Ignore transient urls during redirects.
      }
    }

    await sleep(1_500);
  }

  throw new Error("Timed out waiting for WeChat Official Accounts login.");
}

async function getSessionHeaders(context, page, referer = DEFAULT_LOGIN_URL) {
  const cookies = await context.cookies("https://mp.weixin.qq.com");
  const cookieHeader = cookies.map((cookie) => `${cookie.name}=${cookie.value}`).join("; ");
  const userAgent = await page.evaluate(() => navigator.userAgent);

  return {
    accept: "application/json, text/plain, */*",
    "accept-language": "zh-CN,zh;q=0.9",
    cookie: cookieHeader,
    referer,
    "user-agent": userAgent,
    "x-requested-with": "XMLHttpRequest",
  };
}

async function fetchTextWithSession(context, page, url, referer) {
  const headers = await getSessionHeaders(context, page, referer);
  const response = await fetch(url, {
    method: "GET",
    headers,
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch ${url}: HTTP ${response.status}`);
  }

  return response.text();
}

async function fetchJsonWithSession(context, page, url, referer) {
  const text = await fetchTextWithSession(context, page, url, referer);
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`Expected JSON from ${url}, received: ${text.slice(0, 240)}`);
  }
}

function getSearchBizUrls(token, query) {
  const encoded = encodeURIComponent(query);
  return [
    `https://mp.weixin.qq.com/cgi-bin/searchbiz?action=search_biz&token=${token}&lang=zh_CN&f=json&ajax=1&begin=0&count=10&query=${encoded}`,
    `https://mp.weixin.qq.com/cgi-bin/searchbiz?token=${token}&lang=zh_CN&f=json&ajax=1&action=search_biz&begin=0&count=10&query=${encoded}`,
  ];
}

function pickMatchingAccount(items) {
  const normalizedTargetNames = new Set(
    [TARGET_ACCOUNT.nickname, TARGET_ACCOUNT.userName]
      .map((value) => String(value || "").trim().toLowerCase())
      .filter(Boolean),
  );

  return items.find((item) => {
    const values = [
      item.nickname,
      item.alias,
      item.user_name,
      item.userName,
      item.biz,
      item.fakeid,
    ]
      .map((value) => String(value || "").trim().toLowerCase())
      .filter(Boolean);

    if (values.includes(String(TARGET_ACCOUNT.biz).trim().toLowerCase())) {
      return true;
    }

    return values.some((value) => normalizedTargetNames.has(value));
  });
}

async function searchTargetAccount(context, page, token, referer) {
  const queries = [
    TARGET_ACCOUNT.nickname,
    TARGET_ACCOUNT.userName,
    TARGET_ACCOUNT.biz,
  ].filter(Boolean);

  for (const query of queries) {
    for (const url of getSearchBizUrls(token, query)) {
      try {
        const data = await fetchJsonWithSession(context, page, url, referer);
        const lists = [data.list, data.biz_list, data.bizList].filter(Array.isArray);
        const flattened = lists.flat();
        const match = pickMatchingAccount(flattened);
        if (match) {
          return match;
        }
      } catch {
        // Try the next URL/query variant.
      }
    }
  }

  throw new Error("Unable to locate the target public account from the authenticated backend session.");
}

function getAppmsgPublishUrls(token, fakeid) {
  const encodedFakeid = encodeURIComponent(fakeid);
  return [
    `https://mp.weixin.qq.com/cgi-bin/appmsgpublish?sub=list&search_field=null&begin=0&count=20&query=&fakeid=${encodedFakeid}&type=101_1&free_publish_type=1&sub_action=list_ex&token=${token}&lang=zh_CN&f=json&ajax=1`,
    `https://mp.weixin.qq.com/cgi-bin/appmsgpublish?token=${token}&lang=zh_CN&f=json&ajax=1&sub=list&begin=0&count=20&query=&fakeid=${encodedFakeid}&type=101_1&free_publish_type=1&sub_action=list_ex`,
    `https://mp.weixin.qq.com/cgi-bin/appmsg?token=${token}&lang=zh_CN&f=json&ajax=1&action=list_ex&begin=0&count=20&query=&fakeid=${encodedFakeid}&type=9`,
  ];
}

function toUnixTimestamp(value) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value > 1_000_000_000_000 ? Math.floor(value / 1000) : value;
  }

  if (typeof value === "string" && /^\d+$/.test(value.trim())) {
    return toUnixTimestamp(Number(value.trim()));
  }

  return 0;
}

function cleanText(value) {
  return String(value || "")
    .replace(/\u00a0/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function maybeParseJsonString(value) {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  if (
    !(trimmed.startsWith("{") && trimmed.endsWith("}")) &&
    !(trimmed.startsWith("[") && trimmed.endsWith("]"))
  ) {
    return null;
  }

  try {
    return JSON.parse(trimmed);
  } catch {
    return null;
  }
}

function pushArticleCandidate(candidates, source, title, url, timestamp) {
  const normalizedUrl = normalizeWeChatUrl(url);
  const normalizedTitle = cleanText(title);

  if (!normalizedTitle || !isWeChatArticleUrl(normalizedUrl)) {
    return;
  }

  candidates.push({
    title: normalizedTitle,
    url: normalizedUrl,
    timestamp: toUnixTimestamp(timestamp),
    source,
  });
}

function collectArticleCandidates(value, candidates = []) {
  if (value == null) {
    return candidates;
  }

  const parsed = maybeParseJsonString(value);
  if (parsed) {
    collectArticleCandidates(parsed, candidates);
    return candidates;
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      collectArticleCandidates(item, candidates);
    }
    return candidates;
  }

  if (typeof value !== "object") {
    return candidates;
  }

  pushArticleCandidate(
    candidates,
    "object",
    value.title || value.appmsg_title || value.name,
    value.link || value.url || value.content_url || value.article_url,
    value.update_time || value.publish_time || value.create_time || value.date,
  );

  if (Array.isArray(value.appmsgex)) {
    for (const item of value.appmsgex) {
      pushArticleCandidate(
        candidates,
        "appmsgex",
        item.title || item.appmsg_title || item.name,
        item.link || item.url || item.content_url || item.article_url,
        item.update_time || item.publish_time || item.create_time || item.date,
      );
    }
  }

  if (Array.isArray(value.appmsg_info)) {
    for (const item of value.appmsg_info) {
      pushArticleCandidate(
        candidates,
        "appmsg_info",
        item.title || item.appmsg_title || item.name,
        item.link || item.url || item.content_url || item.article_url,
        item.update_time || item.publish_time || item.create_time || item.date,
      );
    }
  }

  for (const nested of Object.values(value)) {
    collectArticleCandidates(nested, candidates);
  }

  return candidates;
}

function dedupeCandidates(candidates) {
  const seen = new Set();
  return candidates.filter((candidate) => {
    if (seen.has(candidate.url)) {
      return false;
    }

    seen.add(candidate.url);
    return true;
  });
}

async function fetchArticleCandidatesFromBackend(context, page, token, fakeid, referer) {
  // Open the normal article-management page and observe the requests it makes.
  // This follows the browser UI flow instead of issuing private API calls from
  // Node, which is what triggered WeChat's frequency control previously.
  try {
    const responseBodies = [];
    const onResponse = async (response) => {
      if (!response.url().includes("mp.weixin.qq.com")) return;
      const contentType = response.headers()["content-type"] || "";
      if (!contentType.includes("json") && !response.url().includes("appmsg")) return;
      try {
        const text = await response.text();
        if (text.includes("mp.weixin.qq.com/s/") || text.includes("appmsgex") || text.includes("appmsg_info")) {
          responseBodies.push(text);
        }
      } catch {
        // Ignore responses that are unavailable after navigation.
      }
    };
    context.on("response", onResponse);
    let managementPage = page;
    console.log("Opening the authenticated backend home page...");
    await managementPage.goto(referer, { waitUntil: "domcontentloaded", timeout: 60_000 });
    await waitForQuietPage(managementPage);
    console.log(`Backend home loaded: ${managementPage.url()}`);
    const appmsgLink = managementPage.locator('a[href*="appmsgpublish"], [data-href*="appmsgpublish"]').first();
    if (await appmsgLink.count()) {
      console.log("Opening article management from the backend navigation...");
      try {
        await appmsgLink.click({ timeout: 10_000 });
      } catch {
        await appmsgLink.evaluate((element) => element.click());
      }
    } else {
      const contentMenu = managementPage.getByText(/\\u5185\\u5bb9\\u7ba1\\u7406|\\u6587\\u7ae0\\u7ba1\\u7406|\\u53d1\\u8868\\u8bb0\\u5f55/).first();
      if (!(await contentMenu.count())) {
        throw new Error("Article-management menu was not found on the authenticated home page.");
      }
      console.log("Opening article management from the content menu...");
      try {
        await contentMenu.click({ timeout: 10_000 });
      } catch {
        await contentMenu.evaluate((element) => element.click());
      }
    }
    const popupPage = context.pages().find((candidate) =>
      candidate !== managementPage && /appmsg|material/i.test(candidate.url()),
    );
    if (popupPage) {
      managementPage = popupPage;
      await page.close();
      await waitForQuietPage(managementPage);
    }
    await waitForQuietPage(managementPage);
    console.log(`Article management loaded: ${managementPage.url()}`);
    await sleep(2_000);
    context.off("response", onResponse);

    const networkCandidates = dedupeCandidates(
      responseBodies.flatMap((body) => collectArticleCandidates(maybeParseJsonString(body) || body)),
    );
    if (networkCandidates.length > 0) {
      networkCandidates.sort((left, right) => right.timestamp - left.timestamp);
      console.log(`Found ${networkCandidates.length} article candidate(s) from the management page.`);
      return networkCandidates;
    }

    const candidates = await managementPage.evaluate(() => {
      const normalize = (value) => String(value || "").replace(/\s+/g, " ").trim();
      const links = [...document.querySelectorAll("a[href], [data-url], [data-link]")];
      return links.map((link) => {
        try {
          const rawUrl = link.href || link.getAttribute("data-url") || link.getAttribute("data-link");
          const url = new URL(rawUrl, window.location.href).toString();
          return { title: normalize(link.textContent), url };
        } catch {
          return null;
        }
      }).filter((item) => item && /^https?:\/\/mp\.weixin\.qq\.com\/s\//i.test(item.url));
    });
    if (candidates.length > 0) {
      console.log(`Found ${candidates.length} article link(s) in the article-management page.`);
      return candidates;
    }
    throw new Error("The article-management page loaded, but no article links were found in its page or network data.");
  } catch (error) {
    throw new Error(`Unable to read the article-management page automatically: ${error instanceof Error ? error.message : String(error)}`);
  }
}

async function extractArticleFromPage(page, fallbackTitle = "") {
  await waitForQuietPage(page);

  const data = await page.evaluate(() => {
    const normalize = (value) =>
      (value || "")
        .replace(/\u00a0/g, " ")
        .replace(/\r/g, "")
        .split("\n")
        .map((line) => line.trim())
        .join("\n")
        .replace(/\n{3,}/g, "\n\n")
        .trim();

    const title =
      normalize(document.querySelector("#activity-name")?.textContent) ||
      normalize(document.querySelector("h1.rich_media_title")?.textContent) ||
      normalize(document.querySelector("h1")?.textContent) ||
      normalize(document.title);

    const canonicalUrl =
      document.querySelector('link[rel="canonical"]')?.href ||
      document.querySelector('meta[property="og:url"]')?.content ||
      window.location.href;

    const publishedAt =
      document.querySelector('meta[property="article:published_time"]')?.content ||
      "";

    const publishText =
      normalize(document.querySelector("#publish_time")?.textContent) ||
      normalize(document.querySelector(".rich_media_meta.rich_media_meta_text")?.textContent) ||
      "";

    const rawTimestamp = Number(window.ct);
    const unixTimestamp = Number.isFinite(rawTimestamp) && rawTimestamp > 0 ? rawTimestamp : 0;

    return {
      title,
      sourceLink: canonicalUrl,
      publishedAt,
      publishText,
      unixTimestamp,
    };
  });

  return {
    ...data,
    title: data.title || fallbackTitle || "WeChat update",
    sourceLink: normalizeWeChatUrl(data.sourceLink),
  };
}

async function fetchArticles(options) {
  const context = await openBrowserContext(options);

  try {
    if (options.articleUrl) {
      const page = context.pages()[0] || (await context.newPage());
      await page.goto(options.articleUrl, {
        waitUntil: "domcontentloaded",
        timeout: 60_000,
      });
      return [await extractArticleFromPage(page)];
    }

    const page = context.pages()[0] || (await context.newPage());
    await page.goto(options.loginUrl, {
      waitUntil: "domcontentloaded",
      timeout: 60_000,
    });
    console.log("Browser opened. Scan the QR code to sign in to the WeChat Official Accounts backend.");

    const { page: homePage, token, homeUrl } = await waitForBackendLogin(
      context,
      options.waitTimeoutMs,
    );
    console.log("Login detected. Opening the article-management page automatically.");
    // The target account's biz is configured above, so no account-search API call
    // is needed. Avoiding that extra request also reduces WeChat rate limiting.
    const fakeid = TARGET_ACCOUNT.biz;

    const candidates = await fetchArticleCandidatesFromBackend(context, homePage, token, fakeid, homeUrl);
    const articles = [];
    const articlePage = await context.newPage();
    for (const candidate of candidates) {
      await articlePage.goto(candidate.url, { waitUntil: "domcontentloaded", timeout: 60_000 });
      articles.push(await extractArticleFromPage(articlePage, candidate.title || TARGET_ACCOUNT.nickname));
    }
    await articlePage.close();
    return articles;
  } finally {
    await context.close();
  }
}

async function main() {
  const repoRoot = process.cwd();
  const options = parseArgs(process.argv.slice(2));

  if (options.help) {
    printHelp();
    return;
  }

  const initialChangedPaths = options.push
    ? getChangedPathsSinceHead(repoRoot)
    : new Set();

  if (options.push && initialChangedPaths.size > 0) {
    console.log(
      "Existing Git changes detected. Auto-push will only include files created or modified by this WeChat sync.",
    );
  }

  const articles = await fetchArticles(options);
  const eventFiles = [];
  for (const article of articles) {
    eventFiles.push({ article, file: await writeEventFile(repoRoot, article, options) });
  }
  const createdFiles = eventFiles.filter(({ file }) => !file.skipped);
  const skippedFiles = eventFiles.filter(({ file }) => file.skipped);
  console.log(
    `Sync summary: ${articles.length} published article(s) found, ${createdFiles.length} new, ${skippedFiles.length} already synced.`,
  );

  for (const { article, file } of eventFiles) {
    console.log(`${file.skipped ? "Already synced" : "Event content created"}: ${file.relativePath}`);
    console.log(`Source link: ${article.sourceLink}`);
  }
  if (createdFiles.length === 0 && !options.build && !options.push) return;

  if (options.build) {
    runBuild(repoRoot);
  }

  if (options.push) {
    const currentChangedPaths = getChangedPathsSinceHead(repoRoot);
    const pathsToStage = [...new Set([
      ...createdFiles.map(({ file }) => file.gitPath).filter((filePath) => currentChangedPaths.has(filePath)),
      ...[...currentChangedPaths]
      .filter((filePath) => !initialChangedPaths.has(filePath))
    ])].sort();
    const commitMessage =
      options.commitMessage || `sync(wechat): ${createdFiles.length} article(s)`;
    if (options.dryRun) {
      dryRunStageCommitAndPush(commitMessage, pathsToStage);
    } else {
      stageCommitAndPush(repoRoot, commitMessage, pathsToStage);
    }
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
