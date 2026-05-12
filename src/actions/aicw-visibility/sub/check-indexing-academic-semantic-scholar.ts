import { BaseVisibilityCheck, VisibilityCheckResult, PageCaptured } from './check-base.js';
import { callHttpWithRetry } from '../../../utils/http-caller.js';
import { logger } from '../../../utils/compact-logger.js';
import { normalizeUrl } from '../../../utils/url-normalizer.js';

const MODULE_NAME = 'Academic: Semantic Scholar';
const SEMANTIC_SCHOLAR_API = 'https://api.semanticscholar.org/graph/v1/paper/search';

/**
 * Citation level category for grouping papers
 */
interface CitationLevel {
  name: string;
  min: number;
  max: number | null; // null = no upper bound
  weight: number; // for weighted scoring
}

/**
 * Result from checking a citation level
 */
interface LevelCheckResult {
  level: string;
  found: boolean;
  paperCount: number;
  topPapers: Array<{
    title: string;
    year: number;
    citationCount: number;
    paperId: string;
  }>;
  metadata: {
    citation_range?: string;
    error?: string;
  };
}

/**
 * Get citation levels for grouping
 */
function getCitationLevels(): CitationLevel[] {
  return [
    { name: 'Highly cited (100+)', min: 100, max: null, weight: 2.0 },
    { name: 'Well cited (10-99)', min: 10, max: 99, weight: 1.5 },
    { name: 'Moderately cited (1-9)', min: 1, max: 9, weight: 1.0 },
    { name: 'Recent papers (< 1 year)', min: 0, max: null, weight: 1.2 }
  ];
}

/**
 * Search for papers containing URL in Semantic Scholar
 */
async function searchPapers(normalizedUrl: string): Promise<any[]> {
  // Search for URL in paper metadata
  const queryUrl = `${SEMANTIC_SCHOLAR_API}?query=${encodeURIComponent(normalizedUrl)}&limit=100&fields=title,year,citationCount,paperId`;

  try {
    const response = await callHttpWithRetry(queryUrl, {
      contextInfo: 'Searching Semantic Scholar',
      maxRetries: 1
    });

    if (!response.ok) {
      return [];
    }

    const data = await response.json();
    return data.data || [];
  } catch (error: any) {
    logger.error(`Failed to search Semantic Scholar: ${error.message}`);
    return [];
  }
}

/**
 * Group papers by citation level
 */
function groupPapersByLevel(papers: any[], level: CitationLevel, currentYear: number): any[] {
  return papers.filter(paper => {
    // Special handling for "Recent papers" level
    if (level.name.includes('Recent')) {
      const paperYear = paper.year || 0;
      return paperYear >= currentYear; // This year or future
    }

    // Citation count-based filtering
    const citations = paper.citationCount || 0;
    const meetsMin = citations >= level.min;
    const meetsMax = level.max === null || citations <= level.max;
    return meetsMin && meetsMax;
  });
}

export class CheckIndexingAcademicSemanticScholar extends BaseVisibilityCheck {
  readonly name = MODULE_NAME;

  protected async performCheck(url: string, pageCaptured?: PageCaptured): Promise<VisibilityCheckResult> {
    try {
      // Normalize URL
      const normalizedUrl = normalizeUrl(url);

      // Get citation levels
      const levels = getCitationLevels();
      const currentYear = new Date().getFullYear();

      // Search for papers containing this URL
      logger.info('Searching for papers in Semantic Scholar...');
      const allPapers = await searchPapers(normalizedUrl);

      // Track results for each level
      const results: LevelCheckResult[] = [];

      // Start progress tracking
      try {
        logger.startProgress(
          'Analyzing papers by citation level:',
          levels.length,
          'citation levels'
        );

        for (let i = 0; i < levels.length; i++) {
          const level = levels[i];

          // Group papers by this citation level
          const papersInLevel = groupPapersByLevel(allPapers, level, currentYear);
          const found = papersInLevel.length > 0;

          // Get top papers (up to 3)
          const topPapers = papersInLevel
            .sort((a, b) => (b.citationCount || 0) - (a.citationCount || 0))
            .slice(0, 3)
            .map(p => ({
              title: p.title || 'Untitled',
              year: p.year || 0,
              citationCount: p.citationCount || 0,
              paperId: p.paperId || ''
            }));

          const rangeStr = level.max === null
            ? `${level.min}+`
            : `${level.min}-${level.max}`;

          results.push({
            level: level.name,
            found,
            paperCount: papersInLevel.length,
            topPapers,
            metadata: { citation_range: rangeStr }
          });

          // Update progress
          const statusIcon = found ? '✓' : '○';
          const countInfo = found ? ` (${papersInLevel.length})` : '';
          logger.updateProgress(i + 1, `${level.name} ${statusIcon}${countInfo}`);
        }
      } finally {
        logger.completeProgress('');
      }

      // Calculate weighted score
      const totalWeight = levels.reduce((sum, l) => sum + l.weight, 0);
      let earnedWeight = 0;

      for (let i = 0; i < results.length; i++) {
        if (results[i].found) {
          earnedWeight += levels[i].weight;
        }
      }

      const foundCount = results.filter(r => r.found).length;

      // Create sub-checks using functional map
      const sub_checks = results.map((result, index) => {
        const level = levels[index];
        const levelScore = result.found ? (level.weight / totalWeight) * this.maxScore : 0;

        const details = result.found
          ? `${result.paperCount} paper${result.paperCount !== 1 ? 's' : ''} (top: "${result.topPapers[0].title.substring(0, 40)}...", ${result.topPapers[0].citationCount} citations)`
          : 'No papers found';

        return {
          check_name: `Scholar - ${result.level}`,
          passed: result.found,
          score: Math.round(levelScore * 100) / 100,
          score_max: Math.round((level.weight / totalWeight) * this.maxScore * 100) / 100,
          score_percent: result.found ? 100 : 0,
          details,
          metadata: {
            citation_level: result.level,
            paper_count: result.paperCount,
            top_papers: result.topPapers,
            ...result.metadata
          }
        };
      });

      // Calculate total score (weighted)
      const score = Math.round((earnedWeight / totalWeight) * this.maxScore * 100) / 100;
      const totalPapers = allPapers.length;
      const passed = foundCount > 0;

      // Build details
      const details = foundCount === 0
        ? `Not found in academic papers`
        : `Found in ${totalPapers} academic paper${totalPapers !== 1 ? 's' : ''} across ${foundCount}/${levels.length} citation levels`;

      return {
        score,
        maxScore: this.maxScore,
        passed,
        details,
        metadata: {
          normalized_url: normalizedUrl,
          levels_checked: levels.length,
          levels_found: foundCount,
          total_papers: totalPapers,
          weighted_coverage: Math.round((earnedWeight / totalWeight) * 100),
          levels_with_papers: results.filter(r => r.found).map(r => r.level),
          sub_checks
        }
      };
    } catch (error: any) {
      throw new Error(`Semantic Scholar check failed: ${error.message}`);
    }
  }
}
