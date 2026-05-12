/**
 * Common Crawl Dataset Check - Base Class
 *
 * This module provides shared logic for checking URL/domain presence in Common Crawl datasets.
 * Extended by two variants:
 *
 * ## Domain-Level Check (`CheckIndexingDatasetCommonCrawlDomain`)
 * - Scope: Runs once per domain (server-level)
 * - Query pattern: `*.domain.com/*` (wildcard)
 * - Purpose: Determines if ANY page from the domain has been crawled
 * - Use case: Verifying domain-wide visibility in training datasets
 *
 * ## Page-Level Check (`CheckIndexingDatasetCommonCrawlPage`)
 * - Scope: Runs for each specific page URL
 * - Query pattern: Exact normalized URL
 * - Purpose: Determines if a specific page has been crawled
 * - Use case: Verifying specific content is in training datasets
 *
 * Both checks query the last 6 months of Common Crawl indexes (up to 6 datasets)
 * and calculate a proportional score based on coverage across datasets.
 *
 * @see https://index.commoncrawl.org/ for API documentation
 */

import { BaseVisibilityCheck, VisibilityCheckResult, PageCaptured } from './check-base.js';
import { callHttpWithRetry } from '../../../utils/http-caller.js';
import { logger } from '../../../utils/compact-logger.js';
import { normalizeUrl, extractDomain } from '../../../utils/url-normalizer.js';

const COMMON_CRAWL_INDEXES_URL = 'https://index.commoncrawl.org/collinfo.json';
// how many indexes to check in Common Crawl (last 6 datasets from last 6 months)
const MAX_INDEXES_TO_CHECK = 6;
const MONTHS_BACK = 6;

/**
 * In-memory cache for Common Crawl index list
 * TTL: 1 hour (indexes don't change frequently)
 */
const INDEX_CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour
let indexListCache: { data: CommonCrawlIndex[]; timestamp: number } | null = null;

/**
 * In-memory cache for URL check results
 * TTL: 24 hours (Common Crawl data is static once published)
 * Key format: `${indexId}:${queryPattern}`
 */
const URL_CHECK_CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours
const urlCheckCache = new Map<string, { data: UrlCheckResult; timestamp: number }>();

/**
 * Check if a cached entry is still valid
 * @param timestamp - When the entry was cached
 * @param ttlMs - Time-to-live in milliseconds
 * @returns True if entry is still valid
 */
function isCacheValid(timestamp: number, ttlMs: number): boolean {
  return Date.now() - timestamp < ttlMs;
}

/**
 * Interface for Common Crawl index metadata
 */
interface CommonCrawlIndex {
  id: string;
  name: string;
  timegate: string;
  cdx_api: string;
}

/**
 * Filter Common Crawl indexes by date
 * Only includes indexes from the last N months
 *
 * @param indexes - Array of Common Crawl indexes
 * @param monthsBack - Number of months to look back (default: 6)
 * @returns Filtered array of indexes within the date range
 */
function filterIndexesByDate(indexes: CommonCrawlIndex[], monthsBack: number = 6): CommonCrawlIndex[] {
  const cutoffDate = new Date();
  cutoffDate.setMonth(cutoffDate.getMonth() - monthsBack);

  return indexes.filter(index => {
    // Parse CC-MAIN-YYYY-WW format (e.g., CC-MAIN-2025-33)
    const match = index.id.match(/CC-MAIN-(\d{4})-(\d{2})/);
    if (!match) return false;

    const year = parseInt(match[1]);
    const week = parseInt(match[2]);

    // Calculate approximate date from ISO year + week number
    // Week 1 starts on the first week of January (simplified calculation)
    const indexDate = new Date(year, 0, 1 + (week - 1) * 7);

    return indexDate >= cutoffDate;
  });
}

/**
 * Get list of available Common Crawl indexes from the last N months
 * Filters indexes by date and returns up to the specified limit.
 * Results are cached in-memory for 1 hour to reduce API calls.
 *
 * @param limit - Maximum number of indexes to return (default: MAX_INDEXES_TO_CHECK)
 * @param monthsBack - Number of months to look back (default: MONTHS_BACK)
 * @returns Array of index objects from the last N months
 */
export async function getRecentIndexes(
  limit: number = MAX_INDEXES_TO_CHECK,
  monthsBack: number = MONTHS_BACK
): Promise<CommonCrawlIndex[]> {
  // Check cache first
  if (indexListCache && isCacheValid(indexListCache.timestamp, INDEX_CACHE_TTL_MS)) {
    const recentIndexes = filterIndexesByDate(indexListCache.data, monthsBack);
    return recentIndexes.slice(0, limit);
  }

  try {
    const response = await callHttpWithRetry(
      COMMON_CRAWL_INDEXES_URL,
      {
        contextInfo: 'Fetching Common Crawl index list',
        maxRetries: 2
      }
    );

    if (!response.ok) {
      throw new Error(`Failed to fetch index list: HTTP ${response.status}`);
    }

    const indexes: CommonCrawlIndex[] = await response.json();

    // Cache the full index list
    indexListCache = {
      data: indexes,
      timestamp: Date.now()
    };

    // Filter indexes by date (last N months)
    const recentIndexes = filterIndexesByDate(indexes, monthsBack);

    // Return up to the specified limit
    return recentIndexes.slice(0, limit);
  } catch (error: any) {
    throw new Error(`Failed to fetch Common Crawl index list from ${COMMON_CRAWL_INDEXES_URL} with the error: ${error.message}`);
  }
}

/**
 * Result from checking a URL in a Common Crawl index
 */
export interface UrlCheckResult {
  found: boolean;
  metadata: {
    timestamp?: string;
    warc_file?: string;
    status?: string;
    mime?: string;
    digest?: string;
    url_found?: string;
    error?: string;
    /** Type of error (e.g., 'ENOTFOUND', 'TIMEOUT') */
    errorType?: string;
    /** Whether the error is recoverable on retry */
    recoverable?: boolean;
  };
}

/**
 * Check if URL/domain exists in a specific Common Crawl index
 * Returns metadata about the crawl if found.
 * Results are cached in-memory for 24 hours to reduce API calls.
 *
 * @param queryPattern - URL or domain pattern to check (e.g., "example.com/path" or "*.example.com/*")
 * @param indexId - Common Crawl index ID (e.g., "CC-MAIN-2025-33")
 * @returns Object with found status and metadata
 */
export async function checkUrlInIndex(queryPattern: string, indexId: string): Promise<UrlCheckResult> {
  // Check cache first
  const cacheKey = `${indexId}:${queryPattern}`;
  const cachedResult = urlCheckCache.get(cacheKey);
  if (cachedResult && isCacheValid(cachedResult.timestamp, URL_CHECK_CACHE_TTL_MS)) {
    return cachedResult.data;
  }

  const queryUrl = `https://index.commoncrawl.org/${indexId}-index?url=${encodeURIComponent(queryPattern)}&output=json`;

  try {
    const response = await callHttpWithRetry(queryUrl, {
      contextInfo: `Checking Common Crawl index: ${indexId}`,
      maxRetries: 1
    });

    if (!response.ok) {
      const result: UrlCheckResult = { found: false, metadata: {} };
      // Cache negative results too
      urlCheckCache.set(cacheKey, { data: result, timestamp: Date.now() });
      return result;
    }

    const text = await response.text();
    const trimmedText = text.trim();

    // API returns NDJSON (newline-delimited JSON)
    // If there are any results, the text will not be empty
    if (trimmedText.length === 0) {
      const result: UrlCheckResult = { found: false, metadata: {} };
      urlCheckCache.set(cacheKey, { data: result, timestamp: Date.now() });
      return result;
    }

    // Parse NDJSON response - take first result
    try {
      const lines = trimmedText.split('\n');
      const firstResult = JSON.parse(lines[0]);

      const result: UrlCheckResult = {
        found: true,
        metadata: {
          timestamp: firstResult.timestamp,
          warc_file: firstResult.filename,
          status: firstResult.status,
          mime: firstResult.mime || firstResult['mime-detected'],
          digest: firstResult.digest,
          url_found: firstResult.url
        }
      };

      // Cache successful result
      urlCheckCache.set(cacheKey, { data: result, timestamp: Date.now() });
      return result;
    } catch (parseError) {
      // If parsing fails, at least we know it was found
      const result: UrlCheckResult = {
        found: true,
        metadata: { error: 'Failed to parse response metadata' }
      };
      urlCheckCache.set(cacheKey, { data: result, timestamp: Date.now() });
      return result;
    }
  } catch (error: any) {
    logger.warn(`Failed to check URL in Common Crawl index ${indexId}: ${error.message}`);
    // Don't cache errors - allow retry on next attempt
    return {
      found: false,
      metadata: {
        error: error.message,
        errorType: (error as any).code || 'UNKNOWN',
        recoverable: true
      }
    };
  }
}

/**
 * Clear the URL check cache
 * Useful for testing or when forcing fresh data
 */
export function clearUrlCheckCache(): void {
  urlCheckCache.clear();
}

/**
 * Clear the index list cache
 * Useful for testing or when forcing fresh data
 */
export function clearIndexCache(): void {
  indexListCache = null;
}

/**
 * Abstract base class for Common Crawl checks
 * Provides shared logic for both domain-level and page-level checks
 */
export abstract class CheckIndexingDatasetCommonCrawlBase extends BaseVisibilityCheck {
  /**
   * Get the query pattern for Common Crawl API
   * Domain checks use wildcard pattern, page checks use exact URL
   *
   * @param url - Input URL
   * @returns Query pattern for Common Crawl API
   */
  protected abstract getQueryPattern(url: string): string;

  /**
   * Get a human-readable description of what is being checked
   */
  protected abstract getCheckDescription(): string;

  protected async performCheck(url: string, pageCaptured?: PageCaptured): Promise<VisibilityCheckResult> {
    try {
      // Get the query pattern based on check type (domain vs page)
      const queryPattern = this.getQueryPattern(url);

      // Get recent indexes from last 6 months
      const indexes = await getRecentIndexes(MAX_INDEXES_TO_CHECK, MONTHS_BACK);

      if (indexes.length === 0) {
        throw new Error('No Common Crawl indexes available from the last 6 months');
      }

      // Track results for each dataset check
      const results: Array<{
        indexId: string;
        found: boolean;
        metadata: any;
      }> = [];

      // Start progress tracking with try-finally to ensure completion
      try {
        logger.startProgress(
          `Checking ${this.getCheckDescription()} in Common Crawl datasets from last 6 months:`,
          indexes.length,
          'datasets'
        );

        for (let i = 0; i < indexes.length; i++) {
          const index = indexes[i];

          // Check URL/domain in this dataset
          const result = await checkUrlInIndex(queryPattern, index.id);

          results.push({
            indexId: index.id,
            found: result.found,
            metadata: result.metadata
          });

          // Update progress with result
          const statusIcon = result.found ? '✓' : '○';
          logger.updateProgress(i + 1, `${index.id} ${statusIcon}`);
        }
      } finally {
        // ALWAYS complete progress, even if error occurs
        logger.completeProgress('');
      }

      // Calculate proportional score
      const foundCount = results.filter(r => r.found).length;
      const scorePerDataset = this.maxScore / indexes.length;

      // Create sub-checks array (one per dataset) using functional map
      const sub_checks = results.map(result => {
        const datasetScore = result.found ? scorePerDataset : 0;

        // Format timestamp if available (YYYYMMDDHHmmss -> YYYY-MM-DD)
        let captureDate = 'unknown date';
        if (result.metadata.timestamp) {
          const ts = result.metadata.timestamp;
          captureDate = `${ts.substring(0, 4)}-${ts.substring(4, 6)}-${ts.substring(6, 8)}`;
        }

        return {
          check_name: `Common Crawl - ${result.indexId}`,
          passed: result.found,
          score: Math.round(datasetScore * 100) / 100,
          score_max: Math.round(scorePerDataset * 100) / 100,
          score_percent: result.found ? 100 : 0,
          details: result.found
            ? `Found (captured ${captureDate})`
            : 'Not found in this dataset',
          metadata: {
            dataset_id: result.indexId,
            ...result.metadata
          }
        };
      });

      // Calculate total proportional score: (found / total) × maxScore
      const score = Math.round((foundCount / indexes.length) * this.maxScore * 100) / 100;
      const passed = foundCount > 0; // Pass if found in at least 1 dataset

      // Build details message
      const details = foundCount === 0
        ? `Not found in any of ${indexes.length} datasets from last 6 months`
        : `Found in ${foundCount}/${indexes.length} datasets from last 6 months (${Math.round((foundCount / indexes.length) * 100)}% coverage)`;

      return {
        score,
        maxScore: this.maxScore,
        passed,
        details,
        metadata: {
          query_pattern: queryPattern,
          datasets_checked: indexes.length,
          datasets_found: foundCount,
          coverage_percent: Math.round((foundCount / indexes.length) * 100),
          found_in_datasets: results.filter(r => r.found).map(r => r.indexId),
          checked_datasets: indexes.map(i => i.id),
          sub_checks
        }
      };
    } catch (error: any) {
      throw new Error(`Common Crawl check failed: ${error.message}`);
    }
  }
}
