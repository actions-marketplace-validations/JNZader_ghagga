/**
 * Tests for ToolGrid component.
 * Covers: rendering all tools, grouping by category, toggle interaction,
 * read-only mode with inherited badges, and callback behavior.
 */

import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ToolGrid } from './ToolGrid';

// ─── Test Data ──────────────────────────────────────────────────

const MOCK_TOOLS = [
  { name: 'semgrep', displayName: 'Semgrep', category: 'security', tier: 'always-on' as const },
  { name: 'trivy', displayName: 'Trivy', category: 'sca', tier: 'always-on' as const },
  { name: 'cpd', displayName: 'CPD', category: 'duplication', tier: 'always-on' as const },
  { name: 'gitleaks', displayName: 'Gitleaks', category: 'secrets', tier: 'always-on' as const },
  { name: 'ruff', displayName: 'Ruff', category: 'linting', tier: 'auto-detect' as const },
  { name: 'biome', displayName: 'Biome', category: 'linting', tier: 'auto-detect' as const },
  {
    name: 'markdownlint',
    displayName: 'markdownlint',
    category: 'docs',
    tier: 'always-on' as const,
  },
];

// ═══════════════════════════════════════════════════════════════════
// Rendering
// ═══════════════════════════════════════════════════════════════════

describe('ToolGrid — rendering', () => {
  it('renders the tool grid container', () => {
    render(<ToolGrid tools={MOCK_TOOLS} disabledTools={[]} onToggle={vi.fn()} />);
    expect(screen.getByTestId('tool-grid')).toBeInTheDocument();
  });

  it('renders all tool rows', () => {
    render(<ToolGrid tools={MOCK_TOOLS} disabledTools={[]} onToggle={vi.fn()} />);
    for (const tool of MOCK_TOOLS) {
      expect(screen.getByTestId(`tool-row-${tool.name}`)).toBeInTheDocument();
      expect(screen.getByText(tool.displayName)).toBeInTheDocument();
    }
  });

  it('renders tier badges for always-on and auto-detect tools', () => {
    render(<ToolGrid tools={MOCK_TOOLS} disabledTools={[]} onToggle={vi.fn()} />);
    expect(screen.getAllByText('Always-on').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Auto-detect').length).toBeGreaterThan(0);
  });

  it('renders tools grouped by category with headers', () => {
    render(<ToolGrid tools={MOCK_TOOLS} disabledTools={[]} onToggle={vi.fn()} />);
    // Should have category headers
    expect(screen.getByText('Security')).toBeInTheDocument();
    expect(screen.getByText('SCA / Dependencies')).toBeInTheDocument();
    expect(screen.getByText('Duplication')).toBeInTheDocument();
    expect(screen.getByText('Secrets')).toBeInTheDocument();
    expect(screen.getByText('Linting')).toBeInTheDocument();
    expect(screen.getByText('Documentation')).toBeInTheDocument();
  });
});

// ═══════════════════════════════════════════════════════════════════
// Toggle interaction
// ═══════════════════════════════════════════════════════════════════

describe('ToolGrid — toggle interaction', () => {
  it('shows tools as enabled when not in disabledTools', () => {
    render(<ToolGrid tools={MOCK_TOOLS} disabledTools={[]} onToggle={vi.fn()} />);
    const toggle = screen.getByTestId('tool-toggle-semgrep') as HTMLInputElement;
    expect(toggle.checked).toBe(true);
  });

  it('shows tools as disabled when in disabledTools', () => {
    render(<ToolGrid tools={MOCK_TOOLS} disabledTools={['cpd', 'ruff']} onToggle={vi.fn()} />);
    const cpdToggle = screen.getByTestId('tool-toggle-cpd') as HTMLInputElement;
    const ruffToggle = screen.getByTestId('tool-toggle-ruff') as HTMLInputElement;
    const semgrepToggle = screen.getByTestId('tool-toggle-semgrep') as HTMLInputElement;

    expect(cpdToggle.checked).toBe(false);
    expect(ruffToggle.checked).toBe(false);
    expect(semgrepToggle.checked).toBe(true);
  });

  it('calls onToggle with tool added to disabledTools when toggling off', () => {
    const onToggle = vi.fn();
    render(<ToolGrid tools={MOCK_TOOLS} disabledTools={[]} onToggle={onToggle} />);

    const toggle = screen.getByTestId('tool-toggle-gitleaks');
    fireEvent.click(toggle);

    expect(onToggle).toHaveBeenCalledWith(['gitleaks']);
  });

  it('calls onToggle with tool removed from disabledTools when toggling on', () => {
    const onToggle = vi.fn();
    render(
      <ToolGrid tools={MOCK_TOOLS} disabledTools={['cpd', 'markdownlint']} onToggle={onToggle} />,
    );

    const toggle = screen.getByTestId('tool-toggle-cpd');
    fireEvent.click(toggle);

    expect(onToggle).toHaveBeenCalledWith(['markdownlint']);
  });
});

// ═══════════════════════════════════════════════════════════════════
// Read-only mode
// ═══════════════════════════════════════════════════════════════════

describe('ToolGrid — read-only mode', () => {
  it('shows "Inherited" badges when readOnly is true', () => {
    render(<ToolGrid tools={MOCK_TOOLS} disabledTools={[]} onToggle={vi.fn()} readOnly />);
    const badges = screen.getAllByText('Inherited');
    expect(badges.length).toBe(MOCK_TOOLS.length);
  });

  it('does not show "Inherited" badges when readOnly is false', () => {
    render(<ToolGrid tools={MOCK_TOOLS} disabledTools={[]} onToggle={vi.fn()} />);
    expect(screen.queryByText('Inherited')).not.toBeInTheDocument();
  });

  it('disables all toggles when readOnly is true', () => {
    render(<ToolGrid tools={MOCK_TOOLS} disabledTools={[]} onToggle={vi.fn()} readOnly />);
    for (const tool of MOCK_TOOLS) {
      const toggle = screen.getByTestId(`tool-toggle-${tool.name}`) as HTMLInputElement;
      expect(toggle.disabled).toBe(true);
    }
  });

  it('does not call onToggle when clicking a read-only toggle', () => {
    const onToggle = vi.fn();
    render(<ToolGrid tools={MOCK_TOOLS} disabledTools={[]} onToggle={onToggle} readOnly />);

    const toggle = screen.getByTestId('tool-toggle-semgrep');
    fireEvent.click(toggle);

    expect(onToggle).not.toHaveBeenCalled();
  });
});

// ═══════════════════════════════════════════════════════════════════
// Empty state
// ═══════════════════════════════════════════════════════════════════

describe('ToolGrid — empty state', () => {
  it('renders nothing when tools array is empty', () => {
    render(<ToolGrid tools={[]} disabledTools={[]} onToggle={vi.fn()} />);
    const grid = screen.getByTestId('tool-grid');
    expect(grid.children).toHaveLength(0);
  });
});
