/**
 * Common Crawl Dataset Check - Domain Level
 *
 * Checks if the domain is present in Common Crawl datasets.
 * Uses wildcard pattern to find ANY page from the domain.
 * This is a server-level check (runs once per domain).
 */

import { CheckIndexingDatasetCommonCrawlBase } from './check-indexing-dataset-common-crawl-base.js';
import { extractDomain } from '../../../utils/url-normalizer.js';

const MODULE_NAME = 'Indexing: Common Crawl';

export class CheckIndexingDatasetCommonCrawlDomain extends CheckIndexingDatasetCommonCrawlBase {
  readonly name = MODULE_NAME;

  // Domain-scoped check
  protected targetPath = undefined;

  /**
   * Get wildcard query pattern for domain-level search
   * Uses *.domain.com/* to find any page from this domain
   */
  protected getQueryPattern(url: string): string {
    const domain = extractDomain(url);
    // Use wildcard pattern to match any page from this domain
    return `*.${domain}/*`;
  }

  protected getCheckDescription(): string {
    return 'domain';
  }
}
