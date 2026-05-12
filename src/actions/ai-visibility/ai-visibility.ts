/**
 * Check AICW Visibility Action
 *
 * Verifies if a website is accessible and properly indexed by AI crawlers.
 * Runs multiple checks and displays a weighted score report.
 */

import { createInterface } from 'readline';
import { platform } from 'os';
import { logger } from '../../utils/compact-logger.js';
import { colorize, waitForEnterInInteractiveMode, WaitForEnterMessageType } from '../../utils/misc-utils.js';
import { interruptibleDelay as delay } from '../../utils/delay.js';
import { AI_VISIBILITY_CHECK_DELAY_MS, SEARCH_ENGINE_CHECK_DELAY_MS, ENABLE_SEARCH_ENGINE_CHECKS } from '../../config/constants.js';
import { callHttpWithRetry } from '../../utils/http-caller.js';
import { DEFAULT_BROWSER_HEADERS, DESKTOP_BROWSER_USER_AGENT, MOBILE_BROWSER_USER_AGENT } from '../../config/ai-user-agents.js';
import { saveMultiPageVisibilityCheckJson } from '../../utils/visibility-json-output.js';

// sub actions
import { BaseVisibilityCheck, PageCaptured, VisibilityCheckResult } from './sub/check-base.js';
import { ServerBaseBotAccessibilityCheck } from './sub/check-server-bot-accessibility-base.js';
import { BaseSearchIndexingCheck } from './sub/check-indexing-base.js';
import { CheckContentJsonLD } from './sub/check-content-json-ld.js';
import { CheckContentMetaTags } from './sub/check-content-meta-tags.js';
// HTTP Headers variants (homepage + page)
import { CheckHttpHeadersHomepage } from './sub/check-http-headers-homepage.js';
import { CheckHttpHeadersPage } from './sub/check-http-headers-page.js';
// Bot accessibility checks (domain-scoped, moved to server level)
import { ServerBotAccessibilityFoundationModelsTraining } from './sub/check-server-bot-accessibility-foundations.js';
import { ServerBotAccessibilitySearchIndex } from './sub/check-server-bot-accessibility-search.js';
import { ServerBotAccessibilityUserInteraction } from './sub/check-server-bot-accessibility-user-interaction.js';
import { CheckServerRobotsTxt } from './sub/check-server-robots-txt.js';
import { CheckServerSitemap } from './sub/check-server-sitemap.js';
// Domain-scoped checks (moved to server level)
import { ContentLlmsTxtFile as CheckContentLlmsTxtFile } from './sub/check-content-llms-txt.js';
import { CheckIndexingSocialHackerNews } from './sub/check-indexing-social-hackernews.js';
import { CheckIndexingSocialStackOverflow } from './sub/check-indexing-social-stackoverflow.js';
import { CheckIndexingSocialReddit } from './sub/check-indexing-social-reddit.js';
import { CheckIndexingKnowledgeWikipedia } from './sub/check-indexing-knowledge-wikipedia.js';
import { CheckIndexingAcademicSemanticScholar } from './sub/check-indexing-academic-semantic-scholar.js';
// Search engine checks (disabled by default)
import { CheckIndexingGoogle } from './sub/check-indexing-google.js';
import { CheckIndexingBing } from './sub/check-indexing-bing.js';
import { CheckIndexingBrave } from './sub/check-indexing-brave.js';
// Content checks
import { CheckContentJavaScriptRendering } from './sub/check-content-javascript-rendering.js';
import { launchBrowser } from './sub/check-content-javascript-full.js';
import { CheckContentMobileCompatibility } from './sub/check-content-mobile-compatibility.js';
import { CheckContentStructure } from './sub/check-content-structure.js';
import { getUniqueAIProducts } from './utils/ai-product-utils.js';
// Response Speed variants (homepage + page)
import { CheckResponseSpeedHomepage } from './sub/check-response-speed-homepage.js';
import { CheckResponseSpeedPage } from './sub/check-response-speed-page.js';
import { CheckServerTtfb } from './sub/check-server-ttfb.js';
// Common Crawl variants (domain + page)
import { CheckIndexingDatasetCommonCrawlDomain } from './sub/check-indexing-dataset-common-crawl-domain.js';
import { CheckIndexingDatasetCommonCrawlPage } from './sub/check-indexing-dataset-common-crawl-page.js';

/**
 * Configuration for a visibility check with its weighted score
 */
export interface VisibilityCheckConfig {
  CheckClass: new () => BaseVisibilityCheck;
  maxScore: number;
  level: 'server' | 'page';  // server: run once per domain, page: run per URL
}

/**
 * All visibility checks with explicit level flags
 *
 * Scoring (auto-normalizing 0-100):
 * - Server-level: Run once per hostname, raw scores normalized to 0-100
 * - Page-level: Run per URL, raw scores normalized to 0-100 per page
 * - Total score: Average of all entity scores (each server + each page)
 *
 * Each check has its configured maxScore. Adding new checks doesn't require
 * rebalancing - normalization handles it automatically.
 *
 * Note: Search engine checks (Google, Bing, Brave) are disabled by default
 * due to CAPTCHA/IP blocking issues. Enable with AICW_ENABLE_SEARCH_ENGINE_CHECKS=true
 */
export const VISIBILITY_CHECKS: VisibilityCheckConfig[] = [
  // ============================================================================
  // SERVER-LEVEL CHECKS (500 points total - run once per domain)
  // ============================================================================

  // Core server configuration (300 points)
  { CheckClass: CheckServerRobotsTxt, maxScore: 200, level: 'server' },    // Protocol-level bot blocking
  { CheckClass: CheckServerSitemap, maxScore: 80, level: 'server' },       // Discovery aid
  { CheckClass: CheckServerTtfb, maxScore: 20, level: 'server' },          // Server infrastructure performance

  // Domain-level data availability (5 points)
  { CheckClass: CheckContentLlmsTxtFile, maxScore: 5, level: 'server' },   // /llms.txt at domain root

  // AI bot accessibility - domain-wide via robots.txt (120 points)
  { CheckClass: ServerBotAccessibilityFoundationModelsTraining, maxScore: 50, level: 'server' }, // Foundation model training
  { CheckClass: ServerBotAccessibilitySearchIndex, maxScore: 40, level: 'server' },              // Search indexing
  { CheckClass: ServerBotAccessibilityUserInteraction, maxScore: 30, level: 'server' },          // User interactions

  // Domain indexing - search by domain, not URL (65 points)
  { CheckClass: CheckIndexingKnowledgeWikipedia, maxScore: 25, level: 'server' },        // Wikipedia (6 language editions)
  { CheckClass: CheckIndexingSocialStackOverflow, maxScore: 20, level: 'server' },       // Stack Overflow (domain mentions)
  { CheckClass: CheckIndexingSocialReddit, maxScore: 20, level: 'server' },              // Reddit (domain mentions)

  // Dual-level checks - server instances (10 points)
  { CheckClass: CheckHttpHeadersHomepage, maxScore: 5, level: 'server' },                // Homepage X-Robots-Tag
  { CheckClass: CheckResponseSpeedHomepage, maxScore: 3, level: 'server' },              // Homepage response speed
  { CheckClass: CheckIndexingDatasetCommonCrawlDomain, maxScore: 2, level: 'server' },   // Common Crawl domain presence

  // ============================================================================
  // PAGE-LEVEL CHECKS (base ~36 points, scaled to 500 ÷ num_pages per page)
  // Disabled checks: Mobile Compatibility (7), Hacker News (1.5), Semantic Scholar (2)
  // ============================================================================

  // HTTP headers and performance - per-page (14 points base)
  { CheckClass: CheckHttpHeadersPage, maxScore: 10, level: 'page' },              // Per-page X-Robots-Tag headers
  { CheckClass: CheckResponseSpeedPage, maxScore: 4, level: 'page' },             // Per-page response speed

  // Content checks (34 points base - was 41, removed Mobile Compatibility)
  { CheckClass: CheckContentJsonLD, maxScore: 5, level: 'page' },                 // Structured data
  { CheckClass: CheckContentMetaTags, maxScore: 8, level: 'page' },               // HTML meta tag blocking
  { CheckClass: CheckContentJavaScriptRendering, maxScore: 16, level: 'page' },   // JS rendering (browser-based, accurate)
  { CheckClass: CheckContentStructure, maxScore: 5, level: 'page' },              // AI-optimized content structure
  // DISABLED: Mobile compatibility - AI bots don't differentiate mobile/desktop versions
  // { CheckClass: CheckContentMobileCompatibility, maxScore: 7, level: 'page' },    // Mobile-first indexing

  // Page-level indexing checks (2 points base, 8 if search engines enabled)
  { CheckClass: CheckIndexingDatasetCommonCrawlPage, maxScore: 2, level: 'page' },       // Common Crawl page URL presence
  // DISABLED: Hacker News - No verified connection to LLM training datasets
  // { CheckClass: CheckIndexingSocialHackerNews, maxScore: 1.5, level: 'page' },           // Hacker News (URL mentions)
  // DISABLED: Semantic Scholar - Not an AI training dataset, searches for URL in paper metadata (flawed premise)
  // { CheckClass: CheckIndexingAcademicSemanticScholar, maxScore: 2, level: 'page' },      // Semantic Scholar (URL citations)

  // Search engine checks - disabled by default (6 points, optional)
  // DISABLED: Search engine indexing does NOT correlate with AI training data inclusion
  // Being indexed by Google/Bing/Brave means nothing for LLM training - they use Common Crawl snapshots
  { CheckClass: CheckIndexingGoogle, maxScore: 2, level: 'page' },                // Google Search (disabled by default via env var)
  { CheckClass: CheckIndexingBing, maxScore: 2, level: 'page' },                  // Bing Search (disabled by default via env var)
  { CheckClass: CheckIndexingBrave, maxScore: 2, level: 'page' },                 // Brave Search (disabled by default via env var)

];

/**
 * Get instantiated server-level checks with configured weights
 * Filters checks by level === 'server'
 */
export function getServerChecks(): BaseVisibilityCheck[] {
  return VISIBILITY_CHECKS
    .filter(config => config.level === 'server')
    .map(config => {
      const instance = new config.CheckClass();
      instance.setMaxScore(config.maxScore);
      return instance;
    });
}

/**
 * Get instantiated page-level checks with configured weights
 * Filters checks by level === 'page'
 * Optionally filters out search engine checks if disabled via environment variable
 *
 * Note: No scaling is applied - raw scores are normalized to 0-100 at aggregation time
 */
export function getPageChecks(): BaseVisibilityCheck[] {
  // Filter page-level checks only
  let pageChecks = VISIBILITY_CHECKS.filter(config => config.level === 'page');

  // Optionally filter out search engine checks if disabled
  if (!ENABLE_SEARCH_ENGINE_CHECKS) {
    pageChecks = pageChecks.filter(config => {
      const instance = new config.CheckClass();
      return !(instance instanceof BaseSearchIndexingCheck);
    });
  }

  // Return checks with their configured maxScore (no scaling)
  return pageChecks.map(config => {
    const instance = new config.CheckClass();
    instance.setMaxScore(config.maxScore);
    return instance;
  });
}

/**
 * Get all instantiated visibility checks with configured weights (legacy)
 * Used for backward compatibility with single-URL checks
 * @deprecated Use getServerChecks() and getPageChecks() instead for multi-URL support
 */
export function getAllVisibilityChecks(): BaseVisibilityCheck[] {
  return VISIBILITY_CHECKS.map(config => {
    const instance = new config.CheckClass();
    instance.setMaxScore(config.maxScore);
    return instance;
  });
}

/**
 * Fetch page content for both desktop and mobile browsers
 * Returns PageCaptured structure with all data
 * @param url - URL to fetch
 * @returns PageCaptured with desktop and mobile content and timing data
 */
async function fetchPageContent(url: string): Promise<PageCaptured> {
  const pageCaptured: PageCaptured = {};

  // Fetch desktop version
  logger.info('  Fetching website as a desktop browser...');
  try {
    const startTime = Date.now();
    const response = await callHttpWithRetry(url, {
      userAgent: DESKTOP_BROWSER_USER_AGENT,
      headers: DEFAULT_BROWSER_HEADERS,
      contextInfo: `Fetching desktop HTML: ${url}`
    });

    if (response.ok) {
      const html = await response.text();
      const endTime = Date.now();

      pageCaptured.browserHtmlDesktop = html;
      pageCaptured.browserHeadersDesktop = response.headers;
      pageCaptured.desktopResponseTimeMs = endTime - startTime;
      pageCaptured.desktopStatusCode = response.status;
      pageCaptured.desktopFetchedAt = new Date();

      logger.info(`   Desktop: ${html.length} bytes in ${endTime - startTime}ms`);
    } else {
      throw new Error(`HTTP ${response.status}`);
    }
  } catch (error: any) {
    logger.warn(`   Desktop fetch failed: ${error.message}`);
  }

  // Add delay before mobile fetch to avoid rate limiting
  if (pageCaptured.browserHtmlDesktop) {
    await delay(AI_VISIBILITY_CHECK_DELAY_MS);
  }

  // Fetch mobile version
  logger.info('  Fetching website as a mobile browser...');
  try {
    const startTime = Date.now();
    const response = await callHttpWithRetry(url, {
      userAgent: MOBILE_BROWSER_USER_AGENT,
      headers: DEFAULT_BROWSER_HEADERS,
      contextInfo: `Fetching mobile HTML: ${url}`
    });

    if (response.ok) {
      const html = await response.text();
      const endTime = Date.now();

      pageCaptured.browserHtmlMobile = html;
      pageCaptured.browserHeadersMobile = response.headers;
      pageCaptured.mobileResponseTimeMs = endTime - startTime;
      pageCaptured.mobileStatusCode = response.status;
      pageCaptured.mobileFetchedAt = new Date();

      logger.info(`   Mobile: ${html.length} bytes in ${endTime - startTime}ms`);
    } else {
      throw new Error(`HTTP ${response.status}`);
    }
  } catch (error: any) {
    logger.warn(`   Mobile fetch failed: ${error.message}`);
  }

  if (!pageCaptured.browserHtmlDesktop && !pageCaptured.browserHtmlMobile) {
    logger.warn('Could not fetch page with either desktop or mobile user agents. Some checks will be limited.');
  }

  return pageCaptured;
}

/**
 * Prompt for URL input (supports comma-separated URLs)
 */
function promptForUrl(): Promise<string> {
  const rl = createInterface({
    input: process.stdin,
    output: process.stdout
  });

  return new Promise((resolve) => {
    rl.question(colorize('\nCheck AI visibility for URL(s) (comma-separated for multiple): ', 'yellow'), (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

/**
 * Validate and normalize URL
 */
function validateUrl(urlString: string): string {
  // Add https:// if no protocol specified
  if (!urlString.match(/^https?:\/\//i)) {
    urlString = 'https://' + urlString;
  }

  try {
    const url = new URL(urlString);
    return url.toString();
  } catch (error) {
    throw new Error(`Invalid URL: ${urlString}`);
  }
}

/**
 * Hostname group containing URLs from the same host
 */
interface HostnameGroup {
  hostname: string;      // "www.example.com"
  baseUrl: string;       // "https://www.example.com"
  urls: string[];        // Full URLs
  paths: string[];       // Just paths ["/", "/about"]
}

/**
 * Extract root domain from hostname (e.g., www.example.com → example.com)
 */
function extractRootDomain(hostname: string): string {
  const parts = hostname.split('.');
  // Handle localhost and simple domains
  if (parts.length <= 2) {
    return hostname;
  }
  // Return last 2 parts (e.g., example.com)
  return parts.slice(-2).join('.');
}

/**
 * Parse comma-separated URLs and group by hostname
 * Validates all URLs share the same root domain (e.g., example.com)
 * @returns Hostname groups and root domain for display
 */
function parseAndValidateUrls(urlsString: string): {
  groups: HostnameGroup[];
  rootDomain: string;    // "example.com" for display
  urls: string[];        // All URLs (for backward compat)
} {
  // Split by comma and trim each URL
  const urlStrings = urlsString.split(',').map(s => s.trim()).filter(s => s.length > 0);

  if (urlStrings.length === 0) {
    throw new Error('No URLs provided');
  }

  // Validate and normalize each URL
  const urls = urlStrings.map(validateUrl);

  // Group URLs by hostname
  const hostnameMap = new Map<string, { urls: string[], paths: string[], baseUrl: string }>();

  for (const url of urls) {
    const urlObj = new URL(url);
    const hostname = urlObj.host;
    const baseUrl = `${urlObj.protocol}//${urlObj.host}`;
    const path = urlObj.pathname || '/';

    if (!hostnameMap.has(hostname)) {
      hostnameMap.set(hostname, { urls: [], paths: [], baseUrl });
    }
    const group = hostnameMap.get(hostname)!;
    group.urls.push(url);
    group.paths.push(path);
  }

  // Convert to array of HostnameGroup
  const groups: HostnameGroup[] = Array.from(hostnameMap.entries()).map(([hostname, data]) => ({
    hostname,
    baseUrl: data.baseUrl,
    urls: data.urls,
    paths: data.paths,
  }));

  // Validate all hostnames share the same root domain
  const rootDomains = new Set(groups.map(g => extractRootDomain(g.hostname)));
  if (rootDomains.size > 1) {
    throw new Error(`All URLs must belong to the same root domain. Found: ${Array.from(rootDomains).join(', ')}`);
  }

  // Extract root domain for display
  const rootDomain = Array.from(rootDomains)[0];

  return {
    groups,
    rootDomain,
    urls, // Keep for backward compat
  };
}

/**
 * Extract path from URL (for display in results)
 */
function extractPath(url: string): string {
  const urlObj = new URL(url);
  return urlObj.pathname === '' || urlObj.pathname === '/'
    ? '/'
    : urlObj.pathname;
}

function calculateLetterGrade(percentage: number): string {
  if (percentage >= 97) return 'A+';
  if (percentage >= 93) return 'A';
  if (percentage >= 90) return 'A-';

  if (percentage >= 87) return 'B+';
  if (percentage >= 83) return 'B';
  if (percentage >= 80) return 'B-';

  if (percentage >= 77) return 'C+';
  if (percentage >= 73) return 'C';
  if (percentage >= 70) return 'C-';

  if (percentage >= 67) return 'D+';
  if (percentage >= 63) return 'D';
  if (percentage >= 60) return 'D-';

  return 'F';
}

/**
 * Parse CLI arguments for flags
 */
function parseCliArgs(): { urlsString: string; noBrowser: boolean } {
  const args = process.argv.slice(2);
  let urlsString = '';
  let noBrowser = false;

  for (const arg of args) {
    if (arg === '--no-browser') {
      noBrowser = true;
    } else if (!arg.startsWith('-')) {
      urlsString = arg;
    }
  }

  return { urlsString, noBrowser };
}

async function main(): Promise<void> {
  // Initialize logger
  await logger.initialize('aicw-visibility');

  // Parse CLI arguments
  const cliArgs = parseCliArgs();
  let urlsString = cliArgs.urlsString;
  const noBrowser = cliArgs.noBrowser;

  if (!urlsString) {
    // Show permission notice before prompting
    logger.log('');
    logger.log(colorize('⚠️  By continuing, you confirm that you have all required permissions', 'yellow'));
    logger.log(colorize('   to test the URL(s) for AI visibility. Press CTRL+C to cancel.', 'yellow'));
    logger.log('');

    urlsString = await promptForUrl();
  }

  if (!urlsString) {
    logger.error('No URL provided');
    process.exit(1);
  }

  // Parse and validate URLs (grouped by hostname)
  let hostnameGroups: HostnameGroup[];
  let urls: string[];
  let rootDomain: string;
  try {
    const parsed = parseAndValidateUrls(urlsString);
    hostnameGroups = parsed.groups;
    rootDomain = parsed.rootDomain;
    urls = parsed.urls;
  } catch (error: any) {
    logger.error(error.message);
    process.exit(1);
  }

  // Format the output with better visual hierarchy
  const products = getUniqueAIProducts();
  const groupSize = 4;
  const productGroups: string[] = [];

  // Group products into lines of ~4 for better readability
  for (let i = 0; i < products.length; i += groupSize) {
    productGroups.push(products.slice(i, i + groupSize).join(', '));
  }

  const numPages = urls.length;
  const numServers = hostnameGroups.length;
  const serverChecksCount = VISIBILITY_CHECKS.filter(c => c.level === 'server').length;

  // Calculate actual page checks count (accounting for disabled search engine checks)
  let pageChecksCount = VISIBILITY_CHECKS.filter(c => c.level === 'page').length;
  if (!ENABLE_SEARCH_ENGINE_CHECKS) {
    // Subtract 3 search engine checks (Google, Bing, Brave)
    pageChecksCount -= 3;
  }
  if (noBrowser) {
    pageChecksCount -= 1;
  }

  const totalChecksCount = (serverChecksCount * numServers) + (pageChecksCount * numPages);

  // Display formatted message
  logger.info(colorize('\n🔍 Checking AICW Visibility\n', 'bright'));
  logger.info(`   ${colorize('Domain:', 'dim')}  ${colorize(rootDomain, 'cyan')}`);
  if (numServers > 1) {
    logger.info(`   ${colorize('Hosts:', 'dim')}   ${hostnameGroups.map(g => g.hostname).join(', ')}`);
  }
  if (numPages > 1) {
    logger.info(`   ${colorize('Pages:', 'dim')}   ${urls.map(u => extractPath(u)).join(', ')}`);
  }
  logger.info('');

  // Show what will be performed
  logger.info(colorize('   This action will:', 'dim'));
  logger.info(colorize(`   • Run ${serverChecksCount} server-level checks`, 'dim'));
  logger.info(colorize(`   • Fetch ${numPages} page${numPages > 1 ? 's' : ''} (desktop + mobile)`, 'dim'));
  logger.info(colorize(`   • Run ${pageChecksCount} checks per page`, 'dim'));
  logger.info(colorize(`   • Total: ${totalChecksCount} checks, score normalized to 0-100`, 'dim'));

  // Show notification if search engine checks are disabled
  if (!ENABLE_SEARCH_ENGINE_CHECKS) {
    logger.info('');
    logger.info(colorize('   ℹ️  Search engine checks disabled (Google, Bing, Brave)', 'yellow'));
    logger.info(colorize('      Enable with: AICW_ENABLE_SEARCH_ENGINE_CHECKS=true', 'dim'));
    logger.info(colorize('      Note: Requires proxy/CAPTCHA solution to avoid blocking', 'dim'));
  }

  // Show notification if browser check is disabled
  if (noBrowser) {
    logger.info('');
    logger.info(colorize('   ℹ️  Browser JS check disabled (--no-browser)', 'yellow'));
    logger.info(colorize('      JS content rendering check will be skipped and excluded from score', 'dim'));
  }

  logger.info(colorize(`   • Test visibility by ${products.length} AI products including:`, 'dim'));
  productGroups.forEach(group => {
    logger.info(colorize(`      → ${group}`, 'dim'));
  });

  // Wait for user confirmation in interactive mode (or Ctrl+C to cancel)
  await waitForEnterInInteractiveMode(WaitForEnterMessageType.PRESS_ENTER_TO_CONTINUE);
  logger.info(''); // Empty line for spacing

  // ============================================================================
  // STEP 1: Run server-level checks for each hostname
  // ============================================================================

  // Store results per hostname
  interface ServerCheckResults {
    hostname: string;
    baseUrl: string;
    pageCaptured: PageCaptured;
    results: Array<{check: BaseVisibilityCheck, result: VisibilityCheckResult}>;
  }

  const allServersResults: ServerCheckResults[] = [];

  for (let hostIdx = 0; hostIdx < hostnameGroups.length; hostIdx++) {
    const group = hostnameGroups[hostIdx];
    const serverPageCaptured: PageCaptured = {};

    if (numServers > 1) {
      logger.info(colorize(`  SERVER ${hostIdx + 1}/${numServers}: ${group.hostname}`, 'bright'));
    } else {
      logger.info(colorize('  SERVER-LEVEL CHECKS', 'bright'));
    }
    logger.info('');

    // Pre-fetch robots.txt and sitemap.xml for this hostname
    logger.info('  Fetching server-level resources (robots.txt, sitemap.xml, homepage)...');

    try {
      const robotsResponse = await callHttpWithRetry(`${group.baseUrl}/robots.txt`, {
        contextInfo: `Fetching robots.txt for ${group.hostname}`,
        maxRetries: 1
      });
      serverPageCaptured.robotsTxtStatus = robotsResponse.status;
      if (robotsResponse.ok) {
        serverPageCaptured.robotsTxtContent = await robotsResponse.text();
      }
    } catch (err) {
      // Pre-fetch failed, checks will handle appropriately
    }

    try {
      const sitemapResponse = await callHttpWithRetry(`${group.baseUrl}/sitemap.xml`, {
        contextInfo: `Fetching sitemap.xml for ${group.hostname}`,
        maxRetries: 1
      });
      serverPageCaptured.sitemapXmlStatus = sitemapResponse.status;
      if (sitemapResponse.ok) {
        serverPageCaptured.sitemapXmlContent = await sitemapResponse.text();
      }
    } catch (err) {
      // Pre-fetch failed, checks will handle appropriately
    }

    // Pre-fetch homepage for server-level checks
    const homepageUrl = `${group.baseUrl}/`;
    logger.info('  Fetching homepage for server-level checks...');

    // Fetch desktop homepage
    try {
      const startTime = Date.now();
      const response = await callHttpWithRetry(homepageUrl, {
        userAgent: DESKTOP_BROWSER_USER_AGENT,
        headers: DEFAULT_BROWSER_HEADERS,
        contextInfo: `Fetching homepage (desktop) for ${group.hostname}`,
        maxRetries: 2
      });

      if (response.ok) {
        serverPageCaptured.homepageHtmlDesktop = await response.text();
        serverPageCaptured.homepageHeadersDesktop = response.headers;
        serverPageCaptured.homepageDesktopResponseTimeMs = Date.now() - startTime;
        serverPageCaptured.homepageDesktopStatusCode = response.status;
        logger.info(`   Homepage Desktop: ${serverPageCaptured.homepageHtmlDesktop.length} bytes in ${serverPageCaptured.homepageDesktopResponseTimeMs}ms`);
      }
    } catch (err) {
      logger.warn('   Could not fetch homepage (desktop) for server-level checks');
    }

    // Add delay before mobile fetch
    if (serverPageCaptured.homepageHtmlDesktop) {
      await delay(AI_VISIBILITY_CHECK_DELAY_MS);
    }

    // Fetch mobile homepage
    try {
      const startTime = Date.now();
      const response = await callHttpWithRetry(homepageUrl, {
        userAgent: MOBILE_BROWSER_USER_AGENT,
        headers: DEFAULT_BROWSER_HEADERS,
        contextInfo: `Fetching homepage (mobile) for ${group.hostname}`,
        maxRetries: 2
      });

      if (response.ok) {
        serverPageCaptured.homepageHtmlMobile = await response.text();
        serverPageCaptured.homepageHeadersMobile = response.headers;
        serverPageCaptured.homepageMobileResponseTimeMs = Date.now() - startTime;
        serverPageCaptured.homepageMobileStatusCode = response.status;
        logger.info(`   Homepage Mobile: ${serverPageCaptured.homepageHtmlMobile.length} bytes in ${serverPageCaptured.homepageMobileResponseTimeMs}ms`);
      }
    } catch (err) {
      logger.warn('   Could not fetch homepage (mobile) for server-level checks');
    }

    logger.info(''); // Empty line for spacing

    // Run server-level checks for this hostname
    const serverChecks = getServerChecks();
    const serverResults: Array<{check: BaseVisibilityCheck, result: VisibilityCheckResult}> = [];

    for (let i = 0; i < serverChecks.length; i++) {
      const check = serverChecks[i];

      if (i > 0) {
        // Larger jitter (±500ms) for more human-like timing patterns
        const jitter = Math.floor(Math.random() * 1000) - 500; // ±500ms
        await delay(AI_VISIBILITY_CHECK_DELAY_MS + jitter);
      }

      const result = await check.execute(group.baseUrl + '/', serverPageCaptured);

      // Display result
      const icon = result.error ? '❌' : result.passed ? '✓' : '⚠';
      const color = result.error ? 'red' : result.passed ? 'green' : 'yellow';
      const roundedScore = Math.round(result.score);
      const scoreText = result.error ? 'ERR' : `${roundedScore}/${result.maxScore}`;
      const padding = ' '.repeat(Math.max(0, 25 - check.name.length));

      logger.log(
        `${colorize(icon, color)} ${check.name}${padding}${colorize(scoreText.padStart(7), color)}  ${result.details}`
      );

      serverResults.push({ check, result });
    }

    allServersResults.push({
      hostname: group.hostname,
      baseUrl: group.baseUrl,
      pageCaptured: serverPageCaptured,
      results: serverResults,
    });

    logger.info('');
  }

  // For backward compat: use first server's results as "serverResults"
  const primaryServer = allServersResults[0];
  const serverResults = primaryServer.results;

  // ============================================================================
  // STEP 2: Run page-level checks for each URL
  // ============================================================================
  let pageChecks = getPageChecks();
  const withoutBrowserChecks = (checks: BaseVisibilityCheck[]) =>
    checks.filter(check => !(check instanceof CheckContentJavaScriptRendering));
  const pagesResults: Array<{
    url: string;
    path: string;
    hostname: string;    // Track which server this page belongs to
    results: Array<{check: BaseVisibilityCheck, result: VisibilityCheckResult}>;
    pageCaptured: PageCaptured;
  }> = [];

  // Launch Puppeteer browser for accurate JS content comparison (unless --no-browser)
  let puppeteerBrowser: any = null;
  if (noBrowser) {
    pageChecks = withoutBrowserChecks(pageChecks);
  } else {
    try {
      logger.info(colorize('  Launching browser for JS content check...', 'dim'));
      puppeteerBrowser = await launchBrowser();
      logger.info(colorize('  Browser ready', 'dim'));
      logger.info('');
    } catch (err: any) {
      logger.warn(`  Could not launch browser: ${err.message}`);
      logger.warn('  Browser-based JS check will be skipped and excluded from score');
      logger.warn('  To enable it locally, run: npx puppeteer browsers install chrome');
      logger.info('');
      pageChecks = withoutBrowserChecks(pageChecks);
    }
  }

  try {
  for (let pageIdx = 0; pageIdx < urls.length; pageIdx++) {
    const pageUrl = urls[pageIdx];
    const pagePath = extractPath(pageUrl);
    const pageHostname = new URL(pageUrl).host;

    logger.info(colorize(`  PAGE ${pageIdx + 1}/${urls.length}: ${pagePath}`, 'bright'));
    logger.info('');

    // Fetch page content
    const pageCaptured = await fetchPageContent(pageUrl);

    // Find the matching server for this page's hostname
    const matchingServer = allServersResults.find(s => s.hostname === pageHostname);
    const serverPageCaptured = matchingServer?.pageCaptured || {};

    // Inherit robots.txt and sitemap from the matching server
    pageCaptured.robotsTxtStatus = serverPageCaptured.robotsTxtStatus;
    pageCaptured.robotsTxtContent = serverPageCaptured.robotsTxtContent;
    pageCaptured.sitemapXmlStatus = serverPageCaptured.sitemapXmlStatus;
    pageCaptured.sitemapXmlContent = serverPageCaptured.sitemapXmlContent;

    // Preflight check: ensure page is reachable
    if (!pageCaptured.browserHtmlDesktop && !pageCaptured.browserHtmlMobile) {
      logger.log('');
      logger.warn(colorize(`⚠️  Page not accessible: ${pageUrl}`, 'yellow'));
      logger.log('');
      continue; // Skip this page but continue with others
    }

    // Add browser to pageCaptured for browser-based JS check
    if (puppeteerBrowser) {
      pageCaptured.puppeteerBrowser = puppeteerBrowser;
    }

    logger.info('');

    // Execute checks for this page
    const pageResults: Array<{check: BaseVisibilityCheck, result: VisibilityCheckResult}> = [];

    for (let i = 0; i < pageChecks.length; i++) {
      const check = pageChecks[i];

      if (i > 0) {
        // Use longer delay for search engine checks to avoid CAPTCHA/blocking
        const isSearchEngineCheck = check instanceof BaseSearchIndexingCheck;

        if (isSearchEngineCheck) {
          // Search engines get 7s base + ±3s jitter (4-10 seconds total)
          // Much larger variability to avoid detection patterns
          const jitter = Math.floor(Math.random() * 6000) - 3000; // ±3000ms
          await delay(SEARCH_ENGINE_CHECK_DELAY_MS + jitter);
        } else {
          // Standard checks get 1.5s base + ±500ms jitter
          const jitter = Math.floor(Math.random() * 1000) - 500; // ±500ms
          await delay(AI_VISIBILITY_CHECK_DELAY_MS + jitter);
        }
      }

      const result = await check.execute(pageUrl, pageCaptured);

      // Display result
      const icon = result.error ? '❌' : result.passed ? '✓' : '⚠';
      const color = result.error ? 'red' : result.passed ? 'green' : 'yellow';
      const roundedScore = Math.round(result.score);
      const scoreText = result.error ? 'ERR' : `${roundedScore}/${result.maxScore}`;
      const padding = ' '.repeat(Math.max(0, 25 - check.name.length));

      logger.log(
        `${colorize(icon, color)} ${check.name}${padding}${colorize(scoreText.padStart(7), color)}  ${result.details}`
      );

      pageResults.push({ check, result });

      // Add blank line after last bot check to separate from other checks
      const isCurrentBotCheck = check instanceof ServerBaseBotAccessibilityCheck;
      const nextCheck = pageChecks[i + 1];
      const isNextBotCheck = nextCheck instanceof ServerBaseBotAccessibilityCheck;

      if (isCurrentBotCheck && !isNextBotCheck) {
        logger.log('');
      }
    }

    pagesResults.push({
      url: pageUrl,
      path: pagePath,
      hostname: pageHostname,
      results: pageResults,
      pageCaptured
    });

    logger.info('');
  }
  } finally {
    // Close Puppeteer browser if it was launched
    if (puppeteerBrowser) {
      try {
        await puppeteerBrowser.close();
        logger.info(colorize('  Browser closed', 'dim'));
      } catch (err) {
        // Ignore close errors
      }
    }
  }

  // ============================================================================
  // STEP 3: Calculate normalized scores (0-100 per entity, average for total)
  // ============================================================================

  // Calculate normalized score for each server
  interface ServerNormalizedData {
    hostname: string;
    rawScore: number;
    rawMaxScore: number;
    normalizedScore: number;
  }
  const serverNormalizedData: ServerNormalizedData[] = allServersResults.map(server => {
    const rawScore = server.results.reduce((sum, {result}) =>
      result.error ? sum : sum + result.score, 0
    );
    const rawMaxScore = server.results.reduce((sum, {result}) =>
      sum + result.maxScore, 0
    );
    const normalizedScore = rawMaxScore > 0 ? (rawScore / rawMaxScore) * 100 : 0;
    return {
      hostname: server.hostname,
      rawScore: Math.round(rawScore),
      rawMaxScore,
      normalizedScore,
    };
  });

  // For backward compat: primary server scores
  const serverRawScore = serverNormalizedData[0]?.rawScore ?? 0;
  const serverRawMaxScore = serverNormalizedData[0]?.rawMaxScore ?? 0;

  // Calculate normalized score for each page
  const pageNormalizedScores: number[] = [];
  for (const page of pagesResults) {
    const pageRawScore = page.results.reduce((sum, {result}) =>
      result.error ? sum : sum + result.score, 0
    );
    const pageRawMaxScore = page.results.reduce((sum, {result}) =>
      sum + result.maxScore, 0
    );
    // Normalized page score (0-100)
    const pageNormalizedScore = pageRawMaxScore > 0
      ? (pageRawScore / pageRawMaxScore) * 100
      : 0;
    pageNormalizedScores.push(pageNormalizedScore);
  }

  // Total score = average of all entity normalized scores (all servers + all pages)
  const serverNormalizedScores = serverNormalizedData.map(s => s.normalizedScore);
  const allNormalizedScores = [...serverNormalizedScores, ...pageNormalizedScores];
  const totalNormalizedScore = allNormalizedScores.length > 0
    ? allNormalizedScores.reduce((sum, s) => sum + s, 0) / allNormalizedScores.length
    : 0;

  // Round for display
  const percentage = Math.round(totalNormalizedScore);

  // Build formula string for scoring summary
  const formulaParts: string[] = [];
  serverNormalizedData.forEach((server, idx) => {
    const label = numServers > 1 ? server.hostname : 'Server';
    formulaParts.push(`${label}: ${server.normalizedScore.toFixed(1)}`);
  });
  pageNormalizedScores.forEach((score, idx) => {
    const page = pagesResults[idx];
    const label = page?.path || `Page${idx + 1}`;
    formulaParts.push(`${label}: ${score.toFixed(1)}`);
  });
  const scoringFormula = `(${allNormalizedScores.map(s => s.toFixed(1)).join(' + ')}) / ${allNormalizedScores.length} = ${totalNormalizedScore.toFixed(1)}`;

  // Ensure output state is normal before displaying summary
  logger.log('');

  // Display clean report summary
  const letterGrade = calculateLetterGrade(percentage);
  const scoreColor = percentage >= 80 ? 'green' : percentage >= 50 ? 'yellow' : 'red';

  logger.log('='.repeat(80));
  const formattedDate = new Date().toLocaleString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });

  logger.log(`AICW VISIBILITY REPORT for ${colorize(rootDomain, 'cyan')} on ${colorize(formattedDate, 'bright')}`);
  if (numPages > 1) {
    logger.log(`Pages checked: ${urls.map(u => extractPath(u)).join(', ')}`);
  }
  logger.log('='.repeat(80));
  logger.log(
    colorize(`TOTAL SCORE: ${percentage}/100\nGRADE: ${colorize(letterGrade, scoreColor)}`, 'bright')
  );
  logger.log('');
  // Show all servers
  serverNormalizedData.forEach((server) => {
    const label = numServers > 1 ? server.hostname : 'Server';
    logger.log(colorize(`  ${label}: ${Math.round(server.normalizedScore)}/100`, 'dim'));
  });
  // Show all pages
  pageNormalizedScores.forEach((score, idx) => {
    const path = pagesResults[idx]?.path || `Page ${idx + 1}`;
    logger.log(colorize(`  ${path}: ${Math.round(score)}/100`, 'dim'));
  });
  logger.log(colorize(`  Formula: ${scoringFormula}`, 'dim'));
  logger.log('='.repeat(80));
  logger.log('');

  // Display detailed results table
  logger.log('DETAILS:');

  // Show all servers' results
  for (let serverIdx = 0; serverIdx < allServersResults.length; serverIdx++) {
    const server = allServersResults[serverIdx];
    logger.log('');
    const serverLabel = numServers > 1
      ? `Server ${serverIdx + 1} (${server.hostname}):`
      : 'Server Checks:';
    logger.log(colorize(`  ${serverLabel}`, 'bright'));
    for (const {check, result} of server.results) {
      const icon = result.error ? '[FAIL]' : result.passed ? '[PASS]' : '[WARN]';
      const color = result.error ? 'red' : result.passed ? 'green' : 'yellow';
      const roundedScore = Math.round(result.score);
      const scoreText = result.error ? 'ERR' : `${roundedScore}/${result.maxScore}`;
      const padding = '.'.repeat(Math.max(0, 45 - check.name.length));

      logger.log(
        `  ${colorize(icon, color)} ${check.name}${padding} ${scoreText.padStart(8)}`
      );
    }
  }

  // Show all pages' results
  for (let i = 0; i < pagesResults.length; i++) {
    const page = pagesResults[i];
    logger.log('');
    logger.log(colorize(`  Page ${i + 1} (${page.path}):`, 'bright'));
    for (const {check, result} of page.results) {
      const icon = result.error ? '[FAIL]' : result.passed ? '[PASS]' : '[WARN]';
      const color = result.error ? 'red' : result.passed ? 'green' : 'yellow';
      const roundedScore = Math.round(result.score);
      const scoreText = result.error ? 'ERR' : `${roundedScore}/${result.maxScore}`;
      const padding = '.'.repeat(Math.max(0, 45 - check.name.length));

      logger.log(
        `  ${colorize(icon, color)} ${check.name}${padding} ${scoreText.padStart(8)}`
      );
    }
  }

  // Display issues and recommendations section
  const allServerCheckResults = allServersResults.flatMap(s => s.results);
  const allResults = [...allServerCheckResults, ...pagesResults.flatMap(p => p.results)];
  const issuesAndWarnings = allResults.filter(({result}) => !result.passed || result.error);

  if (issuesAndWarnings.length > 0) {
    logger.log('');
    logger.log('-'.repeat(80));
    logger.log('ISSUES:');
    logger.log('-'.repeat(80));

    // Group by severity: errors first, then warnings
    const errors = issuesAndWarnings.filter(({result}) => result.error);
    const warnings = issuesAndWarnings.filter(({result}) => !result.error && !result.passed);

    // Display errors
    if (errors.length > 0) {
      logger.log('');
      for (const {check, result} of errors) {
        logger.log(colorize(`  ❌ ${check.name}`, 'red'));
        logger.log(colorize(`     Status: Check failed`, 'red'));
        logger.log(`     Details:  ${result.details}`);
        logger.log('');
      }
    }

    // Display warnings
    if (warnings.length > 0) {
      for (const {check, result} of warnings) {
        const roundedScore = Math.round(result.score * 10) / 10;
        const lostPoints = Math.round((result.maxScore - roundedScore) * 10) / 10;
        logger.log(colorize(`  ⚠️  ${check.name}`, 'yellow'));
        logger.log(colorize(`     Impact: ${lostPoints} point${lostPoints !== 1 ? 's' : ''} lost`, 'yellow'));
        logger.log(`     Details:  ${result.details}`);
        logger.log('');
      }
    }
  } else {
    logger.log('');
    logger.log(colorize('✓ No issues found - excellent AI visibility!', 'green'));
    logger.log('');
  }

  // Save report output for visualization
  // Use primary server's baseUrl as the root for output path
  const primaryBaseUrl = allServersResults[0]?.baseUrl || hostnameGroups[0]?.baseUrl || `https://${rootDomain}`;

  // Generate actionable todos from failed checks
  let todos: any[] = [];
  try {
    const { generateTodosFromResults } = await import('./todo-generator.js');
    todos = generateTodosFromResults(serverResults, pagesResults, primaryBaseUrl);
  } catch (err) {
    // If import fails, continue without todos
  }

  try {
    const reportOutputPath = await saveMultiPageVisibilityCheckJson(
      primaryBaseUrl + '/',
      serverResults,
      pagesResults,
      {
        // Normalized scores (0-100)
        score: percentage,  // Total normalized score
        scoreMax: 100,
        percentage,
        grade: letterGrade,
        // Raw scores for transparency
        serverRawScore,
        serverRawMaxScore,
        // Per-page normalized scores
        pageNormalizedScores,
        // Formula for display
        scoringFormula,
        numEntities: allNormalizedScores.length,
      },
      todos
    );

    // Display path with platform-specific open command
    const plat = platform();
    const openCmd = plat === 'darwin' ? 'open' : plat === 'win32' ? 'start' : 'xdg-open';

    logger.log('='.repeat(80));
    logger.log(`${colorize('✓', 'green')} Report saved to: ${colorize(reportOutputPath, 'cyan')}`);
    logger.log(`${colorize('📋', 'bright')} Open with: ${colorize(`${openCmd} "${reportOutputPath}"`, 'dim')}`);
  } catch (error: any) {
    logger.error(`Failed to save report output: ${error.message}`);
  }

  logger.log('='.repeat(80));
  logger.log(colorize('Thank you for using AICW Visibility. Visit https://www.aicw.io for more tools.', 'dim'));
  logger.log('='.repeat(80));

  // Wait for Enter in interactive mode
  await waitForEnterInInteractiveMode();
}

main().catch(err => {
  logger.error(err.message || err.toString());
  process.exit(1);
});
