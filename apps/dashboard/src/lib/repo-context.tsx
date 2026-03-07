import { createContext, type ReactNode, useContext, useState } from 'react';

interface RepoContextValue {
  selectedRepo: string;
  setSelectedRepo: (repo: string) => void;
}

const RepoContext = createContext<RepoContextValue | null>(null);

const STORAGE_KEY = 'ghagga_selected_repo';

export function RepoProvider({ children }: { children: ReactNode }) {
  const [selectedRepo, setSelectedRepoState] = useState(() => {
    try {
      return localStorage.getItem(STORAGE_KEY) ?? '';
    } catch {
      return '';
    }
  });

  const setSelectedRepo = (repo: string) => {
    setSelectedRepoState(repo);
    try {
      if (repo) {
        localStorage.setItem(STORAGE_KEY, repo);
      } else {
        localStorage.removeItem(STORAGE_KEY);
      }
    } catch {
      // localStorage not available
    }
  };

  return (
    <RepoContext.Provider value={{ selectedRepo, setSelectedRepo }}>
      {children}
    </RepoContext.Provider>
  );
}

export function useSelectedRepo() {
  const ctx = useContext(RepoContext);
  if (!ctx) {
    throw new Error('useSelectedRepo must be used within a RepoProvider');
  }
  return ctx;
}
