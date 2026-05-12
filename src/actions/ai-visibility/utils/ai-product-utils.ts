/**
 * AI Product Utilities
 *
 * Helper functions for grouping bots by AI products and calculating visibility.
 */

import { AI_USER_AGENTS, AIBotDefinition, AI_PRODUCTS } from '../../../config/ai-user-agents.js';

/**
 * Get all unique AI products
 * @returns Array of AI product names
 */
export function getUniqueAIProducts(): string[] {
  return Object.values(AI_PRODUCTS).map(p => p.name);
}

/**
 * Get AI product metadata by name
 * @param productName - Name of the AI product
 * @returns AI product metadata with name and URL, or undefined if not found
 */
export function getProductMetadata(productName: string): { name: string; url: string } | undefined {
  if (!productName || typeof productName !== 'string') {
    return undefined;
  }

  const product = Object.values(AI_PRODUCTS).find(p => p.name === productName);
  return product;
}

/**
 * Get all bots related to a specific AI product
 *
 * @param productName - Name of AI product (e.g., "OpenAI ChatGPT")
 * @returns Array of bot definitions related to this product
 */
export function getBotsForProduct(productName: string): AIBotDefinition[] {
  if (!productName || typeof productName !== 'string') {
    return [];
  }

  return AI_USER_AGENTS.filter(bot => {
    return bot.related_ai_products?.includes(productName) ?? false;
  });
}

/**
 * Calculate AI product visibility from bot check results
 *
 * @param blockedBotNames - Set of bot names that are blocked/inaccessible
 * @returns Map of product name to visibility status
 */
export function calculateProductVisibility(blockedBotNames: Set<string>): Map<string, boolean> {
  const productVisibility = new Map<string, boolean>();
  const products = getUniqueAIProducts();

  for (const product of products) {
    const productBots = getBotsForProduct(product);

    // Product is visible if ANY of its bots is accessible (not blocked)
    const isVisible = productBots.some(bot => !blockedBotNames.has(bot.name));

    productVisibility.set(product, isVisible);
  }

  return productVisibility;
}
