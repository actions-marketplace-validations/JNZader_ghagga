import {
  useQuery,
  useMutation,
  useQueryClient,
} from '@tanstack/react-query';
import type {
  Review,
  ReviewsResponse,
  Stats,
  Repository,
  RepositorySettings,
  Installation,
  InstallationSettings,
  MemorySession,
  Observation,
  ValidationResponse,
  SaaSProvider,
  RunnerStatus,
  RunnerCreateResult,
  RunnerConfigureResult,
} from './types';

const API_URL =
  import.meta.env.VITE_API_URL ||
  (window.location.hostname === 'localhost'
    ? 'http://localhost:3000'
    : 'https://ghagga.onrender.com');

class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

async function fetchApi<T>(path: string, options?: RequestInit): Promise<T> {
  const token = localStorage.getItem('ghagga_token');
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options?.headers as Record<string, string>),
  };

  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  const response = await fetch(`${API_URL}${path}`, {
    ...options,
    headers,
  });

  if (!response.ok) {
    const message = await response.text().catch(() => 'Request failed');
    throw new ApiError(response.status, message);
  }

  return response.json() as Promise<T>;
}

/**
 * Unwrap server responses that use `{ data: T }` envelope.
 * All GET endpoints return `{ data: ... }` for consistency.
 */
async function fetchData<T>(path: string, options?: RequestInit): Promise<T> {
  const result = await fetchApi<{ data: T }>(path, options);
  return result.data;
}

// ─── Reviews ──────────────────────────────────────────────

export function useReviews(repo?: string, page: number = 1) {
  const params = new URLSearchParams();
  if (repo) params.set('repo', repo);
  params.set('page', String(page));

  return useQuery<ReviewsResponse>({
    queryKey: ['reviews', repo, page],
    queryFn: async () => {
      const result = await fetchApi<{
        data: Review[];
        pagination: { page: number; limit: number; offset: number };
      }>(`/api/reviews?${params.toString()}`);
      return {
        reviews: result.data,
        total: result.data.length,
        page: result.pagination.page,
        pageSize: result.pagination.limit,
      };
    },
  });
}

// ─── Stats ────────────────────────────────────────────────

export function useStats(repo: string) {
  return useQuery<Stats>({
    queryKey: ['stats', repo],
    queryFn: () => fetchData<Stats>(`/api/stats?repo=${encodeURIComponent(repo)}`),
    enabled: !!repo,
  });
}

// ─── Repositories ─────────────────────────────────────────

export function useRepositories() {
  return useQuery<Repository[]>({
    queryKey: ['repositories'],
    queryFn: () => fetchData<Repository[]>('/api/repositories'),
  });
}

// ─── Settings ─────────────────────────────────────────────

export function useSettings(repo: string) {
  return useQuery<RepositorySettings>({
    queryKey: ['settings', repo],
    queryFn: () =>
      fetchData<RepositorySettings>(`/api/settings?repo=${encodeURIComponent(repo)}`),
    enabled: !!repo,
  });
}

export function useUpdateSettings() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (settings: Record<string, unknown> & { repoFullName: string }) =>
      fetchApi<{ message: string }>('/api/settings', {
        method: 'PUT',
        body: JSON.stringify(settings),
      }),
    onSuccess: (_data, variables) => {
      void queryClient.invalidateQueries({
        queryKey: ['settings', variables.repoFullName],
      });
    },
  });
}

// ─── Provider Validation ──────────────────────────────────

export function useValidateProvider() {
  return useMutation({
    mutationFn: (payload: { provider: SaaSProvider; apiKey?: string }) =>
      fetchApi<ValidationResponse>('/api/providers/validate', {
        method: 'POST',
        body: JSON.stringify(payload),
      }),
  });
}

// ─── Installations ────────────────────────────────────────

export function useInstallations() {
  return useQuery<Installation[]>({
    queryKey: ['installations'],
    queryFn: () => fetchData<Installation[]>('/api/installations'),
  });
}

export function useInstallationSettings(installationId: number) {
  return useQuery<InstallationSettings>({
    queryKey: ['installation-settings', installationId],
    queryFn: () =>
      fetchData<InstallationSettings>(
        `/api/installation-settings?installation_id=${installationId}`,
      ),
    enabled: !!installationId,
  });
}

export function useUpdateInstallationSettings() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (settings: Record<string, unknown> & { installationId: number }) =>
      fetchApi<{ message: string }>('/api/installation-settings', {
        method: 'PUT',
        body: JSON.stringify(settings),
      }),
    onSuccess: (_data, variables) => {
      void queryClient.invalidateQueries({
        queryKey: ['installation-settings', variables.installationId],
      });
      // Also invalidate repo settings since they may show global values
      void queryClient.invalidateQueries({ queryKey: ['settings'] });
    },
  });
}

// ─── Memory ───────────────────────────────────────────────

export function useMemorySessions(project: string) {
  return useQuery<MemorySession[]>({
    queryKey: ['memory', 'sessions', project],
    queryFn: () =>
      fetchData<MemorySession[]>(`/api/memory/sessions?project=${encodeURIComponent(project)}`),
    enabled: !!project,
  });
}

export function useObservations(sessionId: number) {
  return useQuery<Observation[]>({
    queryKey: ['memory', 'observations', sessionId],
    queryFn: () => fetchData<Observation[]>(`/api/memory/sessions/${sessionId}/observations`),
    enabled: !!sessionId,
  });
}

// ─── Runner ───────────────────────────────────────────────

export function useRunnerStatus(ownerLogin?: string) {
  return useQuery<RunnerStatus>({
    queryKey: ['runner', 'status', ownerLogin],
    queryFn: () => fetchData<RunnerStatus>('/api/runner/status'),
    enabled: !!ownerLogin,
    staleTime: 30_000,
    retry: 1,
  });
}

export function useCreateRunner() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: () =>
      fetchApi<{ data: RunnerCreateResult }>('/api/runner/create', {
        method: 'POST',
      }).then((res) => res.data),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['runner', 'status'] });
    },
  });
}

export function useConfigureRunnerSecret() {
  return useMutation({
    mutationFn: () =>
      fetchApi<{ data: RunnerConfigureResult }>('/api/runner/configure-secret', {
        method: 'POST',
      }).then((res) => res.data),
  });
}

export { ApiError };
