/**
 * Visibility Check Group Configuration
 *
 * Defines hierarchical grouping for visibility checks:
 * - Server checks: Config, AI Access, Headers, Indexing, Performance
 * - Page checks: Content, Headers, Indexing, Performance
 *
 * This enables better UI organization and todo tagging.
 */

// =============================================================================
// Parent Groups (Top Level)
// =============================================================================

export const PARENT_GROUPS = {
  SERVER: 'Server',
  PAGES: 'Pages',
} as const;

export type ParentGroup = (typeof PARENT_GROUPS)[keyof typeof PARENT_GROUPS];
export type ParentGroupTag = 'server' | 'pages';

// =============================================================================
// Server Subgroups
// =============================================================================

export const SERVER_GROUPS = {
  CONFIG: 'Config',
  AI_ACCESS: 'AI Access',
  HEADERS: 'Headers',
  INDEXING: 'Indexing',
  PERFORMANCE: 'Performance',
} as const;

export type ServerGroup = (typeof SERVER_GROUPS)[keyof typeof SERVER_GROUPS];

// =============================================================================
// Page Subgroups
// =============================================================================

export const PAGE_GROUPS = {
  CONTENT: 'Content',
  HEADERS: 'Headers',
  INDEXING: 'Indexing',
  PERFORMANCE: 'Performance',
} as const;

export type PageGroup = (typeof PAGE_GROUPS)[keyof typeof PAGE_GROUPS];

// =============================================================================
// Combined Group Type
// =============================================================================

export type CheckGroup = ServerGroup | PageGroup;

// =============================================================================
// Group Info Interface
// =============================================================================

export interface CheckGroupInfo {
  parentGroup: ParentGroup;
  parentGroupTag: ParentGroupTag;
  group: CheckGroup;
  groupTag: string;
}

// =============================================================================
// Check ID to Group Mapping
// =============================================================================

/**
 * Maps check IDs to their hierarchical group information.
 *
 * Check IDs are generated from class names via generateCheckId():
 *   CheckServerRobotsTxt -> server-robots-txt
 *   CheckContentMetaTags -> content-meta-tags
 */
export const CHECK_GROUP_MAP: Record<string, CheckGroupInfo> = {
  // =========================================================================
  // SERVER-LEVEL CHECKS
  // =========================================================================

  // Config Group - Core server configuration files
  'server-robots-txt': {
    parentGroup: 'Server',
    parentGroupTag: 'server',
    group: 'Config',
    groupTag: 'config',
  },
  'server-sitemap': {
    parentGroup: 'Server',
    parentGroupTag: 'server',
    group: 'Config',
    groupTag: 'config',
  },
  'content-llms-txt-file': {
    parentGroup: 'Server',
    parentGroupTag: 'server',
    group: 'Indexing',
    groupTag: 'indexing',
  },

  // AI Access Group - Bot accessibility checks
  'server-bot-accessibility-foundation-models-training': {
    parentGroup: 'Server',
    parentGroupTag: 'server',
    group: 'AI Access',
    groupTag: 'ai_access',
  },
  'server-bot-accessibility-search-index': {
    parentGroup: 'Server',
    parentGroupTag: 'server',
    group: 'AI Access',
    groupTag: 'ai_access',
  },
  'server-bot-accessibility-user-interaction': {
    parentGroup: 'Server',
    parentGroupTag: 'server',
    group: 'AI Access',
    groupTag: 'ai_access',
  },

  // Headers Group - HTTP headers (homepage)
  'http-headers-homepage': {
    parentGroup: 'Server',
    parentGroupTag: 'server',
    group: 'Headers',
    groupTag: 'headers',
  },

  // Indexing Group - Domain-level indexing
  'indexing-knowledge-wikipedia': {
    parentGroup: 'Server',
    parentGroupTag: 'server',
    group: 'Indexing',
    groupTag: 'indexing',
  },
  'indexing-social-stack-overflow': {
    parentGroup: 'Server',
    parentGroupTag: 'server',
    group: 'Indexing',
    groupTag: 'indexing',
  },
  'indexing-social-reddit': {
    parentGroup: 'Server',
    parentGroupTag: 'server',
    group: 'Indexing',
    groupTag: 'indexing',
  },
  'indexing-dataset-common-crawl-domain': {
    parentGroup: 'Server',
    parentGroupTag: 'server',
    group: 'Indexing',
    groupTag: 'indexing',
  },

  // Performance Group - Server performance
  'server-ttfb': {
    parentGroup: 'Server',
    parentGroupTag: 'server',
    group: 'Performance',
    groupTag: 'performance',
  },
  'response-speed-homepage': {
    parentGroup: 'Server',
    parentGroupTag: 'server',
    group: 'Performance',
    groupTag: 'performance',
  },

  // =========================================================================
  // PAGE-LEVEL CHECKS
  // =========================================================================

  // Content Group - Page content quality
  'content-meta-tags': {
    parentGroup: 'Pages',
    parentGroupTag: 'pages',
    group: 'Content',
    groupTag: 'content',
  },
  'content-json-ld': {
    parentGroup: 'Pages',
    parentGroupTag: 'pages',
    group: 'Content',
    groupTag: 'content',
  },
  'content-javascript-rendering': {
    parentGroup: 'Pages',
    parentGroupTag: 'pages',
    group: 'Content',
    groupTag: 'content',
  },
  'content-structure': {
    parentGroup: 'Pages',
    parentGroupTag: 'pages',
    group: 'Content',
    groupTag: 'content',
  },

  // Headers Group - HTTP headers (per-page)
  'http-headers-page': {
    parentGroup: 'Pages',
    parentGroupTag: 'pages',
    group: 'Headers',
    groupTag: 'headers',
  },

  // Indexing Group - Page-level indexing
  'indexing-dataset-common-crawl-page': {
    parentGroup: 'Pages',
    parentGroupTag: 'pages',
    group: 'Indexing',
    groupTag: 'indexing',
  },
  'indexing-google': {
    parentGroup: 'Pages',
    parentGroupTag: 'pages',
    group: 'Indexing',
    groupTag: 'indexing',
  },
  'indexing-bing': {
    parentGroup: 'Pages',
    parentGroupTag: 'pages',
    group: 'Indexing',
    groupTag: 'indexing',
  },
  'indexing-brave': {
    parentGroup: 'Pages',
    parentGroupTag: 'pages',
    group: 'Indexing',
    groupTag: 'indexing',
  },

  // Performance Group - Page performance
  'response-speed-page': {
    parentGroup: 'Pages',
    parentGroupTag: 'pages',
    group: 'Performance',
    groupTag: 'performance',
  },
};

// =============================================================================
// Utility Functions
// =============================================================================

/**
 * Get group information for a check by its ID.
 * Returns undefined if check is not mapped.
 */
export function getCheckGroup(checkId: string): CheckGroupInfo | undefined {
  return CHECK_GROUP_MAP[checkId];
}

/**
 * Get group information for a check, with fallback based on level.
 * Used when check is not in the mapping.
 */
export function getCheckGroupWithFallback(
  checkId: string,
  level: 'server' | 'page'
): CheckGroupInfo {
  const mapped = CHECK_GROUP_MAP[checkId];
  if (mapped) {
    return mapped;
  }

  // Fallback: derive group from check ID prefix
  const parentGroup = level === 'server' ? 'Server' : 'Pages';
  const parentGroupTag = level === 'server' ? 'server' : 'pages';

  // Try to determine group from check ID
  let group: CheckGroup;
  let groupTag: string;

  if (checkId.startsWith('content-')) {
    group = 'Content';
    groupTag = 'content';
  } else if (checkId.startsWith('indexing-') || checkId.startsWith('social-')) {
    group = 'Indexing';
    groupTag = 'indexing';
  } else if (
    checkId.includes('response-speed') ||
    checkId.includes('ttfb') ||
    checkId.includes('performance')
  ) {
    group = 'Performance';
    groupTag = 'performance';
  } else if (checkId.includes('headers')) {
    group = 'Headers';
    groupTag = 'headers';
  } else if (checkId.includes('bot-accessibility')) {
    group = 'AI Access';
    groupTag = 'ai_access';
  } else {
    // Default to Config for server, Content for pages
    group = level === 'server' ? 'Config' : 'Content';
    groupTag = level === 'server' ? 'config' : 'content';
  }

  return { parentGroup, parentGroupTag, group, groupTag };
}

/**
 * Convert a group name to a tag (lowercase, underscores).
 * Example: "AI Access" -> "ai_access"
 */
export function groupToTag(group: string): string {
  return group.toLowerCase().replace(/\s+/g, '_');
}

/**
 * Get display name for a group.
 * Example: "ai_access" -> "AI Access"
 */
export const GROUP_DISPLAY_NAMES: Record<string, string> = {
  config: 'Configuration',
  ai_access: 'AI Bot Access',
  headers: 'HTTP Headers',
  indexing: 'Search Indexing',
  performance: 'Performance',
  content: 'Content',
};

export function getGroupDisplayName(groupTag: string): string {
  return GROUP_DISPLAY_NAMES[groupTag] || groupTag;
}

/**
 * Get all unique groups for a given parent (server or pages).
 */
export function getGroupsForParent(parentGroupTag: ParentGroupTag): CheckGroup[] {
  if (parentGroupTag === 'server') {
    return Object.values(SERVER_GROUPS);
  }
  return Object.values(PAGE_GROUPS);
}

/**
 * Order for displaying groups (for sorting).
 */
export const GROUP_DISPLAY_ORDER: Record<string, number> = {
  config: 1,
  ai_access: 2,
  headers: 3,
  indexing: 4,
  performance: 5,
  content: 1, // Content first for pages
};

export function getGroupOrder(groupTag: string): number {
  return GROUP_DISPLAY_ORDER[groupTag] ?? 99;
}
