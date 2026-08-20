import { useEffect, useRef, useState } from 'react';
import { Device, DeviceType, Employee, Workspace, WorkspaceStatus, WorkspaceType } from '../../types';

const STATUS_OPTIONS: WorkspaceStatus[] = ['available', 'occupied', 'reserved', 'assigned', 'inactive'];

interface WorkspaceDetailPanelProps {
  workspace: Workspace;
  workspaceTypes: WorkspaceType[];
  assignedEmployee: Employee | null;
  unassignedEmployees: Employee[];
  devices: Device[];
  deviceTypes: DeviceType[];
  onUpdate: (patch: Partial<Workspace>) => void;
  onDelete: () => void;
  onAssign: (employeeId: string) => void;
  onUnassign: () => void;
  onAddDevice: (deviceTypeId: string, name: string) => void;
  onRemoveDevice: (deviceId: string) => void;
}

export default function WorkspaceDetailPanel({
  workspace,
  workspaceTypes,
  assignedEmployee,
  unassignedEmployees,
  devices,
  deviceTypes,
  onUpdate,
  onDelete,
  onAssign,
  onUnassign,
  onAddDevice,
  onRemoveDevice,
}: WorkspaceDetailPanelProps) {
  const [newDeviceTypeId, setNewDeviceTypeId] = useState(deviceTypes[0]?.id ?? '');
  const [newDeviceName, setNewDeviceName] = useState('');
  const [posXText, setPosXText] = useState(String(workspace.pos_x ?? 0));
  const [posYText, setPosYText] = useState(String(workspace.pos_y ?? 0));
  const xFocused = useRef(false);
  const yFocused = useRef(false);

  // Switching desks always shows the newly-selected desk's real position. This must not be gated by
  // xFocused/yFocused: selecting a desk on the canvas calls preventDefault() on pointerdown (needed to
  // suppress the browser's own drag), which as a side effect also suppresses the blur that would
  // normally clear a stale "focused" flag left over from the previously-selected desk's input.
  useEffect(() => {
    xFocused.current = false;
    yFocused.current = false;
    setPosXText(String(workspace.pos_x ?? 0));
    setPosYText(String(workspace.pos_y ?? 0));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspace.id]);

  // Picks up a canvas drag on the *same* desk, skipping whichever field is genuinely focused right now
  // so an in-progress edit to one field isn't overwritten by the other field's commit.
  useEffect(() => {
    if (!xFocused.current) setPosXText(String(workspace.pos_x ?? 0));
    if (!yFocused.current) setPosYText(String(workspace.pos_y ?? 0));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspace.pos_x, workspace.pos_y]);

  function updatePos(xText: string, yText: string) {
    const x = parseFloat(xText);
    const y = parseFloat(yText);
    if (Number.isFinite(x) && Number.isFinite(y)) onUpdate({ pos_x: x, pos_y: y });
  }

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4">
      <div className="mb-3">
        <label className="mb-1 block text-[11px] uppercase tracking-wide text-slate-500">Desk code</label>
        <input
          className="w-full rounded-md border border-slate-300 px-2.5 py-2 text-sm"
          value={workspace.code}
          onChange={(e) => onUpdate({ code: e.target.value })}
        />
      </div>

      <div className="mb-3">
        <label className="mb-1 block text-[11px] uppercase tracking-wide text-slate-500">Position (% of floor)</label>
        <div className="flex gap-2">
          <div className="flex-1">
            <span className="mb-1 block text-[10px] text-slate-400">X</span>
            <input
              type="number"
              step="0.01"
              className="w-full rounded-md border border-slate-300 px-2.5 py-2 text-sm"
              value={posXText}
              onFocus={() => (xFocused.current = true)}
              onChange={(e) => {
                setPosXText(e.target.value);
                updatePos(e.target.value, posYText);
              }}
              onBlur={() => {
                xFocused.current = false;
                updatePos(posXText, posYText);
              }}
            />
          </div>
          <div className="flex-1">
            <span className="mb-1 block text-[10px] text-slate-400">Y</span>
            <input
              type="number"
              step="0.01"
              className="w-full rounded-md border border-slate-300 px-2.5 py-2 text-sm"
              value={posYText}
              onFocus={() => (yFocused.current = true)}
              onChange={(e) => {
                setPosYText(e.target.value);
                updatePos(posXText, e.target.value);
              }}
              onBlur={() => {
                yFocused.current = false;
                updatePos(posXText, posYText);
              }}
            />
          </div>
        </div>
      </div>

      <div className="mb-3">
        <label className="mb-1 block text-[11px] uppercase tracking-wide text-slate-500">Type</label>
        <select
          className="w-full rounded-md border border-slate-300 px-2.5 py-2 text-sm"
          value={workspace.workspace_type_id}
          onChange={(e) => onUpdate({ workspace_type_id: e.target.value })}
        >
          {workspaceTypes.map((t) => (
            <option key={t.id} value={t.id}>
              {t.label}
            </option>
          ))}
        </select>
      </div>

      <div className="mb-3">
        <label className="mb-1 block text-[11px] uppercase tracking-wide text-slate-500">Status</label>
        <select
          className="w-full rounded-md border border-slate-300 px-2.5 py-2 text-sm"
          value={workspace.status}
          onChange={(e) => onUpdate({ status: e.target.value as WorkspaceStatus })}
        >
          {STATUS_OPTIONS.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
      </div>

      <div className="mb-3">
        <label className="mb-1 block text-[11px] uppercase tracking-wide text-slate-500">Assigned employee</label>
        {assignedEmployee ? (
          <div className="flex items-center justify-between rounded-md border border-slate-300 px-2.5 py-2 text-sm">
            <span>{assignedEmployee.name}</span>
            <button className="text-xs text-red-600" onClick={onUnassign}>
              Unassign
            </button>
          </div>
        ) : (
          <select
            className="w-full rounded-md border border-slate-300 px-2.5 py-2 text-sm"
            defaultValue=""
            onChange={(e) => e.target.value && onAssign(e.target.value)}
          >
            <option value="" disabled>
              Select an employee…
            </option>
            {unassignedEmployees.map((e) => (
              <option key={e.id} value={e.id}>
                {e.name}
              </option>
            ))}
          </select>
        )}
      </div>

      <div className="mb-3">
        <label className="mb-1 block text-[11px] uppercase tracking-wide text-slate-500">Devices at this desk</label>
        <ul className="mb-2 text-sm">
          {devices.map((d) => (
            <li key={d.id} className="flex items-center justify-between border-b border-slate-100 py-1">
              <span>{d.name || deviceTypes.find((t) => t.id === d.device_type_id)?.label}</span>
              <button className="text-xs text-red-600" onClick={() => onRemoveDevice(d.id)}>
                Remove
              </button>
            </li>
          ))}
        </ul>
        <div className="flex flex-wrap gap-2">
          <select
            className="min-w-0 rounded-md border border-slate-300 px-2 py-1.5 text-sm"
            value={newDeviceTypeId}
            onChange={(e) => setNewDeviceTypeId(e.target.value)}
          >
            {deviceTypes.map((t) => (
              <option key={t.id} value={t.id}>
                {t.label}
              </option>
            ))}
          </select>
          <input
            className="min-w-0 flex-1 rounded-md border border-slate-300 px-2 py-1.5 text-sm"
            placeholder="Name (optional)"
            value={newDeviceName}
            onChange={(e) => setNewDeviceName(e.target.value)}
          />
          <button
            className="rounded-md bg-blue-600 px-3 py-1.5 text-sm text-white"
            onClick={() => {
              if (!newDeviceTypeId) return;
              onAddDevice(newDeviceTypeId, newDeviceName);
              setNewDeviceName('');
            }}
          >
            Add
          </button>
        </div>
      </div>

      <button className="w-full rounded-lg bg-indigo-50 py-2.5 text-sm font-bold text-red-600" onClick={onDelete}>
        🗑 Delete Desk
      </button>
    </div>
  );
}
