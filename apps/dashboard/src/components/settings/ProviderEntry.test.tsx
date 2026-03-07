/**
 * ProviderEntry component tests.
 *
 * Tests rendering of provider dropdown, API key input,
 * validation button states, and model selection.
 */

import { QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createTestQueryClient } from '@/test/test-utils';
import { ProviderEntry, type ProviderEntryState } from './ProviderEntry';

// ─── Mock fetch for useValidateProvider ─────────────────────────

const mockFetch = vi.fn().mockResolvedValue({
  ok: true,
  json: () => Promise.resolve({ data: {} }),
});
vi.stubGlobal('fetch', mockFetch);

// ─── Helpers ───────────────────────────────────────────────────

function renderWithQuery(ui: React.ReactElement) {
  const client = createTestQueryClient();
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

function createEntry(overrides: Partial<ProviderEntryState> = {}): ProviderEntryState {
  return {
    provider: 'anthropic',
    model: '',
    apiKey: '',
    availableModels: [],
    hasExistingKey: false,
    validated: false,
    ...overrides,
  };
}

const noop = vi.fn();

function renderEntry(entry: ProviderEntryState, onChange = noop) {
  return renderWithQuery(
    <ProviderEntry
      index={0}
      entry={entry}
      totalEntries={1}
      onChange={onChange}
      onRemove={noop}
      onMoveUp={noop}
      onMoveDown={noop}
    />,
  );
}

// ─── Setup ─────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
});

// ─── Tests ─────────────────────────────────────────────────────

describe('ProviderEntry', () => {
  it('renders provider dropdown with correct options', () => {
    renderEntry(createEntry());

    const select = screen.getByDisplayValue('Anthropic');
    expect(select).toBeInTheDocument();
    expect(select.tagName).toBe('SELECT');
  });

  it('renders API key input for non-GitHub providers', () => {
    renderEntry(createEntry({ provider: 'anthropic' }));

    const input = screen.getByPlaceholderText(/enter api key/i);
    expect(input).toBeInTheDocument();
    expect(input).toHaveAttribute('type', 'password');
  });

  it('shows GitHub Models disclaimer instead of API key input for GitHub provider', () => {
    renderEntry(createEntry({ provider: 'github' }));

    expect(screen.getByText(/github models is not available/i)).toBeInTheDocument();
    expect(screen.queryByPlaceholderText(/enter api key/i)).not.toBeInTheDocument();
  });

  it('shows "Validate" button that is disabled when apiKey is empty', () => {
    renderEntry(createEntry({ provider: 'openai', apiKey: '' }));

    const button = screen.getByRole('button', { name: /validate/i });
    expect(button).toBeDisabled();
  });

  it('shows "Valid ✓" text when entry is validated', () => {
    renderEntry(createEntry({ provider: 'openai', apiKey: 'sk-test', validated: true }));

    expect(screen.getByText(/valid ✓/i)).toBeInTheDocument();
  });

  it('renders model dropdown when availableModels are present', () => {
    renderEntry(
      createEntry({
        provider: 'openai',
        validated: true,
        availableModels: ['gpt-4o', 'gpt-4o-mini'],
        model: 'gpt-4o',
      }),
    );

    const modelSelect = screen.getByDisplayValue('gpt-4o');
    expect(modelSelect).toBeInTheDocument();
  });

  it('shows "Primary" label for index 0', () => {
    renderEntry(createEntry());
    expect(screen.getByText('Primary')).toBeInTheDocument();
  });

  it('calls onChange when provider dropdown changes', () => {
    const onChange = vi.fn();
    renderEntry(createEntry({ provider: 'anthropic' }), onChange);

    const select = screen.getByDisplayValue('Anthropic');
    fireEvent.change(select, { target: { value: 'openai' } });

    expect(onChange).toHaveBeenCalledOnce();
    expect(onChange.mock.calls[0]?.[0].provider).toBe('openai');
  });
});
