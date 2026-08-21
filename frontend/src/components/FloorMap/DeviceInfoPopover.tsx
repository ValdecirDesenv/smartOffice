import { Device, DeviceType } from '../../types';

interface DeviceInfoPopoverProps {
  device: Device;
  deviceType: DeviceType | null;
  style: React.CSSProperties;
  onClose: () => void;
}

export default function DeviceInfoPopover({ device, deviceType, style, onClose }: DeviceInfoPopoverProps) {
  return (
    <div style={style} className="w-64 rounded-xl border border-slate-200 bg-white p-4 shadow-xl">
      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="font-bold">{device.name || deviceType?.label || 'Device'}</span>
        </div>
        <button className="text-slate-400 hover:text-slate-600" onClick={onClose} aria-label="Close">
          ✕
        </button>
      </div>

      <div className="mb-2 grid grid-cols-2 gap-y-1 text-sm">
        <span className="text-slate-500">Type</span>
        <span>{deviceType?.label ?? '—'}</span>
        <span className="text-slate-500">Status</span>
        <span className="capitalize">{device.status}</span>
        {device.serial_number && (
          <>
            <span className="text-slate-500">Serial</span>
            <span>{device.serial_number}</span>
          </>
        )}
        {device.asset_tag && (
          <>
            <span className="text-slate-500">Asset tag</span>
            <span>{device.asset_tag}</span>
          </>
        )}
      </div>
    </div>
  );
}
