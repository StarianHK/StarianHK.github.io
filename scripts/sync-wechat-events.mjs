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
  1. Open the WeChat Official Accounts backend login page.
  2. Wait for QR-code sign-in.
  3. Query the target account's published article list automatically.
  4. Save the latest article as a new content/events item.
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

async function fetchLatestArticleUrlFromBackend(context, page, token, fakeid, referer) {
  const errors = [];
  for (const url of getAppmsgPublishUrls(token, fakeid)) {
    try {
      const data = await fetchJsonWithSession(context, page, url, referer);
      const candidates = dedupeCandidates(collectArticleCandidates(data));
      if (candidates.length === 0) {
        const responseCode = data?.base_resp?.ret ?? data?.ret ?? "unknown";
        const responseMessage =
          data?.base_resp?.errmsg || data?.base_resp?.err_msg || data?.errmsg || "no error message";
        const responseKeys =
          data && typeof data === "object" ? Object.keys(data).join(", ") : typeof data;
        const responsePreview = JSON.stringify(data).slice(0, 500);
        errors.push(
          `endpoint returned no article candidates (ret=${responseCode}, errmsg=${responseMessage}, keys=${responseKeys}, preview=${responsePreview})`,
        );
        if (String(responseCode) === "200013") {
          break;
        }
        continue;
      }

      candidates.sort((left, right) => right.timestamp - left.timestamp);
      console.log(
        `Found ${candidates.length} published article candidate(s); selecting ${candidates[0].title}.`,
      );
      return candidates[0].url;
    } catch (error) {
      errors.push(error instanceof Error ? error.message : String(error));
    }
  }

  // The authenticated JSON endpoint is frequently rate-limited. The public
  // account page usually remains available and exposes the same article links.
  try {
    const profileUrl = `https://mp.weixin.qq.com/mp/profile_ext?action=home&__biz=${encodeURIComponent(fakeid)}&scene=124#wechat_redirect`;
    const profilePage = await context.newPage();
    await profilePage.goto(profileUrl, { waitUntil: "domcontentloaded", timeout: 60_000 });
    await waitForQuietPage(profilePage);
    const candidates = await profilePage.evaluate(() => {
      const normalize = (value) => String(value || "").replace(/\s+/g, " ").trim();
      return [...document.querySelectorAll("a[href]")]
        .map((link) => {
          try {
            const url = new URL(link.href, window.location.href).toString();
            return { title: normalize(link.textContent), url };
          } catch {
            return null;
          }
        })
        .filter((item) => item && item.title && /^https?:\/\/mp\.weixin\.qq\.com\/s\//i.test(item.url));
    });
    if (candidates.length > 0) {
      console.log(`Found ${candidates.length} article link(s) on the public account page; selecting the first one.`);
      return candidates[0].url;
    }
    errors.push("public account page contained no article links");
  } catch (error) {
    errors.push(`public account page fallback failed: ${error instanceof Error ? error.message : String(error)}`);
  }

  if (errors.some((message) => message.includes("200013") || message.includes("freq control"))) {
    throw new Error(
      `WeChat is rate-limiting the article list (ret=200013, freq control). Wait a few minutes before retrying; ${errors.join(" | ")}`,
    );
  }

  throw new Error(
    `Unable to fetch the target account's published article list. ${errors.join(" | ")}`,
  );
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

async function fetchLatestArticle(options) {
  const context = await openBrowserContext(options);

  try {
    if (options.articleUrl) {
      const page = context.pages()[0] || (await context.newPage());
      await page.goto(options.articleUrl, {
        waitUntil: "domcontentloaded",
        timeout: 60_000,
      });
      return await extractArticleFromPage(page);
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

    console.log("Login detected. Fetching the latest published article automatically.");
    const account = await searchTargetAccount(context, homePage, token, homeUrl);
    const fakeid =
      account.fakeid || account.fakeId || account.id || account.biz || account.user_name;

    if (!fakeid) {
      throw new Error("Authenticated search succeeded, but no account identifier was returned.");
    }

    console.log(`Target account resolved: ${account.nickname || TARGET_ACCOUNT.nickname} (id=${fakeid}).`);

    const latestArticleUrl = await fetchLatestArticleUrlFromBackend(
      context,
      homePage,
      token,
      fakeid,
      homeUrl,
    );

    const articlePage = await context.newPage();
    await articlePage.goto(latestArticleUrl, {
      waitUntil: "domcontentloaded",
      timeout: 60_000,
    });

    return await extractArticleFromPage(articlePage, TARGET_ACCOUNT.nickname);
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

  const article = await fetchLatestArticle(options);
  const eventFile = await writeEventFile(repoRoot, article, options);

  if (eventFile.skipped) {
    console.log(`Latest article already exists: ${eventFile.relativePath}`);
    if (!options.build && !options.push) {
      return;
    }
    console.log("Continuing with build and auto-push checks for pending sync changes.");
  } else {
    console.log(`Event content created: ${eventFile.relativePath}`);
  }
  console.log(`Source link: ${article.sourceLink}`);

  if (options.build) {
    runBuild(repoRoot);
  }

  if (options.push) {
    const currentChangedPaths = getChangedPathsSinceHead(repoRoot);
    const pathsToStage = [...new Set([
      ...(currentChangedPaths.has(eventFile.gitPath) ? [eventFile.gitPath] : []),
      ...[...currentChangedPaths]
      .filter((filePath) => !initialChangedPaths.has(filePath))
    ])].sort();
    const commitMessage =
      options.commitMessage || `sync(wechat): ${article.title}`;
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
