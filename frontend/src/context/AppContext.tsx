import { createContext, useCallback, useContext, useEffect, useMemo, useState, ReactNode } from 'react';
import { api } from '../api/client';
import { Employee, Floor, Site, Workspace, WorkspaceAssignment } from '../types';

export interface FloorStats {
  total: number;
  available: number;
  occupied: number;
  reserved: number;
}

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
  // Floor Map page state mirrored here so the Sidebar can render the editing toggle and the
  // background-upload/stats readout without the two components needing a parent-child relationship.
  editing: boolean;
  setEditing: (v: boolean) => void;
  floorStats: FloorStats | null;
  setFloorStats: (s: FloorStats | null) => void;
  // A site/floor-independent directory used for the "search a person, jump to their desk"
  // feature - loaded once for the whole app rather than scoped to the currently viewed site.
  directoryEmployees: Employee[];
  directoryWorkspaces: Workspace[];
  directoryAssignments: WorkspaceAssignment[];
  refreshDirectory: () => Promise<void>;
  // Navigates to a specific site + floor directly, unlike selectSite (which always lands on
  // that site's first floor) - used to jump straight to wherever a searched-for desk actually is.
  goToLocation: (siteId: string, floorId: string) => Promise<void>;
}

const AppContext = createContext<AppContextValue | undefined>(undefined);

export function AppProvider({ children }: { children: ReactNode }) {
  const [loading, setLoading] = useState(true);
  const [sites, setSites] = useState<Site[]>([]);
  const [floors, setFloors] = useState<Floor[]>([]);
  const [currentSiteId, setCurrentSiteId] = useState<string | null>(null);
  const [currentFloorId, setCurrentFloorId] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [floorStats, setFloorStats] = useState<FloorStats | null>(null);
  const [directoryEmployees, setDirectoryEmployees] = useState<Employee[]>([]);
  const [directoryWorkspaces, setDirectoryWorkspaces] = useState<Workspace[]>([]);
  const [directoryAssignments, setDirectoryAssignments] = useState<WorkspaceAssignment[]>([]);

  const refreshDirectory = useCallback(async () => {
    const [emps, ws, as] = await Promise.all([api.employees.list({}), api.workspaces.list({}), api.assignments.list({})]);
    setDirectoryEmployees(emps);
    setDirectoryWorkspaces(ws);
    setDirectoryAssignments(as);
  }, []);

  useEffect(() => {
    refreshDirectory();
  }, [refreshDirectory]);

  // Switching floors invalidates whatever the previous floor's editing/stats state was.
  useEffect(() => {
    setEditing(false);
    setFloorStats(null);
  }, [currentFloorId]);

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

  const goToLocation = useCallback(
    async (siteId: string, floorId: string) => {
      if (siteId !== currentSiteId) {
        setCurrentSiteId(siteId);
        const loadedFloors = await api.floors.list(siteId);
        setFloors(loadedFloors);
      }
      setCurrentFloorId(floorId);
    },
    [currentSiteId]
  );

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
    editing,
    setEditing,
    floorStats,
    setFloorStats,
    directoryEmployees,
    directoryWorkspaces,
    directoryAssignments,
    refreshDirectory,
    goToLocation,
  };

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

export function useApp(): AppContextValue {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error('useApp must be used within AppProvider');
  return ctx;
}
