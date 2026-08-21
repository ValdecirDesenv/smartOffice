import { useEffect, useState } from 'react';
import { Device, DeviceStatus, DeviceType } from '../../types';

const STATUS_OPTIONS: DeviceStatus[] = ['active', 'inactive', 'missing', 'retired'];

interface DeviceDetailPanelProps {
  device: Device;
  deviceTypes: DeviceType[];
  onUpdate: (patch: Partial<Device>) => void;
  onDelete: () => void;
}

export default function DeviceDetailPanel({ device, deviceTypes, onUpdate, onDelete }: DeviceDetailPanelProps) {
  const [posXText, setPosXText] = useState(String(device.pos_x ?? 0));
  const [posYText, setPosYText] = useState(String(device.pos_y ?? 0));

  useEffect(() => {
    setPosXText(String(device.pos_x ?? 0));
    setPosYText(String(device.pos_y ?? 0));
  }, [device.id, device.pos_x, device.pos_y]);

  function updatePos(xText: string, yText: string) {
    const x = parseFloat(xText);
    const y = parseFloat(yText);
    if (Number.isFinite(x) && Number.isFinite(y)) onUpdate({ pos_x: x, pos_y: y });
  }

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4">
      <div className="mb-3">
        <label className="mb-1 block text-[11px] uppercase tracking-wide text-slate-500">Name</label>
        <input
          className="w-full rounded-md border border-slate-300 px-2.5 py-2 text-sm"
          placeholder="e.g. Boardroom TV"
          value={device.name ?? ''}
          onChange={(e) => onUpdate({ name: e.target.value })}
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
              onChange={(e) => {
                setPosXText(e.target.value);
                updatePos(e.target.value, posYText);
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
              onChange={(e) => {
                setPosYText(e.target.value);
                updatePos(posXText, e.target.value);
              }}
            />
          </div>
        </div>
      </div>

      <div className="mb-3">
        <label className="mb-1 block text-[11px] uppercase tracking-wide text-slate-500">Device type</label>
        <select
          className="w-full rounded-md border border-slate-300 px-2.5 py-2 text-sm"
          value={device.device_type_id}
          onChange={(e) => onUpdate({ device_type_id: e.target.value })}
        >
          {deviceTypes.map((t) => (
            <option key={t.id} value={t.id}>
              {t.label}
            </option>
          ))}
        </select>
      </div>

      {deviceTypes.find((t) => t.id === device.device_type_id)?.code === 'tv' && (
        <div className="mb-3">
          <label className="mb-1 block text-[11px] uppercase tracking-wide text-slate-500">Orientation</label>
          <button
            className="w-full rounded-md border border-slate-300 px-2.5 py-2 text-sm hover:bg-slate-50"
            onClick={() => onUpdate({ rotated: !device.rotated })}
          >
            ↻ Rotate 90°{device.rotated ? ' (currently vertical)' : ' (currently horizontal)'}
          </button>
        </div>
      )}

      <div className="mb-3">
        <label className="mb-1 block text-[11px] uppercase tracking-wide text-slate-500">Device status</label>
        <select
          className="w-full rounded-md border border-slate-300 px-2.5 py-2 text-sm"
          value={device.status}
          onChange={(e) => onUpdate({ status: e.target.value as DeviceStatus })}
        >
          {STATUS_OPTIONS.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
      </div>

      <div className="mb-3 grid grid-cols-2 gap-2">
        <div>
          <label className="mb-1 block text-[11px] uppercase tracking-wide text-slate-500">Serial number</label>
          <input
            className="w-full rounded-md border border-slate-300 px-2.5 py-2 text-sm"
            value={device.serial_number ?? ''}
            onChange={(e) => onUpdate({ serial_number: e.target.value })}
          />
        </div>
        <div>
          <label className="mb-1 block text-[11px] uppercase tracking-wide text-slate-500">Asset tag</label>
          <input
            className="w-full rounded-md border border-slate-300 px-2.5 py-2 text-sm"
            value={device.asset_tag ?? ''}
            onChange={(e) => onUpdate({ asset_tag: e.target.value })}
          />
        </div>
      </div>

      <div className="mb-3">
        <label className="mb-1 block text-[11px] uppercase tracking-wide text-slate-500">MAC address</label>
        <input
          className="w-full rounded-md border border-slate-300 px-2.5 py-2 text-sm"
          value={device.mac_address ?? ''}
          onChange={(e) => onUpdate({ mac_address: e.target.value })}
        />
      </div>

      <button className="w-full rounded-lg bg-indigo-50 py-2.5 text-sm font-bold text-red-600" onClick={onDelete}>
        🗑 Delete Device
      </button>
    </div>
  );
}
