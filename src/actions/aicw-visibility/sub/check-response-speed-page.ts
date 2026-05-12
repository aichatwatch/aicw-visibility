/**
 * Response Speed Check - Page Level
 *
 * Evaluates page load speed for both desktop and mobile versions.
 * This is a page-level check (runs for each page).
 */

import { CheckResponseSpeedBase } from './check-response-speed-base.js';
import { PageCaptured } from './check-base.js';

const MODULE_NAME = 'Performance: Response Time';

export class CheckResponseSpeedPage extends CheckResponseSpeedBase {
  readonly name = MODULE_NAME;

  // Page-scoped check
  protected targetPath = null;

  /**
   * Use page-specific timing data for this check
   */
  protected getTimingData(pageCaptured?: PageCaptured) {
    return {
      desktopTime: pageCaptured?.desktopResponseTimeMs,
      mobileTime: pageCaptured?.mobileResponseTimeMs
    };
  }

  protected getUnavailableMessage(): string {
    return 'Page response time data is required for speed check';
  }
}
