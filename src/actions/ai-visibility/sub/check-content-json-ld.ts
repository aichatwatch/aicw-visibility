import { BaseVisibilityCheck, VisibilityCheckResult, PageCaptured } from './check-base.js';
import { logger } from '../../../utils/compact-logger.js';

// general regex to run JSON LD regex
const JSON_LD_REGEX = /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;

// High-value schemas that AI systems heavily favor
const HIGH_VALUE_SCHEMAS = ['FAQPage', 'QAPage', 'Article', 'NewsArticle', 'BlogPosting', 'HowTo', 'Recipe'];

// Common schemas to check for in structured data
// This list is used to create a complete checklist showing which schemas are present vs. not found
const COMMON_SCHEMAS = [
  // Core organizational schemas
  'Organization',
  'WebSite',
  'WebPage',
  'Person',
  'LocalBusiness',

  // Product/service schemas
  'Product',
  'SoftwareApplication',
  'Service',

  // Content schemas (high-value for AI)
  'Article',
  'NewsArticle',
  'BlogPosting',
  'FAQPage',
  'QAPage',
  'HowTo',
  'Recipe',

  // Navigation/structure schemas
  'BreadcrumbList',

  // Media schemas
  'VideoObject',
  'ImageObject',

  // Other common schemas
  'Event',
  'Review'
];


export class CheckContentJsonLD extends BaseVisibilityCheck {
  readonly name = 'Content: JSON-LD Schema';

  protected async performCheck(url: string, pageCaptured?: PageCaptured): Promise<VisibilityCheckResult> {
    // Require HTML content - this check doesn't fetch
    const browserHtml = pageCaptured?.browserHtmlDesktop;
    if (!browserHtml) {
      throw new Error('HTML content is required for JSON-LD check');
    }

    // Find all JSON-LD script tags
    const jsonLdMatches = browserHtml.match(
      JSON_LD_REGEX
    );

    if (!jsonLdMatches || jsonLdMatches.length === 0) {
      return {
        score: 0,
        maxScore: this.maxScore,
        passed: false,
        details: 'No JSON-LD structured data found.'
      };
    }

    // Parse and validate JSON-LD
    const validSchemas: string[] = [];
    for (const match of jsonLdMatches) {
      const jsonContent = match.replace(/<script[^>]*>|<\/script>/gi, '').trim();
      try {
        const data = JSON.parse(jsonContent);
        if (data['@type']) {
          if(Array.isArray(data['@type'])) {
            for(const type of data['@type']) {
              validSchemas.push(type);
              logger.debug(`found JSON-LD schema type: ${type}`);
            }
          } else {
            validSchemas.push(data['@type']);
            logger.debug(`found JSON-LD schema type: ${data['@type']}`);
          }
        }
      } catch (e) {
        logger.error(`Broken JSON-LD data block detected`);
      }
    }

    // Detect high-value schemas
    const highValueSchemasFound = validSchemas.filter(s => HIGH_VALUE_SCHEMAS.includes(s));
    const hasHighValueSchema = highValueSchemasFound.length > 0;

    // Score based on number of valid schemas found (capped at 3)
    // More schemas = better structured data for AI visibility
    const maxSchemasToScore = 3;
    const schemasFound = Math.min(validSchemas.length, maxSchemasToScore);
    const baseScore = (schemasFound / maxSchemasToScore) * this.maxScore;

    // Bonus for high-value schemas (10% boost, capped at maxScore)
    let score = hasHighValueSchema ? Math.min(baseScore * 1.1, this.maxScore) : baseScore;

    // Create sub-checks only for schemas that are actually found
    // This avoids confusing UI where many "Not found" entries appear despite a good score
    const sub_checks: any[] = [];
    const pointsPerSchema = this.maxScore / maxSchemasToScore;

    // Get unique schemas found on this page
    const uniqueSchemas = [...new Set(validSchemas)];

    // Only create sub_checks for schemas that are present
    for (const schemaName of uniqueSchemas) {
      const isHighValue = HIGH_VALUE_SCHEMAS.includes(schemaName);
      const count = validSchemas.filter(s => s === schemaName).length;

      // Distribute the earned score proportionally among present schemas
      const scorePerPresentSchema = score / uniqueSchemas.length;

      // Build details message
      let details: string;
      if (isHighValue) {
        details = `High-value schema${count > 1 ? ` (${count} instances)` : ''}`;
      } else {
        details = count > 1 ? `${count} instances found` : 'Present';
      }

      sub_checks.push({
        check_name: schemaName,
        passed: true, // All shown subchecks are present
        score: Math.round(scorePerPresentSchema * 10) / 10,
        score_max: Math.round(pointsPerSchema * 10) / 10,
        score_percent: Math.round((scorePerPresentSchema / pointsPerSchema) * 100 * 10) / 10,
        details,
        metadata: {
          is_high_value: isHighValue,
          instance_count: count,
          present: true
        }
      });
    }

    // Display count to show progress toward max score
    const schemasCount = validSchemas.length;
    const countDisplay = schemasCount < maxSchemasToScore
      ? `${schemasCount}/${maxSchemasToScore}`
      : `${schemasCount}`;

    return {
      score,
      maxScore: this.maxScore,
      passed: score === this.maxScore,
      details: validSchemas.length > 0
        ? `Found ${countDisplay} schemas: ${validSchemas.join(', ')}` +
          (hasHighValueSchema ? ` (includes high-value schemas: ${highValueSchemasFound.join(', ')})` : '')
        : `Found ${jsonLdMatches.length} JSON-LD blocks but invalid`,
      metadata: {
        schemas: validSchemas,
        high_value_schemas: highValueSchemasFound,
        total_blocks: jsonLdMatches.length,
        valid_blocks: validSchemas.length,
        sub_checks
      }
    };
  }
}
