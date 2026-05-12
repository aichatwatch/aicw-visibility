/**
 * Base class for AI visibility checks
 *
 * Provides error handling and standardized result format.
 * Each subclass implements a specific check (robots.txt, meta tags, etc.)
 */

import { mkdir, writeFile } from "fs/promises";
import { USER_LOGS_DIR } from "../../../config/user-paths.js";
import { join } from "path";
import { logger } from "../../../utils/compact-logger.js";

// Check for "no results" indicators
export const NO_SEARCH_RESULTS_PATTERNS = [
  /No results found/i,
  /couldn't find any results/i,
  /didn't match any results/i,
  /0 results/i,
  /Too few matches were found/i,
  /No results found for/i,
  /There are no results for/i,
];


export async function saveResponseToFileIfInDevMode(
  html: string, 
  headers: Headers, 
  domain: string, 
  prefix: string
): Promise<void> {
  const isDev = process.env.AICW_DEV_MODE === 'true' || process.env.NODE_ENV === 'development';
  if (!isDev) return;

  try {
    // Ensure logs directory exists
    await mkdir(USER_LOGS_DIR, { recursive: true });

    const timestamp = new Date().toISOString().replace(/:/g, '-').split('.')[0];
    const filename = `${prefix}-${domain}-${timestamp}.html`;
    const filepath = join(USER_LOGS_DIR, filename);
    await writeFile(filepath, html, 'utf-8');
  } catch (err) {
    logger.error(`Error saving response to file in dev mode: ${err}`);
  }
}

/**
 * Captured page data for both desktop and mobile with timing information
 */
export interface PageCaptured {
  /** Desktop browser HTML content */
  browserHtmlDesktop?: string;
  /** Mobile browser HTML content */
  browserHtmlMobile?: string;
  /** Desktop HTTP response headers */
  browserHeadersDesktop?: Headers;
  /** Mobile HTTP response headers */
  browserHeadersMobile?: Headers;
  /** Desktop response time in milliseconds */
  desktopResponseTimeMs?: number;
  /** Mobile response time in milliseconds */
  mobileResponseTimeMs?: number;
  /** Desktop HTTP status code */
  desktopStatusCode?: number;
  /** Mobile HTTP status code */
  mobileStatusCode?: number;
  /** When desktop page was fetched */
  desktopFetchedAt?: Date;
  /** When mobile page was fetched */
  mobileFetchedAt?: Date;
  /** Cached robots.txt content (undefined if not fetched or 404) */
  robotsTxtContent?: string;
  /** HTTP status from robots.txt fetch */
  robotsTxtStatus?: number;
  /** Cached sitemap.xml content (undefined if not fetched or 404) */
  sitemapXmlContent?: string;
  /** HTTP status from sitemap.xml fetch */
  sitemapXmlStatus?: number;

  // Puppeteer browser instance (for checks that need rendering)
  /** Puppeteer browser instance (shared across page checks) */
  puppeteerBrowser?: import('puppeteer').Browser;

  // Homepage-specific data for server-level checks
  /** Homepage desktop HTML content */
  homepageHtmlDesktop?: string;
  /** Homepage mobile HTML content */
  homepageHtmlMobile?: string;
  /** Homepage desktop HTTP response headers */
  homepageHeadersDesktop?: Headers;
  /** Homepage mobile HTTP response headers */
  homepageHeadersMobile?: Headers;
  /** Homepage desktop response time in milliseconds */
  homepageDesktopResponseTimeMs?: number;
  /** Homepage mobile response time in milliseconds */
  homepageMobileResponseTimeMs?: number;
  /** Homepage desktop HTTP status code */
  homepageDesktopStatusCode?: number;
  /** Homepage mobile HTTP status code */
  homepageMobileStatusCode?: number;
}

export interface VisibilityCheckResult {
  /** Score earned (0 to maxScore, or -1 for error) */
  score: number;
  /** Maximum possible score for this check */
  maxScore: number;
  /** Whether check passed (score meets threshold) */
  passed: boolean;
  /** Human-readable summary of result */
  details: string;
  /** True if an error occurred during check */
  error?: boolean;
  /** Additional metadata for debugging/logging */
  metadata?: Record<string, any>;
}

/**
 * Discriminated union for check scope
 * - domain: Check runs once per domain (e.g., robots.txt, Common Crawl domain check)
 * - page: Check runs for each specific page URL
 * - homepage: Check runs specifically on the root path of a domain
 */
export type CheckScope =
  | { type: 'domain'; domain: string }
  | { type: 'page'; url: string }
  | { type: 'homepage'; domain: string };

/**
 * Extended result with explicit scope information
 */
export interface ScopedCheckResult extends VisibilityCheckResult {
  scope: CheckScope;
}

/**
 * Abstract base class for visibility checks
 *
 * Handles errors automatically, subclasses only implement the check logic.
 */
export abstract class BaseVisibilityCheck {
  /** Display name for this check */
  abstract readonly name: string;

  /** Maximum score for this check (set from configuration) */
  public maxScore!: number;

  /**
   * Target path determines the scope of this check:
   * - undefined: Domain-scoped (uses domain only, not specific path)
   * - '/': Homepage-specific (checks the root path)
   * - null: Page-scoped (uses full page URL passed to performCheck)
   * - other string: Specific path (uses domain + this path)
   */
  protected targetPath?: string | null;

  /**
   * Set the maximum score for this check
   * Called during instantiation with configured weight
   */
  setMaxScore(score: number): this {
    this.maxScore = score;
    return this;
  }

  /**
   * Get the scope of this check as a discriminated union
   * Useful for type-safe handling of check results
   *
   * @param inputUrl - The URL being checked
   * @returns CheckScope discriminated union indicating domain/page/homepage scope
   */
  public getScope(inputUrl: string): CheckScope {
    try {
      const urlObj = new URL(inputUrl.startsWith('http') ? inputUrl : 'https://' + inputUrl);

      if (this.targetPath === undefined) {
        // Domain-level check
        return { type: 'domain', domain: urlObj.host };
      } else if (this.targetPath === null) {
        // Page-level check
        return { type: 'page', url: inputUrl };
      } else {
        // Homepage or specific path check
        return { type: 'homepage', domain: urlObj.host };
      }
    } catch {
      // Fallback for invalid URLs
      if (this.targetPath === null) {
        return { type: 'page', url: inputUrl };
      }
      return { type: 'domain', domain: inputUrl };
    }
  }

  /**
   * Get the effective URL based on targetPath setting
   *
   * @param inputUrl - The URL passed to the check
   * @returns The URL to actually check based on targetPath
   */
  protected getEffectiveUrl(inputUrl: string): string {
    if (this.targetPath === undefined) {
      // Domain-level: just the domain (no path)
      const urlObj = new URL(inputUrl);
      return `${urlObj.protocol}//${urlObj.host}`;
    } else if (this.targetPath === null) {
      // Page-level: use full URL as-is
      return inputUrl;
    } else {
      // Specific path: domain + targetPath
      const urlObj = new URL(inputUrl);
      urlObj.pathname = this.targetPath;
      urlObj.search = '';
      urlObj.hash = '';
      return urlObj.toString();
    }
  }

  /**
   * Execute the visibility check
   * Handles errors automatically and returns standardized result
   *
   * @param url - URL to check
   * @param pageCaptured - Captured page data for desktop and mobile
   * @returns Check result with score and details
   */
  async execute(url: string, pageCaptured?: PageCaptured): Promise<VisibilityCheckResult> {
    try {
      return await this.performCheck(url, pageCaptured);
    } catch (error: any) {
      // Automatic error handling - return error result
      return {
        score: -1,
        maxScore: this.maxScore,
        passed: false,
        details: `Error: ${error.message}`,
        error: true
      };
    }
  }

  /**
   * Perform the actual check logic
   * Subclasses implement this method
   *
   * @param url - URL to check
   * @param pageCaptured - Captured page data for desktop and mobile
   * @returns Check result
   */
  protected abstract performCheck(url: string, pageCaptured?: PageCaptured): Promise<VisibilityCheckResult>;
}
