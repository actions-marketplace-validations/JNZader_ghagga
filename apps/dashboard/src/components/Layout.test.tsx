/**
 * Tests for Layout component.
 * Tests sidebar navigation, user section, and main content rendering.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

// ─── Mock modules ───────────────────────────────────────────────

const mockLogout = vi.fn();
const mockUseAuth = vi.fn();

vi.mock('@/lib/auth', () => ({
  useAuth: () => mockUseAuth(),
}));

// Import after mocks
import { Layout } from './Layout';

// ─── Setup ──────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();

  mockUseAuth.mockReturnValue({
    user: { githubLogin: 'testuser', githubUserId: 1, avatarUrl: 'https://example.com/avatar.png' },
    logout: mockLogout,
  });
});

// ─── Helpers ────────────────────────────────────────────────────

function renderLayout(children: React.ReactNode = <div>Main Content</div>) {
  return render(
    <MemoryRouter>
      <Layout>{children}</Layout>
    </MemoryRouter>,
  );
}

// ═══════════════════════════════════════════════════════════════════
// Layout
// ═══════════════════════════════════════════════════════════════════

describe('Layout', () => {
  it('renders sidebar with GHAGGA branding', () => {
    renderLayout();

    expect(screen.getByText('GHAGGA')).toBeInTheDocument();
    expect(screen.getByText('AI Code Review')).toBeInTheDocument();
  });

  it('renders navigation links', () => {
    renderLayout();

    expect(screen.getByText('Dashboard')).toBeInTheDocument();
    expect(screen.getByText('Reviews')).toBeInTheDocument();
    expect(screen.getByText('Settings')).toBeInTheDocument();
    expect(screen.getByText('Memory')).toBeInTheDocument();
    expect(screen.getByText('Global Settings')).toBeInTheDocument();
  });

  it('renders children in main content area', () => {
    renderLayout(<p>Custom page content</p>);

    expect(screen.getByText('Custom page content')).toBeInTheDocument();
  });

  it('renders user section when user is authenticated', () => {
    renderLayout();

    expect(screen.getByText('testuser')).toBeInTheDocument();
    expect(screen.getByAltText('testuser')).toBeInTheDocument();
  });

  it('does not render user section when user is null', () => {
    mockUseAuth.mockReturnValue({ user: null, logout: mockLogout });

    renderLayout();

    expect(screen.queryByText('testuser')).not.toBeInTheDocument();
  });
});
