import { createContext, useContext, useEffect, useState, ReactNode } from 'react';
import { toast } from '@/hooks/use-toast';

export type AppMode = 'mock' | 'live';

interface ModeContextValue {
  mode: AppMode;
  setMode: (m: AppMode) => void;
  isMock: boolean;
  isLive: boolean;
  /**
   * Guard for write actions that require a real backend.
   * In `mock` mode → runs the action.
   * In `live`  mode → shows a toast and returns false.
   */
  requireMock: (featureName?: string) => boolean;
  /**
   * Pick between a mock value (shown in mock mode) and a fallback
   * (shown in live mode while no real backend is connected).
   */
  pick: <T,>(mockValue: T, liveValue: T) => T;
}

const ModeContext = createContext<ModeContextValue | null>(null);
const STORAGE_KEY = 'agentmesh:mode';

// Module-level mirror of current mode so non-React modules
// (e.g. the mock API client) can branch on it without a hook.
let currentMode: AppMode =
  typeof window !== 'undefined'
    ? ((localStorage.getItem(STORAGE_KEY) as AppMode) || 'mock')
    : 'mock';

export function getCurrentMode(): AppMode {
  return currentMode;
}

export function ModeProvider({ children }: { children: ReactNode }) {
  const [mode, setModeState] = useState<AppMode>(() => currentMode);

  useEffect(() => {
    currentMode = mode;
    localStorage.setItem(STORAGE_KEY, mode);
  }, [mode]);

  const setMode = (m: AppMode) => {
    setModeState(m);
    currentMode = m;
    toast({
      title: m === 'live' ? '🔌 Live mode' : '🧪 Mock mode',
      description:
        m === 'live'
          ? 'Showing real backend data only. Lists are empty until the API is connected.'
          : 'Using simulated data and actions. No backend calls.',
    });
  };

  const requireMock = (featureName = 'This action') => {
    if (mode === 'mock') return true;
    toast({
      title: 'Live backend not connected',
      description: `${featureName} needs a real API. Switch to Mock mode in the navbar to try it now.`,
      variant: 'destructive',
    });
    return false;
  };

  function pick<T>(mockValue: T, liveValue: T): T {
    return mode === 'mock' ? mockValue : liveValue;
  }

  return (
    <ModeContext.Provider
      value={{
        mode,
        setMode,
        isMock: mode === 'mock',
        isLive: mode === 'live',
        requireMock,
        pick,
      }}
    >
      {children}
    </ModeContext.Provider>
  );
}

export function useMode() {
  const ctx = useContext(ModeContext);
  if (!ctx) throw new Error('useMode must be used within ModeProvider');
  return ctx;
}
