/**
 * Common Crawl Dataset Check - Page Level
 *
 * Checks if a specific page URL is present in Common Crawl datasets.
 * Uses exact URL matching.
 * This is a page-level check (runs for each page).
 */

import { CheckIndexingDatasetCommonCrawlBase } from './check-indexing-dataset-common-crawl-base.js';
import { normalizeUrl } from '../../../utils/url-normalizer.js';

const MODULE_NAME = 'Indexing: Common Crawl';

export class CheckIndexingDatasetCommonCrawlPage extends CheckIndexingDatasetCommonCrawlBase {
  readonly name = MODULE_NAME;

  // Page-scoped check
  protected targetPath = null;

  /**
   * Get exact URL pattern for page-level search
   * Uses normalized URL to find this specific page
   */
  protected getQueryPattern(url: string): string {
    // Use the full page URL, normalized
    return normalizeUrl(url);
  }

  protected getCheckDescription(): string {
    return 'page URL';
  }
}
