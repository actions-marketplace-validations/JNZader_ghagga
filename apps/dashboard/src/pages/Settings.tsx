import { useState, useEffect, type FormEvent } from 'react';
import { Card, CardHeader } from '@/components/Card';
import { useRepositories, useSettings, useUpdateSettings } from '@/lib/api';
import { useSelectedRepo } from '@/lib/repo-context';
import { ProviderChainEditor } from '@/components/settings/ProviderChainEditor';
import type { ProviderEntryState } from '@/components/settings/ProviderEntry';
import type { ReviewMode, ProviderChainUpdate } from '@/lib/types';

export function Settings() {
  const { selectedRepo, setSelectedRepo } = useSelectedRepo();
  const { data: repos } = useRepositories();
  const { data: settings, isLoading } = useSettings(selectedRepo);
  const updateSettings = useUpdateSettings();

  // ── Static analysis toggles ─────────────────────────────────
  const [enableSemgrep, setEnableSemgrep] = useState(true);
  const [enableTrivy, setEnableTrivy] = useState(true);
  const [enableCpd, setEnableCpd] = useState(false);
  const [enableMemory, setEnableMemory] = useState(true);

  // ── AI Review toggle ────────────────────────────────────────
  const [aiReviewEnabled, setAiReviewEnabled] = useState(true);

  // ── Provider chain ──────────────────────────────────────────
  const [providerChain, setProviderChain] = useState<ProviderEntryState[]>([]);

  // ── Review mode ─────────────────────────────────────────────
  const [reviewMode, setReviewMode] = useState<ReviewMode>('simple');

  // ── Other settings ──────────────────────────────────────────
  const [customRules, setCustomRules] = useState('');
  const [ignorePatterns, setIgnorePatterns] = useState('');

  // ── Save feedback ───────────────────────────────────────────
  const [saveSuccess, setSaveSuccess] = useState(false);

  // ── Sync form state with fetched settings ───────────────────
  useEffect(() => {
    if (settings) {
      setEnableSemgrep(settings.enableSemgrep);
      setEnableTrivy(settings.enableTrivy);
      setEnableCpd(settings.enableCpd);
      setEnableMemory(settings.enableMemory);
      setAiReviewEnabled(settings.aiReviewEnabled);
      setReviewMode(settings.reviewMode);
      setCustomRules(settings.customRules);
      setIgnorePatterns(settings.ignorePatterns.join('\n'));

      // Map server chain view to local entry state
      setProviderChain(
        settings.providerChain.map((entry) => ({
          provider: entry.provider,
          model: entry.model,
          apiKey: '',
          availableModels: [],
          hasExistingKey: entry.hasApiKey,
          maskedApiKey: entry.maskedApiKey,
          validated: entry.hasApiKey || entry.provider === 'github',
        })),
      );
    }
  }, [settings]);

  // ── Save handler ────────────────────────────────────────────
  const handleSave = async (e: FormEvent) => {
    e.preventDefault();
    if (!selectedRepo) return;

    // Build provider chain for the API
    const chainUpdate: ProviderChainUpdate[] = providerChain.map((entry) => ({
      provider: entry.provider,
      model: entry.model,
      // Only send apiKey if user entered a new one
      ...(entry.apiKey.trim() ? { apiKey: entry.apiKey.trim() } : {}),
    }));

    await updateSettings.mutateAsync({
      repoFullName: selectedRepo,
      aiReviewEnabled,
      providerChain: chainUpdate,
      reviewMode,
      enableSemgrep,
      enableTrivy,
      enableCpd,
      enableMemory,
      customRules,
      ignorePatterns: ignorePatterns
        .split('\n')
        .map((p) => p.trim())
        .filter(Boolean),
    });

    setSaveSuccess(true);
    setTimeout(() => setSaveSuccess(false), 3000);
  };

  return (
    <div>
      {/* Header */}
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-text-primary">Settings</h1>
          <p className="mt-1 text-text-secondary">
            Configure review settings per repository
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
          <div className="mb-4 text-5xl">&#9881;&#65039;</div>
          <h2 className="mb-2 text-xl font-semibold text-text-primary">
            Select a Repository
          </h2>
          <p className="max-w-md text-text-secondary">
            Choose a repository from the dropdown above to configure its review
            settings.
          </p>
        </div>
      ) : isLoading ? (
        <div className="flex items-center justify-center py-20">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary-600 border-t-transparent" />
        </div>
      ) : (
        <form onSubmit={handleSave} className="space-y-6">
          {/* ── Static Analysis ──────────────────────────────── */}
          <Card>
            <CardHeader
              title="Static Analysis"
              description="Configure which static analysis tools run on pull requests"
            />
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {[
                { label: 'Semgrep (security + patterns)', value: enableSemgrep, setter: setEnableSemgrep },
                { label: 'Trivy (vulnerabilities)', value: enableTrivy, setter: setEnableTrivy },
                { label: 'PMD/CPD (code duplication)', value: enableCpd, setter: setEnableCpd },
                { label: 'Memory (project knowledge)', value: enableMemory, setter: setEnableMemory },
              ].map((toggle) => (
                <label
                  key={toggle.label}
                  className="flex cursor-pointer items-center gap-3 rounded-lg border border-surface-border bg-surface-bg p-3 transition-colors hover:border-surface-border/80"
                >
                  <input
                    type="checkbox"
                    checked={toggle.value}
                    onChange={(e) => toggle.setter(e.target.checked)}
                    className="h-4 w-4 accent-primary-600"
                  />
                  <span className="text-sm text-text-primary">
                    {toggle.label}
                  </span>
                </label>
              ))}
            </div>
          </Card>

          {/* ── AI Review ────────────────────────────────────── */}
          <Card>
            <div className="flex items-center justify-between">
              <CardHeader
                title="AI Review"
                description="Enable LLM-powered code review with provider fallback chain"
              />
              <label className="flex cursor-pointer items-center gap-3">
                <span className="text-sm text-text-secondary">
                  {aiReviewEnabled ? 'Enabled' : 'Disabled'}
                </span>
                <div className="relative">
                  <input
                    type="checkbox"
                    checked={aiReviewEnabled}
                    onChange={(e) => setAiReviewEnabled(e.target.checked)}
                    className="peer sr-only"
                  />
                  <div className="h-6 w-11 rounded-full bg-surface-border peer-checked:bg-primary-600 transition-colors" />
                  <div className="absolute left-0.5 top-0.5 h-5 w-5 rounded-full bg-white transition-transform peer-checked:translate-x-5" />
                </div>
              </label>
            </div>

            {aiReviewEnabled && (
              <div className="mt-4 space-y-4">
                {/* Provider Chain */}
                <div>
                  <label className="mb-2 block text-sm font-medium text-text-primary">
                    Provider Chain
                    <span className="ml-2 font-normal text-text-secondary">
                      (ordered by priority — primary first, fallbacks below)
                    </span>
                  </label>
                  <ProviderChainEditor
                    chain={providerChain}
                    onChange={setProviderChain}
                  />
                </div>

                {/* Review Mode */}
                <div>
                  <label className="mb-2 block text-sm font-medium text-text-primary">
                    Review Mode
                  </label>
                  <div className="flex gap-4">
                    {(['simple', 'workflow', 'consensus'] as const).map((mode) => (
                      <label
                        key={mode}
                        className="flex cursor-pointer items-center gap-2"
                      >
                        <input
                          type="radio"
                          name="reviewMode"
                          value={mode}
                          checked={reviewMode === mode}
                          onChange={() => setReviewMode(mode)}
                          className="accent-primary-600"
                        />
                        <span className="text-sm capitalize text-text-primary">
                          {mode}
                        </span>
                      </label>
                    ))}
                  </div>
                  <p className="mt-1 text-xs text-text-secondary">
                    Simple: 1 LLM call &middot; Workflow: 5 specialist agents &middot; Consensus: 3 stances debate
                  </p>
                </div>
              </div>
            )}
          </Card>

          {/* ── Advanced Settings ─────────────────────────────── */}
          <Card>
            <CardHeader
              title="Advanced"
              description="Custom rules and file ignore patterns"
            />

            {/* Custom Rules */}
            <div className="mb-4">
              <label
                htmlFor="customRules"
                className="mb-2 block text-sm font-medium text-text-primary"
              >
                Custom Rules
              </label>
              <textarea
                id="customRules"
                value={customRules}
                onChange={(e) => setCustomRules(e.target.value)}
                placeholder="Add custom review rules..."
                rows={4}
                className="input-field resize-y"
              />
            </div>

            {/* Ignore Patterns */}
            <div>
              <label
                htmlFor="ignorePatterns"
                className="mb-2 block text-sm font-medium text-text-primary"
              >
                Ignore Patterns{' '}
                <span className="font-normal text-text-secondary">
                  (one per line)
                </span>
              </label>
              <textarea
                id="ignorePatterns"
                value={ignorePatterns}
                onChange={(e) => setIgnorePatterns(e.target.value)}
                placeholder={"*.lock\ndist/**\nnode_modules/**"}
                rows={4}
                className="input-field resize-y font-mono text-sm"
              />
            </div>
          </Card>

          {/* ── Save Button ──────────────────────────────────── */}
          <div className="flex items-center gap-4">
            <button
              type="submit"
              disabled={updateSettings.isPending}
              className="btn-primary"
            >
              {updateSettings.isPending ? 'Saving...' : 'Save Settings'}
            </button>
            {saveSuccess && (
              <span className="text-sm text-green-400">
                Settings saved successfully!
              </span>
            )}
            {updateSettings.isError && (
              <span className="text-sm text-red-400">
                Failed to save settings.
              </span>
            )}
          </div>
        </form>
      )}
    </div>
  );
}
