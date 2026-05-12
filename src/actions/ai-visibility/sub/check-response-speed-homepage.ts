/**
 * Response Speed Check - Homepage Level
 *
 * Evaluates homepage load speed for both desktop and mobile versions.
 * This is a server-level check (runs once per domain).
 */

import { CheckResponseSpeedBase } from './check-response-speed-base.js';
import { PageCaptured } from './check-base.js';

const MODULE_NAME = 'Performance: Homepage Response';

export class CheckResponseSpeedHomepage extends CheckResponseSpeedBase {
  readonly name = MODULE_NAME;

  // Homepage-specific check
  protected targetPath = '/';

  /**
   * Use homepage timing data for this check
   */
  protected getTimingData(pageCaptured?: PageCaptured) {
    return {
      desktopTime: pageCaptured?.homepageDesktopResponseTimeMs,
      mobileTime: pageCaptured?.homepageMobileResponseTimeMs
    };
  }

  protected getUnavailableMessage(): string {
    return 'Homepage response time data is required for speed check';
  }
}
