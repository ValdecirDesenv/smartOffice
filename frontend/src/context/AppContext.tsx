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
  selectSite: (id: string) => Promise<void>;
  createSite: (name: string) => Promise<void>;
  renameSite: (id: string, name: string) => Promise<void>;
  deleteSite: (id: string) => Promise<void>;
  createFloor: (name: string) => Promise<void>;
  renameFloor: (id: string, name: string) => Promise<void>;
  deleteFloor: (id: string) => Promise<void>;
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

  const selectSite = useCallback(async (id: string) => {
    setCurrentSiteId(id);
    const loadedFloors = await api.floors.list(id);
    setFloors(loadedFloors);
    setCurrentFloorId(loadedFloors[0]?.id ?? null);
  }, []);

  const createSite = useCallback(
    async (name: string) => {
      const created = await api.sites.create({ name });
      await api.sites.list().then(setSites);
      await selectSite(created.id);
    },
    [selectSite]
  );

  const renameSite = useCallback(
    async (id: string, name: string) => {
      const site = sites.find((s) => s.id === id);
      if (!site) return;
      await api.sites.update(id, { ...site, name });
      await refresh();
    },
    [sites, refresh]
  );

  const deleteSite = useCallback(
    async (id: string) => {
      await api.sites.remove(id);
      await refresh();
    },
    [refresh]
  );

  const createFloor = useCallback(
    async (name: string) => {
      if (!currentSiteId) return;
      const created = await api.floors.create({ site_id: currentSiteId, name });
      const loadedFloors = await api.floors.list(currentSiteId);
      setFloors(loadedFloors);
      setCurrentFloorId(created.id);
    },
    [currentSiteId]
  );

  const renameFloor = useCallback(
    async (id: string, name: string) => {
      const floor = floors.find((f) => f.id === id);
      if (!floor) return;
      await api.floors.update(id, { ...floor, name });
      await refresh();
    },
    [floors, refresh]
  );

  const deleteFloor = useCallback(
    async (id: string) => {
      await api.floors.remove(id);
      await refresh();
    },
    [refresh]
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
    selectSite,
    createSite,
    renameSite,
    deleteSite,
    createFloor,
    renameFloor,
    deleteFloor,
    refresh,
  };

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

export function useApp(): AppContextValue {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error('useApp must be used within AppProvider');
  return ctx;
}
