/**
 * Smoke render tests for Reviews page.
 * Mocks api hooks and repo-context to render without crashes.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

// ─── Mock modules ───────────────────────────────────────────────

const mockUseReviews = vi.fn();
const mockUseRepositories = vi.fn();

vi.mock('@/lib/api', () => ({
  useReviews: (...args: unknown[]) => mockUseReviews(...args),
  useRepositories: () => mockUseRepositories(),
}));

const mockUseSelectedRepo = vi.fn();

vi.mock('@/lib/repo-context', () => ({
  useSelectedRepo: () => mockUseSelectedRepo(),
}));

// Import after mocks
import { Reviews } from './Reviews';

// ─── Helpers ────────────────────────────────────────────────────

function createTestQueryClient() {
  return new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
}

function renderReviews() {
  const queryClient = createTestQueryClient();
  return render(
    <QueryClientProvider client={queryClient}>
      <Reviews />
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
  mockUseReviews.mockReturnValue({
    data: undefined,
    isLoading: false,
  });
});

// ═══════════════════════════════════════════════════════════════════
// Reviews page
// ═══════════════════════════════════════════════════════════════════

describe('Reviews page', () => {
  it('renders without crashing (empty state)', () => {
    renderReviews();

    expect(screen.getByText('Reviews')).toBeInTheDocument();
    expect(screen.getByText('No reviews found.')).toBeInTheDocument();
  });

  it('renders table headers when data is loaded', () => {
    mockUseReviews.mockReturnValue({
      data: {
        reviews: [
          {
            id: 1,
            repo: 'acme/app',
            prNumber: 42,
            status: 'PASSED',
            mode: 'simple',
            summary: 'All good',
            findings: [],
            createdAt: '2026-01-01T00:00:00Z',
          },
        ],
        total: 1,
        page: 1,
        pageSize: 20,
      },
      isLoading: false,
    });

    renderReviews();

    expect(screen.getByText('Status')).toBeInTheDocument();
    expect(screen.getByText('Repository')).toBeInTheDocument();
    expect(screen.getByText('PR #')).toBeInTheDocument();
    expect(screen.getByText('Mode')).toBeInTheDocument();
    expect(screen.getByText('Date')).toBeInTheDocument();
    expect(screen.getByText('acme/app')).toBeInTheDocument();
  });
});
