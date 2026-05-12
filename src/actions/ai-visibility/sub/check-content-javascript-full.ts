/**
 * Full JavaScript Content Check using Puppeteer
 *
 * Runs PER PAGE - each page URL gets its own comparison.
 *
 * Compares:
 * 1. HTTP fetch text content (what AI bots see)
 * 2. Puppeteer-rendered text content (what users see)
 *
 * Returns exact JS dependency ratio for THIS PAGE.
 */

import puppeteer, { Browser, Page } from 'puppeteer';

export interface JSContentCheckResult {
  desktop: {
    textLengthNoJS: number;
    textLengthWithJS: number;
    jsContentRatio: number;
  };
  mobile: {
    textLengthNoJS: number;
    textLengthWithJS: number;
    jsContentRatio: number;
  };
  avgRatio: number;
  grade: 'excellent' | 'good' | 'warning' | 'critical';
  details: string;
}

/**
 * Launch Puppeteer browser
 * Browser downloads Chromium automatically on first run (~150MB)
 */
export async function launchBrowser(): Promise<Browser> {
  return puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });
}

/**
 * Extract visible text content from HTML (what AI bots see)
 */
export function extractTextContent(html: string): string {
  // Extract body content
  const bodyMatch = html.match(/<body[^>]*>([\s\S]*)<\/body>/i);
  const bodyContent = bodyMatch ? bodyMatch[1] : html;

  // Clean and extract text
  return bodyContent
    .replace(/<script[\s\S]*?<\/script>/gi, '')   // Remove scripts
    .replace(/<style[\s\S]*?<\/style>/gi, '')      // Remove styles
    .replace(/<!--[\s\S]*?-->/g, '')               // Remove HTML comments
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, '') // Remove noscript (not visible to bots)
    .replace(/<[^>]+>/g, ' ')                      // Replace tags with space
    .replace(/\s+/g, ' ')                          // Normalize whitespace
    .trim();
}

/**
 * Get grade based on JS content ratio
 */
function getGrade(ratio: number): 'excellent' | 'good' | 'warning' | 'critical' {
  if (ratio >= 90) return 'excellent';
  if (ratio >= 50) return 'good';
  if (ratio >= 20) return 'warning';
  return 'critical';
}

/**
 * Build human-readable details message
 */
function buildDetails(
  desktopRatio: number,
  mobileRatio: number,
  avgRatio: number,
  desktopNoJS: number,
  desktopWithJS: number,
  mobileNoJS: number,
  mobileWithJS: number
): string {
  const grade = getGrade(avgRatio);
  const gradeEmoji = {
    excellent: '✓',
    good: '○',
    warning: '⚠',
    critical: '✗'
  }[grade];

  let msg = `${gradeEmoji} JS Content Ratio: ${avgRatio}% (${grade})\n`;
  msg += `   Desktop: ${desktopNoJS.toLocaleString()} / ${desktopWithJS.toLocaleString()} chars (${desktopRatio}%)\n`;
  msg += `   Mobile: ${mobileNoJS.toLocaleString()} / ${mobileWithJS.toLocaleString()} chars (${mobileRatio}%)`;

  if (avgRatio < 50) {
    msg += `\n   ⚠ AI bots can only see ${avgRatio}% of your content!`;
    msg += `\n   Solution: Implement Server-Side Rendering (SSR)`;
  }

  return msg;
}

/**
 * Helper to wait for a specified time
 */
function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Perform full JS check for a SINGLE PAGE
 * Called once per page URL in the visibility check
 *
 * @param url - The specific page URL to check
 * @param httpHtmlDesktop - Already fetched HTML (desktop UA)
 * @param httpHtmlMobile - Already fetched HTML (mobile UA)
 * @param browser - Shared browser instance (passed from action level)
 */
export async function performFullJSCheckForPage(
  url: string,
  httpHtmlDesktop: string,
  httpHtmlMobile: string,
  browser: Browser
): Promise<JSContentCheckResult> {
  const page = await browser.newPage();

  try {
    // === DESKTOP CHECK ===
    await page.setViewport({ width: 1280, height: 800 });
    await page.goto(url, { waitUntil: 'networkidle0', timeout: 30000 });
    await delay(2000);  // Wait for JS frameworks to render

    const desktopTextWithJS = await page.evaluate(() => {
      return document.body?.innerText || '';
    });
    const desktopTextNoJS = extractTextContent(httpHtmlDesktop);

    // === MOBILE CHECK ===
    await page.setViewport({ width: 375, height: 667 });
    await delay(500);  // Allow responsive adjustments

    const mobileTextWithJS = await page.evaluate(() => {
      return document.body?.innerText || '';
    });
    const mobileTextNoJS = extractTextContent(httpHtmlMobile);

    // Calculate ratios
    const desktopRatio = Math.round(
      (desktopTextNoJS.length / Math.max(desktopTextWithJS.length, 1)) * 100
    );
    const mobileRatio = Math.round(
      (mobileTextNoJS.length / Math.max(mobileTextWithJS.length, 1)) * 100
    );
    const avgRatio = Math.round((desktopRatio + mobileRatio) / 2);

    return {
      desktop: {
        textLengthNoJS: desktopTextNoJS.length,
        textLengthWithJS: desktopTextWithJS.length,
        jsContentRatio: desktopRatio
      },
      mobile: {
        textLengthNoJS: mobileTextNoJS.length,
        textLengthWithJS: mobileTextWithJS.length,
        jsContentRatio: mobileRatio
      },
      avgRatio,
      grade: getGrade(avgRatio),
      details: buildDetails(
        desktopRatio,
        mobileRatio,
        avgRatio,
        desktopTextNoJS.length,
        desktopTextWithJS.length,
        mobileTextNoJS.length,
        mobileTextWithJS.length
      )
    };

  } finally {
    await page.close();  // Close page, NOT browser (browser is shared)
  }
}

/**
 * Calculate score based on JS content ratio
 * Maps ratio to score proportionally
 *
 * @param avgRatio - Average JS content ratio (0-100)
 * @param maxScore - Maximum score for this check
 * @returns Score (0 to maxScore)
 */
export function calculateScoreFromRatio(avgRatio: number, maxScore: number): number {
  // Map ratio directly to score percentage
  // 90-100% ratio = full score
  // 50% ratio = 50% score
  // 0% ratio = 0 score
  const scorePercent = avgRatio / 100;
  return Math.round(scorePercent * maxScore * 10) / 10;
}
