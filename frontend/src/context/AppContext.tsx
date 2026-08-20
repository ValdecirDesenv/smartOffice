import { createContext, useCallback, useContext, useEffect, useMemo, useState, ReactNode } from 'react';
import { api } from '../api/client';
import { Floor, Site } from '../types';

interface AppContextValue {
  loading: boolean;
  sites: Site[];
  floors: Floor[];
  currentSite: Site | null;
  currentFloor: Floor | null;
  setCurrentFloorId: (id: string) => void;
  createSite: (name: string) => Promise<void>;
  createFloor: (name: string) => Promise<void>;
  refresh: () => Promise<void>;
}

const AppContext = createContext<AppContextValue | undefined>(undefined);

export function AppProvider({ children }: { children: ReactNode }) {
  const [loading, setLoading] = useState(true);
  const [sites, setSites] = useState<Site[]>([]);
  const [floors, setFloors] = useState<Floor[]>([]);
  const [currentSiteId, setCurrentSiteId] = useState<string | null>(null);
  const [currentFloorId, setCurrentFloorId] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const loadedSites = await api.sites.list();
      setSites(loadedSites);
      // Single-site principle (per docs/PROJECT_PLAN.md): just auto-select the first site.
      const siteId = loadedSites[0]?.id ?? null;
      setCurrentSiteId((prev) => (prev && loadedSites.some((s) => s.id === prev) ? prev : siteId));

      if (siteId) {
        const loadedFloors = await api.floors.list(siteId);
        setFloors(loadedFloors);
        setCurrentFloorId((prev) => (prev && loadedFloors.some((f) => f.id === prev) ? prev : loadedFloors[0]?.id ?? null));
      } else {
        setFloors([]);
        setCurrentFloorId(null);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const createSite = useCallback(
    async (name: string) => {
      await api.sites.create({ name });
      await refresh();
    },
    [refresh]
  );

  const createFloor = useCallback(
    async (name: string) => {
      if (!currentSiteId) return;
      await api.floors.create({ site_id: currentSiteId, name });
      await refresh();
    },
    [currentSiteId, refresh]
  );

  const currentSite = useMemo(() => sites.find((s) => s.id === currentSiteId) ?? null, [sites, currentSiteId]);
  const currentFloor = useMemo(() => floors.find((f) => f.id === currentFloorId) ?? null, [floors, currentFloorId]);

  const value: AppContextValue = {
    loading,
    sites,
    floors,
    currentSite,
    currentFloor,
    setCurrentFloorId,
    createSite,
    createFloor,
    refresh,
  };

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

export function useApp(): AppContextValue {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error('useApp must be used within AppProvider');
  return ctx;
}
