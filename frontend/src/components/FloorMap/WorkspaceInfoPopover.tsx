import { Device, DeviceType, Employee, Team, Workspace, WorkspaceType } from '../../types';

const STATUS_DOT: Record<string, string> = {
  available: 'bg-emerald-500',
  occupied: 'bg-red-500',
  reserved: 'bg-amber-500',
  assigned: 'bg-indigo-500',
  inactive: 'bg-slate-400',
};

interface WorkspaceInfoPopoverProps {
  workspace: Workspace;
  workspaceType: WorkspaceType | null;
  assignedEmployee: Employee | null;
  assignedEmployeeTeam: Team | null;
  devices: Device[];
  deviceTypes: DeviceType[];
  style: React.CSSProperties;
  onClose: () => void;
}

export default function WorkspaceInfoPopover({
  workspace,
  workspaceType,
  assignedEmployee,
  assignedEmployeeTeam,
  devices,
  deviceTypes,
  style,
  onClose,
}: WorkspaceInfoPopoverProps) {
  return (
    <div style={style} className="w-64 rounded-xl border border-slate-200 bg-white p-4 shadow-xl">
      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className={`h-2.5 w-2.5 rounded-full ${STATUS_DOT[workspace.status] ?? 'bg-slate-400'}`} />
          <span className="font-bold">{workspace.code}</span>
          <span className="text-xs capitalize text-slate-500">{workspace.status}</span>
        </div>
        <button className="text-slate-400 hover:text-slate-600" onClick={onClose} aria-label="Close">
          ✕
        </button>
      </div>

      <div className="mb-2">
        <div className="text-[11px] uppercase tracking-wide text-slate-500">Seated here</div>
        {assignedEmployee ? (
          <div className="text-sm">
            <div className="font-medium">{assignedEmployee.name}</div>
            {assignedEmployee.job_title && <div className="text-xs text-slate-500">{assignedEmployee.job_title}</div>}
            {assignedEmployeeTeam && <div className="text-xs text-slate-500">{assignedEmployeeTeam.name}</div>}
          </div>
        ) : (
          <div className="text-sm text-slate-400">Unassigned</div>
        )}
      </div>

      <div className="mb-2">
        <div className="text-[11px] uppercase tracking-wide text-slate-500">Devices</div>
        {devices.length === 0 ? (
          <div className="text-sm text-slate-400">None</div>
        ) : (
          <ul className="text-sm">
            {devices.map((d) => (
              <li key={d.id}>{d.name || deviceTypes.find((t) => t.id === d.device_type_id)?.label}</li>
            ))}
          </ul>
        )}
      </div>

      {workspaceType && <div className="text-xs text-slate-400">{workspaceType.label}</div>}
    </div>
  );
}
