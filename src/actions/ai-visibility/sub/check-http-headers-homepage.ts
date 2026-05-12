/**
 * X-Robots-Tag HTTP Header Check - Homepage Level
 *
 * Checks X-Robots-Tag HTTP headers on the homepage (/).
 * This is a server-level check (runs once per domain).
 */

import { CheckHttpHeadersBase } from './check-http-headers-base.js';
import { PageCaptured } from './check-base.js';

const MODULE_NAME = 'Headers: X-Robots-Tag';

export class CheckHttpHeadersHomepage extends CheckHttpHeadersBase {
  readonly name = MODULE_NAME;

  // Homepage-specific check
  protected targetPath = '/';

  /**
   * Use homepage headers for this check
   */
  protected getHeadersToCheck(pageCaptured?: PageCaptured): Headers | undefined {
    return pageCaptured?.homepageHeadersDesktop;
  }

  protected getUnavailableMessage(): string {
    return 'Unable to check (homepage headers not available)';
  }
}
