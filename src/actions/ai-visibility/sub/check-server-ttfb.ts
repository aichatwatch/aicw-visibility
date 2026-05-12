/**
 * Server TTFB (Time To First Byte) Check
 *
 * Measures server infrastructure performance by checking how quickly
 * the server responds with the first byte of data.
 *
 * Industry standard thresholds:
 * - Excellent: < 200ms
 * - Good: 200-500ms
 * - Fair: 500-1000ms
 * - Poor: > 1000ms
 */

import { BaseVisibilityCheck, VisibilityCheckResult, PageCaptured } from './check-base.js';
import { callHttpWithRetry } from '../../../utils/http-caller.js';

const MODULE_NAME = 'Performance: Time-To-First-Byte (TTFB)';

export class CheckServerTtfb extends BaseVisibilityCheck {
  readonly name = MODULE_NAME;

  protected async performCheck(url: string, pageCaptured?: PageCaptured): Promise<VisibilityCheckResult> {
    // Extract root domain from URL
    const urlObj = new URL(url);
    const rootUrl = `${urlObj.protocol}//${urlObj.host}/`;

    try {
      // Measure TTFB using GET request
      const startTime = Date.now();
      const response = await callHttpWithRetry(rootUrl, {
        contextInfo: `TTFB check: ${rootUrl}`,
        maxRetries: 1
      });
      const ttfb = Date.now() - startTime;

      // Check if response is successful
      if (!response.ok) {
        return {
          score: 0,
          maxScore: this.maxScore,
          passed: false,
          details: `Server returned HTTP ${response.status}`,
          error: true,
          metadata: {
            ttfb_ms: ttfb,
            http_status: response.status
          }
        };
      }

      // Score based on industry standard thresholds
      let score: number;
      let rating: string;
      let passed: boolean;

      if (ttfb < 200) {
        score = this.maxScore;
        rating = 'Excellent';
        passed = true;
      } else if (ttfb < 500) {
        score = Math.round(this.maxScore * 0.75);
        rating = 'Good';
        passed = true;
      } else if (ttfb < 1000) {
        score = Math.round(this.maxScore * 0.5);
        rating = 'Fair';
        passed = false;
      } else {
        score = Math.round(this.maxScore * 0.25);
        rating = 'Poor';
        passed = false;
      }

      return {
        score,
        maxScore: this.maxScore,
        passed,
        details: `${ttfb}ms - ${rating}`,
        metadata: {
          ttfb_ms: ttfb,
          rating: rating.toLowerCase(),
          http_status: response.status,
          threshold_excellent: 200,
          threshold_good: 500,
          threshold_fair: 1000
        }
      };
    } catch (error: any) {
      return {
        score: -1,
        maxScore: this.maxScore,
        passed: false,
        details: `Failed to measure TTFB: ${error.message}`,
        error: true
      };
    }
  }
}
