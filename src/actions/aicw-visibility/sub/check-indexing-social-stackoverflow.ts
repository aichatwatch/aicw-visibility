/**
 * Stack Overflow Presence Check
 *
 * Checks if a domain is mentioned in Stack Overflow questions/answers.
 * Stack Overflow content is part of RedPajama training dataset used by major LLMs.
 *
 * Stack Exchange API Documentation: https://api.stackexchange.com/docs
 */

import { BaseVisibilityCheck, VisibilityCheckResult, PageCaptured } from './check-base.js';
import { callHttpWithRetry } from '../../../utils/http-caller.js';
import { logger } from '../../../utils/compact-logger.js';
import { extractDomain } from '../../../utils/url-normalizer.js';

const MODULE_NAME = 'Social: Stack Overflow';
const STACK_EXCHANGE_API = 'https://api.stackexchange.com/2.3/search/advanced';

/**
 * Result from checking Stack Overflow
 */
interface StackOverflowResult {
  totalItems: number;
  topItems: Array<{
    title: string;
    link: string;
    score: number;
    answerCount: number;
    isAnswered: boolean;
  }>;
}

/**
 * Check if domain is mentioned in Stack Overflow
 * Uses Stack Exchange API to search for questions/answers containing the domain
 */
export class CheckIndexingSocialStackOverflow extends BaseVisibilityCheck {
  name = MODULE_NAME;

  protected async performCheck(url: string, pageCaptured?: PageCaptured): Promise<VisibilityCheckResult> {
    const domain = extractDomain(url);

    try {
      // Search for domain mentions in Stack Overflow
      // API: https://api.stackexchange.com/docs/advanced-search
      const searchUrl = new URL(STACK_EXCHANGE_API);
      searchUrl.searchParams.set('order', 'desc');
      searchUrl.searchParams.set('sort', 'votes');
      searchUrl.searchParams.set('q', domain);
      searchUrl.searchParams.set('site', 'stackoverflow');
      searchUrl.searchParams.set('pagesize', '10');
      searchUrl.searchParams.set('filter', 'default'); // Get standard fields

      const response = await callHttpWithRetry(searchUrl.toString(), {
        headers: {
          'Accept': 'application/json',
          'Accept-Encoding': 'gzip'
        },
        contextInfo: `Stack Overflow search: ${domain}`,
        maxRetries: 1
      });

      if (!response.ok) {
        return {
          score: 0,
          maxScore: this.maxScore,
          passed: false,
          details: `API error: HTTP ${response.status}`,
          metadata: {
            domain,
            error: `HTTP ${response.status}`
          }
        };
      }

      const data = await response.json();

      // Check for API errors
      if (data.error_id || data.error_message) {
        return {
          score: 0,
          maxScore: this.maxScore,
          passed: false,
          details: `API error: ${data.error_name || 'Unknown error'}`,
          metadata: {
            domain,
            error: data.error_message || 'Unknown error'
          }
        };
      }

      const totalItems = data.total || 0;
      const items = data.items || [];

      // Calculate score based on number of mentions (proportional scoring)
      const passed = totalItems > 0;
      let score = 0;

      if (passed) {
        // Logarithmic scaling: 1-9 items = 40-70%, 10-99 = 70-90%, 100+ = 90-100%
        if (totalItems >= 100) {
          score = this.maxScore; // 100%
        } else if (totalItems >= 10) {
          score = this.maxScore * (0.7 + (Math.min(totalItems, 99) - 10) / 89 * 0.2); // 70-90%
        } else {
          score = this.maxScore * (0.4 + (totalItems - 1) / 9 * 0.3); // 40-70%
        }
      }

      // Extract top items for metadata
      const topItems = items.slice(0, 5).map((item: any) => ({
        title: item.title,
        link: item.link,
        score: item.score || 0,
        answerCount: item.answer_count || 0,
        isAnswered: item.is_answered || false
      }));

      const details = passed
        ? `${totalItems} mention${totalItems !== 1 ? 's' : ''} found`
        : 'No mentions found';

      return {
        score,
        maxScore: this.maxScore,
        passed,
        details,
        metadata: {
          domain,
          totalItems,
          topItems,
          apiQuotaRemaining: data.quota_remaining,
          hasMore: data.has_more || false
        }
      };

    } catch (error: any) {
      return {
        score: 0,
        maxScore: this.maxScore,
        passed: false,
        details: `Error: ${error.message}`,
        error: true,
        metadata: {
          domain,
          error: error.message
        }
      };
    }
  }
}
