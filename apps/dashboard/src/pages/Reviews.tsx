import { useState } from 'react';
import { Card } from '@/components/Card';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { SeverityBadge } from '@/components/SeverityBadge';
import { StatusBadge } from '@/components/StatusBadge';
import { useToast } from '@/components/Toast';
import { useDeleteRepoReviews, useRepositories, useReviews } from '@/lib/api';
import { useSelectedRepo } from '@/lib/repo-context';
import type { Finding, Review, ReviewStatus } from '@/lib/types';

function ReviewDetail({ review, onClose }: { review: Review; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <Card className="max-h-[80vh] w-full max-w-4xl overflow-y-auto" padding="lg">
        {/* Header */}
        <div className="mb-4 flex items-start justify-between">
          <div>
            <div className="flex items-center gap-3">
              <StatusBadge status={review.status} />
              <span className="text-sm text-text-secondary">
                {review.repo} #{review.prNumber}
              </span>
            </div>
            <p className="mt-2 text-sm text-text-secondary">
              {new Date(review.createdAt).toLocaleString()} &middot; Mode:{' '}
              <span className="capitalize">{review.mode}</span>
            </p>
          </div>
          <button
            onClick={onClose}
            className="rounded-md p-1.5 text-text-muted transition-colors hover:bg-surface-hover hover:text-text-secondary"
          >
            <svg
              className="h-5 w-5"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={1.5}
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Summary */}
        <div className="mb-6">
          <h3 className="mb-2 text-sm font-medium text-text-secondary">Summary</h3>
          <p className="whitespace-pre-wrap text-sm text-text-primary">{review.summary}</p>
        </div>

        {/* Findings */}
        {review.findings.length > 0 && (
          <div>
            <h3 className="mb-3 text-sm font-medium text-text-secondary">
              Findings ({review.findings.length})
            </h3>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-surface-border text-left">
                    <th className="pb-2 pr-4 font-medium text-text-secondary">Severity</th>
                    <th className="pb-2 pr-4 font-medium text-text-secondary">Category</th>
                    <th className="pb-2 pr-4 font-medium text-text-secondary">Location</th>
                    <th className="pb-2 pr-4 font-medium text-text-secondary">Message</th>
                    <th className="pb-2 font-medium text-text-secondary">Suggestion</th>
                  </tr>
                </thead>
                <tbody>
                  {review.findings.map((finding: Finding, idx: number) => (
                    <tr key={idx} className="border-b border-surface-border/50">
                      <td className="py-2.5 pr-4">
                        <SeverityBadge severity={finding.severity} />
                      </td>
                      <td className="py-2.5 pr-4 text-text-secondary">{finding.category}</td>
                      <td className="py-2.5 pr-4 font-mono text-xs text-primary-400">
                        {finding.file}:{finding.line}
                      </td>
                      <td className="py-2.5 pr-4 text-text-primary">{finding.message}</td>
                      <td className="py-2.5 text-text-secondary">{finding.suggestion || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </Card>
    </div>
  );
}

export function Reviews() {
  const { selectedRepo, setSelectedRepo } = useSelectedRepo();
  const [statusFilter, setStatusFilter] = useState<ReviewStatus | ''>('');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [selectedReview, setSelectedReview] = useState<Review | null>(null);
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [includeMemory, setIncludeMemory] = useState(false);

  const { addToast } = useToast();
  const { data: repos } = useRepositories();
  const { data, isLoading } = useReviews(selectedRepo || undefined, page);
  const deleteReviews = useDeleteRepoReviews();

  const reviews = data?.reviews ?? [];
  const total = data?.total ?? 0;
  const pageSize = data?.pageSize ?? 20;
  const totalPages = Math.ceil(total / pageSize);

  // Client-side filtering for status and search
  const filteredReviews = reviews.filter((review: Review) => {
    if (statusFilter && review.status !== statusFilter) return false;
    if (search) {
      const q = search.toLowerCase();
      return (
        review.repo.toLowerCase().includes(q) ||
        review.summary.toLowerCase().includes(q) ||
        String(review.prNumber).includes(q)
      );
    }
    return true;
  });

  return (
    <div>
      {/* Header */}
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-text-primary">Reviews</h1>
        <p className="mt-1 text-text-secondary">Browse your code review history</p>
      </div>

      {/* Filters */}
      <div className="mb-6 flex flex-wrap items-center gap-4">
        <select
          value={selectedRepo}
          onChange={(e) => {
            setSelectedRepo(e.target.value);
            setPage(1);
          }}
          className="select-field w-56"
        >
          <option value="">All repositories</option>
          {repos?.map((repo) => (
            <option key={repo.id} value={repo.fullName}>
              {repo.fullName}
            </option>
          ))}
        </select>

        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value as ReviewStatus | '')}
          className="select-field w-44"
        >
          <option value="">All statuses</option>
          <option value="PASSED">Passed</option>
          <option value="FAILED">Failed</option>
          <option value="NEEDS_HUMAN_REVIEW">Needs Review</option>
          <option value="SKIPPED">Skipped</option>
        </select>

        <input
          type="text"
          placeholder="Search reviews..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="input-field w-64"
        />

        {selectedRepo && (
          <button
            type="button"
            onClick={() => setShowDeleteDialog(true)}
            className="ml-auto rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-red-700"
          >
            Delete Reviews
          </button>
        )}
      </div>

      {/* Table */}
      <Card padding="none">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-surface-border text-left">
                <th className="px-6 py-3 font-medium text-text-secondary">Status</th>
                <th className="px-6 py-3 font-medium text-text-secondary">Repository</th>
                <th className="px-6 py-3 font-medium text-text-secondary">PR #</th>
                <th className="px-6 py-3 font-medium text-text-secondary">Mode</th>
                <th className="px-6 py-3 font-medium text-text-secondary">Date</th>
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                <tr>
                  <td colSpan={5} className="px-6 py-12 text-center">
                    <div className="inline-block h-6 w-6 animate-spin rounded-full border-2 border-primary-600 border-t-transparent" />
                  </td>
                </tr>
              ) : filteredReviews.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-6 py-12 text-center text-text-secondary">
                    No reviews found.
                  </td>
                </tr>
              ) : (
                filteredReviews.map((review: Review) => (
                  <tr
                    key={review.id}
                    onClick={() => setSelectedReview(review)}
                    className="cursor-pointer border-b border-surface-border/50 transition-colors hover:bg-surface-hover"
                  >
                    <td className="px-6 py-3">
                      <StatusBadge status={review.status} />
                    </td>
                    <td className="px-6 py-3 font-medium text-text-primary">{review.repo}</td>
                    <td className="px-6 py-3 text-primary-400">#{review.prNumber}</td>
                    <td className="px-6 py-3 capitalize text-text-secondary">{review.mode}</td>
                    <td className="px-6 py-3 text-text-secondary">
                      {new Date(review.createdAt).toLocaleDateString()}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="flex items-center justify-between border-t border-surface-border px-6 py-3">
            <p className="text-sm text-text-secondary">
              Page {page} of {totalPages} ({total} total)
            </p>
            <div className="flex gap-2">
              <button
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page <= 1}
                className="btn-secondary px-3 py-1.5 text-sm"
              >
                Previous
              </button>
              <button
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                disabled={page >= totalPages}
                className="btn-secondary px-3 py-1.5 text-sm"
              >
                Next
              </button>
            </div>
          </div>
        )}
      </Card>

      {/* Detail Modal */}
      {selectedReview && (
        <ReviewDetail review={selectedReview} onClose={() => setSelectedReview(null)} />
      )}

      {/* Delete Reviews Confirmation Dialog */}
      <ConfirmDialog
        open={showDeleteDialog}
        title={`Delete all reviews for ${selectedRepo}?`}
        description="This will permanently delete all review history and stats for this repository. This action cannot be undone."
        confirmText={selectedRepo}
        confirmLabel="Delete Reviews"
        confirmVariant="danger"
        isLoading={deleteReviews.isPending}
        error={deleteReviews.error?.message ?? null}
        onConfirm={() => {
          deleteReviews.mutate(
            { repoFullName: selectedRepo, includeMemory },
            {
              onSuccess: (data) => {
                setShowDeleteDialog(false);
                setIncludeMemory(false);
                addToast({
                  message: `Deleted ${data.deletedReviews} review${data.deletedReviews === 1 ? '' : 's'} for ${selectedRepo}`,
                  type: 'success',
                });
              },
            },
          );
        }}
        onCancel={() => {
          setShowDeleteDialog(false);
          setIncludeMemory(false);
          deleteReviews.reset();
        }}
      >
        <label className="mt-3 flex cursor-pointer items-center gap-2 text-sm text-text-secondary">
          <input
            type="checkbox"
            checked={includeMemory}
            onChange={(e) => setIncludeMemory(e.target.checked)}
            className="h-4 w-4 rounded border-surface-border"
          />
          Also clear memory observations for this repository
        </label>
      </ConfirmDialog>
    </div>
  );
}
