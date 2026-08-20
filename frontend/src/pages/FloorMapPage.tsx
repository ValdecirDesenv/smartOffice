import { useEffect, useMemo, useRef, useState } from 'react';
import { useApp } from '../context/AppContext';
import { api } from '../api/client';
import { Device, DeviceType, Employee, Label, Team, Workspace, WorkspaceAssignment, WorkspaceType } from '../types';
import TopBar from '../components/TopBar';
import FloorMapCanvas from '../components/FloorMap/FloorMapCanvas';
import BackgroundUpload from '../components/FloorMap/BackgroundUpload';
import WorkspaceDetailPanel from '../components/FloorMap/WorkspaceDetailPanel';
import LabelEditor from '../components/FloorMap/LabelEditor';

export default function FloorMapPage() {
  const { loading, currentSite, currentFloor, createSite, createFloor, refresh } = useApp();

  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [labels, setLabels] = useState<Label[]>([]);
  const [assignments, setAssignments] = useState<WorkspaceAssignment[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [teams, setTeams] = useState<Team[]>([]);
  const [devices, setDevices] = useState<Device[]>([]);
  const [workspaceTypes, setWorkspaceTypes] = useState<WorkspaceType[]>([]);
  const [deviceTypes, setDeviceTypes] = useState<DeviceType[]>([]);

  const [editing, setEditing] = useState(false);
  const [selectedWorkspaceId, setSelectedWorkspaceId] = useState<string | null>(null);
  const [selectedLabelId, setSelectedLabelId] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [newSiteName, setNewSiteName] = useState('');
  const [newFloorName, setNewFloorName] = useState('');

  // Guards against out-of-order responses: rapid nudges (e.g. holding an arrow key) can have their
  // PUT requests resolve out of order, so a stale response must not clobber a newer one's result.
  const workspaceMoveSeq = useRef<Map<string, number>>(new Map());
  const labelMoveSeq = useRef<Map<string, number>>(new Map());

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
    reloadFloorData();
    setSelectedWorkspaceId(null);
    setSelectedLabelId(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentFloor]);

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

  const stats = useMemo(
    () => ({
      total: workspaces.length,
      available: workspaces.filter((w) => w.status === 'available').length,
      occupied: workspaces.filter((w) => w.status === 'occupied').length,
      reserved: workspaces.filter((w) => w.status === 'reserved').length,
    }),
    [workspaces]
  );

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
      </div>
    );
  }

  if (!currentFloor) {
    return (
      <div className="mx-auto max-w-md p-10">
        <h1 className="mb-2 text-xl font-bold">{currentSite.name}</h1>
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
      <TopBar search={search} onSearchChange={setSearch} />
      <div className={`grid gap-5 p-6 ${editing ? 'grid-cols-[1fr_300px]' : 'grid-cols-1'}`}>
        <div>
          <h1 className="text-2xl font-bold">
            {currentSite.name} · {currentFloor.name}
          </h1>
          <p className="mb-4 mt-1 text-sm text-slate-500">Interactive workplace map · Live workspace status</p>

          <div className="mb-4 grid grid-cols-4 gap-3">
            {(['total', 'available', 'occupied', 'reserved'] as const).map((key) => (
              <div key={key} className="rounded-xl border border-slate-200 bg-white p-4">
                <div className="text-xs uppercase text-slate-500">{key}</div>
                <b className="mt-1 block text-2xl">{stats[key]}</b>
              </div>
            ))}
          </div>

          <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
            <div className="flex flex-wrap gap-2 border-b border-slate-200 p-2.5">
              <BackgroundUpload floorId={currentFloor.id} onUploaded={refresh} />
              <span className="flex-1" />
              <button
                className={`rounded-lg border px-3 py-2 text-sm ${
                  editing ? 'border-blue-600 bg-blue-600 text-white' : 'border-slate-300 bg-white'
                }`}
                onClick={() => setEditing((e) => !e)}
              >
                {editing ? '✓ Done Editing' : '✎ Edit Desks'}
              </button>
              {editing && (
                <>
                  <button className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm" onClick={handleAddWorkspace}>
                    ＋ Add Desk
                  </button>
                  <button className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm" onClick={handleAddLabel}>
                    🏷 Add Label
                  </button>
                </>
              )}
            </div>

            <FloorMapCanvas
              backgroundUrl={currentFloor.background_image_path ? `/uploads/${currentFloor.background_image_path}` : null}
              editing={editing}
              workspaces={filteredWorkspaces}
              labels={labels}
              selectedWorkspaceId={selectedWorkspaceId}
              selectedLabelId={selectedLabelId}
              onSelectWorkspace={(id) => {
                setSelectedWorkspaceId((prev) => (prev === id ? null : id));
                setSelectedLabelId(null);
              }}
              onSelectLabel={(id) => {
                setSelectedLabelId((prev) => (prev === id ? null : id));
                setSelectedWorkspaceId(null);
              }}
              onMoveWorkspace={handleMoveWorkspace}
              onMoveLabel={handleMoveLabel}
              workspaceTypes={workspaceTypes}
              deviceTypes={deviceTypes}
              selectedWorkspaceEmployee={assignedEmployee}
              selectedWorkspaceEmployeeTeam={assignedEmployeeTeam}
              selectedWorkspaceDevices={workspaceDevices}
            />

            <div className="flex gap-5 border-t border-slate-200 px-3.5 py-2.5 text-xs text-slate-500">
              <span>🟢 Available</span>
              <span>🔴 Occupied</span>
              <span>🟡 Reserved</span>
              <span>🟣 Assigned</span>
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
                onUnassign={handleUnassign}
                onAddDevice={handleAddDevice}
                onRemoveDevice={handleRemoveDevice}
              />
            )}
            {selectedLabel && <LabelEditor label={selectedLabel} onUpdate={handleUpdateLabel} onDelete={handleDeleteLabel} />}
            {!selectedWorkspace && !selectedLabel && (
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
