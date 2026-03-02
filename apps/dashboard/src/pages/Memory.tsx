import { useState, useEffect, useRef } from 'react';
import { Card } from '@/components/Card';
import { cn } from '@/lib/cn';
import { useRepositories, useMemorySessions, useObservations } from '@/lib/api';
import type { MemorySession, Observation } from '@/lib/types';

const observationTypeConfig: Record<
  Observation['type'],
  { label: string; classes: string }
> = {
  pattern: {
    label: 'Pattern',
    classes: 'bg-purple-500/15 text-purple-400 border-purple-500/25',
  },
  preference: {
    label: 'Preference',
    classes: 'bg-blue-500/15 text-blue-400 border-blue-500/25',
  },
  convention: {
    label: 'Convention',
    classes: 'bg-green-500/15 text-green-400 border-green-500/25',
  },
  issue: {
    label: 'Issue',
    classes: 'bg-red-500/15 text-red-400 border-red-500/25',
  },
  decision: {
    label: 'Decision',
    classes: 'bg-yellow-500/15 text-yellow-400 border-yellow-500/25',
  },
};

function TypeBadge({ type }: { type: Observation['type'] }) {
  const config = observationTypeConfig[type];
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium',
        config.classes,
      )}
    >
      {config.label}
    </span>
  );
}

function SessionItem({
  session,
  isActive,
  onClick,
}: {
  session: MemorySession;
  isActive: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'w-full rounded-lg border px-4 py-3 text-left transition-colors',
        isActive
          ? 'border-primary-500/50 bg-primary-600/10'
          : 'border-surface-border bg-surface-card hover:bg-surface-hover',
      )}
    >
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium text-primary-400">
          PR #{session.prNumber}
        </span>
        <span className="text-xs text-text-muted">
          {session.observationCount} obs
        </span>
      </div>
      <p className="mt-1 line-clamp-2 text-sm text-text-secondary">
        {session.summary}
      </p>
      <p className="mt-1 text-xs text-text-muted">
        {new Date(session.createdAt).toLocaleDateString()}
      </p>
    </button>
  );
}

function ObservationCard({ observation }: { observation: Observation }) {
  return (
    <Card>
      <div className="flex items-start gap-3">
        <TypeBadge type={observation.type} />
        <div className="flex-1">
          <h4 className="text-sm font-medium text-text-primary">
            {observation.title}
          </h4>
          <p className="mt-2 whitespace-pre-wrap text-sm text-text-secondary">
            {observation.content}
          </p>
          {observation.filePaths.length > 0 && (
            <div className="mt-3 flex flex-wrap gap-2">
              {observation.filePaths.map((path) => (
                <span
                  key={path}
                  className="rounded bg-surface-bg px-2 py-1 font-mono text-xs text-text-secondary"
                >
                  {path}
                </span>
              ))}
            </div>
          )}
          <p className="mt-2 text-xs text-text-muted">
            {new Date(observation.createdAt).toLocaleString()}
          </p>
        </div>
      </div>
    </Card>
  );
}

function useDebounce<T>(value: T, delay: number): T {
  const [debouncedValue, setDebouncedValue] = useState(value);

  useEffect(() => {
    const handler = setTimeout(() => {
      setDebouncedValue(value);
    }, delay);

    return () => clearTimeout(handler);
  }, [value, delay]);

  return debouncedValue;
}

export function Memory() {
  const [selectedRepo, setSelectedRepo] = useState('');
  const [selectedSessionId, setSelectedSessionId] = useState<number | null>(null);
  const [search, setSearch] = useState('');
  const debouncedSearch = useDebounce(search, 300);

  const { data: repos } = useRepositories();
  const { data: sessions, isLoading: sessionsLoading } =
    useMemorySessions(selectedRepo);
  const { data: observations, isLoading: observationsLoading } =
    useObservations(selectedSessionId ?? 0);

  // Reset session when repo changes
  const prevRepo = useRef(selectedRepo);
  useEffect(() => {
    if (prevRepo.current !== selectedRepo) {
      setSelectedSessionId(null);
      prevRepo.current = selectedRepo;
    }
  }, [selectedRepo]);

  // Filter observations by search
  const filteredObservations = observations?.filter((obs) => {
    if (!debouncedSearch) return true;
    const q = debouncedSearch.toLowerCase();
    return (
      obs.title.toLowerCase().includes(q) ||
      obs.content.toLowerCase().includes(q) ||
      obs.type.toLowerCase().includes(q) ||
      obs.filePaths.some((p) => p.toLowerCase().includes(q))
    );
  });

  // Filter sessions by search too
  const filteredSessions = sessions?.filter((session) => {
    if (!debouncedSearch) return true;
    const q = debouncedSearch.toLowerCase();
    return (
      session.summary.toLowerCase().includes(q) ||
      String(session.prNumber).includes(q)
    );
  });

  return (
    <div>
      {/* Header */}
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-text-primary">Memory</h1>
          <p className="mt-1 text-text-secondary">
            Browse learned patterns and observations
          </p>
        </div>

        <select
          value={selectedRepo}
          onChange={(e) => setSelectedRepo(e.target.value)}
          className="select-field w-64"
        >
          <option value="">Select a repository</option>
          {repos?.map((repo) => (
            <option key={repo.id} value={repo.fullName}>
              {repo.fullName}
            </option>
          ))}
        </select>
      </div>

      {!selectedRepo ? (
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <div className="mb-4 text-5xl">🧠</div>
          <h2 className="mb-2 text-xl font-semibold text-text-primary">
            Select a Repository
          </h2>
          <p className="max-w-md text-text-secondary">
            Choose a repository to browse memory sessions and observations
            learned from past reviews.
          </p>
        </div>
      ) : (
        <>
          {/* Search */}
          <div className="mb-4">
            <input
              type="text"
              placeholder="Search sessions and observations..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="input-field w-full max-w-md"
            />
          </div>

          <div className="flex gap-6">
            {/* Sessions sidebar */}
            <div className="w-72 flex-shrink-0 space-y-2">
              {sessionsLoading ? (
                <div className="flex items-center justify-center py-12">
                  <div className="h-6 w-6 animate-spin rounded-full border-2 border-primary-600 border-t-transparent" />
                </div>
              ) : (filteredSessions?.length ?? 0) === 0 ? (
                <p className="py-8 text-center text-sm text-text-secondary">
                  No sessions found.
                </p>
              ) : (
                filteredSessions?.map((session) => (
                  <SessionItem
                    key={session.id}
                    session={session}
                    isActive={selectedSessionId === session.id}
                    onClick={() => setSelectedSessionId(session.id)}
                  />
                ))
              )}
            </div>

            {/* Observations main area */}
            <div className="flex-1">
              {!selectedSessionId ? (
                <div className="flex items-center justify-center py-20 text-center">
                  <p className="text-text-secondary">
                    Select a session from the left to view its observations.
                  </p>
                </div>
              ) : observationsLoading ? (
                <div className="flex items-center justify-center py-12">
                  <div className="h-6 w-6 animate-spin rounded-full border-2 border-primary-600 border-t-transparent" />
                </div>
              ) : (filteredObservations?.length ?? 0) === 0 ? (
                <div className="flex items-center justify-center py-20 text-center">
                  <p className="text-text-secondary">
                    No observations found in this session.
                  </p>
                </div>
              ) : (
                <div className="space-y-4">
                  {filteredObservations?.map((obs) => (
                    <ObservationCard key={obs.id} observation={obs} />
                  ))}
                </div>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
