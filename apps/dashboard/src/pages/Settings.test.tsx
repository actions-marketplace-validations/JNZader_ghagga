/**
 * Smoke render tests for Settings page.
 * Mocks api hooks and repo-context to render without crashes.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

// ─── Mock modules ───────────────────────────────────────────────

const mockUseRepositories = vi.fn();
const mockUseSettings = vi.fn();
const mockUseUpdateSettings = vi.fn();

vi.mock('@/lib/api', () => ({
  useRepositories: () => mockUseRepositories(),
  useSettings: () => mockUseSettings(),
  useUpdateSettings: () => mockUseUpdateSettings(),
}));

const mockUseSelectedRepo = vi.fn();

vi.mock('@/lib/repo-context', () => ({
  useSelectedRepo: () => mockUseSelectedRepo(),
}));

// Mock ProviderChainEditor (complex component not tested here)
vi.mock('@/components/settings/ProviderChainEditor', () => ({
  ProviderChainEditor: () => <div data-testid="provider-chain-editor" />,
}));

// Import after mocks
import { Settings } from './Settings';

// ─── Helpers ────────────────────────────────────────────────────

function createTestQueryClient() {
  return new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
}

function renderSettings() {
  const queryClient = createTestQueryClient();
  return render(
    <MemoryRouter>
      <QueryClientProvider client={queryClient}>
        <Settings />
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

// ─── Setup ──────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();

  mockUseSelectedRepo.mockReturnValue({
    selectedRepo: '',
    setSelectedRepo: vi.fn(),
  });
  mockUseRepositories.mockReturnValue({ data: [], isLoading: false });
  mockUseSettings.mockReturnValue({ data: undefined, isLoading: false });
  mockUseUpdateSettings.mockReturnValue({
    mutateAsync: vi.fn(),
    isPending: false,
    isError: false,
  });
});

// ═══════════════════════════════════════════════════════════════════
// Settings page
// ═══════════════════════════════════════════════════════════════════

describe('Settings page', () => {
  it('renders without crashing (no repo selected)', () => {
    renderSettings();

    expect(screen.getByText('Repository Settings')).toBeInTheDocument();
    expect(screen.getByText('Select a Repository')).toBeInTheDocument();
  });

  it('renders form with defaults when repo and settings are loaded', () => {
    mockUseSelectedRepo.mockReturnValue({
      selectedRepo: 'acme/app',
      setSelectedRepo: vi.fn(),
    });
    mockUseSettings.mockReturnValue({
      data: {
        repoId: 1,
        repoFullName: 'acme/app',
        useGlobalSettings: false,
        aiReviewEnabled: true,
        providerChain: [],
        reviewMode: 'simple',
        enableSemgrep: true,
        enableTrivy: true,
        enableCpd: false,
        enableMemory: true,
        customRules: '',
        ignorePatterns: [],
      },
      isLoading: false,
    });

    renderSettings();

    expect(screen.getByText('Repository Settings')).toBeInTheDocument();
    expect(screen.getByText('Save Settings')).toBeInTheDocument();
    expect(screen.getByText('Static Analysis')).toBeInTheDocument();
  });
});
