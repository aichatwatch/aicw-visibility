/**
 * Base class for AI bot accessibility checks
 *
 * Subclasses only need to specify:
 * - name: Display name for the check
 * - botTypeFilter: Tag to filter which bots to test
 *
 * All testing logic is handled here.
 */

import { BaseVisibilityCheck, VisibilityCheckResult, PageCaptured } from './check-base.js';
import { callHttpWithRetry } from '../../../utils/http-caller.js';
import { AI_USER_AGENTS, AI_PRODUCTS } from '../../../config/ai-user-agents.js';
import { interruptibleDelay as delay } from '../../../utils/delay.js';
import { AI_BOT_TEST_DELAY_MS } from '../../../config/constants.js';
import { logger } from '../../../utils/compact-logger.js';
import { calculateProductVisibility, getUniqueAIProducts, getBotsForProduct, getProductMetadata } from '../utils/ai-product-utils.js';

// Configuration constants
const CONTENT_SIZE_TOLERANCE = 0.03; // 3% size difference allowed when comparing to baseline
const MIN_VALID_HTML_SIZE = 500; // Minimum bytes to be considered valid content (not error page)

// Type definitions for AI services summary
interface AIServiceSummary {
  service_name: string;
  service_url?: string;
  accessible: boolean;
  bots_tested: string[];
  bots_accessible_count: number;
  bots_total_count: number;
  score_contribution: number;
}

/**
 * Check if two content sizes are similar within tolerance
 */
function isContentSimilar(size1: number, size2: number, tolerance: number = CONTENT_SIZE_TOLERANCE): boolean {
  const diff = Math.abs(size1 - size2);
  const avgSize = (size1 + size2) / 2;

  // If avg size is 0, both must be 0 to be similar
  if (avgSize === 0) {
    return size1 === 0 && size2 === 0;
  }

  return (diff / avgSize) <= tolerance;
}

/**
 * Abstract base class for bot accessibility checks
 * Subclasses define which bot type to test via botTypeFilter
 */
export abstract class ServerBaseBotAccessibilityCheck extends BaseVisibilityCheck {
  /**
   * Subclasses must specify which bot classification tag to filter by
   * E.g., CRAWLER_BOT_CLASSIFICATION_TAGS.AI_FOUNDATION_MODEL_TRAINING
   */
  protected abstract readonly botTypeFilter: string;

  protected async performCheck(url: string, pageCaptured?: PageCaptured): Promise<VisibilityCheckResult> {
    // Filter bots by the specified type
    const botsToTest = AI_USER_AGENTS.filter(bot =>
      bot.tags?.includes(this.botTypeFilter)
    );

    if (botsToTest.length === 0) {
      throw new Error(`No bots found for bot type filter: ${this.botTypeFilter}`);
    }

    // Step 1: Determine testing mode
    const browserHtml = pageCaptured?.browserHtmlDesktop;
    const baselineSize = browserHtml?.length;
    const hasBaseline = !!baselineSize;

    if (!hasBaseline) {
      logger.debug('Running bot accessibility test without browser baseline (bot-only testing)');
    }

    // Step 2: Test each AI bot with delays to prevent rate limiting
    const results: Array<{ bot: string; accessible: boolean; status: number; size: number }> = [];

    // Wrap progress in try-finally to ensure completion
    try {
      logger.startProgress(
        `Checking accessibility for AI bots for "${this.name}" type:`,
        botsToTest.length,
        'AI bots to test'
      );

      for (let i = 0; i < botsToTest.length; i++) {
        const bot = botsToTest[i];

        // Add delay between bot tests (except before first bot)
        if (i > 0) {
          // Add small jitter to prevent pattern detection
          const jitter = Math.floor(Math.random() * 100) - 50; // ±50ms
          await delay(AI_BOT_TEST_DELAY_MS + jitter);
        }

        try {
          const botResponse = await callHttpWithRetry(url, {
            userAgent: bot.user_agent,
            headers: {
              'Accept': 'text/html,application/xhtml+xml,application/xml'
            },
            contextInfo: `Checking accessibility for the bot: ${bot.name}: ${url}`,
            maxRetries: 2  // Don't retry as much for bot checks
          });

          const botContent = await botResponse.text();
          const botSize = botContent.length;

          // Check accessibility based on mode
          let isAccessible: boolean;
          if (hasBaseline) {
            // With baseline: compare size to browser baseline
            isAccessible =
              botResponse.status === 200 &&
              botSize >= MIN_VALID_HTML_SIZE &&
              isContentSimilar(baselineSize!, botSize);
          } else {
            // Bot-only mode: just check if bot gets valid content
            isAccessible =
              botResponse.status === 200 &&
              botSize >= MIN_VALID_HTML_SIZE;
          }

          results.push({
            bot: bot.name,
            accessible: isAccessible,
            status: botResponse.status,
            size: botSize
          });

          // Update progress with result
          const statusIcon = isAccessible ? '✓' : '✗';
          logger.updateProgress(i + 1, `${bot.name} ${statusIcon}`);
        } catch (error: any) {
          // Bot request failed
          results.push({
            bot: bot.name,
            accessible: false,
            status: 0,
            size: 0
          });
          logger.updateProgress(i + 1, `${bot.name} ✗`);
        }
      }
    } finally {
      // ALWAYS complete progress, even if error occurs
      logger.completeProgress('');
    }

    // Get blocked/inaccessible bots
    const blockedBots = results.filter(r => !r.accessible).map(r => r.bot);
    const blockedBotNames = new Set(blockedBots);

    // Calculate AI product visibility
    const productVisibility = calculateProductVisibility(blockedBotNames);

    // Build AI services summary and categorize services
    const aiServicesAccessible: string[] = [];
    const aiServicesBlocked: string[] = [];
    const aiServicesSummary: AIServiceSummary[] = [];
    const totalServices = productVisibility.size;

    for (const [serviceName, isAccessible] of productVisibility) {
      // Skip invalid service names
      if (!serviceName || typeof serviceName !== 'string') {
        continue;
      }

      // Get all bots for this service
      const serviceBots = getBotsForProduct(serviceName);
      const serviceBotNames = serviceBots.map(b => b.name);

      // Find which of these bots were tested in this check
      const testedBots = results.filter(r => serviceBotNames.includes(r.bot));
      const accessibleBots = testedBots.filter(r => r.accessible);

      const pointsPerService = this.maxScore / totalServices;

      // Get product metadata to include URL
      const productMetadata = getProductMetadata(serviceName);

      // Build service summary with type safety
      const summary: AIServiceSummary = {
        service_name: serviceName,
        service_url: productMetadata?.url,
        accessible: isAccessible,
        bots_tested: testedBots.map(r => r.bot),
        bots_accessible_count: accessibleBots.length,
        bots_total_count: testedBots.length,
        score_contribution: Math.round((isAccessible ? pointsPerService : 0) * 10) / 10
      };

      aiServicesSummary.push(summary);

      // Categorize service
      if (isAccessible) {
        aiServicesAccessible.push(serviceName);
      } else {
        aiServicesBlocked.push(serviceName);
      }
    }

    const accessibleServicesCount = aiServicesAccessible.length;

    // Score based on services (scaled to maxScore)
    const score = Math.round((accessibleServicesCount / totalServices) * this.maxScore * 10) / 10;

    // Create sub-checks for each bot actually tested (complete checklist)
    // Points are distributed based on service visibility, but we show bot-level details
    const pointsPerService = this.maxScore / totalServices;
    const sub_checks: any[] = [];

    for (const result of results) {
      // Find which AI services this bot is related to
      const relatedAiServices: string[] = [];

      for (const product of Object.values(AI_PRODUCTS)) {
        const serviceBots = getBotsForProduct(product.name);
        if (serviceBots.some(b => b.name === result.bot)) {
          relatedAiServices.push(product.name);
        }
      }

      // Calculate score contribution based on the services this bot represents
      const botScore = result.accessible ? (pointsPerService / (results.length / totalServices)) : 0;

      sub_checks.push({
        check_name: result.bot,
        passed: result.accessible,
        score: Math.round(botScore * 10) / 10,
        score_max: Math.round(pointsPerService * 10) / 10,
        score_percent: result.accessible ? 100 : 0,
        details: result.status > 0
          ? `HTTP ${result.status}, ${result.size} bytes`
          : 'Request failed',
        metadata: {
          http_status: result.status,
          response_size_bytes: result.size,
          accessible: result.accessible,
          related_ai_services: relatedAiServices
        }
      });
    }

    // Passing threshold: 70% of maxScore
    const passingThreshold = Math.round(this.maxScore * 0.7);

    // Build details message
    const modeNote = !hasBaseline ? ' (bot-only testing)' : '';
    let details: string;
    if (aiServicesBlocked.length === 0) {
      details = `Visible to all ${totalServices} AI services${modeNote}`;
    } else if (aiServicesAccessible.length === 0) {
      details = `Hidden from all ${totalServices} AI services${modeNote}`;
    } else {
      details = `${accessibleServicesCount}/${totalServices} visible${modeNote}\n` +
        `   ✓ Visible: ${aiServicesAccessible.join(', ')}\n` +
        `   ❌ Hidden: ${aiServicesBlocked.join(', ')}`;
    }

    return {
      score,
      maxScore: this.maxScore,
      passed: score >= passingThreshold,
      details,
      metadata: {
        baseline_size: baselineSize,
        results,
        blocked_bots: blockedBots,
        ai_services_accessible: aiServicesAccessible,
        ai_services_blocked: aiServicesBlocked,
        accessible_services_count: accessibleServicesCount,
        total_services: totalServices,
        total_bots: botsToTest.length,
        bot_type_filter: this.botTypeFilter,
        ai_services_summary: aiServicesSummary,
        sub_checks
      }
    };
  }
}
