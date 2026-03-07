/**
 * Smoke render tests for Memory page.
 * Mocks api hooks and repo-context to render without crashes.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

// ─── Mock modules ───────────────────────────────────────────────

const mockUseRepositories = vi.fn();
const mockUseMemorySessions = vi.fn();
const mockUseObservations = vi.fn();

vi.mock('@/lib/api', () => ({
  useRepositories: () => mockUseRepositories(),
  useMemorySessions: () => mockUseMemorySessions(),
  useObservations: () => mockUseObservations(),
}));

const mockUseSelectedRepo = vi.fn();

vi.mock('@/lib/repo-context', () => ({
  useSelectedRepo: () => mockUseSelectedRepo(),
}));

// Import after mocks
import { Memory } from './Memory';

// ─── Helpers ────────────────────────────────────────────────────

function createTestQueryClient() {
  return new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
}

function renderMemory() {
  const queryClient = createTestQueryClient();
  return render(
    <QueryClientProvider client={queryClient}>
      <Memory />
    </QueryClientProvider>,
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
  mockUseMemorySessions.mockReturnValue({ data: undefined, isLoading: false });
  mockUseObservations.mockReturnValue({ data: undefined, isLoading: false });
});

// ═══════════════════════════════════════════════════════════════════
// Memory page
// ═══════════════════════════════════════════════════════════════════

describe('Memory page', () => {
  it('renders without crashing (no repo selected)', () => {
    renderMemory();

    expect(screen.getByText('Memory')).toBeInTheDocument();
    expect(screen.getByText('Select a Repository')).toBeInTheDocument();
  });

  it('renders session list when repo is selected', () => {
    mockUseSelectedRepo.mockReturnValue({
      selectedRepo: 'acme/app',
      setSelectedRepo: vi.fn(),
    });
    mockUseMemorySessions.mockReturnValue({
      data: [
        {
          id: 1,
          project: 'acme/app',
          prNumber: 42,
          summary: 'Learned async patterns',
          createdAt: '2026-01-01T00:00:00Z',
          observationCount: 5,
        },
      ],
      isLoading: false,
    });

    renderMemory();

    expect(screen.getByText('PR #42')).toBeInTheDocument();
    expect(screen.getByText('Learned async patterns')).toBeInTheDocument();
    expect(screen.getByText('5 obs')).toBeInTheDocument();
  });
});
