/**
 * Response Speed Check - Base Class
 *
 * Evaluates page load speed for both desktop and mobile versions.
 * Fast response times are critical for AI crawlers with timeout constraints.
 * Extended by homepage-level and page-level variants.
 */

import { BaseVisibilityCheck, VisibilityCheckResult, PageCaptured } from './check-base.js';

// Speed thresholds in milliseconds
const EXCELLENT_SPEED = 500;   // < 500ms = excellent
const GOOD_SPEED = 1000;       // < 1000ms = good
const ACCEPTABLE_SPEED = 2000; // < 2000ms = acceptable
const SLOW_SPEED = 3000;       // < 3000ms = slow

function getSpeedScore(timeMs: number): number {
  if (timeMs < EXCELLENT_SPEED) return 5;
  if (timeMs < GOOD_SPEED) return 4;
  if (timeMs < ACCEPTABLE_SPEED) return 3;
  if (timeMs < SLOW_SPEED) return 2;
  return 1;
}

function getSpeedLabel(timeMs: number): string {
  if (timeMs < EXCELLENT_SPEED) return 'excellent';
  if (timeMs < GOOD_SPEED) return 'good';
  if (timeMs < ACCEPTABLE_SPEED) return 'acceptable';
  if (timeMs < SLOW_SPEED) return 'slow';
  return 'very slow';
}

/**
 * Timing data for desktop and mobile
 */
interface TimingData {
  desktopTime?: number;
  mobileTime?: number;
}

/**
 * Abstract base class for response speed checks
 * Provides shared logic for both homepage-level and page-level checks
 */
export abstract class CheckResponseSpeedBase extends BaseVisibilityCheck {
  /**
   * Get the timing data to check based on the variant type
   * Homepage variant uses homepage timings, Page variant uses page timings
   *
   * @param pageCaptured - Captured page data
   * @returns Timing data object
   */
  protected abstract getTimingData(pageCaptured?: PageCaptured): TimingData;

  /**
   * Get the error message when timing data is not available
   */
  protected abstract getUnavailableMessage(): string;

  protected async performCheck(url: string, pageCaptured?: PageCaptured): Promise<VisibilityCheckResult> {
    const { desktopTime, mobileTime } = this.getTimingData(pageCaptured);

    if (!desktopTime && !mobileTime) {
      throw new Error(this.getUnavailableMessage());
    }

    let score = 0;
    const details: string[] = [];

    // Split maxScore between desktop and mobile
    const scorePerDevice = this.maxScore / 2;

    // Desktop speed (half of maxScore)
    if (desktopTime) {
      const desktopScore = getSpeedScore(desktopTime);  // Returns 0-5
      score += (desktopScore / 5) * scorePerDevice;  // Scale to half of maxScore
      details.push(`Desktop: ${desktopTime}ms (${getSpeedLabel(desktopTime)})`);
    }

    // Mobile speed (half of maxScore)
    if (mobileTime) {
      const mobileScore = getSpeedScore(mobileTime);  // Returns 0-5
      score += (mobileScore / 5) * scorePerDevice;  // Scale to half of maxScore
      details.push(`Mobile: ${mobileTime}ms (${getSpeedLabel(mobileTime)})`);
    }

    // Round score to avoid floating point issues
    score = Math.round(score * 100) / 100;

    return {
      score,
      maxScore: this.maxScore,
      passed: score >= (this.maxScore * 0.6), // Pass threshold at 60%
      details: details.join(', '),
      metadata: {
        desktop_time_ms: desktopTime,
        mobile_time_ms: mobileTime,
        desktop_label: desktopTime ? getSpeedLabel(desktopTime) : undefined,
        mobile_label: mobileTime ? getSpeedLabel(mobileTime) : undefined
      }
    };
  }
}
