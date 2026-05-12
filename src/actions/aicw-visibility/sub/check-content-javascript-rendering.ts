/**
 * Browser-Based JavaScript Content Rendering Check
 *
 * Uses Puppeteer to render the page and compare visible text content
 * between HTTP fetch (no JS) vs browser render (with JS).
 *
 * This provides ACCURATE measurement of JS dependency.
 * AI bots don't execute JavaScript, so they only see the HTTP-fetched content.
 *
 * This replaces the unreliable heuristic-based check.
 */

import { BaseVisibilityCheck, VisibilityCheckResult, PageCaptured } from './check-base.js';
import { performFullJSCheckForPage } from './check-content-javascript-full.js';

const MODULE_NAME = 'Content: JS Rendering';

export class CheckContentJavaScriptRendering extends BaseVisibilityCheck {
  readonly name = MODULE_NAME;
  protected targetPath: string | null = null;  // Page-level check

  protected async performCheck(url: string, pageCaptured?: PageCaptured): Promise<VisibilityCheckResult> {
    // Check if browser is available
    const browser = pageCaptured?.puppeteerBrowser;
    if (!browser) {
      return {
        score: -1,
        maxScore: this.maxScore,
        passed: false,
        details: 'Browser check skipped (Puppeteer not available)',
        error: true,
        metadata: { skipped: true, reason: 'no_browser' }
      };
    }

    // Ensure we have HTTP-fetched HTML
    if (!pageCaptured?.browserHtmlDesktop || !pageCaptured?.browserHtmlMobile) {
      return {
        score: -1,
        maxScore: this.maxScore,
        passed: false,
        details: 'Missing HTTP-fetched HTML for comparison',
        error: true,
        metadata: { skipped: true, reason: 'no_html' }
      };
    }

    // Run Puppeteer comparison
    const result = await performFullJSCheckForPage(
      url,
      pageCaptured.browserHtmlDesktop,
      pageCaptured.browserHtmlMobile,
      browser
    );

    // Map ratio to score (ratio directly maps to score percentage)
    const scorePercent = result.avgRatio / 100;
    const score = Math.min(
      this.maxScore,
      Math.round(scorePercent * this.maxScore * 10) / 10
    );
    const passed = result.avgRatio >= 50;  // 50%+ = pass

    // Build details
    let details = `JS Content Ratio: ${result.avgRatio}% (${result.grade})`;
    details += `\n   Desktop: ${result.desktop.textLengthNoJS.toLocaleString()}/${result.desktop.textLengthWithJS.toLocaleString()} chars (${result.desktop.jsContentRatio}%)`;
    details += `\n   Mobile: ${result.mobile.textLengthNoJS.toLocaleString()}/${result.mobile.textLengthWithJS.toLocaleString()} chars (${result.mobile.jsContentRatio}%)`;

    if (result.avgRatio < 50) {
      details += `\n   ⚠ AI bots see only ${result.avgRatio}% of content`;
      details += `\n   Solution: Implement Server-Side Rendering (SSR)`;
    }

    return {
      score,
      maxScore: this.maxScore,
      passed,
      details,
      metadata: {
        check_method: 'puppeteer',
        js_content_ratio_avg: result.avgRatio,
        js_content_grade: result.grade,
        desktop_text_no_js: result.desktop.textLengthNoJS,
        desktop_text_with_js: result.desktop.textLengthWithJS,
        desktop_ratio: result.desktop.jsContentRatio,
        mobile_text_no_js: result.mobile.textLengthNoJS,
        mobile_text_with_js: result.mobile.textLengthWithJS,
        mobile_ratio: result.mobile.jsContentRatio,
      }
    };
  }
}
