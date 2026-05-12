/**
 * X-Robots-Tag HTTP Header Check - Base Class
 *
 * Checks X-Robots-Tag HTTP headers for blocking directives that prevent AI indexing:
 * - X-Robots-Tag: noindex
 * - X-Robots-Tag: noai
 * - X-Robots-Tag: noimageai
 * - X-Robots-Tag: nosnippet
 *
 * These headers are sent at the HTTP protocol level, before HTML is parsed.
 * Extended by homepage-level and page-level variants.
 */

import { BaseVisibilityCheck, VisibilityCheckResult, PageCaptured } from './check-base.js';

/**
 * Abstract base class for HTTP header checks
 * Provides shared logic for both homepage-level and page-level checks
 */
export abstract class CheckHttpHeadersBase extends BaseVisibilityCheck {
  /**
   * Get the headers to check based on the variant type
   * Homepage variant uses homepageHeaders, Page variant uses browserHeaders
   *
   * @param pageCaptured - Captured page data
   * @returns Headers object to check, or undefined if not available
   */
  protected abstract getHeadersToCheck(pageCaptured?: PageCaptured): Headers | undefined;

  /**
   * Get the message to display when headers are not available
   */
  protected abstract getUnavailableMessage(): string;

  protected async performCheck(url: string, pageCaptured?: PageCaptured): Promise<VisibilityCheckResult> {
    // Get headers based on check type (homepage or page)
    const headers = this.getHeadersToCheck(pageCaptured);

    // If headers not available, return neutral result
    if (!headers) {
      return {
        score: this.maxScore,
        maxScore: this.maxScore,
        passed: true,
        details: this.getUnavailableMessage(),
        metadata: { headers_available: false }
      };
    }

    // Get all X-Robots-Tag headers (can be multiple)
    const xRobotsValues: string[] = [];

    // Headers.get() only returns the first value, so we need to check all
    headers.forEach((value, key) => {
      if (key.toLowerCase() === 'x-robots-tag') {
        xRobotsValues.push(value);
      }
    });

    // If no X-Robots-Tag headers, all is good
    if (xRobotsValues.length === 0) {
      return {
        score: this.maxScore,
        maxScore: this.maxScore,
        passed: true,
        details: 'No blocking X-Robots-Tag headers found (all good)',
        metadata: { x_robots_tag_present: false }
      };
    }

    // Parse directives from headers (comma-separated values)
    const blockingDirectives = /\b(noindex|noai|noimageai|nosnippet)\b/i;
    const foundBlockingDirectives: string[] = [];

    for (const headerValue of xRobotsValues) {
      const directives = headerValue.split(',').map(d => d.trim());
      for (const directive of directives) {
        if (blockingDirectives.test(directive)) {
          foundBlockingDirectives.push(directive);
        }
      }
    }

    // Calculate score
    const hasBlockingDirective = foundBlockingDirectives.length > 0;
    const score = hasBlockingDirective ? 0 : this.maxScore;

    return {
      score,
      maxScore: this.maxScore,
      passed: !hasBlockingDirective,
      details: hasBlockingDirective
        ? `Found blocking: X-Robots-Tag: ${foundBlockingDirectives.join(', ')}`
        : 'No blocking X-Robots-Tag directives',
      metadata: {
        x_robots_tag_present: true,
        header_values: xRobotsValues,
        blocking_directives: foundBlockingDirectives
      }
    };
  }
}
