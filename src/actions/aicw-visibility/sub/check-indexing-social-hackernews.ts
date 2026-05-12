import { BaseVisibilityCheck, VisibilityCheckResult, PageCaptured } from './check-base.js';
import { callHttpWithRetry } from '../../../utils/http-caller.js';
import { logger } from '../../../utils/compact-logger.js';
import { normalizeUrl } from '../../../utils/url-normalizer.js';

const MODULE_NAME = 'Social: Hacker News';
const ALGOLIA_HN_API = 'https://hn.algolia.com/api/v1/search';

/**
 * Hacker News content types to check
 */
interface HNContentType {
  name: string;
  tag: string;
  description: string;
}

/**
 * Result from checking a content type
 */
interface TypeCheckResult {
  type: string;
  found: boolean;
  count: number;
  topStory?: {
    title: string;
    points: number;
    created_at: string;
    objectID: string;
  };
  metadata: {
    tag?: string;
    error?: string;
  };
}

/**
 * Get HN content types to check
 */
function getContentTypes(): HNContentType[] {
  return [
    { name: 'Stories', tag: 'story', description: 'Main story submissions' },
    { name: 'Ask HN', tag: 'ask_hn', description: 'Ask HN posts' },
    { name: 'Show HN', tag: 'show_hn', description: 'Show HN posts' },
    { name: 'Comments', tag: 'comment', description: 'Comment mentions' }
  ];
}

/**
 * Check HN for URL in a specific content type
 */
async function checkContentType(normalizedUrl: string, contentType: HNContentType): Promise<TypeCheckResult> {
  // Search for URL with specific tag
  const queryUrl = `${ALGOLIA_HN_API}?query=${encodeURIComponent(normalizedUrl)}&tags=${contentType.tag}&hitsPerPage=10`;

  try {
    const response = await callHttpWithRetry(queryUrl, {
      contextInfo: `Checking Hacker News: ${contentType.name}`,
      maxRetries: 1
    });

    if (!response.ok) {
      return {
        type: contentType.name,
        found: false,
        count: 0,
        metadata: { tag: contentType.tag }
      };
    }

    const data = await response.json();
    const hits = data.hits || [];
    const count = data.nbHits || 0;

    if (count === 0 || hits.length === 0) {
      return {
        type: contentType.name,
        found: false,
        count: 0,
        metadata: { tag: contentType.tag }
      };
    }

    // Get top story (first hit, sorted by relevance)
    const topHit = hits[0];
    const topStory = {
      title: topHit.title || topHit.story_title || 'Unknown',
      points: topHit.points || 0,
      created_at: topHit.created_at || '',
      objectID: topHit.objectID || ''
    };

    return {
      type: contentType.name,
      found: true,
      count,
      topStory,
      metadata: { tag: contentType.tag }
    };
  } catch (error: any) {
    logger.error(`Failed to check Hacker News ${contentType.name}: ${error.message}`);
    return {
      type: contentType.name,
      found: false,
      count: 0,
      metadata: { tag: contentType.tag, error: error.message }
    };
  }
}

export class CheckIndexingSocialHackerNews extends BaseVisibilityCheck {
  readonly name = MODULE_NAME;

  protected async performCheck(url: string, pageCaptured?: PageCaptured): Promise<VisibilityCheckResult> {
    try {
      // Normalize URL
      const normalizedUrl = normalizeUrl(url);

      // Get content types to check
      const contentTypes = getContentTypes();

      // Track results
      const results: TypeCheckResult[] = [];

      // Start progress tracking
      try {
        logger.startProgress(
          'Checking URL on Hacker News:',
          contentTypes.length,
          'content types'
        );

        for (let i = 0; i < contentTypes.length; i++) {
          const contentType = contentTypes[i];

          // Check this content type
          const result = await checkContentType(normalizedUrl, contentType);
          results.push(result);

          // Update progress
          const statusIcon = result.found ? '✓' : '○';
          const countInfo = result.found ? ` (${result.count})` : '';
          logger.updateProgress(i + 1, `${contentType.name} ${statusIcon}${countInfo}`);
        }
      } finally {
        logger.completeProgress('');
      }

      // Calculate score
      const foundCount = results.filter(r => r.found).length;
      const scorePerType = this.maxScore / contentTypes.length;

      // Create sub-checks using functional map
      const sub_checks = results.map(result => {
        const typeScore = result.found ? scorePerType : 0;

        const details = result.found && result.topStory
          ? `${result.count} mention${result.count !== 1 ? 's' : ''} (top: "${result.topStory.title.substring(0, 50)}${result.topStory.title.length > 50 ? '...' : ''}", ${result.topStory.points} pts)`
          : 'Not found';

        return {
          check_name: `HN - ${result.type}`,
          passed: result.found,
          score: Math.round(typeScore * 100) / 100,
          score_max: Math.round(scorePerType * 100) / 100,
          score_percent: result.found ? 100 : 0,
          details,
          metadata: {
            content_type: result.type,
            mention_count: result.count,
            top_story: result.topStory,
            ...result.metadata
          }
        };
      });

      // Calculate total score
      const totalMentions = results.reduce((sum, r) => sum + r.count, 0);
      const score = Math.round((foundCount / contentTypes.length) * this.maxScore * 100) / 100;
      const passed = foundCount > 0;

      // Build details
      const details = foundCount === 0
        ? `Not found on Hacker News`
        : `Found in ${foundCount}/${contentTypes.length} content types (${totalMentions} total mentions, ${Math.round((foundCount / contentTypes.length) * 100)}% coverage)`;

      return {
        score,
        maxScore: this.maxScore,
        passed,
        details,
        metadata: {
          normalized_url: normalizedUrl,
          types_checked: contentTypes.length,
          types_found: foundCount,
          total_mentions: totalMentions,
          coverage_percent: Math.round((foundCount / contentTypes.length) * 100),
          types_with_mentions: results.filter(r => r.found).map(r => r.type),
          sub_checks
        }
      };
    } catch (error: any) {
      throw new Error(`Hacker News check failed: ${error.message}`);
    }
  }
}
