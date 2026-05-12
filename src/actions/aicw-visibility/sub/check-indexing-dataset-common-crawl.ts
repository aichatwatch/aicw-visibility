import { BaseVisibilityCheck, VisibilityCheckResult, PageCaptured } from './check-base.js';
import { callHttpWithRetry } from '../../../utils/http-caller.js';
import { logger } from '../../../utils/compact-logger.js';
import { normalizeUrl } from '../../../utils/url-normalizer.js';


const MODULE_NAME = 'Dataset: Common Crawl Dataset';
const COMMON_CRAWL_INDEXES_URL = 'https://index.commoncrawl.org/collinfo.json';
// how many indexes to check in Common Crawl (last 6 datasets from last 6 months)
const MAX_INDEXES_TO_CHECK = 6;
const MONTHS_BACK = 6;

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
 * Filters indexes by date and returns up to the specified limit
 *
 * @param limit - Maximum number of indexes to return (default: MAX_INDEXES_TO_CHECK)
 * @param monthsBack - Number of months to look back (default: MONTHS_BACK)
 * @returns Array of index objects from the last N months
 */
async function getRecentIndexes(
  limit: number = MAX_INDEXES_TO_CHECK,
  monthsBack: number = MONTHS_BACK
): Promise<CommonCrawlIndex[]> {
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
interface UrlCheckResult {
  found: boolean;
  metadata: {
    timestamp?: string;
    warc_file?: string;
    status?: string;
    mime?: string;
    digest?: string;
    url_found?: string;
    error?: string;
  };
}

/**
 * Check if URL exists in a specific Common Crawl index
 * Returns metadata about the crawl if found
 *
 * @param normalizedUrl - Normalized URL to check (e.g., "example.com/path")
 * @param indexId - Common Crawl index ID (e.g., "CC-MAIN-2025-33")
 * @returns Object with found status and metadata
 */
async function checkUrlInIndex(normalizedUrl: string, indexId: string): Promise<UrlCheckResult> {
  const queryUrl = `https://index.commoncrawl.org/${indexId}-index?url=${encodeURIComponent(normalizedUrl)}&output=json`;

  try {
    const response = await callHttpWithRetry(queryUrl, {
      contextInfo: `Checking Common Crawl index: ${indexId}`,
      maxRetries: 1
    });

    if (!response.ok) {
      return { found: false, metadata: {} };
    }

    const text = await response.text();
    const trimmedText = text.trim();

    // API returns NDJSON (newline-delimited JSON)
    // If there are any results, the text will not be empty
    if (trimmedText.length === 0) {
      return { found: false, metadata: {} };
    }

    // Parse NDJSON response - take first result
    try {
      const lines = trimmedText.split('\n');
      const firstResult = JSON.parse(lines[0]);

      return {
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
    } catch (parseError) {
      // If parsing fails, at least we know it was found
      return {
        found: true,
        metadata: { error: 'Failed to parse response metadata' }
      };
    }
  } catch (error: any) {
    logger.error(`Failed to check URL in Common Crawl index ${indexId}: ${error.message}`);
    return {
      found: false,
      metadata: { error: error.message }
    };
  }
}

export class CheckIndexingDatasetCommonCrawl extends BaseVisibilityCheck {
  readonly name = MODULE_NAME;

  protected async performCheck(url: string, pageCaptured?: PageCaptured): Promise<VisibilityCheckResult> {
    try {
      // Normalize URL - keep full path, remove tracking parameters
      const normalizedUrl = normalizeUrl(url);

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
          'Checking URL in Common Crawl datasets from last 6 months:',
          indexes.length,
          'datasets'
        );

        for (let i = 0; i < indexes.length; i++) {
          const index = indexes[i];

          // Check URL in this dataset
          const result = await checkUrlInIndex(normalizedUrl, index.id);

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
          normalized_url: normalizedUrl,
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
