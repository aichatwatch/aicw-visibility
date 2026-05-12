/**
 * X-Robots-Tag HTTP Header Check - Page Level
 *
 * Checks X-Robots-Tag HTTP headers for a specific page.
 * This is a page-level check (runs for each page).
 */

import { CheckHttpHeadersBase } from './check-http-headers-base.js';
import { PageCaptured } from './check-base.js';

const MODULE_NAME = 'Headers: X-Robots-Tag';

export class CheckHttpHeadersPage extends CheckHttpHeadersBase {
  readonly name = MODULE_NAME;

  // Page-scoped check
  protected targetPath = null;

  /**
   * Use page-specific headers for this check
   */
  protected getHeadersToCheck(pageCaptured?: PageCaptured): Headers | undefined {
    return pageCaptured?.browserHeadersDesktop;
  }

  protected getUnavailableMessage(): string {
    return 'Unable to check (page headers not available)';
  }
}
