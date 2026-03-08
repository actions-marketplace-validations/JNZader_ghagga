/**
 * Plugin registry initialization.
 *
 * Imports all tool plugins and registers them with the singleton toolRegistry.
 * Call `initializeDefaultTools()` to populate the registry.
 *
 * Phase 2: semgrep, trivy, cpd (always-on)
 * Phase 3+: additional plugins will be added here.
 */

import { toolRegistry } from '../registry.js';
import { cpdPlugin } from './cpd.js';
import { semgrepPlugin } from './semgrep.js';
import { trivyPlugin } from './trivy.js';

/** All built-in plugins. Grows as more phases are implemented. */
const DEFAULT_PLUGINS = [semgrepPlugin, trivyPlugin, cpdPlugin];

let initialized = false;

/**
 * Register all default tool plugins with the registry.
 * Safe to call multiple times — only registers once.
 */
export function initializeDefaultTools(): void {
  if (initialized) return;

  for (const plugin of DEFAULT_PLUGINS) {
    toolRegistry.register(plugin);
  }

  initialized = true;
}

/**
 * Reset the initialization flag (for tests).
 * @internal
 */
export function resetInitialization(): void {
  initialized = false;
}

// Re-export plugins for direct access
export { cpdPlugin } from './cpd.js';
export { semgrepPlugin } from './semgrep.js';
export { trivyPlugin } from './trivy.js';
