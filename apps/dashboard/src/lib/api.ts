import {
  useQuery,
  useMutation,
  useQueryClient,
} from '@tanstack/react-query';
import type {
  ReviewsResponse,
  Stats,
  Repository,
  RepositorySettings,
  MemorySession,
  Observation,
} from './types';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3000';

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

// ─── Reviews ──────────────────────────────────────────────

export function useReviews(repo?: string, page: number = 1) {
  const params = new URLSearchParams();
  if (repo) params.set('repo', repo);
  params.set('page', String(page));

  return useQuery<ReviewsResponse>({
    queryKey: ['reviews', repo, page],
    queryFn: () => fetchApi(`/api/reviews?${params.toString()}`),
  });
}

// ─── Stats ────────────────────────────────────────────────

export function useStats(repo: string) {
  return useQuery<Stats>({
    queryKey: ['stats', repo],
    queryFn: () => fetchApi(`/api/stats?repo=${encodeURIComponent(repo)}`),
    enabled: !!repo,
  });
}

// ─── Repositories ─────────────────────────────────────────

export function useRepositories() {
  return useQuery<Repository[]>({
    queryKey: ['repositories'],
    queryFn: () => fetchApi('/api/repositories'),
  });
}

// ─── Settings ─────────────────────────────────────────────

export function useSettings(repo: string) {
  return useQuery<RepositorySettings>({
    queryKey: ['settings', repo],
    queryFn: () =>
      fetchApi(`/api/settings?repo=${encodeURIComponent(repo)}`),
    enabled: !!repo,
  });
}

export function useUpdateSettings() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (settings: Partial<RepositorySettings> & { repoFullName: string }) =>
      fetchApi<RepositorySettings>('/api/settings', {
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

// ─── API Keys ─────────────────────────────────────────────

export function useSaveApiKey() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (payload: { repo: string; apiKey: string }) =>
      fetchApi<{ maskedKey: string }>('/api/settings/api-key', {
        method: 'POST',
        body: JSON.stringify(payload),
      }),
    onSuccess: (_data, variables) => {
      void queryClient.invalidateQueries({
        queryKey: ['settings', variables.repo],
      });
    },
  });
}

export function useDeleteApiKey() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (repo: string) =>
      fetchApi<void>(`/api/settings/api-key?repo=${encodeURIComponent(repo)}`, {
        method: 'DELETE',
      }),
    onSuccess: (_data, repo) => {
      void queryClient.invalidateQueries({
        queryKey: ['settings', repo],
      });
    },
  });
}

// ─── Memory ───────────────────────────────────────────────

export function useMemorySessions(project: string) {
  return useQuery<MemorySession[]>({
    queryKey: ['memory', 'sessions', project],
    queryFn: () =>
      fetchApi(`/api/memory/sessions?project=${encodeURIComponent(project)}`),
    enabled: !!project,
  });
}

export function useObservations(sessionId: number) {
  return useQuery<Observation[]>({
    queryKey: ['memory', 'observations', sessionId],
    queryFn: () => fetchApi(`/api/memory/sessions/${sessionId}/observations`),
    enabled: !!sessionId,
  });
}
