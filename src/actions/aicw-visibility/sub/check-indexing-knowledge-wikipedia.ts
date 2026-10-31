import { BaseVisibilityCheck, VisibilityCheckResult, PageCaptured } from './check-base.js';
import { callHttpWithRetry } from '../../../utils/http-caller.js';
import { logger } from '../../../utils/compact-logger.js';
import { extractDomain } from '../../../utils/url-normalizer.js';

const MODULE_NAME = 'Indexing: Wikipedia';

/**
 * Wikipedia language edition to check
 */
interface WikipediaEdition {
  name: string;
  code: string;
  apiUrl: string;
}

/**
 * Result from checking a Wikipedia edition
 */
interface EditionCheckResult {
  edition: string;
  found: boolean;
  pageCount: number;
  pages: string[];
  metadata: {
    language_code?: string;
    error?: string;
  };
}

/**
 * Get Wikipedia editions to check (major languages)
 */
function getWikipediaEditions(): WikipediaEdition[] {
  return [
    { name: 'English', code: 'en', apiUrl: 'https://en.wikipedia.org/w/api.php' },
    { name: 'German', code: 'de', apiUrl: 'https://de.wikipedia.org/w/api.php' },
    { name: 'French', code: 'fr', apiUrl: 'https://fr.wikipedia.org/w/api.php' },
    { name: 'Spanish', code: 'es', apiUrl: 'https://es.wikipedia.org/w/api.php' },
    { name: 'Japanese', code: 'ja', apiUrl: 'https://ja.wikipedia.org/w/api.php' },
    { name: 'Chinese', code: 'zh', apiUrl: 'https://zh.wikipedia.org/w/api.php' }
  ];
}

/**
 * Check if domain appears in a specific Wikipedia edition
 * Uses the exturlusage API to find pages linking to the domain
 */
async function checkEdition(domain: string, edition: WikipediaEdition): Promise<EditionCheckResult> {
  // MediaWiki API: list=exturlusage to find external links
  const queryUrl = `${edition.apiUrl}?action=query&list=exturlusage&euquery=${encodeURIComponent(domain)}&eulimit=10&format=json`;

  try {
    const response = await callHttpWithRetry(queryUrl, {
      contextInfo: `Checking Wikipedia ${edition.name}`,
      maxRetries: 1,
      headers: {
        'User-Agent': 'AICW-Visibility-Check/1.0 (https://aichatwatch.com)'
      }
    });

    if (!response.ok) {
      return {
        edition: edition.name,
        found: false,
        pageCount: 0,
        pages: [],
        metadata: { language_code: edition.code }
      };
    }

    const data = await response.json();
    const results = data.query?.exturlusage || [];

    if (results.length === 0) {
      return {
        edition: edition.name,
        found: false,
        pageCount: 0,
        pages: [],
        metadata: { language_code: edition.code }
      };
    }

    // Extract page titles
    const pages = results.slice(0, 5).map((r: any) => r.title);

    return {
      edition: edition.name,
      found: true,
      pageCount: results.length,
      pages,
      metadata: { language_code: edition.code }
    };
  } catch (error: any) {
    logger.error(`Failed to check Wikipedia ${edition.name}: ${error.message}`);
    return {
      edition: edition.name,
      found: false,
      pageCount: 0,
      pages: [],
      metadata: { language_code: edition.code, error: error.message }
    };
  }
}

export class CheckIndexingKnowledgeWikipedia extends BaseVisibilityCheck {
  readonly name = MODULE_NAME;

  protected async performCheck(url: string, pageCaptured?: PageCaptured): Promise<VisibilityCheckResult> {
    try {
      // Extract domain only (Wikipedia searches by domain, not full URL)
      const domain = extractDomain(url);

      // Get Wikipedia editions to check
      const editions = getWikipediaEditions();

      // Track results
      const results: EditionCheckResult[] = [];

      // Start progress tracking
      try {
        logger.startProgress(
          'Checking domain in Wikipedia editions:',
          editions.length,
          'language editions'
        );

        for (let i = 0; i < editions.length; i++) {
          const edition = editions[i];

          // Check this edition
          const result = await checkEdition(domain, edition);
          results.push(result);

          // Update progress
          const statusIcon = result.found ? '✓' : '○';
          const countInfo = result.found ? ` (${result.pageCount})` : '';
          logger.updateProgress(i + 1, `${edition.name} ${statusIcon}${countInfo}`);
        }
      } finally {
        logger.completeProgress('');
      }

      // Calculate score
      const foundCount = results.filter(r => r.found).length;
      const scorePerEdition = this.maxScore / editions.length;

      // Create sub-checks using functional map
      const sub_checks = results.map(result => {
        const editionScore = result.found ? scorePerEdition : 0;

        const details = result.found
          ? `${result.pageCount} citation${result.pageCount !== 1 ? 's' : ''} (e.g., "${result.pages[0]}"${result.pages.length > 1 ? ` +${result.pages.length - 1} more` : ''})`
          : 'Not found';

        return {
          check_name: `Wikipedia - ${result.edition}`,
          passed: result.found,
          score: Math.round(editionScore * 100) / 100,
          score_max: Math.round(scorePerEdition * 100) / 100,
          score_percent: result.found ? 100 : 0,
          details,
          metadata: {
            edition: result.edition,
            page_count: result.pageCount,
            sample_pages: result.pages,
            ...result.metadata
          }
        };
      });

      // Calculate total score
      const totalCitations = results.reduce((sum, r) => sum + r.pageCount, 0);
      const score = Math.round((foundCount / editions.length) * this.maxScore * 100) / 100;
      const passed = foundCount > 0;

      // Build details
      const details = foundCount === 0
        ? `Not found in any Wikipedia edition`
        : `Found in ${foundCount}/${editions.length} Wikipedia editions (${totalCitations} total citations, ${Math.round((foundCount / editions.length) * 100)}% coverage)`;

      return {
        score,
        maxScore: this.maxScore,
        passed,
        details,
        metadata: {
          domain_checked: domain,
          editions_checked: editions.length,
          editions_found: foundCount,
          total_citations: totalCitations,
          coverage_percent: Math.round((foundCount / editions.length) * 100),
          editions_with_citations: results.filter(r => r.found).map(r => r.edition),
          sub_checks
        }
      };
    } catch (error: any) {
      throw new Error(`Wikipedia check failed: ${error.message}`);
    }
  }
}
