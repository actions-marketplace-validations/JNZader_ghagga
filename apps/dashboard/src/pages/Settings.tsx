import { useState, useEffect, type FormEvent } from 'react';
import { Card, CardHeader } from '@/components/Card';
import {
  useRepositories,
  useSettings,
  useUpdateSettings,
  useSaveApiKey,
  useDeleteApiKey,
} from '@/lib/api';
import type { ReviewMode, LLMProvider } from '@/lib/types';

export function Settings() {
  const [selectedRepo, setSelectedRepo] = useState('');
  const { data: repos } = useRepositories();
  const { data: settings, isLoading } = useSettings(selectedRepo);
  const updateSettings = useUpdateSettings();
  const saveApiKey = useSaveApiKey();
  const deleteApiKey = useDeleteApiKey();

  // Form state
  const [reviewMode, setReviewMode] = useState<ReviewMode>('simple');
  const [llmProvider, setLlmProvider] = useState<LLMProvider>('anthropic');
  const [llmModel, setLlmModel] = useState('');
  const [enableSemgrep, setEnableSemgrep] = useState(true);
  const [enableTrivy, setEnableTrivy] = useState(true);
  const [enableCpd, setEnableCpd] = useState(false);
  const [enableMemory, setEnableMemory] = useState(true);
  const [customRules, setCustomRules] = useState('');
  const [ignorePatterns, setIgnorePatterns] = useState('');

  // API Key state
  const [newApiKey, setNewApiKey] = useState('');
  const [saveSuccess, setSaveSuccess] = useState(false);

  // Sync form state with fetched settings
  useEffect(() => {
    if (settings) {
      setReviewMode(settings.reviewMode);
      setLlmProvider(settings.llmProvider);
      setLlmModel(settings.llmModel);
      setEnableSemgrep(settings.enableSemgrep);
      setEnableTrivy(settings.enableTrivy);
      setEnableCpd(settings.enableCpd);
      setEnableMemory(settings.enableMemory);
      setCustomRules(settings.customRules);
      setIgnorePatterns(settings.ignorePatterns.join('\n'));
    }
  }, [settings]);

  const handleSaveSettings = async (e: FormEvent) => {
    e.preventDefault();
    if (!selectedRepo) return;

    await updateSettings.mutateAsync({
      repoFullName: selectedRepo,
      reviewMode,
      llmProvider,
      llmModel,
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

  const handleSaveApiKey = async () => {
    if (!selectedRepo || !newApiKey.trim()) return;
    await saveApiKey.mutateAsync({
      repo: selectedRepo,
      apiKey: newApiKey.trim(),
    });
    setNewApiKey('');
  };

  const handleDeleteApiKey = async () => {
    if (!selectedRepo) return;
    await deleteApiKey.mutateAsync(selectedRepo);
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
          <div className="mb-4 text-5xl">⚙️</div>
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
        <div className="space-y-6">
          {/* Review Settings */}
          <Card>
            <CardHeader
              title="Review Configuration"
              description="Configure how GHAGGA reviews pull requests for this repository"
            />

            <form onSubmit={handleSaveSettings} className="space-y-6">
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
              </div>

              {/* LLM Provider */}
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div>
                  <label
                    htmlFor="llmProvider"
                    className="mb-2 block text-sm font-medium text-text-primary"
                  >
                    LLM Provider
                  </label>
                  <select
                    id="llmProvider"
                    value={llmProvider}
                    onChange={(e) => setLlmProvider(e.target.value as LLMProvider)}
                    className="select-field"
                  >
                    <option value="anthropic">Anthropic</option>
                    <option value="openai">OpenAI</option>
                    <option value="google">Google</option>
                  </select>
                </div>

                <div>
                  <label
                    htmlFor="llmModel"
                    className="mb-2 block text-sm font-medium text-text-primary"
                  >
                    LLM Model
                  </label>
                  <input
                    id="llmModel"
                    type="text"
                    value={llmModel}
                    onChange={(e) => setLlmModel(e.target.value)}
                    placeholder="e.g. claude-sonnet-4-20250514"
                    className="input-field"
                  />
                </div>
              </div>

              {/* Toggles */}
              <div>
                <label className="mb-3 block text-sm font-medium text-text-primary">
                  Analysis Tools
                </label>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  {[
                    { label: 'Enable Semgrep', value: enableSemgrep, setter: setEnableSemgrep },
                    { label: 'Enable Trivy', value: enableTrivy, setter: setEnableTrivy },
                    { label: 'Enable CPD', value: enableCpd, setter: setEnableCpd },
                    { label: 'Enable Memory', value: enableMemory, setter: setEnableMemory },
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
              </div>

              {/* Custom Rules */}
              <div>
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

              {/* Save Button */}
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
          </Card>

          {/* API Key Section */}
          <Card>
            <CardHeader
              title="API Key"
              description="Manage the LLM API key for this repository"
            />

            {settings?.hasApiKey ? (
              <div className="flex items-center gap-4">
                <div className="flex-1">
                  <p className="text-sm text-text-secondary">
                    Current key:{' '}
                    <code className="rounded bg-surface-bg px-2 py-1 font-mono text-text-primary">
                      {settings.maskedApiKey || '••••••••••••'}
                    </code>
                  </p>
                </div>
                <button
                  onClick={handleDeleteApiKey}
                  disabled={deleteApiKey.isPending}
                  className="btn-danger text-sm"
                >
                  {deleteApiKey.isPending ? 'Removing...' : 'Remove Key'}
                </button>
              </div>
            ) : (
              <div className="flex items-end gap-4">
                <div className="flex-1">
                  <label
                    htmlFor="apiKey"
                    className="mb-2 block text-sm font-medium text-text-primary"
                  >
                    API Key
                  </label>
                  <input
                    id="apiKey"
                    type="password"
                    value={newApiKey}
                    onChange={(e) => setNewApiKey(e.target.value)}
                    placeholder="sk-..."
                    className="input-field"
                  />
                </div>
                <button
                  onClick={handleSaveApiKey}
                  disabled={saveApiKey.isPending || !newApiKey.trim()}
                  className="btn-primary"
                >
                  {saveApiKey.isPending ? 'Saving...' : 'Save Key'}
                </button>
              </div>
            )}
          </Card>
        </div>
      )}
    </div>
  );
}
