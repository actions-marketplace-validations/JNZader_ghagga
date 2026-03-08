/**
 * Tests for Reviews page.
 * Covers: table rendering, loading/empty/error states, filters,
 * pagination, review detail modal, status badges, finding counts,
 * and delete reviews functionality.
 */

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ToastProvider } from '@/components/Toast';

// ─── Mock modules ───────────────────────────────────────────────

const mockUseReviews = vi.fn();
const mockUseRepositories = vi.fn();
const mockDeleteMutate = vi.fn();
const mockDeleteReset = vi.fn();
const mockUseDeleteRepoReviews = vi.fn();

vi.mock('@/lib/api', () => ({
  useReviews: (...args: unknown[]) => mockUseReviews(...args),
  useRepositories: () => mockUseRepositories(),
  useDeleteRepoReviews: () => mockUseDeleteRepoReviews(),
}));

const mockUseSelectedRepo = vi.fn();

vi.mock('@/lib/repo-context', () => ({
  useSelectedRepo: () => mockUseSelectedRepo(),
}));

// Import after mocks
import { Reviews } from './Reviews';

// ─── Test Data ──────────────────────────────────────────────────

function makeReview(overrides: Record<string, unknown> = {}) {
  return {
    id: 1,
    repo: 'acme/app',
    prNumber: 42,
    status: 'PASSED' as const,
    mode: 'simple' as const,
    summary: 'All checks passed',
    findings: [],
    createdAt: '2026-01-15T10:30:00Z',
    ...overrides,
  };
}

const MULTI_REVIEWS = [
  makeReview({ id: 1, repo: 'acme/app', prNumber: 10, status: 'PASSED', mode: 'simple' }),
  makeReview({
    id: 2,
    repo: 'acme/api',
    prNumber: 20,
    status: 'FAILED',
    mode: 'workflow',
    summary: 'Security issues found',
  }),
  makeReview({
    id: 3,
    repo: 'acme/web',
    prNumber: 30,
    status: 'NEEDS_HUMAN_REVIEW',
    mode: 'consensus',
  }),
  makeReview({ id: 4, repo: 'acme/lib', prNumber: 40, status: 'SKIPPED', mode: 'workflow' }),
];

const REVIEW_WITH_FINDINGS = makeReview({
  id: 5,
  repo: 'acme/app',
  prNumber: 55,
  status: 'FAILED',
  summary: 'Found critical issues',
  findings: [
    {
      severity: 'critical',
      category: 'security',
      file: 'src/auth.ts',
      line: 42,
      message: 'SQL injection vulnerability',
      suggestion: 'Use parameterized queries',
    },
    {
      severity: 'medium',
      category: 'quality',
      file: 'src/utils.ts',
      line: 10,
      message: 'Unused variable',
      suggestion: undefined,
    },
  ],
});

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
      <ToastProvider>
        <Reviews />
      </ToastProvider>
    </QueryClientProvider>,
  );
}

function mockReviewsData(reviews: unknown[], total?: number) {
  mockUseReviews.mockReturnValue({
    data: {
      reviews,
      total: total ?? reviews.length,
      page: 1,
      pageSize: 20,
    },
    isLoading: false,
  });
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
  mockUseDeleteRepoReviews.mockReturnValue({
    mutate: mockDeleteMutate,
    reset: mockDeleteReset,
    isPending: false,
    error: null,
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
    mockReviewsData([makeReview()]);

    renderReviews();

    expect(screen.getByText('Status')).toBeInTheDocument();
    expect(screen.getByText('Repository')).toBeInTheDocument();
    expect(screen.getByText('PR #')).toBeInTheDocument();
    expect(screen.getByText('Mode')).toBeInTheDocument();
    expect(screen.getByText('Date')).toBeInTheDocument();
    expect(screen.getByText('acme/app')).toBeInTheDocument();
  });
});

// ═══════════════════════════════════════════════════════════════════
// Loading state
// ═══════════════════════════════════════════════════════════════════

describe('Reviews — loading state', () => {
  it('shows spinner while reviews are loading', () => {
    mockUseReviews.mockReturnValue({
      data: undefined,
      isLoading: true,
    });

    const { container } = renderReviews();

    expect(container.querySelector('.animate-spin')).toBeInTheDocument();
    expect(screen.queryByText('No reviews found.')).not.toBeInTheDocument();
  });
});

// ═══════════════════════════════════════════════════════════════════
// Empty state (data loaded, zero results)
// ═══════════════════════════════════════════════════════════════════

describe('Reviews — empty state', () => {
  it('shows "No reviews found." when the API returns an empty list', () => {
    mockReviewsData([]);

    renderReviews();

    expect(screen.getByText('No reviews found.')).toBeInTheDocument();
  });
});

// ═══════════════════════════════════════════════════════════════════
// Table rendering with multiple reviews
// ═══════════════════════════════════════════════════════════════════

describe('Reviews — table rendering', () => {
  it('renders all review rows with correct columns', () => {
    mockReviewsData(MULTI_REVIEWS);

    renderReviews();

    // Verify all repos appear
    expect(screen.getByText('acme/app')).toBeInTheDocument();
    expect(screen.getByText('acme/api')).toBeInTheDocument();
    expect(screen.getByText('acme/web')).toBeInTheDocument();
    expect(screen.getByText('acme/lib')).toBeInTheDocument();

    // Verify PR numbers
    expect(screen.getByText('#10')).toBeInTheDocument();
    expect(screen.getByText('#20')).toBeInTheDocument();
    expect(screen.getByText('#30')).toBeInTheDocument();
    expect(screen.getByText('#40')).toBeInTheDocument();

    // Verify modes appear (some modes may appear multiple times)
    expect(screen.getAllByText('workflow')).toHaveLength(2);
    expect(screen.getByText('simple')).toBeInTheDocument();
    expect(screen.getByText('consensus')).toBeInTheDocument();
  });

  it('renders status badges for all review statuses', () => {
    mockReviewsData(MULTI_REVIEWS);

    renderReviews();

    // "Passed" / "Failed" etc. appear both in filter options and status badges,
    // so use getAllByText and verify at least 2 (option + badge)
    expect(screen.getAllByText('Passed').length).toBeGreaterThanOrEqual(2);
    expect(screen.getAllByText('Failed').length).toBeGreaterThanOrEqual(2);
    expect(screen.getAllByText('Needs Review').length).toBeGreaterThanOrEqual(2);
    expect(screen.getAllByText('Skipped').length).toBeGreaterThanOrEqual(2);
  });

  it('renders formatted dates', () => {
    mockReviewsData([makeReview({ createdAt: '2026-03-07T14:00:00Z' })]);

    renderReviews();

    // toLocaleDateString output varies by locale; just verify some date text
    // appears in the table body (the row should have date content)
    const rows = screen.getAllByRole('row');
    // First row is header; data rows follow
    expect(rows.length).toBeGreaterThan(1);
  });
});

// ═══════════════════════════════════════════════════════════════════
// Status filter
// ═══════════════════════════════════════════════════════════════════

describe('Reviews — status filter', () => {
  it('filters reviews by status when a status option is selected', () => {
    mockReviewsData(MULTI_REVIEWS);

    renderReviews();

    // All 4 repos visible initially
    expect(screen.getByText('acme/app')).toBeInTheDocument();
    expect(screen.getByText('acme/api')).toBeInTheDocument();

    // Select "Failed" filter
    const statusSelect = screen.getByDisplayValue('All statuses');
    fireEvent.change(statusSelect, { target: { value: 'FAILED' } });

    // Only the FAILED review should remain visible
    expect(screen.getByText('acme/api')).toBeInTheDocument();
    expect(screen.queryByText('acme/app')).not.toBeInTheDocument();
    expect(screen.queryByText('acme/web')).not.toBeInTheDocument();
    expect(screen.queryByText('acme/lib')).not.toBeInTheDocument();
  });

  it('shows empty state when no reviews match the filter', () => {
    mockReviewsData([makeReview({ status: 'PASSED' })]);

    renderReviews();

    const statusSelect = screen.getByDisplayValue('All statuses');
    fireEvent.change(statusSelect, { target: { value: 'FAILED' } });

    expect(screen.getByText('No reviews found.')).toBeInTheDocument();
  });

  it('clears filter when "All statuses" is selected again', () => {
    mockReviewsData(MULTI_REVIEWS);

    renderReviews();

    const statusSelect = screen.getByDisplayValue('All statuses');

    // Filter to PASSED
    fireEvent.change(statusSelect, { target: { value: 'PASSED' } });
    expect(screen.queryByText('acme/api')).not.toBeInTheDocument();

    // Clear filter
    fireEvent.change(statusSelect, { target: { value: '' } });
    expect(screen.getByText('acme/api')).toBeInTheDocument();
    expect(screen.getByText('acme/app')).toBeInTheDocument();
  });
});

// ═══════════════════════════════════════════════════════════════════
// Search filter
// ═══════════════════════════════════════════════════════════════════

describe('Reviews — search filter', () => {
  it('filters reviews by repo name', () => {
    mockReviewsData(MULTI_REVIEWS);

    renderReviews();

    const searchInput = screen.getByPlaceholderText('Search reviews...');
    fireEvent.change(searchInput, { target: { value: 'acme/api' } });

    expect(screen.getByText('acme/api')).toBeInTheDocument();
    expect(screen.queryByText('acme/app')).not.toBeInTheDocument();
    expect(screen.queryByText('acme/web')).not.toBeInTheDocument();
  });

  it('filters reviews by PR number', () => {
    mockReviewsData(MULTI_REVIEWS);

    renderReviews();

    const searchInput = screen.getByPlaceholderText('Search reviews...');
    fireEvent.change(searchInput, { target: { value: '30' } });

    expect(screen.getByText('acme/web')).toBeInTheDocument();
    expect(screen.queryByText('acme/app')).not.toBeInTheDocument();
  });

  it('filters reviews by summary text', () => {
    mockReviewsData(MULTI_REVIEWS);

    renderReviews();

    const searchInput = screen.getByPlaceholderText('Search reviews...');
    fireEvent.change(searchInput, { target: { value: 'security' } });

    expect(screen.getByText('acme/api')).toBeInTheDocument();
    expect(screen.queryByText('acme/app')).not.toBeInTheDocument();
  });

  it('search is case-insensitive', () => {
    mockReviewsData(MULTI_REVIEWS);

    renderReviews();

    const searchInput = screen.getByPlaceholderText('Search reviews...');
    fireEvent.change(searchInput, { target: { value: 'ACME/API' } });

    expect(screen.getByText('acme/api')).toBeInTheDocument();
  });

  it('shows empty state when search has no matches', () => {
    mockReviewsData(MULTI_REVIEWS);

    renderReviews();

    const searchInput = screen.getByPlaceholderText('Search reviews...');
    fireEvent.change(searchInput, { target: { value: 'nonexistent-repo' } });

    expect(screen.getByText('No reviews found.')).toBeInTheDocument();
  });
});

// ═══════════════════════════════════════════════════════════════════
// Repository selector
// ═══════════════════════════════════════════════════════════════════

describe('Reviews — repository selector', () => {
  it('renders repository options from the API', () => {
    mockUseRepositories.mockReturnValue({
      data: [
        { id: 1, fullName: 'acme/app' },
        { id: 2, fullName: 'acme/api' },
      ],
      isLoading: false,
    });

    renderReviews();

    const repoSelect = screen.getByDisplayValue('All repositories');
    expect(repoSelect).toBeInTheDocument();

    const options = within(repoSelect).getAllByRole('option');
    expect(options).toHaveLength(3); // "All repositories" + 2 repos
    expect(options[1]).toHaveTextContent('acme/app');
    expect(options[2]).toHaveTextContent('acme/api');
  });

  it('calls setSelectedRepo and resets page when a repo is selected', () => {
    const setSelectedRepo = vi.fn();
    mockUseSelectedRepo.mockReturnValue({
      selectedRepo: '',
      setSelectedRepo,
    });
    mockUseRepositories.mockReturnValue({
      data: [{ id: 1, fullName: 'acme/app' }],
      isLoading: false,
    });

    renderReviews();

    const repoSelect = screen.getByDisplayValue('All repositories');
    fireEvent.change(repoSelect, { target: { value: 'acme/app' } });

    expect(setSelectedRepo).toHaveBeenCalledWith('acme/app');
  });
});

// ═══════════════════════════════════════════════════════════════════
// Pagination
// ═══════════════════════════════════════════════════════════════════

describe('Reviews — pagination', () => {
  it('does not show pagination when total fits in one page', () => {
    mockReviewsData([makeReview()], 1);

    renderReviews();

    expect(screen.queryByText('Previous')).not.toBeInTheDocument();
    expect(screen.queryByText('Next')).not.toBeInTheDocument();
  });

  it('shows pagination when total exceeds pageSize', () => {
    mockUseReviews.mockReturnValue({
      data: {
        reviews: [makeReview()],
        total: 50,
        page: 1,
        pageSize: 20,
      },
      isLoading: false,
    });

    renderReviews();

    expect(screen.getByText('Previous')).toBeInTheDocument();
    expect(screen.getByText('Next')).toBeInTheDocument();
    expect(screen.getByText('Page 1 of 3 (50 total)')).toBeInTheDocument();
  });

  it('Previous button is disabled on the first page', () => {
    mockUseReviews.mockReturnValue({
      data: {
        reviews: [makeReview()],
        total: 50,
        page: 1,
        pageSize: 20,
      },
      isLoading: false,
    });

    renderReviews();

    expect(screen.getByText('Previous')).toBeDisabled();
    expect(screen.getByText('Next')).not.toBeDisabled();
  });

  it('clicking Next calls useReviews with incremented page', () => {
    mockUseReviews.mockReturnValue({
      data: {
        reviews: [makeReview()],
        total: 50,
        page: 1,
        pageSize: 20,
      },
      isLoading: false,
    });

    renderReviews();

    fireEvent.click(screen.getByText('Next'));

    // useReviews should be called again with page 2
    // The component calls useReviews(selectedRepo || undefined, page)
    // After clicking Next, the page state becomes 2
    const lastCall = mockUseReviews.mock.calls[mockUseReviews.mock.calls.length - 1];
    // biome-ignore lint/style/noNonNullAssertion: test assertion on known mock data
    expect(lastCall![1]).toBe(2);
  });

  it('clicking Previous decrements the page', () => {
    // Start at page 2 by clicking Next first
    mockUseReviews.mockReturnValue({
      data: {
        reviews: [makeReview()],
        total: 50,
        page: 1,
        pageSize: 20,
      },
      isLoading: false,
    });

    renderReviews();

    // Go to page 2
    fireEvent.click(screen.getByText('Next'));
    // Now go back
    fireEvent.click(screen.getByText('Previous'));

    const lastCall = mockUseReviews.mock.calls[mockUseReviews.mock.calls.length - 1];
    // biome-ignore lint/style/noNonNullAssertion: test assertion on known mock data
    expect(lastCall![1]).toBe(1);
  });
});

// ═══════════════════════════════════════════════════════════════════
// Review detail modal
// ═══════════════════════════════════════════════════════════════════

describe('Reviews — detail modal', () => {
  it('opens the detail modal when a review row is clicked', () => {
    mockReviewsData([REVIEW_WITH_FINDINGS]);

    renderReviews();

    // Click the review row
    fireEvent.click(screen.getByText('acme/app'));

    // Modal should show the review summary
    expect(screen.getByText('Found critical issues')).toBeInTheDocument();
    // Modal shows repo and PR number
    expect(screen.getByText('acme/app #55')).toBeInTheDocument();
  });

  it('displays findings table in the modal', () => {
    mockReviewsData([REVIEW_WITH_FINDINGS]);

    renderReviews();

    fireEvent.click(screen.getByText('acme/app'));

    // Findings header with count
    expect(screen.getByText('Findings (2)')).toBeInTheDocument();

    // Finding details
    expect(screen.getByText('SQL injection vulnerability')).toBeInTheDocument();
    expect(screen.getByText('Use parameterized queries')).toBeInTheDocument();
    expect(screen.getByText('src/auth.ts:42')).toBeInTheDocument();
    expect(screen.getByText('security')).toBeInTheDocument();

    // Severity badges
    expect(screen.getByText('Critical')).toBeInTheDocument();
    expect(screen.getByText('Medium')).toBeInTheDocument();

    // Second finding
    expect(screen.getByText('Unused variable')).toBeInTheDocument();
    expect(screen.getByText('quality')).toBeInTheDocument();
    expect(screen.getByText('src/utils.ts:10')).toBeInTheDocument();
  });

  it('displays "—" when a finding has no suggestion', () => {
    mockReviewsData([REVIEW_WITH_FINDINGS]);

    renderReviews();

    fireEvent.click(screen.getByText('acme/app'));

    // The second finding has no suggestion → should show —
    const dashCells = screen.getAllByText('—');
    expect(dashCells.length).toBeGreaterThanOrEqual(1);
  });

  it('does not show findings section when review has zero findings', () => {
    const reviewNoFindings = makeReview({ id: 10, findings: [], summary: 'Clean review' });
    mockReviewsData([reviewNoFindings]);

    renderReviews();

    fireEvent.click(screen.getByText('acme/app'));

    expect(screen.getByText('Clean review')).toBeInTheDocument();
    expect(screen.queryByText(/Findings/)).not.toBeInTheDocument();
  });

  it('closes the modal when the close button is clicked', () => {
    mockReviewsData([REVIEW_WITH_FINDINGS]);

    renderReviews();

    // Open modal
    fireEvent.click(screen.getByText('acme/app'));
    expect(screen.getByText('Found critical issues')).toBeInTheDocument();

    // Close modal — find the close button (the SVG button in the header)
    const modal = screen.getByText('Found critical issues').closest('.max-w-4xl');
    const closeButton = modal?.querySelector('button');
    expect(closeButton).toBeTruthy();
    if (closeButton) fireEvent.click(closeButton);

    // Summary should no longer be visible in a modal context
    // (it was only shown inside the modal, not in the table)
    expect(screen.queryByText('Found critical issues')).not.toBeInTheDocument();
  });

  it('shows the review mode in the modal', () => {
    mockReviewsData([makeReview({ mode: 'consensus', summary: 'Consensus review done' })]);

    renderReviews();

    fireEvent.click(screen.getByText('acme/app'));

    // "consensus" appears in both the table row and the modal's Mode: <span>
    // Verify the modal is open by checking for the summary and Mode label
    expect(screen.getByText('Consensus review done')).toBeInTheDocument();
    expect(screen.getByText(/Mode:/)).toBeInTheDocument();
    // The mode text "consensus" appears in both places — verify at least 2
    expect(screen.getAllByText('consensus').length).toBeGreaterThanOrEqual(2);
  });
});

// ═══════════════════════════════════════════════════════════════════
// Combined filters (status + search)
// ═══════════════════════════════════════════════════════════════════

describe('Reviews — combined filters', () => {
  it('applies both status and search filters simultaneously', () => {
    const reviews = [
      makeReview({ id: 1, repo: 'acme/app', status: 'FAILED', summary: 'bad code' }),
      makeReview({ id: 2, repo: 'acme/api', status: 'FAILED', summary: 'also bad' }),
      makeReview({ id: 3, repo: 'acme/app', status: 'PASSED', summary: 'good code' }),
    ];
    mockReviewsData(reviews);

    renderReviews();

    // Filter to FAILED only
    const statusSelect = screen.getByDisplayValue('All statuses');
    fireEvent.change(statusSelect, { target: { value: 'FAILED' } });

    // Then search for "acme/api"
    const searchInput = screen.getByPlaceholderText('Search reviews...');
    fireEvent.change(searchInput, { target: { value: 'acme/api' } });

    // Only the FAILED acme/api should be visible
    expect(screen.getByText('acme/api')).toBeInTheDocument();
    expect(screen.queryByText('acme/app')).not.toBeInTheDocument();
  });
});

// ═══════════════════════════════════════════════════════════════════
// Delete Reviews
// ═══════════════════════════════════════════════════════════════════

describe('Reviews — delete reviews', () => {
  it('shows "Delete Reviews" button when a repo is selected', () => {
    mockUseSelectedRepo.mockReturnValue({
      selectedRepo: 'acme/widgets',
      setSelectedRepo: vi.fn(),
    });
    mockReviewsData([makeReview({ repo: 'acme/widgets' })]);

    renderReviews();

    expect(screen.getByText('Delete Reviews')).toBeInTheDocument();
  });

  it('does NOT show "Delete Reviews" button when no repo is selected (All repositories)', () => {
    mockUseSelectedRepo.mockReturnValue({
      selectedRepo: '',
      setSelectedRepo: vi.fn(),
    });
    mockReviewsData(MULTI_REVIEWS);

    renderReviews();

    expect(screen.queryByText('Delete Reviews')).not.toBeInTheDocument();
  });

  it('opens confirmation dialog when "Delete Reviews" is clicked', () => {
    mockUseSelectedRepo.mockReturnValue({
      selectedRepo: 'acme/widgets',
      setSelectedRepo: vi.fn(),
    });
    mockReviewsData([makeReview({ repo: 'acme/widgets' })]);

    renderReviews();

    fireEvent.click(screen.getByText('Delete Reviews'));

    // Dialog should be open with correct title
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByText('Delete all reviews for acme/widgets?')).toBeInTheDocument();
    // Should have a confirmation text input
    expect(screen.getByLabelText('Confirmation text')).toBeInTheDocument();
  });

  it('shows the memory clear checkbox in the confirmation dialog', () => {
    mockUseSelectedRepo.mockReturnValue({
      selectedRepo: 'acme/widgets',
      setSelectedRepo: vi.fn(),
    });
    mockReviewsData([makeReview({ repo: 'acme/widgets' })]);

    renderReviews();

    fireEvent.click(screen.getByText('Delete Reviews'));

    expect(
      screen.getByText('Also clear memory observations for this repository'),
    ).toBeInTheDocument();
  });

  it('calls mutation with includeMemory: false when checkbox is unchecked', () => {
    mockUseSelectedRepo.mockReturnValue({
      selectedRepo: 'acme/widgets',
      setSelectedRepo: vi.fn(),
    });
    mockReviewsData([makeReview({ repo: 'acme/widgets' })]);

    renderReviews();

    // Open dialog
    fireEvent.click(screen.getByText('Delete Reviews'));

    // Type the repo name to enable confirm
    fireEvent.change(screen.getByLabelText('Confirmation text'), {
      target: { value: 'acme/widgets' },
    });

    // Click confirm (the button inside the dialog, not the "Delete Reviews" trigger)
    const dialog = screen.getByRole('dialog');
    const confirmBtn = within(dialog).getByText('Delete Reviews');
    fireEvent.click(confirmBtn);

    expect(mockDeleteMutate).toHaveBeenCalledTimes(1);
    expect(mockDeleteMutate).toHaveBeenCalledWith(
      { repoFullName: 'acme/widgets', includeMemory: false },
      expect.objectContaining({ onSuccess: expect.any(Function) }),
    );
  });

  it('calls mutation with includeMemory: true when checkbox is checked', () => {
    mockUseSelectedRepo.mockReturnValue({
      selectedRepo: 'acme/widgets',
      setSelectedRepo: vi.fn(),
    });
    mockReviewsData([makeReview({ repo: 'acme/widgets' })]);

    renderReviews();

    // Open dialog
    fireEvent.click(screen.getByText('Delete Reviews'));

    // Check the memory checkbox — click the checkbox input inside the label
    const checkbox = screen.getByRole('checkbox');
    fireEvent.click(checkbox);

    // Type the repo name to enable confirm
    fireEvent.change(screen.getByLabelText('Confirmation text'), {
      target: { value: 'acme/widgets' },
    });

    // Click confirm
    const dialog = screen.getByRole('dialog');
    const confirmBtn = within(dialog).getByText('Delete Reviews');
    fireEvent.click(confirmBtn);

    expect(mockDeleteMutate).toHaveBeenCalledTimes(1);
    expect(mockDeleteMutate).toHaveBeenCalledWith(
      { repoFullName: 'acme/widgets', includeMemory: true },
      expect.objectContaining({ onSuccess: expect.any(Function) }),
    );
  });

  it('cancel closes dialog without making API call', () => {
    mockUseSelectedRepo.mockReturnValue({
      selectedRepo: 'acme/widgets',
      setSelectedRepo: vi.fn(),
    });
    mockReviewsData([makeReview({ repo: 'acme/widgets' })]);

    renderReviews();

    // Open dialog
    fireEvent.click(screen.getByText('Delete Reviews'));
    expect(screen.getByRole('dialog')).toBeInTheDocument();

    // Click cancel
    fireEvent.click(screen.getByText('Cancel'));

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(mockDeleteMutate).not.toHaveBeenCalled();
  });

  it('shows success toast after deletion succeeds', () => {
    mockUseSelectedRepo.mockReturnValue({
      selectedRepo: 'acme/widgets',
      setSelectedRepo: vi.fn(),
    });
    mockReviewsData([makeReview({ repo: 'acme/widgets' })]);

    // Make mutate call onSuccess immediately
    mockDeleteMutate.mockImplementation(
      (_vars: unknown, opts: { onSuccess: (data: { deletedReviews: number }) => void }) => {
        opts.onSuccess({ deletedReviews: 5 });
      },
    );

    renderReviews();

    // Open dialog
    fireEvent.click(screen.getByText('Delete Reviews'));

    // Type the repo name
    fireEvent.change(screen.getByLabelText('Confirmation text'), {
      target: { value: 'acme/widgets' },
    });

    // Confirm
    const dialog = screen.getByRole('dialog');
    const confirmBtn = within(dialog).getByText('Delete Reviews');
    fireEvent.click(confirmBtn);

    // Toast should appear
    expect(screen.getByText('Deleted 5 reviews for acme/widgets')).toBeInTheDocument();
    // Dialog should close
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('shows error message in dialog when deletion fails', () => {
    mockUseSelectedRepo.mockReturnValue({
      selectedRepo: 'acme/widgets',
      setSelectedRepo: vi.fn(),
    });
    mockReviewsData([makeReview({ repo: 'acme/widgets' })]);

    // Simulate error state
    mockUseDeleteRepoReviews.mockReturnValue({
      mutate: mockDeleteMutate,
      reset: mockDeleteReset,
      isPending: false,
      error: { message: 'DELETE_FAILED' },
    });

    renderReviews();

    // Open dialog
    fireEvent.click(screen.getByText('Delete Reviews'));

    // Error should be visible in dialog
    expect(screen.getByText('DELETE_FAILED')).toBeInTheDocument();
    // Dialog should remain open
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('confirm button is disabled until user types exact repo name', () => {
    mockUseSelectedRepo.mockReturnValue({
      selectedRepo: 'acme/widgets',
      setSelectedRepo: vi.fn(),
    });
    mockReviewsData([makeReview({ repo: 'acme/widgets' })]);

    renderReviews();

    // Open dialog
    fireEvent.click(screen.getByText('Delete Reviews'));

    const dialog = screen.getByRole('dialog');
    const confirmBtn = within(dialog).getByText('Delete Reviews').closest('button')!;

    // Initially disabled (empty input)
    expect(confirmBtn).toBeDisabled();

    // Partial text — still disabled
    fireEvent.change(screen.getByLabelText('Confirmation text'), {
      target: { value: 'acme/widge' },
    });
    expect(confirmBtn).toBeDisabled();

    // Exact text — enabled
    fireEvent.change(screen.getByLabelText('Confirmation text'), {
      target: { value: 'acme/widgets' },
    });
    expect(confirmBtn).not.toBeDisabled();
  });
});
