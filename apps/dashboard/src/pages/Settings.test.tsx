/**
 * Tests for Settings page.
 * Covers: no-repo state, loading, global/custom toggle, static analysis toggles,
 * AI review toggle, review mode selection, provider chain editor presence,
 * save handler (global + custom), save success/error feedback, advanced fields,
 * and global settings inherited view.
 */

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

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
  ProviderChainEditor: ({
    chain,
    onChange,
  }: {
    chain: unknown[];
    onChange: (c: unknown[]) => void;
  }) => (
    <div data-testid="provider-chain-editor">
      <span data-testid="chain-length">{chain.length}</span>
      <button
        type="button"
        data-testid="add-provider-btn"
        onClick={() =>
          onChange([
            ...chain,
            {
              provider: 'openai',
              model: 'gpt-4',
              apiKey: 'sk-test',
              availableModels: ['gpt-4'],
              hasExistingKey: false,
              maskedApiKey: '',
              validated: true,
            },
          ])
        }
      >
        Add Provider
      </button>
      <button
        type="button"
        data-testid="remove-provider-btn"
        onClick={() => onChange(chain.slice(0, -1))}
      >
        Remove Provider
      </button>
    </div>
  ),
}));

// Import after mocks
import { Settings } from './Settings';

// ─── Test Data ──────────────────────────────────────────────────

const DEFAULT_REPOS = [
  { id: 1, fullName: 'acme/app' },
  { id: 2, fullName: 'acme/api' },
];

const DEFAULT_SETTINGS = {
  repoId: 1,
  repoFullName: 'acme/app',
  useGlobalSettings: false,
  aiReviewEnabled: true,
  providerChain: [
    {
      provider: 'anthropic',
      model: 'claude-sonnet-4-20250514',
      hasApiKey: true,
      maskedApiKey: 'sk-...abc',
    },
  ],
  reviewMode: 'simple' as const,
  enableSemgrep: true,
  enableTrivy: true,
  enableCpd: false,
  enableMemory: true,
  customRules: 'no eval()',
  ignorePatterns: ['*.lock', 'dist/**'],
};

const GLOBAL_SETTINGS = {
  installationId: 100,
  accountLogin: 'acme',
  providerChain: [
    { provider: 'openai', model: 'gpt-4', hasApiKey: true, maskedApiKey: 'sk-...xyz' },
  ],
  aiReviewEnabled: true,
  reviewMode: 'workflow',
  enableSemgrep: true,
  enableTrivy: false,
  enableCpd: true,
  enableMemory: false,
  customRules: 'global rules',
  ignorePatterns: ['vendor/**'],
};

const SETTINGS_WITH_GLOBAL = {
  ...DEFAULT_SETTINGS,
  useGlobalSettings: true,
  globalSettings: GLOBAL_SETTINGS,
};

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

function setupSelectedRepo(repo = 'acme/app') {
  mockUseSelectedRepo.mockReturnValue({
    selectedRepo: repo,
    setSelectedRepo: vi.fn(),
  });
}

function setupWithSettings(settingsData = DEFAULT_SETTINGS) {
  setupSelectedRepo();
  mockUseSettings.mockReturnValue({ data: settingsData, isLoading: false });
}

// ─── Setup ──────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();

  mockUseSelectedRepo.mockReturnValue({
    selectedRepo: '',
    setSelectedRepo: vi.fn(),
  });
  mockUseRepositories.mockReturnValue({ data: DEFAULT_REPOS, isLoading: false });
  mockUseSettings.mockReturnValue({ data: undefined, isLoading: false });
  mockUseUpdateSettings.mockReturnValue({
    mutateAsync: vi.fn().mockResolvedValue({ message: 'ok' }),
    isPending: false,
    isError: false,
  });
});

// ═══════════════════════════════════════════════════════════════════
// No repo selected
// ═══════════════════════════════════════════════════════════════════

describe('Settings — no repo selected', () => {
  it('renders without crashing (no repo selected)', () => {
    renderSettings();

    expect(screen.getByText('Repository Settings')).toBeInTheDocument();
    expect(screen.getByText('Select a Repository')).toBeInTheDocument();
  });

  it('shows prompt to select a repo from dropdown', () => {
    renderSettings();

    expect(
      screen.getByText(
        'Choose a repository from the dropdown above to configure its review settings.',
      ),
    ).toBeInTheDocument();
  });
});

// ═══════════════════════════════════════════════════════════════════
// Loading state
// ═══════════════════════════════════════════════════════════════════

describe('Settings — loading state', () => {
  it('shows spinner when settings are loading', () => {
    setupSelectedRepo();
    mockUseSettings.mockReturnValue({ data: undefined, isLoading: true });

    const { container } = renderSettings();

    expect(container.querySelector('.animate-spin')).toBeInTheDocument();
    expect(screen.queryByText('Save Settings')).not.toBeInTheDocument();
  });
});

// ═══════════════════════════════════════════════════════════════════
// Form rendering with custom settings
// ═══════════════════════════════════════════════════════════════════

describe('Settings — custom settings form', () => {
  it('renders form with defaults when repo and settings are loaded', () => {
    setupWithSettings();

    renderSettings();

    expect(screen.getByText('Repository Settings')).toBeInTheDocument();
    expect(screen.getByText('Save Settings')).toBeInTheDocument();
    expect(screen.getByText('Static Analysis')).toBeInTheDocument();
  });

  it('renders the provider chain editor', () => {
    setupWithSettings();

    renderSettings();

    expect(screen.getByTestId('provider-chain-editor')).toBeInTheDocument();
    // The chain should have 1 entry from DEFAULT_SETTINGS
    expect(screen.getByTestId('chain-length')).toHaveTextContent('1');
  });

  it('renders review mode radio buttons with correct default', () => {
    setupWithSettings();

    renderSettings();

    const simpleRadio = screen.getByDisplayValue('simple');
    const workflowRadio = screen.getByDisplayValue('workflow');
    const consensusRadio = screen.getByDisplayValue('consensus');

    expect(simpleRadio).toBeChecked();
    expect(workflowRadio).not.toBeChecked();
    expect(consensusRadio).not.toBeChecked();
  });

  it('renders advanced settings fields with pre-filled values', () => {
    setupWithSettings();

    renderSettings();

    const customRulesField = screen.getByPlaceholderText('Add custom review rules...');
    expect(customRulesField).toHaveValue('no eval()');

    const ignorePatternsField = screen.getByLabelText(/Ignore Patterns/);
    expect(ignorePatternsField).toHaveValue('*.lock\ndist/**');
  });
});

// ═══════════════════════════════════════════════════════════════════
// Static analysis toggles
// ═══════════════════════════════════════════════════════════════════

describe('Settings — static analysis toggles', () => {
  it('renders all analysis tool checkboxes with correct initial state', () => {
    setupWithSettings();

    renderSettings();

    // Semgrep and Trivy are enabled, CPD is disabled, Memory is enabled
    const semgrepLabel = screen.getByText('Semgrep (security + patterns)');
    const trivyLabel = screen.getByText('Trivy (vulnerabilities)');
    const cpdLabel = screen.getByText('PMD/CPD (code duplication)');
    const memoryLabel = screen.getByText('Memory (project knowledge)');

    // Find the checkboxes via their labels
    // biome-ignore lint/style/noNonNullAssertion: test assertion on known mock data
    const semgrepCheckbox = semgrepLabel.closest('label')!.querySelector('input[type="checkbox"]')!;
    // biome-ignore lint/style/noNonNullAssertion: test assertion on known mock data
    const trivyCheckbox = trivyLabel.closest('label')!.querySelector('input[type="checkbox"]')!;
    // biome-ignore lint/style/noNonNullAssertion: test assertion on known mock data
    const cpdCheckbox = cpdLabel.closest('label')!.querySelector('input[type="checkbox"]')!;
    // biome-ignore lint/style/noNonNullAssertion: test assertion on known mock data
    const memoryCheckbox = memoryLabel.closest('label')!.querySelector('input[type="checkbox"]')!;

    expect(semgrepCheckbox).toBeChecked();
    expect(trivyCheckbox).toBeChecked();
    expect(cpdCheckbox).not.toBeChecked();
    expect(memoryCheckbox).toBeChecked();
  });

  it('toggles a static analysis checkbox', () => {
    setupWithSettings();

    renderSettings();

    const cpdLabel = screen.getByText('PMD/CPD (code duplication)');
    // biome-ignore lint/style/noNonNullAssertion: test assertion on known mock data
    const cpdCheckbox = cpdLabel.closest('label')!.querySelector('input[type="checkbox"]')!;

    expect(cpdCheckbox).not.toBeChecked();

    fireEvent.click(cpdCheckbox);

    expect(cpdCheckbox).toBeChecked();
  });
});

// ═══════════════════════════════════════════════════════════════════
// AI review toggle
// ═══════════════════════════════════════════════════════════════════

describe('Settings — AI review toggle', () => {
  it('shows provider chain and review mode when AI review is enabled', () => {
    setupWithSettings();

    renderSettings();

    expect(screen.getByText('Enabled')).toBeInTheDocument();
    expect(screen.getByTestId('provider-chain-editor')).toBeInTheDocument();
    expect(screen.getByText('Review Mode')).toBeInTheDocument();
  });

  it('hides provider chain and review mode when AI review is disabled', () => {
    setupWithSettings({
      ...DEFAULT_SETTINGS,
      aiReviewEnabled: false,
    });

    renderSettings();

    expect(screen.getByText('Disabled')).toBeInTheDocument();
    expect(screen.queryByTestId('provider-chain-editor')).not.toBeInTheDocument();
    expect(screen.queryByText('Review Mode')).not.toBeInTheDocument();
  });

  it('toggles AI review on/off', () => {
    setupWithSettings();

    renderSettings();

    // Find the AI Review toggle (the one labeled "Enabled" / "Disabled")
    expect(screen.getByText('Enabled')).toBeInTheDocument();
    expect(screen.getByTestId('provider-chain-editor')).toBeInTheDocument();

    // The AI review checkbox is the peer sr-only one near "Enabled"
    const enabledLabel = screen.getByText('Enabled');
    // biome-ignore lint/style/noNonNullAssertion: test assertion on known mock data
    const aiToggle = enabledLabel.closest('label')!.querySelector('input[type="checkbox"]')!;
    fireEvent.click(aiToggle);

    expect(screen.getByText('Disabled')).toBeInTheDocument();
    expect(screen.queryByTestId('provider-chain-editor')).not.toBeInTheDocument();
  });
});

// ═══════════════════════════════════════════════════════════════════
// Review mode selection
// ═══════════════════════════════════════════════════════════════════

describe('Settings — review mode', () => {
  it('changes review mode when a different radio is selected', () => {
    setupWithSettings();

    renderSettings();

    const workflowRadio = screen.getByDisplayValue('workflow');
    fireEvent.click(workflowRadio);

    expect(workflowRadio).toBeChecked();
    expect(screen.getByDisplayValue('simple')).not.toBeChecked();
  });

  it('shows the mode description text', () => {
    setupWithSettings();

    renderSettings();

    expect(screen.getByText(/Simple: 1 LLM call/)).toBeInTheDocument();
    expect(screen.getByText(/Workflow: 5 specialist agents/)).toBeInTheDocument();
    expect(screen.getByText(/Consensus: 3 stances debate/)).toBeInTheDocument();
  });
});

// ═══════════════════════════════════════════════════════════════════
// Provider chain editor interactions
// ═══════════════════════════════════════════════════════════════════

describe('Settings — provider chain editor', () => {
  it('adds a provider via the chain editor', () => {
    setupWithSettings();

    renderSettings();

    expect(screen.getByTestId('chain-length')).toHaveTextContent('1');

    fireEvent.click(screen.getByTestId('add-provider-btn'));

    expect(screen.getByTestId('chain-length')).toHaveTextContent('2');
  });

  it('removes a provider via the chain editor', () => {
    setupWithSettings();

    renderSettings();

    expect(screen.getByTestId('chain-length')).toHaveTextContent('1');

    fireEvent.click(screen.getByTestId('remove-provider-btn'));

    expect(screen.getByTestId('chain-length')).toHaveTextContent('0');
  });
});

// ═══════════════════════════════════════════════════════════════════
// Global/custom toggle
// ═══════════════════════════════════════════════════════════════════

describe('Settings — global/custom toggle', () => {
  it('renders "Global" label when useGlobalSettings is true', () => {
    setupSelectedRepo();
    mockUseSettings.mockReturnValue({
      data: SETTINGS_WITH_GLOBAL,
      isLoading: false,
    });

    renderSettings();

    expect(screen.getByText('Global')).toBeInTheDocument();
    expect(screen.getByText(/inherits settings from/i)).toBeInTheDocument();
  });

  it('renders "Custom" label when useGlobalSettings is false', () => {
    setupWithSettings();

    renderSettings();

    expect(screen.getByText('Custom')).toBeInTheDocument();
  });

  it('shows inherited global settings in read-only view', () => {
    setupSelectedRepo();
    mockUseSettings.mockReturnValue({
      data: SETTINGS_WITH_GLOBAL,
      isLoading: false,
    });

    renderSettings();

    // "Inherited from global settings" appears for both Static Analysis and AI Review cards
    expect(screen.getAllByText('Inherited from global settings')).toHaveLength(2);

    // Provider chain displayed as text
    expect(screen.getByText(/openai \(gpt-4\)/)).toBeInTheDocument();
  });

  it('switches from global to custom and pre-fills from global settings', async () => {
    setupSelectedRepo();
    mockUseSettings.mockReturnValue({
      data: {
        ...DEFAULT_SETTINGS,
        useGlobalSettings: true,
        providerChain: [],
        globalSettings: GLOBAL_SETTINGS,
      },
      isLoading: false,
    });

    renderSettings();

    expect(screen.getByText('Global')).toBeInTheDocument();

    // Find the Global/Custom toggle checkbox
    const globalLabel = screen.getByText('Global');
    // biome-ignore lint/style/noNonNullAssertion: test assertion on known mock data
    const globalToggle = globalLabel.closest('label')!.querySelector('input[type="checkbox"]')!;

    fireEvent.click(globalToggle);

    await waitFor(() => {
      expect(screen.getByText('Custom')).toBeInTheDocument();
    });

    // After switching to custom, provider chain editor should appear
    // and be pre-filled from global settings (1 provider)
    expect(screen.getByTestId('provider-chain-editor')).toBeInTheDocument();
    expect(screen.getByTestId('chain-length')).toHaveTextContent('1');
  });
});

// ═══════════════════════════════════════════════════════════════════
// Save handler
// ═══════════════════════════════════════════════════════════════════

describe('Settings — save', () => {
  it('calls mutateAsync with useGlobalSettings:true when global is selected', async () => {
    const mockMutateAsync = vi.fn().mockResolvedValue({ message: 'ok' });
    mockUseUpdateSettings.mockReturnValue({
      mutateAsync: mockMutateAsync,
      isPending: false,
      isError: false,
    });

    setupSelectedRepo();
    mockUseSettings.mockReturnValue({
      data: SETTINGS_WITH_GLOBAL,
      isLoading: false,
    });

    renderSettings();

    fireEvent.click(screen.getByText('Save Settings'));

    await waitFor(() => {
      expect(mockMutateAsync).toHaveBeenCalledWith({
        repoFullName: 'acme/app',
        useGlobalSettings: true,
      });
    });
  });

  it('calls mutateAsync with full custom settings when custom is selected', async () => {
    const mockMutateAsync = vi.fn().mockResolvedValue({ message: 'ok' });
    mockUseUpdateSettings.mockReturnValue({
      mutateAsync: mockMutateAsync,
      isPending: false,
      isError: false,
    });

    setupWithSettings();

    renderSettings();

    fireEvent.click(screen.getByText('Save Settings'));

    await waitFor(() => {
      expect(mockMutateAsync).toHaveBeenCalledTimes(1);
      // biome-ignore lint/style/noNonNullAssertion: test assertion on known mock data
      const payload = mockMutateAsync.mock.calls[0]![0];
      expect(payload.repoFullName).toBe('acme/app');
      expect(payload.useGlobalSettings).toBe(false);
      expect(payload.aiReviewEnabled).toBe(true);
      expect(payload.reviewMode).toBe('simple');
      expect(payload.enableSemgrep).toBe(true);
      expect(payload.enableTrivy).toBe(true);
      expect(payload.enableCpd).toBe(false);
      expect(payload.enableMemory).toBe(true);
      expect(payload.customRules).toBe('no eval()');
      expect(payload.ignorePatterns).toEqual(['*.lock', 'dist/**']);
      expect(payload.providerChain).toEqual([
        { provider: 'anthropic', model: 'claude-sonnet-4-20250514' },
      ]);
    });
  });

  it('shows "Saving..." while mutation is pending', () => {
    mockUseUpdateSettings.mockReturnValue({
      mutateAsync: vi.fn(),
      isPending: true,
      isError: false,
    });

    setupWithSettings();

    renderSettings();

    expect(screen.getByText('Saving...')).toBeInTheDocument();
    expect(screen.getByText('Saving...')).toBeDisabled();
  });

  it('shows success message after saving', async () => {
    const mockMutateAsync = vi.fn().mockResolvedValue({ message: 'ok' });
    mockUseUpdateSettings.mockReturnValue({
      mutateAsync: mockMutateAsync,
      isPending: false,
      isError: false,
    });

    setupWithSettings();

    renderSettings();

    fireEvent.click(screen.getByText('Save Settings'));

    await waitFor(() => {
      expect(screen.getByText('Settings saved successfully!')).toBeInTheDocument();
    });
  });

  it('shows error message when save fails', () => {
    mockUseUpdateSettings.mockReturnValue({
      mutateAsync: vi.fn().mockRejectedValue(new Error('Server error')),
      isPending: false,
      isError: true,
    });

    setupWithSettings();

    renderSettings();

    expect(screen.getByText('Failed to save settings.')).toBeInTheDocument();
  });

  it('does not call mutateAsync when no repo is selected', () => {
    const mockMutateAsync = vi.fn();
    mockUseUpdateSettings.mockReturnValue({
      mutateAsync: mockMutateAsync,
      isPending: false,
      isError: false,
    });

    // No repo selected — should show "Select a Repository" screen
    renderSettings();

    // Save button should not be visible
    expect(screen.queryByText('Save Settings')).not.toBeInTheDocument();
    expect(mockMutateAsync).not.toHaveBeenCalled();
  });
});

// ═══════════════════════════════════════════════════════════════════
// Advanced settings
// ═══════════════════════════════════════════════════════════════════

describe('Settings — advanced fields', () => {
  it('allows editing custom rules', () => {
    setupWithSettings();

    renderSettings();

    const customRulesField = screen.getByPlaceholderText('Add custom review rules...');
    fireEvent.change(customRulesField, { target: { value: 'no eval(); no new Function()' } });

    expect(customRulesField).toHaveValue('no eval(); no new Function()');
  });

  it('allows editing ignore patterns', () => {
    setupWithSettings();

    renderSettings();

    const ignorePatternsField = screen.getByLabelText(/Ignore Patterns/);
    fireEvent.change(ignorePatternsField, { target: { value: '*.log\nvendor/**' } });

    expect(ignorePatternsField).toHaveValue('*.log\nvendor/**');
  });

  it('splits ignore patterns by newlines and trims when saving', async () => {
    const mockMutateAsync = vi.fn().mockResolvedValue({ message: 'ok' });
    mockUseUpdateSettings.mockReturnValue({
      mutateAsync: mockMutateAsync,
      isPending: false,
      isError: false,
    });

    setupWithSettings({
      ...DEFAULT_SETTINGS,
      ignorePatterns: [],
    });

    renderSettings();

    // Type multiple patterns with extra whitespace
    const ignorePatternsField = screen.getByLabelText(/Ignore Patterns/);
    fireEvent.change(ignorePatternsField, { target: { value: '  *.log  \n  vendor/**  \n\n' } });

    fireEvent.click(screen.getByText('Save Settings'));

    await waitFor(() => {
      // biome-ignore lint/style/noNonNullAssertion: test assertion on known mock data
      const payload = mockMutateAsync.mock.calls[0]![0];
      expect(payload.ignorePatterns).toEqual(['*.log', 'vendor/**']);
    });
  });
});

// ═══════════════════════════════════════════════════════════════════
// Repository selector
// ═══════════════════════════════════════════════════════════════════

describe('Settings — repository selector', () => {
  it('renders repository options', () => {
    renderSettings();

    const repoSelect = screen.getByDisplayValue('Select a repository');
    const options = repoSelect.querySelectorAll('option');

    expect(options).toHaveLength(3); // "Select a repository" + 2 repos
    expect(options[1]).toHaveTextContent('acme/app');
    expect(options[2]).toHaveTextContent('acme/api');
  });

  it('calls setSelectedRepo when a repo is selected', () => {
    const setSelectedRepo = vi.fn();
    mockUseSelectedRepo.mockReturnValue({
      selectedRepo: '',
      setSelectedRepo,
    });

    renderSettings();

    const repoSelect = screen.getByDisplayValue('Select a repository');
    fireEvent.change(repoSelect, { target: { value: 'acme/app' } });

    expect(setSelectedRepo).toHaveBeenCalledWith('acme/app');
  });
});

// ═══════════════════════════════════════════════════════════════════
// Save with provider chain including new API key
// ═══════════════════════════════════════════════════════════════════

describe('Settings — save with provider chain', () => {
  it('includes apiKey in chain update when a new key is provided', async () => {
    const mockMutateAsync = vi.fn().mockResolvedValue({ message: 'ok' });
    mockUseUpdateSettings.mockReturnValue({
      mutateAsync: mockMutateAsync,
      isPending: false,
      isError: false,
    });

    setupWithSettings();

    renderSettings();

    // Add a new provider via the mock chain editor (simulates adding with apiKey)
    fireEvent.click(screen.getByTestId('add-provider-btn'));

    fireEvent.click(screen.getByText('Save Settings'));

    await waitFor(() => {
      // biome-ignore lint/style/noNonNullAssertion: test assertion on known mock data
      const payload = mockMutateAsync.mock.calls[0]![0];
      expect(payload.providerChain).toHaveLength(2);
      // The first provider has no apiKey (existing key), so no apiKey field
      expect(payload.providerChain[0]).toEqual({
        provider: 'anthropic',
        model: 'claude-sonnet-4-20250514',
      });
      // The second provider has an apiKey
      expect(payload.providerChain[1]).toEqual({
        provider: 'openai',
        model: 'gpt-4',
        apiKey: 'sk-test',
      });
    });
  });
});
