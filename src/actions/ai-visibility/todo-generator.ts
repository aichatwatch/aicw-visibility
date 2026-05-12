/**
 * Todo Generator
 *
 * Generates actionable todo items from AI visibility check results.
 * Each failed check produces one or more specific, trackable todos with
 * HTML-formatted steps containing clickable links.
 */

import { VisibilityTodoItem, TodoTag, TodoStep, generateCheckId } from '../../utils/visibility-json-output.js';
import { BaseVisibilityCheck, VisibilityCheckResult } from './sub/check-base.js';
import { getCheckGroupWithFallback } from '../../config/visibility-check-groups.js';

/**
 * Helper to create a step object with default completed: false
 */
const step = (text: string): TodoStep => ({ text, completed: false });

/**
 * Context for generating todos (domain info, check metadata)
 */
interface TodoContext {
  domain: string;
  brandName?: string;
  pageUrl?: string;
}

/**
 * Template function that generates todos for a specific check
 * Templates don't include parent_group/group - those are added by generateTodosForCheck
 */
type TodoTemplate = (
  result: VisibilityCheckResult,
  metadata: Record<string, any>,
  context: TodoContext
) => VisibilityTodoItem[];

/**
 * Process mustache-style template variables in text
 * Replaces {{DOMAIN}}, {{BOT}}, {{PAGE_URL}}, {{BRAND_NAME}}, {{DATE}} with actual values
 */
function processTemplate(text: string, context: TodoContext, extra?: Record<string, string>): string {
  return text
    .replace(/\{\{DOMAIN\}\}/g, context.domain)
    .replace(/\{\{BOT\}\}/g, extra?.bot || '')
    .replace(/\{\{PAGE_URL\}\}/g, context.pageUrl || '/')
    .replace(/\{\{BRAND_NAME\}\}/g, context.brandName || context.domain)
    .replace(/\{\{DATE\}\}/g, new Date().toISOString().split('T')[0])
    .replace(/\n/g, '<br>');  // Convert newlines to HTML breaks for multi-line templates
}

/**
 * Helper to process step text with template variables
 */
const tplStep = (text: string, context: TodoContext, extra?: Record<string, string>): TodoStep => ({
  text: processTemplate(text, context, extra),
  completed: false
});

/**
 * Extract category from check ID
 */
function getCategoryFromCheckId(checkId: string): VisibilityTodoItem['category'] {
  if (checkId.startsWith('server-') || checkId.startsWith('http-headers-')) {
    return 'server';
  }
  if (checkId.startsWith('content-')) {
    return 'content';
  }
  if (checkId.startsWith('indexing-') || checkId.startsWith('social-')) {
    return 'indexing';
  }
  if (checkId.startsWith('response-speed') || checkId.includes('performance') || checkId.includes('ttfb')) {
    return 'performance';
  }
  // Default to server for unknown categories
  return 'server';
}

/**
 * Template registry for all visibility checks
 * Keys are check IDs (kebab-case derived from class names)
 */
const TODO_TEMPLATES: Record<string, TodoTemplate> = {
  // ============================================
  // SERVER CHECKS
  // ============================================

  'server-robots-txt': (result, metadata, context) => {
    const todos: VisibilityTodoItem[] = [];
    const blockedBots = metadata.blockedBots || [];

    // If specific bots are blocked, create todos for each
    if (blockedBots.length > 0) {
      blockedBots.forEach((bot: string) => {
        const extra = { bot };
        todos.push({
          action_id: `server-robots-txt-allow-${bot.toLowerCase().replace(/\s+/g, '-')}`,
          check_id: 'server-robots-txt',
          title: processTemplate('Allow {{BOT}} in robots.txt', context, extra),
          description: processTemplate('The {{BOT}} crawler is currently blocked by your robots.txt file. Allowing it will improve your visibility in AI-powered services.', context, extra),
          period_days: 90,
          priority: 'high',
          impact_score: 5,
          steps: [
            tplStep(`Open <a href="https://{{DOMAIN}}/robots.txt" target="_blank">{{DOMAIN}}/robots.txt</a> and add:
<code>User-agent: {{BOT}}
Allow: /</code>
Save the file on your server.`, context, extra),
            tplStep('Verify the file was updated: <a href="https://{{DOMAIN}}/robots.txt" target="_blank">{{DOMAIN}}/robots.txt</a>', context, extra)
          ],
          code_example: processTemplate(`User-agent: {{BOT}}
Allow: /`, context, extra),
          category: 'server',
          tag: 'ai_visibility'
        });
      });
    } else {
      // Generic robots.txt improvement todo
      todos.push({
        action_id: 'server-robots-txt-configure',
        check_id: 'server-robots-txt',
        title: 'Configure robots.txt for AI crawlers',
        description: 'Your robots.txt file needs configuration to properly allow AI crawlers access to your content.',
        period_days: 90,
        priority: 'high',
        impact_score: 10,
        steps: [
          tplStep(`Open <a href="https://{{DOMAIN}}/robots.txt" target="_blank">{{DOMAIN}}/robots.txt</a> and add:
<code>User-agent: GPTBot
Allow: /

User-agent: Claude-Web
Allow: /

User-agent: PerplexityBot
Allow: /</code>
Save the file on your server.`, context),
          tplStep('Verify the file was updated: <a href="https://{{DOMAIN}}/robots.txt" target="_blank">{{DOMAIN}}/robots.txt</a>', context)
        ],
        code_example: `# Allow AI assistants to crawl your site
User-agent: GPTBot
Allow: /

User-agent: Claude-Web
Allow: /

User-agent: PerplexityBot
Allow: /`,
        category: 'server',
        tag: 'ai_visibility'
      });
    }

    return todos;
  },

  'server-sitemap': (result, metadata, context) => {
    return [{
      action_id: 'server-sitemap-create',
      check_id: 'server-sitemap',
      title: 'Create and submit XML sitemap',
      description: 'Create a sitemap.xml file to help AI crawlers discover all your important pages.',
      period_days: -1, // One-time
      priority: 'high',
      impact_score: 8,
      steps: [
        tplStep('Enable sitemap.xml in your CMS or manually create sitemap.xml with the URLs of your website pages.', context),
        tplStep(`Add <code>Sitemap: https://{{DOMAIN}}/sitemap.xml</code> to your <a href="https://{{DOMAIN}}/robots.txt" target="_blank">{{DOMAIN}}/robots.txt</a>`, context),
        tplStep(`Submit to <a href="https://search.google.com/search-console?resource_id=sc-domain:{{DOMAIN}}" target="_blank">Google Search Console</a>:
Select your website property from the dropdown (add and verify if not listed).
Click "Sitemaps" under the "Indexing" section in the left menu.
Enter your sitemap URL (e.g., sitemap.xml) and click Submit.`, context),
        tplStep('Submit to <a href="https://www.bing.com/webmasters/help/Sitemaps-3b5cf6ed" target="_blank">Bing Webmaster Tools</a> (powers Microsoft Copilot, ChatGPT search).', context),
        tplStep('Submit to <a href="https://search.brave.com/submit-url" target="_blank">Brave Search</a> (powers Brave Leo AI, other AI assistants).', context)
      ],
      category: 'server',
      tag: 'ai_visibility'
    }];
  },

  'server-ttfb': (result, metadata, context) => {
    const ttfbMs = metadata.ttfbMs || 0;
    return [{
      action_id: 'server-ttfb-optimize',
      check_id: 'server-ttfb',
      title: 'Improve server response time (TTFB)',
      description: `Your server took ${ttfbMs}ms to respond. AI crawlers may timeout on slow pages (target under 200ms). To optimize server speed: add a CDN for assets and website (e.g., Cloudflare), check server configuration, or contact your web hosting support for advice.`,
      period_days: 30, // Monthly check
      priority: ttfbMs > 1000 ? 'critical' : ttfbMs > 500 ? 'high' : 'medium',
      impact_score: 5,
      steps: [],
      category: 'performance',
      tag: 'ai_visibility'
    }];
  },

  'server-http-headers': (result, metadata, context) => {
    return [{
      action_id: 'server-http-headers-optimize',
      check_id: 'server-http-headers',
      title: 'Remove <code>X-Robots-Tag: noindex</code> from HTTP headers',
      description: 'Your server is sending <code>X-Robots-Tag: noindex</code> in HTTP headers, which blocks AI crawlers from indexing your content. Remove this header from your server configuration if you want AI crawlers to index your pages.',
      period_days: 90,
      priority: 'medium',
      impact_score: 3,
      steps: [],
      category: 'server',
      tag: 'ai_visibility'
    }];
  },

  // Bot Accessibility Checks
  'server-bot-accessibility-foundation-models-training': (result, metadata, context) => {
    const blockedServices = metadata.blockedServices || [];

    // Build steps - one per blocked bot, or default bots if none specified
    const steps: TodoStep[] = [];

    if (blockedServices.length > 0) {
      blockedServices.forEach((service: { name: string; bots: string[] }) => {
        const botName = service.bots[0] || service.name;
        steps.push(tplStep(`Add <code>User-agent: ${botName}\nAllow: /</code> to allow ${service.name} to access {{DOMAIN}}`, context));
      });
    } else {
      // Default training bots
      steps.push(tplStep('Add <code>User-agent: GPTBot\nAllow: /</code> to allow OpenAI training crawler to access {{DOMAIN}}', context));
      steps.push(tplStep('Add <code>User-agent: CCBot\nAllow: /</code> to allow Common Crawl to access {{DOMAIN}}', context));
      steps.push(tplStep('Add <code>User-agent: Google-Extended\nAllow: /</code> to allow Google AI training to access {{DOMAIN}}', context));
    }

    return [{
      action_id: 'server-bot-allow-training',
      check_id: 'server-bot-accessibility-foundation-models-training',
      title: 'Allow AI training crawlers in robots.txt',
      description: processTemplate('Update <a href="https://{{DOMAIN}}/robots.txt" target="_blank">{{DOMAIN}}/robots.txt</a> to allow AI training bots to access your content. If you use a web application firewall (WAF), also check that it is not blocking these crawlers by IP.', context),
      period_days: 90,
      priority: 'high',
      impact_score: 10,
      steps,
      category: 'server',
      tag: 'ai_visibility'
    }];
  },

  'server-bot-accessibility-user-interaction': (result, metadata, context) => {
    const blockedServices = metadata.blockedServices || [];

    // Build steps - one per blocked bot, or default bots if none specified
    const steps: TodoStep[] = [];

    if (blockedServices.length > 0) {
      blockedServices.forEach((service: { name: string; bots: string[] }) => {
        const botName = service.bots[0] || service.name;
        steps.push(tplStep(`Add <code>User-agent: ${botName}\nAllow: /</code> to allow ${service.name} to access {{DOMAIN}}`, context));
      });
    } else {
      // Default AI assistant bots
      steps.push(tplStep('Add <code>User-agent: ChatGPT-User\nAllow: /</code> to allow ChatGPT to access {{DOMAIN}}', context));
      steps.push(tplStep('Add <code>User-agent: Claude-Web\nAllow: /</code> to allow Claude to access {{DOMAIN}}', context));
      steps.push(tplStep('Add <code>User-agent: PerplexityBot\nAllow: /</code> to allow Perplexity to access {{DOMAIN}}', context));
    }

    return [{
      action_id: 'server-bot-allow-user-interaction',
      check_id: 'server-bot-accessibility-user-interaction',
      title: 'Allow AI assistant crawlers in robots.txt',
      description: processTemplate('Update <a href="https://{{DOMAIN}}/robots.txt" target="_blank">{{DOMAIN}}/robots.txt</a> to allow AI assistants (ChatGPT, Claude, Perplexity) to fetch your content when users ask questions. If you use a web application firewall (WAF), also check that it is not blocking these crawlers by IP.', context),
      period_days: 90,
      priority: 'critical',
      impact_score: 10,
      steps,
      category: 'server',
      tag: 'ai_visibility'
    }];
  },

  'server-bot-accessibility-ai-search-engines': (result, metadata, context) => {
    const steps: TodoStep[] = [
      tplStep('Add <code>User-agent: PerplexityBot\nAllow: /</code> to allow Perplexity AI search to access {{DOMAIN}}', context),
      tplStep('Add <code>User-agent: Bingbot\nAllow: /</code> to allow Bing AI search (powers Microsoft Copilot) to access {{DOMAIN}}', context),
    ];

    return [{
      action_id: 'server-bot-allow-ai-search',
      check_id: 'server-bot-accessibility-ai-search-engines',
      title: 'Allow AI search engine crawlers in robots.txt',
      description: processTemplate('Update <a href="https://{{DOMAIN}}/robots.txt" target="_blank">{{DOMAIN}}/robots.txt</a> to allow AI-powered search engines to index your content. If you use a web application firewall (WAF), also check that it is not blocking these crawlers by IP.', context),
      period_days: 90,
      priority: 'high',
      impact_score: 6,
      steps,
      category: 'server',
      tag: 'ai_visibility'
    }];
  },

  // ============================================
  // CONTENT CHECKS
  // ============================================

  'content-meta-tags': (result, metadata, context) => {
    const missingTags = metadata.missingTags || [];

    // Build description based on what's missing
    let description = 'Meta tags help AI systems understand and summarize your page content. ';
    if (missingTags.length > 0) {
      description += `Missing tags: <code>${missingTags.join('</code>, <code>')}</code>. `;
    }
    description += 'Ensure your page has: meta description (150-160 chars), Open Graph tags (og:title, og:description, og:image), and author/date metadata.';

    return [{
      action_id: 'content-meta-improve',
      check_id: 'content-meta-tags',
      title: 'Add missing meta tags to page',
      description,
      period_days: -1,
      priority: missingTags.includes('description') ? 'high' : 'medium',
      impact_score: 5,
      steps: [],
      category: 'content',
      tag: 'ai_visibility',
      page_url: context.pageUrl
    }];
  },

  'content-structure': (result, metadata, context) => {
    return [{
      action_id: 'content-structure-semantic-html',
      check_id: 'content-structure',
      title: 'Improve semantic HTML structure',
      description: 'Proper HTML structure helps AI extract key information from your content. Ensure your page has: a single <code>&lt;h1&gt;</code> tag, proper heading hierarchy (<code>&lt;h2&gt;</code>-<code>&lt;h6&gt;</code>), semantic HTML5 elements (<code>&lt;article&gt;</code>, <code>&lt;section&gt;</code>, <code>&lt;nav&gt;</code>), and alt text on all images.',
      period_days: -1,
      priority: 'medium',
      impact_score: 4,
      steps: [],
      category: 'content',
      tag: 'ai_visibility',
      page_url: context.pageUrl
    }];
  },

  'content-json-ld': (result, metadata, context) => {
    const missingSchemas = metadata.missingSchemas || ['Organization', 'WebSite'];
    const pageLink = context.pageUrl && context.pageUrl !== '/'
      ? `<a href="https://${context.domain}${context.pageUrl}" target="_blank">${context.domain}${context.pageUrl}</a>`
      : `<a href="https://${context.domain}" target="_blank">${context.domain}</a>`;
    const validatorUrl = `https://validator.w3.org/nu/?doc=https://${context.domain}${context.pageUrl || '/'}`;

    // Build description based on what's missing
    let schemaList = missingSchemas.map((s: string) => `<code>${s}</code>`).join(', ');

    return [{
      action_id: 'content-json-ld-add',
      check_id: 'content-json-ld',
      title: 'Add JSON-LD structured data',
      description: `Add JSON-LD structured data to ${pageLink} to help AI systems understand your content. Missing schemas: ${schemaList}. For homepage, add Organization and WebSite schemas. For articles/blog posts, add Article schema with headline, author, and dates. Validate your markup with <a href="${validatorUrl}" target="_blank">W3C Validator</a> and <a href="https://search.google.com/test/rich-results" target="_blank">Google Rich Results Test</a>.`,
      period_days: -1,
      priority: 'high',
      impact_score: 5,
      steps: [],
      category: 'content',
      tag: 'ai_visibility',
      page_url: context.pageUrl
    }];
  },

  'content-llms-txt': (result, metadata, context) => {
    return [{
      action_id: 'content-llms-txt-create',
      check_id: 'content-llms-txt',
      title: 'Create llms.txt file',
      description: processTemplate(`Create an <a href="https://{{DOMAIN}}/llms.txt" target="_blank">{{DOMAIN}}/llms.txt</a> file to provide explicit instructions to AI language models about how to use your content. Include your brand name, URL, citation preferences, and whether you allow summarization/training. This is a newer standard - see <a href="https://llmstxt.org/" target="_blank">llmstxt.org</a> for the specification.`, context),
      period_days: -1,
      priority: 'medium',
      impact_score: 3,
      steps: [],
      category: 'content',
      tag: 'ai_visibility'
    }];
  },

  'content-javascript-dependency': (result, metadata, context) => {
    const pageLink = context.pageUrl && context.pageUrl !== '/'
      ? `<a href="https://${context.domain}${context.pageUrl}" target="_blank">${context.domain}${context.pageUrl}</a>`
      : `<a href="https://${context.domain}" target="_blank">${context.domain}</a>`;
    const mobileTestUrl = `https://search.google.com/test/mobile-friendly?url=https://${context.domain}${context.pageUrl || '/'}`;

    return [{
      action_id: 'content-reduce-js-dependency',
      check_id: 'content-javascript-dependency',
      title: 'Ensure content is in initial HTML',
      description: `AI crawlers may not execute JavaScript, so critical content on ${pageLink} should be in the initial HTML response. Test your page with JavaScript disabled. Consider server-side rendering (SSR) with frameworks like Next.js, Nuxt, or Astro. Check with <a href="${mobileTestUrl}" target="_blank">Google Mobile Test</a> which shows rendered HTML.`,
      period_days: -1,
      priority: 'high',
      impact_score: 6,
      steps: [],
      category: 'content',
      tag: 'ai_visibility',
      page_url: context.pageUrl
    }];
  },

  'content-mobile-compatibility': (result, metadata, context) => {
    const pageLink = context.pageUrl && context.pageUrl !== '/'
      ? `<a href="https://${context.domain}${context.pageUrl}" target="_blank">${context.domain}${context.pageUrl}</a>`
      : `<a href="https://${context.domain}" target="_blank">${context.domain}</a>`;
    const mobileTestUrl = `https://search.google.com/test/mobile-friendly?url=https://${context.domain}${context.pageUrl || '/'}`;

    return [{
      action_id: 'content-mobile-viewport',
      check_id: 'content-mobile-compatibility',
      title: 'Add mobile viewport meta tag',
      description: `AI systems often prioritize mobile-friendly content. Ensure ${pageLink} has a viewport meta tag: <code>&lt;meta name="viewport" content="width=device-width, initial-scale=1"&gt;</code>. Use responsive CSS and test with <a href="${mobileTestUrl}" target="_blank">Google Mobile-Friendly Test</a>.`,
      period_days: -1,
      priority: 'medium',
      impact_score: 3,
      steps: [],
      category: 'content',
      tag: 'ai_visibility',
      page_url: context.pageUrl
    }];
  },

  // ============================================
  // PERFORMANCE CHECKS
  // ============================================

  'response-speed': (result, metadata, context) => {
    const loadTimeMs = metadata.loadTimeMs || 0;
    const pageLink = context.pageUrl && context.pageUrl !== '/'
      ? `<a href="https://${context.domain}${context.pageUrl}" target="_blank">${context.domain}${context.pageUrl}</a>`
      : `<a href="https://${context.domain}" target="_blank">${context.domain}</a>`;
    const pageSpeedUrl = `https://pagespeed.web.dev/analysis?url=https://${context.domain}${context.pageUrl || '/'}`;

    return [{
      action_id: 'performance-page-speed',
      check_id: 'response-speed',
      title: 'Improve page load speed',
      description: `Page ${pageLink} loaded in ${loadTimeMs}ms. AI crawlers may timeout on slow pages (target under 3 seconds). Run <a href="${pageSpeedUrl}" target="_blank">PageSpeed Insights</a> for specific recommendations. Common fixes: optimize images (WebP), enable gzip/brotli compression, minify CSS/JS, use a CDN.`,
      period_days: 30,
      priority: loadTimeMs > 5000 ? 'critical' : loadTimeMs > 3000 ? 'high' : 'medium',
      impact_score: 4,
      steps: [],
      category: 'performance',
      tag: 'ai_visibility',
      page_url: context.pageUrl
    }];
  },

  'response-speed-homepage': (result, metadata, context) => {
    const pageSpeedUrl = `https://pagespeed.web.dev/analysis?url=https://${context.domain}/`;

    return [{
      action_id: 'performance-homepage-speed',
      check_id: 'response-speed-homepage',
      title: 'Optimize homepage load time',
      description: `Your homepage <a href="https://${context.domain}" target="_blank">${context.domain}</a> is the entry point for AI crawlers. Fast loading ensures more content gets crawled. Run <a href="${pageSpeedUrl}" target="_blank">PageSpeed Insights</a> for specific recommendations. Common fixes: prioritize above-the-fold content, defer non-critical JavaScript, optimize hero images (WebP), use a CDN like <a href="https://cloudflare.com" target="_blank">Cloudflare</a>.`,
      period_days: 30,
      priority: 'high',
      impact_score: 5,
      steps: [],
      category: 'performance',
      tag: 'ai_visibility'
    }];
  },

  'response-speed-page': (result, metadata, context) => {
    const pageLink = context.pageUrl && context.pageUrl !== '/'
      ? `<a href="https://${context.domain}${context.pageUrl}" target="_blank">${context.domain}${context.pageUrl}</a>`
      : `<a href="https://${context.domain}" target="_blank">${context.domain}</a>`;
    const pageSpeedUrl = `https://pagespeed.web.dev/analysis?url=https://${context.domain}${context.pageUrl || '/'}`;
    const webPageTestUrl = `https://www.webpagetest.org/?url=https://${context.domain}${context.pageUrl || '/'}`;

    return [{
      action_id: `performance-page-${(context.pageUrl || '/').replace(/\//g, '-')}`,
      check_id: 'response-speed-page',
      title: 'Optimize page load speed',
      description: `Slow pages may cause AI crawlers to timeout or skip content. Analyze ${pageLink} with <a href="${pageSpeedUrl}" target="_blank">PageSpeed Insights</a> or <a href="${webPageTestUrl}" target="_blank">WebPageTest</a>. Common fixes: reduce third-party scripts, optimize fonts, implement caching headers.`,
      period_days: 30,
      priority: 'medium',
      impact_score: 3,
      steps: [],
      category: 'performance',
      tag: 'ai_visibility',
      page_url: context.pageUrl
    }];
  },

  // ============================================
  // INDEXING CHECKS
  // ============================================

  'indexing-google': (result, metadata, context) => {
    const indexed = metadata.indexed || false;
    const gscUrl = `https://search.google.com/search-console?resource_id=sc-domain:${context.domain}`;

    return [{
      action_id: 'indexing-google-submit',
      check_id: 'indexing-google',
      title: indexed ? 'Review Google Search Console coverage' : 'Submit site to Google Search Console',
      description: indexed
        ? `Regularly review <a href="${gscUrl}" target="_blank">Google Search Console</a> for <a href="https://${context.domain}" target="_blank">${context.domain}</a> to check crawl errors and coverage issues. Fix any "Error" or "Excluded" pages and request re-indexing if needed.`
        : `Google Search is a primary data source for AI. Submit <a href="https://${context.domain}" target="_blank">${context.domain}</a> to <a href="https://search.google.com/search-console" target="_blank">Google Search Console</a>: add and verify your property, submit your sitemap, and request indexing for important pages.`,
      period_days: indexed ? 30 : -1,
      priority: indexed ? 'medium' : 'critical',
      impact_score: indexed ? 3 : 10,
      steps: [],
      category: 'indexing',
      tag: 'ai_visibility'
    }];
  },

  'indexing-bing': (result, metadata, context) => {
    const indexed = metadata.indexed || false;

    return [{
      action_id: 'indexing-bing-submit',
      check_id: 'indexing-bing',
      title: indexed ? 'Review Bing Webmaster Tools' : 'Submit site to Bing Webmaster Tools',
      description: indexed
        ? `Bing powers Microsoft Copilot and ChatGPT search. Review <a href="https://www.bing.com/webmasters" target="_blank">Bing Webmaster Tools</a> for <a href="https://${context.domain}" target="_blank">${context.domain}</a> to check crawl issues and IndexNow submissions.`
        : `Bing powers Microsoft Copilot and ChatGPT search. Submit <a href="https://${context.domain}" target="_blank">${context.domain}</a> to <a href="https://www.bing.com/webmasters" target="_blank">Bing Webmaster Tools</a>: add and verify your site, submit your sitemap. Consider implementing <a href="https://www.indexnow.org/" target="_blank">IndexNow</a> for instant indexing.`,
      period_days: indexed ? 30 : -1,
      priority: 'high',
      impact_score: indexed ? 2 : 6,
      steps: [],
      category: 'indexing',
      tag: 'ai_visibility'
    }];
  },

  'indexing-brave': (result, metadata, context) => {
    return [{
      action_id: 'indexing-brave-submit',
      check_id: 'indexing-brave',
      title: 'Submit to Brave Search',
      description: `Brave Search powers Brave Leo AI and has an independent index. Submit <a href="https://${context.domain}" target="_blank">${context.domain}</a> to <a href="https://search.brave.com/webmasters" target="_blank">Brave Web Discovery</a> and ensure BraveBot is allowed in your <a href="https://${context.domain}/robots.txt" target="_blank">robots.txt</a>.`,
      period_days: -1,
      priority: 'low',
      impact_score: 2,
      steps: [],
      category: 'indexing',
      tag: 'ai_visibility'
    }];
  },

  'indexing-dataset-common-crawl': (result, metadata, context) => {
    return [{
      action_id: 'indexing-common-crawl-allow',
      check_id: 'indexing-dataset-common-crawl',
      title: 'Allow Common Crawl bot',
      description: `<a href="https://commoncrawl.org/" target="_blank">Common Crawl</a> is a major data source for AI training. Add <code>User-agent: CCBot\nAllow: /</code> to your <a href="https://${context.domain}/robots.txt" target="_blank">robots.txt</a> to allow the CCBot crawler to index your content.`,
      period_days: 90,
      priority: 'high',
      impact_score: 5,
      steps: [],
      category: 'indexing',
      tag: 'ai_visibility'
    }];
  },

  'indexing-dataset-common-crawl-domain': (result, metadata, context) => {
    return [{
      action_id: 'indexing-common-crawl-domain-presence',
      check_id: 'indexing-dataset-common-crawl-domain',
      title: 'Improve domain presence in Common Crawl',
      description: `Your domain's presence in <a href="https://commoncrawl.org/" target="_blank">Common Crawl</a> affects AI model understanding of your brand. Ensure CCBot has full access in <a href="https://${context.domain}/robots.txt" target="_blank">robots.txt</a>, maintain stable URLs, link between your pages, and build quality external links to increase crawl priority.`,
      period_days: 90,
      priority: 'medium',
      impact_score: 4,
      steps: [],
      category: 'indexing',
      tag: 'ai_visibility'
    }];
  },

  'indexing-dataset-common-crawl-page': (result, metadata, context) => {
    const pageLink = context.pageUrl && context.pageUrl !== '/'
      ? `<a href="https://${context.domain}${context.pageUrl}" target="_blank">${context.domain}${context.pageUrl}</a>`
      : `<a href="https://${context.domain}" target="_blank">${context.domain}</a>`;

    return [{
      action_id: `indexing-common-crawl-page-${(context.pageUrl || '/').replace(/\//g, '-')}`,
      check_id: 'indexing-dataset-common-crawl-page',
      title: 'Improve page presence in Common Crawl',
      description: `Individual page presence in <a href="https://commoncrawl.org/" target="_blank">Common Crawl</a> helps AI models learn from your specific content. Ensure ${pageLink} is in your sitemap, link to it from high-traffic pages, keep content fresh, and verify it's not blocked by robots.txt.`,
      period_days: 90,
      priority: 'low',
      impact_score: 2,
      steps: [],
      category: 'indexing',
      tag: 'ai_visibility',
      page_url: context.pageUrl
    }];
  },

  'indexing-knowledge-wikipedia': (result, metadata, context) => {
    const searchQuery = encodeURIComponent(context.brandName || context.domain);

    return [{
      action_id: 'indexing-wikipedia-monitor',
      check_id: 'indexing-knowledge-wikipedia',
      title: 'Monitor Wikipedia for brand mentions',
      description: `Wikipedia is a trusted source for AI knowledge. Search <a href="https://en.wikipedia.org/w/index.php?search=${searchQuery}" target="_blank">Wikipedia for your brand</a> to check if you're mentioned. <strong>Important:</strong> Do NOT edit Wikipedia yourself (conflict of interest). If notable, consider hiring a <a href="https://en.wikipedia.org/wiki/Wikipedia:Paid_editors" target="_blank">Wikipedia consultant</a>. Focus on creating verifiable achievements and press coverage.`,
      period_days: 30,
      priority: 'medium',
      impact_score: 8,
      steps: [],
      category: 'indexing',
      tag: 'ai_visibility'
    }];
  },

  'indexing-social-reddit': (result, metadata, context) => {
    const searchQuery = encodeURIComponent(context.domain);

    return [{
      action_id: 'indexing-reddit-engage',
      check_id: 'indexing-social-reddit',
      title: 'Engage in relevant Reddit communities',
      description: `Reddit discussions are used by AI for understanding brand sentiment. Search <a href="https://reddit.com/search?q=${searchQuery}" target="_blank">Reddit for your brand</a>, find relevant subreddits, and engage helpfully. Respond professionally to brand mentions. <strong>Important:</strong> Never spam or self-promote excessively.`,
      period_days: 7,
      priority: 'medium',
      impact_score: 3,
      steps: [],
      category: 'indexing',
      tag: 'ai_visibility'
    }];
  },

  'indexing-social-hackernews': (result, metadata, context) => {
    const searchQuery = encodeURIComponent(context.domain);

    return [{
      action_id: 'indexing-hackernews-engage',
      check_id: 'indexing-social-hackernews',
      title: 'Share valuable content on Hacker News',
      description: `Hacker News is key for tech AI training data. Check <a href="https://hn.algolia.com/?q=${searchQuery}" target="_blank">HN for your brand mentions</a>, create technically interesting content, and <a href="https://news.ycombinator.com/submit" target="_blank">submit to Hacker News</a>. Engage thoughtfully in discussions. <strong>Important:</strong> Quality over quantity - don't spam.`,
      period_days: 30,
      priority: 'low',
      impact_score: 3,
      steps: [],
      category: 'indexing',
      tag: 'ai_visibility'
    }];
  },

  'indexing-social-stackoverflow': (result, metadata, context) => {
    const tagQuery = encodeURIComponent(context.brandName || 'javascript');

    return [{
      action_id: 'indexing-stackoverflow-presence',
      check_id: 'indexing-social-stackoverflow',
      title: 'Build Stack Overflow presence',
      description: `Stack Overflow is a primary source for AI code assistants. Create a profile at <a href="https://stackoverflow.com/" target="_blank">Stack Overflow</a> with your company info. Search <a href="https://stackoverflow.com/questions/tagged/${tagQuery}?sort=newest" target="_blank">relevant tags</a> and answer questions helpfully. Link to your docs when directly relevant (not spam).`,
      period_days: 7,
      priority: 'medium',
      impact_score: 4,
      steps: [],
      category: 'indexing',
      tag: 'ai_visibility'
    }];
  },

  // ============================================
  // HTTP HEADER CHECKS
  // ============================================

  'http-headers-homepage': (result, metadata, context) => {
    return [{
      action_id: 'http-headers-homepage-fix',
      check_id: 'http-headers-homepage',
      title: 'Fix homepage HTTP headers',
      description: `HTTP headers on <a href="https://${context.domain}" target="_blank">${context.domain}</a> affect how AI crawlers interact with your site. Ensure proper <code>Content-Type: text/html; charset=utf-8</code>, set appropriate <code>Cache-Control</code> headers, remove any <code>X-Robots-Tag: noindex</code> headers, and ensure HTTPS redirect is configured.`,
      period_days: -1,
      priority: 'medium',
      impact_score: 2,
      steps: [],
      category: 'server',
      tag: 'ai_visibility'
    }];
  },

  'http-headers-page': (result, metadata, context) => {
    const pageLink = context.pageUrl && context.pageUrl !== '/'
      ? `<a href="https://${context.domain}${context.pageUrl}" target="_blank">${context.domain}${context.pageUrl}</a>`
      : `<a href="https://${context.domain}" target="_blank">${context.domain}</a>`;

    return [{
      action_id: `http-headers-page-${(context.pageUrl || '/').replace(/\//g, '-')}`,
      check_id: 'http-headers-page',
      title: 'Fix page HTTP headers',
      description: `HTTP headers on ${pageLink} affect AI crawler behavior. Ensure <code>Content-Type</code> matches actual content, set appropriate <code>Cache-Control</code> for content freshness, and avoid <code>X-Robots-Tag: noindex</code> unless intentional.`,
      period_days: -1,
      priority: 'low',
      impact_score: 1,
      steps: [],
      category: 'server',
      tag: 'ai_visibility',
      page_url: context.pageUrl
    }];
  }
};

/**
 * Extract domain from URL
 */
function extractDomain(url: string): string {
  try {
    const parsed = new URL(url);
    return parsed.hostname;
  } catch {
    return url.replace(/^https?:\/\//, '').split('/')[0];
  }
}

/**
 * Generate todos for a single check result
 * @param check - The visibility check instance
 * @param result - The check result
 * @param rootUrl - The root URL being checked
 * @param pageUrl - Optional page URL for page-level checks
 * @param level - Whether this is a 'server' or 'page' level check
 */
export function generateTodosForCheck(
  check: BaseVisibilityCheck,
  result: VisibilityCheckResult,
  rootUrl: string,
  pageUrl?: string,
  level: 'server' | 'page' = 'server'
): VisibilityTodoItem[] {
  // Only generate todos for failed checks
  if (result.passed) {
    return [];
  }

  // Generate check ID from class name (e.g., CheckServerRobotsTxt -> server-robots-txt)
  const checkId = generateCheckId(check.constructor.name);
  const template = TODO_TEMPLATES[checkId];

  // Get group info for this check
  const groupInfo = getCheckGroupWithFallback(checkId, level);

  let todos: VisibilityTodoItem[] = [];

  if (!template) {
    // Try to find a partial match
    for (const [key, tmpl] of Object.entries(TODO_TEMPLATES)) {
      if (checkId.startsWith(key) || key.startsWith(checkId.split('-').slice(0, 3).join('-'))) {
        const context: TodoContext = {
          domain: extractDomain(rootUrl),
          brandName: extractDomain(rootUrl).split('.')[0],
          pageUrl
        };
        todos = tmpl(result, result.metadata || {}, context);
        break;
      }
    }
  } else {
    const context: TodoContext = {
      domain: extractDomain(rootUrl),
      brandName: extractDomain(rootUrl).split('.')[0],
      pageUrl
    };
    todos = template(result, result.metadata || {}, context);
  }

  // Add hierarchical group info to each todo
  return todos.map(todo => ({
    ...todo,
    parent_group: groupInfo.parentGroupTag,
    group: groupInfo.groupTag
  }));
}

/**
 * Generate todos from all check results (server + pages)
 */
export function generateTodosFromResults(
  serverResults: Array<{check: BaseVisibilityCheck, result: VisibilityCheckResult}>,
  pagesResults: Array<{
    url: string;
    path: string;
    results: Array<{check: BaseVisibilityCheck, result: VisibilityCheckResult}>;
  }>,
  rootUrl: string
): VisibilityTodoItem[] {
  const todos: VisibilityTodoItem[] = [];
  const seenActionIds = new Set<string>();

  // Generate todos from server-level checks
  for (const { check, result } of serverResults) {
    const checkTodos = generateTodosForCheck(check, result, rootUrl, undefined, 'server');
    for (const todo of checkTodos) {
      if (!seenActionIds.has(todo.action_id)) {
        seenActionIds.add(todo.action_id);
        todos.push(todo);
      }
    }
  }

  // Generate todos from page-level checks
  for (const page of pagesResults) {
    for (const { check, result } of page.results) {
      const checkTodos = generateTodosForCheck(check, result, rootUrl, page.path, 'page');
      for (const todo of checkTodos) {
        if (!seenActionIds.has(todo.action_id)) {
          seenActionIds.add(todo.action_id);
          todos.push(todo);
        }
      }
    }
  }

  // Sort by priority (critical first)
  const priorityOrder = { critical: 0, high: 1, medium: 2, low: 3 };
  todos.sort((a, b) => priorityOrder[a.priority] - priorityOrder[b.priority]);

  return todos;
}

/**
 * Get all available check IDs that have todo templates
 */
export function getAvailableTodoCheckIds(): string[] {
  return Object.keys(TODO_TEMPLATES);
}
