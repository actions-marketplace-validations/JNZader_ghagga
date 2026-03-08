/**
 * Tool Registry — central registration point for all static analysis tools.
 *
 * Plugins register themselves via `toolRegistry.register()`.
 * The orchestrator discovers tools through `toolRegistry.getAll()`.
 *
 * Singleton pattern: one registry per process, populated at import time
 * by `plugins/index.ts`.
 */

import type { ToolDefinition, ToolTier } from './types.js';

export class ToolRegistry {
  private tools = new Map<string, ToolDefinition>();

  /**
   * Register a tool definition.
   * Validates that auto-detect tools have a detect function.
   * Throws on duplicate name registration.
   */
  register(tool: ToolDefinition): void {
    if (this.tools.has(tool.name)) {
      throw new Error(`Tool "${tool.name}" is already registered`);
    }

    if (tool.tier === 'auto-detect' && typeof tool.detect !== 'function') {
      throw new Error(
        `Tool "${tool.name}" has tier "auto-detect" but no detect function. ` +
          'Auto-detect tools must provide a detect(files) function.',
      );
    }

    this.tools.set(tool.name, tool);
  }

  /** Get all registered tools */
  getAll(): ToolDefinition[] {
    return Array.from(this.tools.values());
  }

  /** Get tool by name, or undefined */
  getByName(name: string): ToolDefinition | undefined {
    return this.tools.get(name);
  }

  /** Get tools by tier */
  getByTier(tier: ToolTier): ToolDefinition[] {
    return this.getAll().filter((t) => t.tier === tier);
  }

  /** Get registered tool count */
  get size(): number {
    return this.tools.size;
  }

  /** Validate all registrations (called once at startup) */
  validateAll(): void {
    for (const tool of this.tools.values()) {
      if (tool.tier === 'auto-detect' && typeof tool.detect !== 'function') {
        throw new Error(
          `Validation failed: tool "${tool.name}" is auto-detect but has no detect function`,
        );
      }
    }
  }

  /**
   * Clear all registrations (useful for tests).
   * @internal
   */
  clear(): void {
    this.tools.clear();
  }
}

/** Singleton registry instance — populated by plugins/index.ts */
export const toolRegistry = new ToolRegistry();
