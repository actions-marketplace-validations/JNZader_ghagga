/**
 * Re-export barrel for backward compatibility.
 *
 * The actual route implementations have been split into
 * domain-specific files under ./api/ — see that directory.
 */

export { buildProviderChainView, createApiRouter } from './api/index.js';
