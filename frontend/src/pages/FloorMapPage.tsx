import { useEffect, useMemo, useRef, useState } from 'react';
import { useApp } from '../context/AppContext';
import { useAuth } from '../context/AuthContext';
import { api } from '../api/client';
import { Device, DeviceType, Employee, Label, Team, Workspace, WorkspaceAssignment, WorkspaceType } from '../types';
import TopBar from '../components/TopBar';
import FloorMapCanvas from '../components/FloorMap/FloorMapCanvas';
import WorkspaceDetailPanel from '../components/FloorMap/WorkspaceDetailPanel';
import DeviceDetailPanel from '../components/FloorMap/DeviceDetailPanel';
import LabelEditor from '../components/FloorMap/LabelEditor';

export default function FloorMapPage() {
  const {
    loading,
    sites,
    currentSite,
    currentFloor,
    createSite,
    createFloor,
    editing,
    setFloorStats,
    directoryEmployees,
    directoryWorkspaces,
    directoryAssignments,
    goToLocation,
  } = useApp();
  const { canEdit } = useAuth();

  // Set when a search result points at a desk on a different floor/site: the workspace to
  // select once that floor's own data has finished loading (see the reloadFloorData effect).
  const pendingSelectionRef = useRef<string | null>(null);

  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [labels, setLabels] = useState<Label[]>([]);
  const [assignments, setAssignments] = useState<WorkspaceAssignment[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [teams, setTeams] = useState<Team[]>([]);
  const [devices, setDevices] = useState<Device[]>([]);
  const [workspaceTypes, setWorkspaceTypes] = useState<WorkspaceType[]>([]);
  const [deviceTypes, setDeviceTypes] = useState<DeviceType[]>([]);

  const [selectedWorkspaceId, setSelectedWorkspaceId] = useState<string | null>(null);
  const [selectedLabelId, setSelectedLabelId] = useState<string | null>(null);
  const [selectedDeviceId, setSelectedDeviceId] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [newSiteName, setNewSiteName] = useState('');
  const [newFloorName, setNewFloorName] = useState('');

  // Guards against out-of-order responses: rapid nudges (e.g. holding an arrow key) can have their
  // PUT requests resolve out of order, so a stale response must not clobber a newer one's result.
  const workspaceMoveSeq = useRef<Map<string, number>>(new Map());
  const labelMoveSeq = useRef<Map<string, number>>(new Map());
  const deviceMoveSeq = useRef<Map<string, number>>(new Map());

  useEffect(() => {
    api.workspaceTypes.list().then(setWorkspaceTypes);
    api.deviceTypes.list().then(setDeviceTypes);
  }, []);

  useEffect(() => {
    if (!currentSite) return;
    api.employees.list({ siteId: currentSite.id }).then(setEmployees);
    api.devices.list({ siteId: currentSite.id }).then(setDevices);
    api.teams.list(currentSite.id).then(setTeams);
  }, [currentSite]);

  async function reloadFloorData() {
    if (!currentFloor) {
      setWorkspaces([]);
      setLabels([]);
      setAssignments([]);
      return;
    }
    const [ws, ls, as] = await Promise.all([
      api.workspaces.list({ floorId: currentFloor.id }),
      api.labels.list(currentFloor.id),
      api.assignments.list({}),
    ]);
    setWorkspaces(ws);
    setLabels(ls);
    setAssignments(as);
  }

  useEffect(() => {
    const target = pendingSelectionRef.current;
    pendingSelectionRef.current = null;
    setSelectedWorkspaceId(null);
    setSelectedLabelId(null);
    setSelectedDeviceId(null);
    reloadFloorData().then(() => {
      if (target) setSelectedWorkspaceId(target);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentFloor]);

  const mapDevices = useMemo(
    () => (currentFloor ? devices.filter((d) => d.floor_id === currentFloor.id) : []),
    [devices, currentFloor]
  );
  const selectedDevice = mapDevices.find((d) => d.id === selectedDeviceId) ?? null;

  const filteredWorkspaces = useMemo(() => {
    if (!search.trim()) return workspaces;
    const q = search.toLowerCase();
    return workspaces.filter((w) => {
      if (w.code.toLowerCase().includes(q)) return true;
      const assignment = assignments.find((a) => a.workspace_id === w.id);
      const employee = assignment && employees.find((e) => e.id === assignment.employee_id);
      return employee?.name.toLowerCase().includes(q) ?? false;
    });
  }, [workspaces, search, assignments, employees]);

  // Local-floor lookup, used only by the on-canvas search-filter below (filteredWorkspaces).
  const employeeWorkspace = useMemo(() => {
    const map = new Map<string, Workspace>();
    for (const a of assignments) {
      const w = workspaces.find((x) => x.id === a.workspace_id);
      if (w) map.set(a.employee_id, w);
    }
    return map;
  }, [assignments, workspaces]);

  // Desks whose occupant is flagged inactive (e.g. a former employee per the HubSpot sync) -
  // rendered in a distinct warning color on the map so it's clear the desk should be unassigned.
  const flaggedWorkspaceIds = useMemo(() => {
    const inactiveEmployeeIds = new Set(employees.filter((e) => e.status === 'inactive').map((e) => e.id));
    const ids = new Set<string>();
    for (const a of assignments) {
      if (inactiveEmployeeIds.has(a.employee_id)) ids.add(a.workspace_id);
    }
    return ids;
  }, [assignments, employees]);

  // App-wide lookup (every site/floor, not just the one currently open) so the search box can
  // find and jump to a person regardless of where they're actually seated.
  const directoryEmployeeWorkspace = useMemo(() => {
    const map = new Map<string, Workspace>();
    for (const a of directoryAssignments) {
      const w = directoryWorkspaces.find((x) => x.id === a.workspace_id);
      if (w) map.set(a.employee_id, w);
    }
    return map;
  }, [directoryAssignments, directoryWorkspaces]);

  const peopleMatches = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return [];
    return directoryEmployees
      .filter((e) => e.name.toLowerCase().includes(q))
      .slice(0, 8)
      .map((e) => {
        const workspace = directoryEmployeeWorkspace.get(e.id) ?? null;
        const siteName = workspace ? sites.find((s) => s.id === workspace.site_id)?.name ?? null : null;
        return { employee: e, workspace, siteName };
      });
  }, [search, directoryEmployees, directoryEmployeeWorkspace, sites]);

  function handleSelectPerson(employeeId: string) {
    setSearch('');
    const w = directoryEmployeeWorkspace.get(employeeId);
    if (!w) return;
    if (currentFloor && w.floor_id === currentFloor.id) {
      setSelectedWorkspaceId(w.id);
      setSelectedLabelId(null);
      setSelectedDeviceId(null);
    } else {
      pendingSelectionRef.current = w.id;
      goToLocation(w.site_id, w.floor_id);
    }
  }

  const stats = useMemo(
    () => ({
      total: workspaces.length,
      available: workspaces.filter((w) => w.status === 'available').length,
      occupied: workspaces.filter((w) => w.status === 'occupied').length,
      reserved: workspaces.filter((w) => w.status === 'reserved').length,
    }),
    [workspaces]
  );

  // Mirrored into AppContext so the Sidebar's collapsible "Floor Details" section can show it
  // without FloorMapPage and Sidebar needing a parent-child relationship. Cleared only on
  // unmount (not on every stats change) so it doesn't flicker null between updates.
  useEffect(() => {
    setFloorStats(stats);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stats]);
  useEffect(() => () => setFloorStats(null), [setFloorStats]);

  const selectedWorkspace = workspaces.find((w) => w.id === selectedWorkspaceId) ?? null;
  const selectedLabel = labels.find((l) => l.id === selectedLabelId) ?? null;
  const selectedAssignment = selectedWorkspace
    ? assignments.find((a) => a.workspace_id === selectedWorkspace.id) ?? null
    : null;
  const assignedEmployee = selectedAssignment ? employees.find((e) => e.id === selectedAssignment.employee_id) ?? null : null;
  const assignedEmployeeTeam = assignedEmployee ? teams.find((t) => t.id === assignedEmployee.team_id) ?? null : null;
  const assignedEmployeeIds = new Set(assignments.map((a) => a.employee_id));
  const unassignedEmployees = employees.filter((e) => !assignedEmployeeIds.has(e.id));
  const workspaceDevices = selectedWorkspace ? devices.filter((d) => d.workspace_id === selectedWorkspace.id) : [];

  if (loading) return <div className="p-6 text-sm text-slate-500">Loading…</div>;

  if (!currentSite) {
    return (
      <div className="mx-auto max-w-md p-10">
        <h1 className="mb-2 text-xl font-bold">Welcome to SmartOffice</h1>
        {canEdit ? (
          <>
            <p className="mb-4 text-sm text-slate-600">No site exists yet. Create the first one to get started.</p>
            <div className="flex gap-2">
              <input
                className="flex-1 rounded-md border border-slate-300 px-3 py-2 text-sm"
                placeholder="Site name (e.g. Toronto Office)"
                value={newSiteName}
                onChange={(e) => setNewSiteName(e.target.value)}
              />
              <button
                className="rounded-md bg-blue-600 px-4 py-2 text-sm text-white"
                onClick={() => newSiteName.trim() && createSite(newSiteName.trim()).then(() => setNewSiteName(''))}
              >
                Create
              </button>
            </div>
          </>
        ) : (
          <p className="text-sm text-slate-600">No site exists yet.</p>
        )}
      </div>
    );
  }

  if (!currentFloor) {
    return (
      <div className="mx-auto max-w-md p-10">
        <h1 className="mb-2 text-xl font-bold">{currentSite.name}</h1>
        {canEdit ? (
          <>
            <p className="mb-4 text-sm text-slate-600">This site has no floors yet. Create the first one.</p>
            <div className="flex gap-2">
              <input
                className="flex-1 rounded-md border border-slate-300 px-3 py-2 text-sm"
                placeholder="Floor name (e.g. Floor 2)"
                value={newFloorName}
                onChange={(e) => setNewFloorName(e.target.value)}
              />
              <button
                className="rounded-md bg-blue-600 px-4 py-2 text-sm text-white"
                onClick={() => newFloorName.trim() && createFloor(newFloorName.trim()).then(() => setNewFloorName(''))}
              >
                Create
              </button>
            </div>
          </>
        ) : (
          <p className="text-sm text-slate-600">This site has no floors yet.</p>
        )}
      </div>
    );
  }

  async function handleMoveWorkspace(id: string, posX: number, posY: number) {
    const w = workspaces.find((x) => x.id === id);
    if (!w) return;
    const seq = (workspaceMoveSeq.current.get(id) ?? 0) + 1;
    workspaceMoveSeq.current.set(id, seq);
    const updated = await api.workspaces.update(id, { ...w, pos_x: posX, pos_y: posY });
    if (workspaceMoveSeq.current.get(id) !== seq) return;
    setWorkspaces((prev) => prev.map((x) => (x.id === id ? updated : x)));
  }

  async function handleMoveLabel(id: string, posX: number, posY: number) {
    const l = labels.find((x) => x.id === id);
    if (!l) return;
    const seq = (labelMoveSeq.current.get(id) ?? 0) + 1;
    labelMoveSeq.current.set(id, seq);
    const updated = await api.labels.update(id, { ...l, pos_x: posX, pos_y: posY });
    if (labelMoveSeq.current.get(id) !== seq) return;
    setLabels((prev) => prev.map((x) => (x.id === id ? updated : x)));
  }

  async function handleMoveDevice(id: string, posX: number, posY: number) {
    const d = devices.find((x) => x.id === id);
    if (!d) return;
    const seq = (deviceMoveSeq.current.get(id) ?? 0) + 1;
    deviceMoveSeq.current.set(id, seq);
    const updated = await api.devices.update(id, { ...d, pos_x: posX, pos_y: posY });
    if (deviceMoveSeq.current.get(id) !== seq) return;
    setDevices((prev) => prev.map((x) => (x.id === id ? updated : x)));
  }

  async function handleUpdateMapDevice(patch: Partial<Device>) {
    if (!selectedDevice) return;
    const updated = await api.devices.update(selectedDevice.id, { ...selectedDevice, ...patch });
    setDevices((prev) => prev.map((x) => (x.id === updated.id ? updated : x)));
  }

  async function handleDeleteMapDevice() {
    if (!selectedDevice) return;
    await api.devices.remove(selectedDevice.id);
    setDevices((prev) => prev.filter((x) => x.id !== selectedDevice.id));
    setSelectedDeviceId(null);
  }

  async function handleAddMapDevice() {
    if (!currentFloor || !currentSite || !deviceTypes[0]) return;
    const created = await api.devices.create({
      site_id: currentSite.id,
      floor_id: currentFloor.id,
      device_type_id: deviceTypes[0].id,
      pos_x: 45,
      pos_y: 45,
    });
    setDevices((prev) => [...prev, created]);
    setSelectedDeviceId(created.id);
    setSelectedWorkspaceId(null);
    setSelectedLabelId(null);
  }

  async function handleUpdateWorkspace(patch: Partial<Workspace>) {
    if (!selectedWorkspace) return;
    const updated = await api.workspaces.update(selectedWorkspace.id, { ...selectedWorkspace, ...patch });
    setWorkspaces((prev) => prev.map((x) => (x.id === updated.id ? updated : x)));
  }

  async function handleDeleteWorkspace() {
    if (!selectedWorkspace) return;
    await api.workspaces.remove(selectedWorkspace.id);
    setSelectedWorkspaceId(null);
    await reloadFloorData();
  }

  async function handleAssign(employeeId: string) {
    if (!selectedWorkspace) return;
    await api.assignments.create({ workspace_id: selectedWorkspace.id, employee_id: employeeId });
    await reloadFloorData();
  }

  async function handleCreateAndAssign(name: string) {
    if (!selectedWorkspace || !currentSite) return;
    const created = await api.employees.create({ site_id: currentSite.id, name });
    setEmployees((prev) => [...prev, created]);
    await api.assignments.create({ workspace_id: selectedWorkspace.id, employee_id: created.id });
    await reloadFloorData();
  }

  async function handleUnassign() {
    if (!selectedAssignment) return;
    await api.assignments.remove(selectedAssignment.id);
    await reloadFloorData();
  }

  async function handleAddDevice(deviceTypeId: string, name: string) {
    if (!selectedWorkspace || !currentSite) return;
    const created = await api.devices.create({
      site_id: currentSite.id,
      workspace_id: selectedWorkspace.id,
      device_type_id: deviceTypeId,
      name: name || undefined,
    });
    setDevices((prev) => [...prev, created]);
  }

  async function handleRemoveDevice(deviceId: string) {
    await api.devices.remove(deviceId);
    setDevices((prev) => prev.filter((d) => d.id !== deviceId));
  }

  async function handleAddWorkspace() {
    if (!currentFloor || !currentSite || !workspaceTypes[0]) return;
    let n = 1;
    const existingCodes = new Set(workspaces.map((w) => w.code));
    while (existingCodes.has(`N-${String(n).padStart(2, '0')}`)) n++;
    const created = await api.workspaces.create({
      site_id: currentSite.id,
      floor_id: currentFloor.id,
      workspace_type_id: workspaceTypes[0].id,
      code: `N-${String(n).padStart(2, '0')}`,
      pos_x: 45,
      pos_y: 45,
    });
    setWorkspaces((prev) => [...prev, created]);
    setSelectedWorkspaceId(created.id);
    setSelectedLabelId(null);
  }

  async function handleAddLabel() {
    if (!currentFloor) return;
    const created = await api.labels.create({ floor_id: currentFloor.id, text: 'New Label', pos_x: 45, pos_y: 45 });
    setLabels((prev) => [...prev, created]);
    setSelectedLabelId(created.id);
    setSelectedWorkspaceId(null);
  }

  async function handleUpdateLabel(patch: Partial<Label>) {
    if (!selectedLabel) return;
    const updated = await api.labels.update(selectedLabel.id, { ...selectedLabel, ...patch });
    setLabels((prev) => prev.map((x) => (x.id === updated.id ? updated : x)));
  }

  async function handleDeleteLabel() {
    if (!selectedLabel) return;
    await api.labels.remove(selectedLabel.id);
    setSelectedLabelId(null);
    await reloadFloorData();
  }

  return (
    <>
      <TopBar search={search} onSearchChange={setSearch} peopleMatches={peopleMatches} onSelectPerson={handleSelectPerson} />
      <div className={`grid gap-3 p-4 ${editing ? 'grid-cols-[minmax(0,1fr)_300px]' : 'grid-cols-[minmax(0,1fr)]'}`}>
        <div className="min-w-0">
          <h1 className="text-lg font-bold">
            {currentSite.name} · {currentFloor.name}
          </h1>
          <p className="mb-2 mt-0.5 text-xs text-slate-500">Interactive workplace map · Live workspace status</p>

          <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
            {editing && (
              <div className="flex flex-wrap gap-2 border-b border-slate-200 p-2.5">
                <button className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm" onClick={handleAddWorkspace}>
                  ＋ Add Desk
                </button>
                <button className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm" onClick={handleAddLabel}>
                  🏷 Add Label
                </button>
                <button className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm" onClick={handleAddMapDevice}>
                  📺 Add Device
                </button>
              </div>
            )}

            <FloorMapCanvas
              backgroundUrl={currentFloor.background_image_path ? `/uploads/${currentFloor.background_image_path}` : null}
              editing={editing}
              workspaces={filteredWorkspaces}
              labels={labels}
              mapDevices={mapDevices}
              selectedWorkspaceId={selectedWorkspaceId}
              selectedLabelId={selectedLabelId}
              selectedDeviceId={selectedDeviceId}
              onSelectWorkspace={(id) => {
                setSelectedWorkspaceId((prev) => (prev === id ? null : id));
                setSelectedLabelId(null);
                setSelectedDeviceId(null);
              }}
              onSelectLabel={(id) => {
                setSelectedLabelId((prev) => (prev === id ? null : id));
                setSelectedWorkspaceId(null);
                setSelectedDeviceId(null);
              }}
              onSelectDevice={(id) => {
                setSelectedDeviceId((prev) => (prev === id ? null : id));
                setSelectedWorkspaceId(null);
                setSelectedLabelId(null);
              }}
              onMoveWorkspace={handleMoveWorkspace}
              onMoveLabel={handleMoveLabel}
              onMoveDevice={handleMoveDevice}
              workspaceTypes={workspaceTypes}
              deviceTypes={deviceTypes}
              selectedWorkspaceEmployee={assignedEmployee}
              selectedWorkspaceEmployeeTeam={assignedEmployeeTeam}
              selectedWorkspaceDevices={workspaceDevices}
              flaggedWorkspaceIds={flaggedWorkspaceIds}
            />

            <div className="flex gap-5 border-t border-slate-200 px-3.5 py-2.5 text-xs text-slate-500">
              <span>🟢 Available</span>
              <span>🔴 Occupied</span>
              <span>🟡 Reserved</span>
              <span>🟣 Assigned</span>
              <span>🟠 Should be unassigned</span>
            </div>
          </div>
        </div>

        {editing && (
          <div>
            {selectedWorkspace && (
              <WorkspaceDetailPanel
                workspace={selectedWorkspace}
                workspaceTypes={workspaceTypes}
                assignedEmployee={assignedEmployee}
                unassignedEmployees={unassignedEmployees}
                devices={workspaceDevices}
                deviceTypes={deviceTypes}
                onUpdate={handleUpdateWorkspace}
                onDelete={handleDeleteWorkspace}
                onAssign={handleAssign}
                onCreateAndAssign={handleCreateAndAssign}
                onUnassign={handleUnassign}
                onAddDevice={handleAddDevice}
                onRemoveDevice={handleRemoveDevice}
              />
            )}
            {selectedLabel && <LabelEditor label={selectedLabel} onUpdate={handleUpdateLabel} onDelete={handleDeleteLabel} />}
            {selectedDevice && (
              <DeviceDetailPanel
                device={selectedDevice}
                deviceTypes={deviceTypes}
                onUpdate={handleUpdateMapDevice}
                onDelete={handleDeleteMapDevice}
              />
            )}
            {!selectedWorkspace && !selectedLabel && !selectedDevice && (
              <div className="rounded-xl border border-slate-200 bg-white p-4 text-sm text-slate-500">
                Click a desk on the map.
              </div>
            )}
          </div>
        )}
      </div>
    </>
  );
}
