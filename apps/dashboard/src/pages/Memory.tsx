import { useState, useEffect, useRef } from 'react';
import { Card } from '@/components/Card';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { useToast } from '@/components/Toast';
import { cn } from '@/lib/cn';
import {
  useRepositories,
  useMemorySessions,
  useObservations,
  useDeleteObservation,
  useClearRepoMemory,
  usePurgeAllMemory,
  ApiError,
} from '@/lib/api';
import { useSelectedRepo } from '@/lib/repo-context';
import type { MemorySession, Observation } from '@/lib/types';

// ─── Observation Type Config ────────────────────────────────────

const observationTypeConfig: Record<
  Observation['type'],
  { label: string; classes: string }
> = {
  pattern: {
    label: 'Pattern',
    classes: 'bg-purple-500/15 text-purple-400 border-purple-500/25',
  },
  bugfix: {
    label: 'Bug Fix',
    classes: 'bg-red-500/15 text-red-400 border-red-500/25',
  },
  learning: {
    label: 'Learning',
    classes: 'bg-blue-500/15 text-blue-400 border-blue-500/25',
  },
  decision: {
    label: 'Decision',
    classes: 'bg-yellow-500/15 text-yellow-400 border-yellow-500/25',
  },
  architecture: {
    label: 'Architecture',
    classes: 'bg-cyan-500/15 text-cyan-400 border-cyan-500/25',
  },
  config: {
    label: 'Config',
    classes: 'bg-gray-500/15 text-gray-400 border-gray-500/25',
  },
  discovery: {
    label: 'Discovery',
    classes: 'bg-green-500/15 text-green-400 border-green-500/25',
  },
};

// ─── Sub-components ─────────────────────────────────────────────

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

function TrashIcon({ className }: { className?: string }) {
  return (
    <svg
      className={cn('h-4 w-4', className)}
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeWidth={1.5}
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="m14.74 9-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 0 1-2.244 2.077H8.084a2.25 2.25 0 0 1-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 0 0-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 0 1 3.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 0 0-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 0 0-7.5 0"
      />
    </svg>
  );
}

function WarningIcon({ className }: { className?: string }) {
  return (
    <svg
      className={cn('h-5 w-5', className)}
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeWidth={1.5}
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126ZM12 15.75h.007v.008H12v-.008Z"
      />
    </svg>
  );
}

function ObservationCard({
  observation,
  onDelete,
  isDeleting,
}: {
  observation: Observation;
  onDelete: (obs: Observation) => void;
  isDeleting: boolean;
}) {
  return (
    <Card>
      <div className="relative flex items-start gap-3">
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

        {/* Delete button (top-right) */}
        <button
          onClick={() => onDelete(observation)}
          disabled={isDeleting}
          title="Delete observation"
          aria-label={`Delete observation: ${observation.title}`}
          className="absolute right-0 top-0 rounded-md p-1.5 text-text-muted transition-colors hover:bg-red-500/10 hover:text-red-400 disabled:opacity-50"
        >
          <TrashIcon />
        </button>
      </div>
    </Card>
  );
}

// ─── Hooks ──────────────────────────────────────────────────────

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

function getErrorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.status === 404)
      return 'Observation not found — it may have already been deleted.';
    return error.message || 'An error occurred';
  }
  if (error instanceof Error) {
    if (error.message.includes('fetch') || error.message.includes('network'))
      return 'Network error. Please check your connection and try again.';
    return error.message;
  }
  return 'An unexpected error occurred';
}

// ─── Main Component ─────────────────────────────────────────────

export function Memory() {
  const { selectedRepo, setSelectedRepo } = useSelectedRepo();
  const [selectedSessionId, setSelectedSessionId] = useState<number | null>(null);
  const [search, setSearch] = useState('');
  const debouncedSearch = useDebounce(search, 300);
  const { addToast } = useToast();

  // ── Data queries ──────────────────────────────────────────────
  const { data: repos } = useRepositories();
  const { data: sessions, isLoading: sessionsLoading } =
    useMemorySessions(selectedRepo);
  const { data: observations, isLoading: observationsLoading } =
    useObservations(selectedSessionId ?? 0);

  // ── Mutations ─────────────────────────────────────────────────
  const deleteObservation = useDeleteObservation();
  const clearRepoMemory = useClearRepoMemory();
  const purgeAllMemory = usePurgeAllMemory();

  const isMutating =
    deleteObservation.isPending ||
    clearRepoMemory.isPending ||
    purgeAllMemory.isPending;

  // ── Dialog state ──────────────────────────────────────────────
  const [deleteTarget, setDeleteTarget] = useState<Observation | null>(null);
  const [showClearDialog, setShowClearDialog] = useState(false);
  const [showPurgeDialog, setShowPurgeDialog] = useState(false);
  const [dialogError, setDialogError] = useState<string | null>(null);

  // Reset session when repo changes
  const prevRepo = useRef(selectedRepo);
  useEffect(() => {
    if (prevRepo.current !== selectedRepo) {
      setSelectedSessionId(null);
      prevRepo.current = selectedRepo;
    }
  }, [selectedRepo]);

  // ── Computed values ───────────────────────────────────────────
  const totalObservationCount =
    sessions?.reduce((sum, s) => sum + s.observationCount, 0) ?? 0;

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

  // Filter sessions by search
  const filteredSessions = sessions?.filter((session) => {
    if (!debouncedSearch) return true;
    const q = debouncedSearch.toLowerCase();
    return (
      session.summary.toLowerCase().includes(q) ||
      String(session.prNumber).includes(q)
    );
  });

  // ── Handlers ──────────────────────────────────────────────────

  function handleDeleteObservation() {
    if (!deleteTarget) return;
    setDialogError(null);

    deleteObservation.mutate(
      { observationId: deleteTarget.id },
      {
        onSuccess: () => {
          setDeleteTarget(null);
          addToast({ message: 'Observation deleted', type: 'success' });
        },
        onError: (error) => {
          setDialogError(getErrorMessage(error));
        },
      },
    );
  }

  function handleClearRepo() {
    if (!selectedRepo) return;
    setDialogError(null);

    clearRepoMemory.mutate(
      { project: selectedRepo },
      {
        onSuccess: (data) => {
          setShowClearDialog(false);
          addToast({
            message: `Cleared ${data.cleared} observations from ${selectedRepo}`,
            type: 'success',
          });
        },
        onError: (error) => {
          setDialogError(getErrorMessage(error));
        },
      },
    );
  }

  function handlePurgeAll() {
    setDialogError(null);

    purgeAllMemory.mutate(undefined, {
      onSuccess: (data) => {
        setShowPurgeDialog(false);
        addToast({
          message: `Purged ${data.cleared} observations from all repositories`,
          type: 'success',
          duration: 5000,
        });
      },
      onError: (error) => {
        setDialogError(getErrorMessage(error));
      },
    });
  }

  // ── Render ────────────────────────────────────────────────────

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

        <div className="flex items-center gap-3">
          {/* Clear Memory button (Tier 2) — visible when repo selected */}
          {selectedRepo && (
            <button
              onClick={() => {
                setDialogError(null);
                setShowClearDialog(true);
              }}
              disabled={isMutating}
              className="flex items-center gap-2 rounded-lg border border-red-500/30 px-3 py-2 text-sm font-medium text-red-400 transition-colors hover:bg-red-500/10 disabled:opacity-50"
            >
              <TrashIcon />
              Clear Memory
            </button>
          )}

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
                  No memory stored for this repository.
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
                    No observations in this session.
                  </p>
                </div>
              ) : (
                <div className="space-y-4">
                  {filteredObservations?.map((obs) => (
                    <ObservationCard
                      key={obs.id}
                      observation={obs}
                      onDelete={(o) => {
                        setDialogError(null);
                        setDeleteTarget(o);
                      }}
                      isDeleting={isMutating}
                    />
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Danger Zone — Purge All Memory (Tier 3) */}
          <div className="mt-12 rounded-lg border border-red-500/30 p-6">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <WarningIcon className="text-red-400" />
                <div>
                  <h3 className="text-sm font-semibold text-red-400">
                    Danger Zone
                  </h3>
                  <p className="text-sm text-text-secondary">
                    Permanently delete all memory across all repositories.
                  </p>
                </div>
              </div>
              <button
                onClick={() => {
                  setDialogError(null);
                  setShowPurgeDialog(true);
                }}
                disabled={isMutating}
                className="flex items-center gap-2 rounded-lg border border-red-500/50 bg-red-500/10 px-4 py-2 text-sm font-medium text-red-400 transition-colors hover:bg-red-500/20 disabled:opacity-50"
              >
                <WarningIcon className="h-4 w-4" />
                Purge All Memory
              </button>
            </div>
          </div>
        </>
      )}

      {/* ── Tier 1: Delete single observation ──────────────────── */}
      <ConfirmDialog
        open={deleteTarget !== null}
        onConfirm={handleDeleteObservation}
        onCancel={() => {
          if (!deleteObservation.isPending) {
            setDeleteTarget(null);
            setDialogError(null);
          }
        }}
        title="Delete observation"
        description={
          deleteTarget
            ? `Are you sure you want to delete "${deleteTarget.title}"? This action cannot be undone.`
            : ''
        }
        confirmLabel="Delete"
        confirmVariant="danger"
        isLoading={deleteObservation.isPending}
        error={dialogError}
      />

      {/* ── Tier 2: Clear repo memory ─────────────────────────── */}
      <ConfirmDialog
        open={showClearDialog}
        onConfirm={handleClearRepo}
        onCancel={() => {
          if (!clearRepoMemory.isPending) {
            setShowClearDialog(false);
            setDialogError(null);
          }
        }}
        title={`Clear all memory for ${selectedRepo}`}
        description={`This will delete all ${totalObservationCount} observations for this repository. This action cannot be undone.`}
        confirmLabel="Clear Memory"
        confirmVariant="danger"
        confirmText={selectedRepo}
        confirmPlaceholder={`Type "${selectedRepo}" to confirm`}
        isLoading={clearRepoMemory.isPending}
        error={dialogError}
      />

      {/* ── Tier 3: Purge all memory ──────────────────────────── */}
      <ConfirmDialog
        open={showPurgeDialog}
        onConfirm={handlePurgeAll}
        onCancel={() => {
          if (!purgeAllMemory.isPending) {
            setShowPurgeDialog(false);
            setDialogError(null);
          }
        }}
        title="Purge all memory"
        description={`This will permanently delete ALL ${totalObservationCount} observations across ALL your repositories. This action cannot be undone.`}
        confirmLabel="Purge All"
        confirmVariant="danger"
        confirmText="DELETE ALL"
        confirmPlaceholder='Type "DELETE ALL" to confirm'
        countdownSeconds={5}
        isLoading={purgeAllMemory.isPending}
        error={dialogError}
      />
    </div>
  );
}
