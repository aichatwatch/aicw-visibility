/**
 * Reddit Presence Check
 *
 * Checks if a domain is mentioned in Reddit posts/comments.
 * Reddit content (via OpenWebText) was used for GPT-2 training and provides social signals.
 *
 * Reddit API Documentation: https://www.reddit.com/dev/api
 */

import { BaseVisibilityCheck, VisibilityCheckResult, PageCaptured } from './check-base.js';
import { callHttpWithRetry } from '../../../utils/http-caller.js';
import { logger } from '../../../utils/compact-logger.js';
import { extractDomain } from '../../../utils/url-normalizer.js';

const MODULE_NAME = 'Social: Reddit';
const REDDIT_SEARCH_API = 'https://www.reddit.com/search.json';

/**
 * Result from checking Reddit
 */
interface RedditResult {
  totalPosts: number;
  topPosts: Array<{
    title: string;
    subreddit: string;
    url: string;
    score: number;
    numComments: number;
    created: number;
  }>;
}

/**
 * Check if domain is mentioned in Reddit
 * Uses Reddit's JSON API (no authentication required for basic searches)
 */
export class CheckIndexingSocialReddit extends BaseVisibilityCheck {
  name = MODULE_NAME;

  protected async performCheck(url: string, pageCaptured?: PageCaptured): Promise<VisibilityCheckResult> {
    const domain = extractDomain(url);

    try {
      // Search for domain mentions in Reddit using the public JSON API
      // Documentation: https://github.com/reddit-archive/reddit/wiki/JSON
      const searchUrl = new URL(REDDIT_SEARCH_API);
      searchUrl.searchParams.set('q', `url:${domain} OR site:${domain}`);
      searchUrl.searchParams.set('sort', 'relevance');
      searchUrl.searchParams.set('t', 'all'); // all time
      searchUrl.searchParams.set('limit', '25');
      searchUrl.searchParams.set('type', 'link'); // search for posts, not comments

      const response = await callHttpWithRetry(searchUrl.toString(), {
        userAgent: 'Mozilla/5.0 (compatible; AICW-Visibility-Check/1.0; +https://aicw.io)',
        headers: {
          'Accept': 'application/json',
          'Accept-Language': 'en-US,en;q=0.9'
        },
        contextInfo: `Reddit search: ${domain}`,
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
      if (data.error || !data.data) {
        return {
          score: 0,
          maxScore: this.maxScore,
          passed: false,
          details: data.message || 'API error',
          metadata: {
            domain,
            error: data.message || 'Unknown error'
          }
        };
      }

      const posts = data.data.children || [];
      const totalPosts = posts.length;

      // Calculate score based on number of mentions (proportional scoring)
      const passed = totalPosts > 0;
      let score = 0;

      if (passed) {
        // Logarithmic scaling: 1-4 posts = 40-60%, 5-14 = 60-80%, 15+ = 80-100%
        if (totalPosts >= 15) {
          score = this.maxScore * (0.8 + Math.min((totalPosts - 15) / 10, 1) * 0.2); // 80-100%
        } else if (totalPosts >= 5) {
          score = this.maxScore * (0.6 + (totalPosts - 5) / 10 * 0.2); // 60-80%
        } else {
          score = this.maxScore * (0.4 + (totalPosts - 1) / 4 * 0.2); // 40-60%
        }
      }

      // Extract top posts for metadata
      const topPosts = posts.slice(0, 5).map((post: any) => {
        const postData = post.data;
        return {
          title: postData.title || '',
          subreddit: postData.subreddit || '',
          url: `https://reddit.com${postData.permalink}` || '',
          score: postData.score || 0,
          numComments: postData.num_comments || 0,
          created: postData.created_utc || 0
        };
      });

      const details = passed
        ? `${totalPosts} post${totalPosts !== 1 ? 's' : ''} found`
        : 'No posts found';

      return {
        score,
        maxScore: this.maxScore,
        passed,
        details,
        metadata: {
          domain,
          totalPosts,
          topPosts,
          searchType: 'link' // posts only, not comments
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
