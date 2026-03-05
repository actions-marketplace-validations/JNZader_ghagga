/**
 * Tests for the Runner section in GlobalSettings.
 *
 * Since GlobalSettings is a large page component with many dependencies,
 * we test the Runner section behavior by rendering GlobalSettings with
 * all API hooks mocked. This tests the UI states: checking, not_configured,
 * creating, ready, error, needs_reauth.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { type ReactNode } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

// ─── Mock modules ───────────────────────────────────────────────

// Mock api hooks
const mockUseInstallations = vi.fn();
const mockUseInstallationSettings = vi.fn();
const mockUseUpdateInstallationSettings = vi.fn();
const mockUseValidateProvider = vi.fn();
const mockUseRunnerStatus = vi.fn();
const mockUseCreateRunner = vi.fn();
const mockUseConfigureRunnerSecret = vi.fn();

vi.mock('@/lib/api', () => ({
  useInstallations: () => mockUseInstallations(),
  useInstallationSettings: () => mockUseInstallationSettings(),
  useUpdateInstallationSettings: () => mockUseUpdateInstallationSettings(),
  useValidateProvider: () => mockUseValidateProvider(),
  useRunnerStatus: () => mockUseRunnerStatus(),
  useCreateRunner: () => mockUseCreateRunner(),
  useConfigureRunnerSecret: () => mockUseConfigureRunnerSecret(),
  ApiError: class ApiError extends Error {
    constructor(public status: number, message: string) {
      super(message);
      this.name = 'ApiError';
    }
  },
}));

// Mock auth
const mockReAuthenticate = vi.fn();

vi.mock('@/lib/auth', () => ({
  useAuth: () => ({
    user: { githubLogin: 'testuser', githubUserId: 1, avatarUrl: '' },
    reAuthenticate: mockReAuthenticate,
  }),
}));

// Mock ProviderChainEditor (complex component we're not testing here)
vi.mock('@/components/settings/ProviderChainEditor', () => ({
  ProviderChainEditor: () => <div data-testid="provider-chain-editor" />,
}));

// Now import the component under test
import { GlobalSettings } from './GlobalSettings';

// ─── Helpers ────────────────────────────────────────────────────

function createTestQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
}

function renderGlobalSettings() {
  const queryClient = createTestQueryClient();
  return render(
    <MemoryRouter>
      <QueryClientProvider client={queryClient}>
        <GlobalSettings />
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

// Default mock return values
const DEFAULT_INSTALLATION = {
  data: [{ id: 100, accountLogin: 'testuser', accountType: 'User' }],
  isLoading: false,
};

const DEFAULT_SETTINGS = {
  data: {
    providerChain: [],
    aiReviewEnabled: true,
    reviewMode: 'simple',
    enableSemgrep: true,
    enableTrivy: true,
    enableCpd: false,
    enableMemory: true,
    customRules: '',
    ignorePatterns: [],
  },
  isLoading: false,
};

const DEFAULT_UPDATE = {
  mutateAsync: vi.fn(),
  isPending: false,
  isError: false,
};

const DEFAULT_VALIDATE = {
  mutateAsync: vi.fn(),
  isPending: false,
};

// ─── Setup ──────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();

  // Set up default returns for non-runner hooks
  mockUseInstallations.mockReturnValue(DEFAULT_INSTALLATION);
  mockUseInstallationSettings.mockReturnValue(DEFAULT_SETTINGS);
  mockUseUpdateInstallationSettings.mockReturnValue(DEFAULT_UPDATE);
  mockUseValidateProvider.mockReturnValue(DEFAULT_VALIDATE);
});

// ═══════════════════════════════════════════════════════════════════
// Runner Card States
// ═══════════════════════════════════════════════════════════════════

describe('RunnerCard — checking state', () => {
  it('shows "Checking runner status..." while loading', () => {
    mockUseRunnerStatus.mockReturnValue({
      isLoading: true,
      data: undefined,
    });
    mockUseCreateRunner.mockReturnValue({
      mutate: vi.fn(),
      isPending: false,
      isError: false,
      error: null,
    });
    mockUseConfigureRunnerSecret.mockReturnValue({
      mutate: vi.fn(),
      isPending: false,
    });

    renderGlobalSettings();

    expect(screen.getByText('Checking runner status...')).toBeInTheDocument();
  });
});

describe('RunnerCard — not_configured state', () => {
  it('shows "Enable Runner" button when runner does not exist', () => {
    mockUseRunnerStatus.mockReturnValue({
      isLoading: false,
      data: { exists: false },
    });
    mockUseCreateRunner.mockReturnValue({
      mutate: vi.fn(),
      isPending: false,
      isError: false,
      error: null,
    });
    mockUseConfigureRunnerSecret.mockReturnValue({
      mutate: vi.fn(),
      isPending: false,
    });

    renderGlobalSettings();

    expect(screen.getByText('Enable Runner')).toBeInTheDocument();
    expect(screen.getByText(/GHAGGA uses a GitHub Actions runner/)).toBeInTheDocument();
  });

  it('calls createRunner.mutate when Enable Runner is clicked', async () => {
    const mockMutate = vi.fn();
    mockUseRunnerStatus.mockReturnValue({
      isLoading: false,
      data: { exists: false },
    });
    mockUseCreateRunner.mockReturnValue({
      mutate: mockMutate,
      isPending: false,
      isError: false,
      error: null,
    });
    mockUseConfigureRunnerSecret.mockReturnValue({
      mutate: vi.fn(),
      isPending: false,
    });

    renderGlobalSettings();

    // Wait for useEffect to set selectedInstallation and re-render
    await vi.waitFor(() => {
      expect(screen.getByText('Enable Runner')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText('Enable Runner'));
    expect(mockMutate).toHaveBeenCalledOnce();
  });
});

describe('RunnerCard — creating state', () => {
  it('shows spinner with "Creating runner repository..." during creation', () => {
    mockUseRunnerStatus.mockReturnValue({
      isLoading: false,
      data: { exists: false },
    });
    mockUseCreateRunner.mockReturnValue({
      mutate: vi.fn(),
      isPending: true,
      isError: false,
      error: null,
    });
    mockUseConfigureRunnerSecret.mockReturnValue({
      mutate: vi.fn(),
      isPending: false,
    });

    renderGlobalSettings();

    expect(screen.getByText('Creating runner repository...')).toBeInTheDocument();
  });
});

describe('RunnerCard — ready state', () => {
  it('shows "Runner enabled" and repo link when runner exists', () => {
    mockUseRunnerStatus.mockReturnValue({
      isLoading: false,
      data: { exists: true, repoFullName: 'acme/ghagga-runner', isPrivate: false },
    });
    mockUseCreateRunner.mockReturnValue({
      mutate: vi.fn(),
      isPending: false,
      isError: false,
      error: null,
    });
    mockUseConfigureRunnerSecret.mockReturnValue({
      mutate: vi.fn(),
      isPending: false,
    });

    renderGlobalSettings();

    expect(screen.getByText('Runner enabled')).toBeInTheDocument();
    expect(screen.getByText('acme/ghagga-runner')).toBeInTheDocument();
    expect(screen.getByText('Reconfigure Secret')).toBeInTheDocument();
  });

  it('shows private repo warning when isPrivate is true', () => {
    const warningText = 'Private repo uses org minutes';
    mockUseRunnerStatus.mockReturnValue({
      isLoading: false,
      data: { exists: true, repoFullName: 'acme/ghagga-runner', isPrivate: true, warning: warningText },
    });
    mockUseCreateRunner.mockReturnValue({
      mutate: vi.fn(),
      isPending: false,
      isError: false,
      error: null,
    });
    mockUseConfigureRunnerSecret.mockReturnValue({
      mutate: vi.fn(),
      isPending: false,
    });

    renderGlobalSettings();

    expect(screen.getByText(warningText)).toBeInTheDocument();
  });

  it('calls configureSecret.mutate when Reconfigure Secret is clicked', async () => {
    const mockSecretMutate = vi.fn();
    mockUseRunnerStatus.mockReturnValue({
      isLoading: false,
      data: { exists: true, repoFullName: 'acme/ghagga-runner', isPrivate: false },
    });
    mockUseCreateRunner.mockReturnValue({
      mutate: vi.fn(),
      isPending: false,
      isError: false,
      error: null,
    });
    mockUseConfigureRunnerSecret.mockReturnValue({
      mutate: mockSecretMutate,
      isPending: false,
    });

    renderGlobalSettings();

    // Wait for useEffect to set selectedInstallation and form to render
    await vi.waitFor(() => {
      expect(screen.getByText('Reconfigure Secret')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText('Reconfigure Secret'));
    expect(mockSecretMutate).toHaveBeenCalledOnce();
  });

  it('shows "Configuring..." when configureSecret is pending', () => {
    mockUseRunnerStatus.mockReturnValue({
      isLoading: false,
      data: { exists: true, repoFullName: 'acme/ghagga-runner', isPrivate: false },
    });
    mockUseCreateRunner.mockReturnValue({
      mutate: vi.fn(),
      isPending: false,
      isError: false,
      error: null,
    });
    mockUseConfigureRunnerSecret.mockReturnValue({
      mutate: vi.fn(),
      isPending: true,
    });

    renderGlobalSettings();

    expect(screen.getByText('Configuring...')).toBeInTheDocument();
  });
});

describe('RunnerCard — error state (non-scope)', () => {
  it('shows error message and Retry button on generic error', () => {
    mockUseRunnerStatus.mockReturnValue({
      isLoading: false,
      data: { exists: false },
    });
    mockUseCreateRunner.mockReturnValue({
      mutate: vi.fn(),
      isPending: false,
      isError: true,
      error: new Error('Something went wrong'),
    });
    mockUseConfigureRunnerSecret.mockReturnValue({
      mutate: vi.fn(),
      isPending: false,
    });

    renderGlobalSettings();

    expect(screen.getByText(/Failed to create runner repository/)).toBeInTheDocument();
    expect(screen.getByText('Retry')).toBeInTheDocument();
  });

  it('calls createRunner.mutate when Retry is clicked', async () => {
    const mockMutate = vi.fn();
    mockUseRunnerStatus.mockReturnValue({
      isLoading: false,
      data: { exists: false },
    });
    mockUseCreateRunner.mockReturnValue({
      mutate: mockMutate,
      isPending: false,
      isError: true,
      error: new Error('Something went wrong'),
    });
    mockUseConfigureRunnerSecret.mockReturnValue({
      mutate: vi.fn(),
      isPending: false,
    });

    renderGlobalSettings();

    // Wait for the form to render after useEffect sets selectedInstallation
    await vi.waitFor(() => {
      expect(screen.getByText('Retry')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText('Retry'));
    expect(mockMutate).toHaveBeenCalledOnce();
  });
});

describe('RunnerCard — needs_reauth state', () => {
  it('shows re-authenticate button on insufficient_scope error', async () => {
    // Import ApiError from the mock
    const { ApiError } = await import('@/lib/api');

    const scopeError = new ApiError(403, JSON.stringify({ error: 'insufficient_scope' }));

    mockUseRunnerStatus.mockReturnValue({
      isLoading: false,
      data: { exists: false },
    });
    mockUseCreateRunner.mockReturnValue({
      mutate: vi.fn(),
      isPending: false,
      isError: true,
      error: scopeError,
    });
    mockUseConfigureRunnerSecret.mockReturnValue({
      mutate: vi.fn(),
      isPending: false,
    });

    renderGlobalSettings();

    // The needsReauth state is set via useEffect, which runs after render.
    await vi.waitFor(() => {
      expect(screen.getAllByText('Re-authenticate').length).toBeGreaterThanOrEqual(1);
    });
  });

  it('calls reAuthenticate when Re-authenticate button is clicked', async () => {
    const { ApiError } = await import('@/lib/api');

    const scopeError = new ApiError(403, JSON.stringify({ error: 'insufficient_scope' }));

    mockUseRunnerStatus.mockReturnValue({
      isLoading: false,
      data: { exists: false },
    });
    mockUseCreateRunner.mockReturnValue({
      mutate: vi.fn(),
      isPending: false,
      isError: true,
      error: scopeError,
    });
    mockUseConfigureRunnerSecret.mockReturnValue({
      mutate: vi.fn(),
      isPending: false,
    });

    renderGlobalSettings();

    await vi.waitFor(() => {
      expect(screen.getAllByText('Re-authenticate').length).toBeGreaterThanOrEqual(1);
    });

    const buttons = screen.getAllByText('Re-authenticate');
    fireEvent.click(buttons[0]!);
    expect(mockReAuthenticate).toHaveBeenCalledOnce();
  });
});
