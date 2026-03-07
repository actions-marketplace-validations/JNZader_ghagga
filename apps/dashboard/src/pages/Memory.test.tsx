/**
 * Integration tests for Memory page with management capabilities.
 * Tests delete buttons, confirmation dialogs (all 3 tiers),
 * success/error flows, empty states, and loading states.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ToastProvider } from '@/components/Toast';

// ─── Mock modules ───────────────────────────────────────────────

const mockUseRepositories = vi.fn();
const mockUseMemorySessions = vi.fn();
const mockUseObservations = vi.fn();

const mockDeleteMutate = vi.fn();
const mockClearMutate = vi.fn();
const mockPurgeMutate = vi.fn();

const mockUseDeleteObservation = vi.fn();
const mockUseClearRepoMemory = vi.fn();
const mockUsePurgeAllMemory = vi.fn();

vi.mock('@/lib/api', () => ({
  useRepositories: () => mockUseRepositories(),
  useMemorySessions: () => mockUseMemorySessions(),
  useObservations: () => mockUseObservations(),
  useDeleteObservation: () => mockUseDeleteObservation(),
  useClearRepoMemory: () => mockUseClearRepoMemory(),
  usePurgeAllMemory: () => mockUsePurgeAllMemory(),
  ApiError: class ApiError extends Error {
    status: number;
    constructor(status: number, message: string) {
      super(message);
      this.status = status;
      this.name = 'ApiError';
    }
  },
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
      <ToastProvider>
        <Memory />
      </ToastProvider>
    </QueryClientProvider>,
  );
}

const sampleObservations = [
  {
    id: 42,
    sessionId: 1,
    type: 'pattern' as const,
    title: 'OAuth token refresh patterns',
    content: 'Always check token expiry before making API calls.',
    filePaths: ['src/auth.ts'],
    createdAt: '2026-01-01T00:00:00Z',
  },
  {
    id: 43,
    sessionId: 1,
    type: 'bugfix' as const,
    title: 'Race condition in async handlers',
    content: 'Use mutex pattern for shared resources.',
    filePaths: [],
    createdAt: '2026-01-02T00:00:00Z',
  },
];

const sampleSessions = [
  {
    id: 1,
    project: 'acme/widgets',
    prNumber: 42,
    summary: 'Learned async patterns',
    createdAt: '2026-01-01T00:00:00Z',
    observationCount: 5,
  },
  {
    id: 2,
    project: 'acme/widgets',
    prNumber: 43,
    summary: 'Bug fix patterns',
    createdAt: '2026-01-02T00:00:00Z',
    observationCount: 3,
  },
];

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
  mockUseDeleteObservation.mockReturnValue({
    mutate: mockDeleteMutate,
    isPending: false,
  });
  mockUseClearRepoMemory.mockReturnValue({
    mutate: mockClearMutate,
    isPending: false,
  });
  mockUsePurgeAllMemory.mockReturnValue({
    mutate: mockPurgeMutate,
    isPending: false,
  });
});

// ═══════════════════════════════════════════════════════════════════
// Basic rendering (backward compat)
// ═══════════════════════════════════════════════════════════════════

describe('Memory page — basic rendering', () => {
  it('renders without crashing (no repo selected)', () => {
    renderMemory();

    expect(screen.getByText('Memory')).toBeInTheDocument();
    expect(screen.getByText('Select a Repository')).toBeInTheDocument();
  });

  it('renders session list when repo is selected', () => {
    mockUseSelectedRepo.mockReturnValue({
      selectedRepo: 'acme/widgets',
      setSelectedRepo: vi.fn(),
    });
    mockUseMemorySessions.mockReturnValue({
      data: sampleSessions,
      isLoading: false,
    });

    renderMemory();

    expect(screen.getByText('PR #42')).toBeInTheDocument();
    expect(screen.getByText('Learned async patterns')).toBeInTheDocument();
  });

  it('shows empty state when sessions list is empty', () => {
    mockUseSelectedRepo.mockReturnValue({
      selectedRepo: 'acme/widgets',
      setSelectedRepo: vi.fn(),
    });
    mockUseMemorySessions.mockReturnValue({
      data: [],
      isLoading: false,
    });

    renderMemory();

    expect(
      screen.getByText('No memory stored for this repository.'),
    ).toBeInTheDocument();
  });
});

// ═══════════════════════════════════════════════════════════════════
// Tier 1: Delete single observation
// ═══════════════════════════════════════════════════════════════════

describe('Memory page — Tier 1 (delete observation)', () => {
  beforeEach(() => {
    mockUseSelectedRepo.mockReturnValue({
      selectedRepo: 'acme/widgets',
      setSelectedRepo: vi.fn(),
    });
    mockUseMemorySessions.mockReturnValue({
      data: sampleSessions,
      isLoading: false,
    });
    mockUseObservations.mockReturnValue({
      data: sampleObservations,
      isLoading: false,
    });
  });

  it('renders delete buttons on observation cards when a session is selected', () => {
    renderMemory();

    // Click a session to select it
    fireEvent.click(screen.getByText('PR #42'));

    const deleteButtons = screen.getAllByTitle('Delete observation');
    expect(deleteButtons.length).toBe(2);
  });

  it('opens Tier 1 confirmation dialog when delete is clicked', () => {
    renderMemory();

    fireEvent.click(screen.getByText('PR #42'));

    const deleteButtons = screen.getAllByTitle('Delete observation');
    fireEvent.click(deleteButtons[0]);

    expect(screen.getByText('Delete observation')).toBeInTheDocument();
    expect(
      screen.getByText(
        'Are you sure you want to delete "OAuth token refresh patterns"? This action cannot be undone.',
      ),
    ).toBeInTheDocument();
  });

  it('calls delete mutation when confirm is clicked', () => {
    renderMemory();

    fireEvent.click(screen.getByText('PR #42'));

    const deleteButtons = screen.getAllByTitle('Delete observation');
    fireEvent.click(deleteButtons[0]);

    // Click the "Delete" button in the dialog
    const confirmBtn = screen.getByRole('dialog').querySelector('button:last-child')!;
    fireEvent.click(confirmBtn);

    expect(mockDeleteMutate).toHaveBeenCalledWith(
      { observationId: 42 },
      expect.objectContaining({
        onSuccess: expect.any(Function),
        onError: expect.any(Function),
      }),
    );
  });

  it('closes modal on cancel without making API call', () => {
    renderMemory();

    fireEvent.click(screen.getByText('PR #42'));

    const deleteButtons = screen.getAllByTitle('Delete observation');
    fireEvent.click(deleteButtons[0]);

    // Click cancel
    fireEvent.click(screen.getByText('Cancel'));

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(mockDeleteMutate).not.toHaveBeenCalled();
  });

  it('shows success toast after delete succeeds', () => {
    // Make mutate call the onSuccess immediately
    mockDeleteMutate.mockImplementation(
      (_vars: unknown, opts: { onSuccess: () => void }) => {
        opts.onSuccess();
      },
    );

    renderMemory();

    fireEvent.click(screen.getByText('PR #42'));

    const deleteButtons = screen.getAllByTitle('Delete observation');
    fireEvent.click(deleteButtons[0]);

    const confirmBtn = screen.getByRole('dialog').querySelector('button:last-child')!;
    fireEvent.click(confirmBtn);

    expect(screen.getByText('Observation deleted')).toBeInTheDocument();
  });
});

// ═══════════════════════════════════════════════════════════════════
// Tier 2: Clear repo memory
// ═══════════════════════════════════════════════════════════════════

describe('Memory page — Tier 2 (clear repo memory)', () => {
  beforeEach(() => {
    mockUseSelectedRepo.mockReturnValue({
      selectedRepo: 'acme/widgets',
      setSelectedRepo: vi.fn(),
    });
    mockUseMemorySessions.mockReturnValue({
      data: sampleSessions,
      isLoading: false,
    });
  });

  it('shows "Clear Memory" button when repo is selected', () => {
    renderMemory();

    expect(screen.getByText('Clear Memory')).toBeInTheDocument();
  });

  it('does not show "Clear Memory" button when no repo is selected', () => {
    mockUseSelectedRepo.mockReturnValue({
      selectedRepo: '',
      setSelectedRepo: vi.fn(),
    });

    renderMemory();

    expect(screen.queryByText('Clear Memory')).not.toBeInTheDocument();
  });

  it('opens Tier 2 dialog with text input when Clear Memory is clicked', () => {
    renderMemory();

    fireEvent.click(screen.getByText('Clear Memory'));

    expect(
      screen.getByText('Clear all memory for acme/widgets'),
    ).toBeInTheDocument();
    expect(screen.getByLabelText('Confirmation text')).toBeInTheDocument();
  });

  it('confirm button is disabled until text matches repo name', () => {
    renderMemory();

    fireEvent.click(screen.getByText('Clear Memory'));

    // "Clear Memory" appears as both the trigger button and the dialog confirm label
    const dialogConfirmBtn = screen
      .getByRole('dialog')
      .querySelector('button:last-child')!;
    expect(dialogConfirmBtn).toBeDisabled();

    // Type wrong text
    fireEvent.change(screen.getByLabelText('Confirmation text'), {
      target: { value: 'wrong' },
    });
    expect(dialogConfirmBtn).toBeDisabled();

    // Type correct text
    fireEvent.change(screen.getByLabelText('Confirmation text'), {
      target: { value: 'acme/widgets' },
    });
    expect(dialogConfirmBtn).not.toBeDisabled();
  });

  it('calls clear mutation when confirmed with matching text', () => {
    renderMemory();

    fireEvent.click(screen.getByText('Clear Memory'));

    fireEvent.change(screen.getByLabelText('Confirmation text'), {
      target: { value: 'acme/widgets' },
    });

    const dialogConfirmBtn = screen
      .getByRole('dialog')
      .querySelector('button:last-child')!;
    fireEvent.click(dialogConfirmBtn);

    expect(mockClearMutate).toHaveBeenCalledWith(
      { project: 'acme/widgets' },
      expect.objectContaining({
        onSuccess: expect.any(Function),
        onError: expect.any(Function),
      }),
    );
  });

  it('shows success toast after clear succeeds', () => {
    mockClearMutate.mockImplementation(
      (_vars: unknown, opts: { onSuccess: (data: { cleared: number }) => void }) => {
        opts.onSuccess({ cleared: 15 });
      },
    );

    renderMemory();

    fireEvent.click(screen.getByText('Clear Memory'));

    fireEvent.change(screen.getByLabelText('Confirmation text'), {
      target: { value: 'acme/widgets' },
    });

    const dialogConfirmBtn = screen
      .getByRole('dialog')
      .querySelector('button:last-child')!;
    fireEvent.click(dialogConfirmBtn);

    expect(
      screen.getByText('Cleared 15 observations from acme/widgets'),
    ).toBeInTheDocument();
  });
});

// ═══════════════════════════════════════════════════════════════════
// Tier 3: Purge all memory
// ═══════════════════════════════════════════════════════════════════

describe('Memory page — Tier 3 (purge all memory)', () => {
  beforeEach(() => {
    vi.useFakeTimers();

    mockUseSelectedRepo.mockReturnValue({
      selectedRepo: 'acme/widgets',
      setSelectedRepo: vi.fn(),
    });
    mockUseMemorySessions.mockReturnValue({
      data: sampleSessions,
      isLoading: false,
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('shows "Purge All Memory" button in Danger Zone', () => {
    renderMemory();

    expect(screen.getByText('Purge All Memory')).toBeInTheDocument();
    expect(screen.getByText('Danger Zone')).toBeInTheDocument();
  });

  it('opens Tier 3 dialog with countdown when Purge All Memory is clicked', () => {
    renderMemory();

    fireEvent.click(screen.getByText('Purge All Memory'));

    expect(screen.getByText('Purge all memory')).toBeInTheDocument();
    expect(screen.getByText('Purge All (5s)')).toBeInTheDocument();
    expect(screen.getByLabelText('Confirmation text')).toBeInTheDocument();
  });

  it('confirm button requires both text match and countdown completion', () => {
    renderMemory();

    fireEvent.click(screen.getByText('Purge All Memory'));

    const dialogConfirmBtn = screen
      .getByRole('dialog')
      .querySelector('button:last-child')!;

    // Type correct text, but countdown still active
    fireEvent.change(screen.getByLabelText('Confirmation text'), {
      target: { value: 'DELETE ALL' },
    });
    expect(dialogConfirmBtn).toBeDisabled();

    // Wait for countdown
    act(() => vi.advanceTimersByTime(5000));

    expect(dialogConfirmBtn).not.toBeDisabled();
  });

  it('calls purge mutation when both conditions are met and button clicked', () => {
    renderMemory();

    fireEvent.click(screen.getByText('Purge All Memory'));

    fireEvent.change(screen.getByLabelText('Confirmation text'), {
      target: { value: 'DELETE ALL' },
    });

    act(() => vi.advanceTimersByTime(5000));

    const dialogConfirmBtn = screen
      .getByRole('dialog')
      .querySelector('button:last-child')!;
    fireEvent.click(dialogConfirmBtn);

    expect(mockPurgeMutate).toHaveBeenCalledWith(
      undefined,
      expect.objectContaining({
        onSuccess: expect.any(Function),
        onError: expect.any(Function),
      }),
    );
  });

  it('shows success toast after purge succeeds', () => {
    mockPurgeMutate.mockImplementation(
      (_vars: unknown, opts: { onSuccess: (data: { cleared: number }) => void }) => {
        opts.onSuccess({ cleared: 50 });
      },
    );

    renderMemory();

    fireEvent.click(screen.getByText('Purge All Memory'));

    fireEvent.change(screen.getByLabelText('Confirmation text'), {
      target: { value: 'DELETE ALL' },
    });

    act(() => vi.advanceTimersByTime(5000));

    const dialogConfirmBtn = screen
      .getByRole('dialog')
      .querySelector('button:last-child')!;
    fireEvent.click(dialogConfirmBtn);

    expect(
      screen.getByText('Purged 50 observations from all repositories'),
    ).toBeInTheDocument();
  });
});

// ═══════════════════════════════════════════════════════════════════
// Empty states
// ═══════════════════════════════════════════════════════════════════

describe('Memory page — empty states', () => {
  it('shows empty session message when sessions are empty', () => {
    mockUseSelectedRepo.mockReturnValue({
      selectedRepo: 'acme/widgets',
      setSelectedRepo: vi.fn(),
    });
    mockUseMemorySessions.mockReturnValue({
      data: [],
      isLoading: false,
    });

    renderMemory();

    expect(
      screen.getByText('No memory stored for this repository.'),
    ).toBeInTheDocument();
  });

  it('shows empty observations message when session has no observations', () => {
    mockUseSelectedRepo.mockReturnValue({
      selectedRepo: 'acme/widgets',
      setSelectedRepo: vi.fn(),
    });
    mockUseMemorySessions.mockReturnValue({
      data: [
        {
          id: 1,
          project: 'acme/widgets',
          prNumber: 42,
          summary: 'Empty session',
          createdAt: '2026-01-01T00:00:00Z',
          observationCount: 0,
        },
      ],
      isLoading: false,
    });
    mockUseObservations.mockReturnValue({
      data: [],
      isLoading: false,
    });

    renderMemory();

    // Select the session
    fireEvent.click(screen.getByText('PR #42'));

    expect(
      screen.getByText('No observations in this session.'),
    ).toBeInTheDocument();
  });
});

// ═══════════════════════════════════════════════════════════════════
// Error handling
// ═══════════════════════════════════════════════════════════════════

describe('Memory page — error handling', () => {
  it('shows error message in dialog when delete fails', () => {
    mockUseSelectedRepo.mockReturnValue({
      selectedRepo: 'acme/widgets',
      setSelectedRepo: vi.fn(),
    });
    mockUseMemorySessions.mockReturnValue({
      data: sampleSessions,
      isLoading: false,
    });
    mockUseObservations.mockReturnValue({
      data: sampleObservations,
      isLoading: false,
    });

    mockDeleteMutate.mockImplementation(
      (_vars: unknown, opts: { onError: (error: Error) => void }) => {
        opts.onError(new Error('Network error'));
      },
    );

    renderMemory();

    fireEvent.click(screen.getByText('PR #42'));

    const deleteButtons = screen.getAllByTitle('Delete observation');
    fireEvent.click(deleteButtons[0]);

    const confirmBtn = screen.getByRole('dialog').querySelector('button:last-child')!;
    fireEvent.click(confirmBtn);

    // Dialog should remain open with error message
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByText('Network error')).toBeInTheDocument();
  });
});
