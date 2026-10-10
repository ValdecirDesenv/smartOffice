import { useState } from 'react';
import { Device, DeviceType, Employee, Team, Workspace } from '../../types';

const STATUS_DOT: Record<string, string> = {
  available: 'bg-emerald-500',
  occupied: 'bg-red-500',
  reserved: 'bg-amber-500',
  assigned: 'bg-indigo-500',
  inactive: 'bg-slate-400',
};

interface WorkspaceInfoPopoverProps {
  workspace: Workspace;
  assignedEmployee: Employee | null;
  assignedEmployeeTeam: Team | null;
  devices: Device[];
  deviceTypes: DeviceType[];
  style: React.CSSProperties;
  onClose: () => void;
}

export default function WorkspaceInfoPopover({
  workspace,
  assignedEmployee,
  assignedEmployeeTeam,
  devices,
  deviceTypes,
  style,
  onClose,
}: WorkspaceInfoPopoverProps) {
  const [photoEnlarged, setPhotoEnlarged] = useState(false);

  return (
    <div style={style} className="w-64 rounded-xl border border-slate-200 bg-white p-4 shadow-xl">
      <div className="mb-3 flex items-start justify-between">
        <div className="flex items-center gap-2">
          <span className={`h-2.5 w-2.5 rounded-full ${STATUS_DOT[workspace.status] ?? 'bg-slate-400'}`} />
          <span className="font-bold">{workspace.code}</span>
          <span className="text-xs capitalize text-slate-500">{workspace.status}</span>
        </div>
        <div className="flex items-start gap-2">
          {assignedEmployee?.headshot_url && (
            <img
              src={assignedEmployee.headshot_url}
              alt={assignedEmployee.name}
              onClick={() => setPhotoEnlarged(true)}
              onMouseLeave={() => setPhotoEnlarged(false)}
              className={`h-8 w-8 shrink-0 cursor-pointer rounded-full border-2 border-slate-400 object-cover transition-transform duration-150 ${
                photoEnlarged ? 'z-10 scale-[2.25]' : 'scale-100'
              }`}
            />
          )}
          <button className="text-slate-400 hover:text-slate-600" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>
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
        {/* Only devices with a serial are shown here - a generic undifferentiated device (e.g.
            a dock with no serial on file) adds clutter without telling anyone anything useful;
            serial number is specifically what the MDM desk-tracking pipeline keys off of (a
            monitor's serial identifies the desk, a desktop's serial identifies the Mac mini),
            so that's the bar for "worth surfacing here" rather than every device row that exists. */}
        {(() => {
          const serializedDevices = devices.filter((d) => d.serial_number);
          if (serializedDevices.length === 0) {
            return <div className="text-sm text-slate-400">None</div>;
          }
          return (
            <ul className="space-y-1 text-sm">
              {serializedDevices.map((d) => {
                const typeLabel = deviceTypes.find((t) => t.id === d.device_type_id)?.label ?? 'Device';
                return (
                  <li key={d.id}>
                    <span className="font-medium">{typeLabel}</span>
                    <span className="text-slate-500">: {d.serial_number}</span>
                  </li>
                );
              })}
            </ul>
          );
        })()}
      </div>
    </div>
  );
}
