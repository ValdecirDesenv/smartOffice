import { Fragment, useEffect, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { api } from '../api/client';
import { IngestionEvent, SeatDeviceRow } from '../types';

const PAGE_SIZE = 50;
// Cap for the "Export CSV" action - a debug/analysis log, not something meant to be paged
// through forever; matches the same cap the server enforces regardless of what's asked for.
const EXPORT_LIMIT = 5000;

const STATUS_STYLES: Record<string, string> = {
  processed: 'bg-emerald-100 text-emerald-800',
  ignored: 'bg-slate-200 text-slate-600',
  error: 'bg-red-100 text-red-800',
  received: 'bg-amber-100 text-amber-800',
};

function csvField(value: string): string {
  return /[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

function downloadCsv(filename: string, header: string[], rows: string[][]) {
  const csv = [header.join(','), ...rows.map((row) => row.map(csvField).join(','))].join('\r\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

function monitorSerials(row: IngestionEvent): string {
  return (row.monitors ?? [])
    .map((m) => m.serial)
    .filter(Boolean)
    .join(', ');
}

const TABS = [
  { key: 'log', label: 'Raw Log' },
  { key: 'seats', label: 'Seat Assignments' },
] as const;
type TabKey = (typeof TABS)[number]['key'];

export default function IngestionEventsPage() {
  const { currentUser } = useAuth();
  const [tab, setTab] = useState<TabKey>('log');

  if (!currentUser?.is_admin) {
    return <div className="p-6 text-sm text-slate-500">Admin access required.</div>;
  }

  return (
    <div className="p-6">
      <h1 className="mb-1 text-2xl font-bold">Device Data</h1>
      <p className="mb-4 text-sm text-slate-500">
        {tab === 'log'
          ? 'Raw incoming data from the MDM desk-location collector - every request ever received, exactly as sent, before any interpretation.'
          : 'One row per currently-assigned desk, with its registered monitor/computer serials (if any) alongside who actually sits there.'}
      </p>

      <div className="mb-4 flex gap-1 rounded-lg border border-slate-300 bg-white p-1 text-sm w-fit">
        {TABS.map((t) => (
          <button
            key={t.key}
            className={`rounded-md px-3 py-1.5 ${tab === t.key ? 'bg-blue-600 text-white' : 'text-slate-600'}`}
            onClick={() => setTab(t.key)}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'log' ? <RawLogView /> : <SeatAssignmentsView />}
    </div>
  );
}

function RawLogView() {
  const [rows, setRows] = useState<IngestionEvent[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(0);
  const [status, setStatus] = useState('');
  const [q, setQ] = useState('');
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const [loading, setLoading] = useState(false);

  async function reload() {
    setLoading(true);
    try {
      const result = await api.ingestionEvents.list({
        status: status || undefined,
        q: q || undefined,
        limit: PAGE_SIZE,
        offset: page * PAGE_SIZE,
      });
      setRows(result.rows);
      setTotal(result.total);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, status]);

  // Search is debounced via the Enter key / blur rather than firing per keystroke - resets
  // to page 0 since a new search invalidates whatever page you were on.
  function runSearch() {
    setPage(0);
    reload();
  }

  async function handleExport() {
    setExporting(true);
    try {
      const result = await api.ingestionEvents.list({
        status: status || undefined,
        q: q || undefined,
        limit: EXPORT_LIMIT,
        offset: 0,
      });
      downloadCsv(
        `ingestion-events-${new Date().toISOString().slice(0, 10)}.csv`,
        ['Received At', 'Status', 'Logged In User', 'Desktop Serial', 'Device Name', 'IP Address', 'Monitor Serials', 'Error/Detail'],
        result.rows.map((r) => [
          r.received_at,
          r.processing_status,
          r.logged_in_user ?? '',
          r.desktop_serial ?? '',
          r.device_name ?? '',
          r.ip_address ?? '',
          monitorSerials(r),
          r.error_detail ?? '',
        ])
      );
    } finally {
      setExporting(false);
    }
  }

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <input
          className="w-64 rounded-lg border border-slate-300 px-3 py-2 text-sm"
          placeholder="Search user, desktop serial, device name..."
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && runSearch()}
          onBlur={runSearch}
        />
        <select
          className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
          value={status}
          onChange={(e) => {
            setPage(0);
            setStatus(e.target.value);
          }}
        >
          <option value="">All statuses</option>
          <option value="processed">Processed</option>
          <option value="ignored">Ignored</option>
          <option value="error">Error</option>
          <option value="received">Received</option>
        </select>
        <span className="text-xs text-slate-400">{total} total</span>
        <button
          className="ml-auto rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-600 hover:bg-slate-50 disabled:opacity-50"
          onClick={handleExport}
          disabled={exporting}
        >
          {exporting ? 'Exporting…' : `Export CSV (up to ${EXPORT_LIMIT})`}
        </button>
      </div>

      <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-3 py-2">Received</th>
                <th className="px-3 py-2">Status</th>
                <th className="px-3 py-2">Logged In User</th>
                <th className="px-3 py-2">Desktop Serial</th>
                <th className="px-3 py-2">Monitor Serial(s)</th>
                <th className="px-3 py-2">Detail</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <Fragment key={r.id}>
                  <tr
                    className="cursor-pointer border-t border-slate-100 hover:bg-slate-50"
                    onClick={() => setExpandedId((prev) => (prev === r.id ? null : r.id))}
                  >
                    <td className="whitespace-nowrap px-3 py-2 text-slate-500">
                      {new Date(r.received_at).toLocaleString()}
                    </td>
                    <td className="px-3 py-2">
                      <span className={`rounded-full px-2 py-0.5 text-xs ${STATUS_STYLES[r.processing_status] ?? ''}`}>
                        {r.processing_status}
                      </span>
                    </td>
                    <td className="px-3 py-2">{r.logged_in_user}</td>
                    <td className="px-3 py-2">{r.desktop_serial}</td>
                    <td className="px-3 py-2">{monitorSerials(r)}</td>
                    <td className="max-w-xs truncate px-3 py-2 text-slate-500">{r.error_detail}</td>
                  </tr>
                  {expandedId === r.id && (
                    <tr className="border-t border-slate-100 bg-slate-50">
                      <td colSpan={6} className="px-3 py-3">
                        <div className="mb-1 text-xs font-medium text-slate-500">Full raw payload:</div>
                        <pre className="overflow-x-auto rounded-md bg-white p-3 text-xs text-slate-700">
                          {JSON.stringify(
                            {
                              desktop_serial: r.desktop_serial,
                              device_name: r.device_name,
                              logged_in_user: r.logged_in_user,
                              ip_address: r.ip_address,
                              collected_at: r.collected_at,
                              monitors: r.monitors,
                              monitor_info_raw: r.monitor_info_raw,
                            },
                            null,
                            2
                          )}
                        </pre>
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))}
              {!loading && rows.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-3 py-6 text-center text-slate-400">
                    No matching events.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <div className="flex items-center justify-between border-t border-slate-200 px-3.5 py-2.5 text-xs text-slate-500">
          <span>
            Page {page + 1} of {totalPages}
          </span>
          <div className="flex gap-2">
            <button
              className="rounded-md border border-slate-300 px-2.5 py-1 disabled:opacity-40"
              disabled={page === 0}
              onClick={() => setPage((p) => Math.max(0, p - 1))}
            >
              ← Prev
            </button>
            <button
              className="rounded-md border border-slate-300 px-2.5 py-1 disabled:opacity-40"
              disabled={page + 1 >= totalPages}
              onClick={() => setPage((p) => p + 1)}
            >
              Next →
            </button>
          </div>
        </div>
      </div>
    </>
  );
}

function SeatAssignmentsView() {
  const [rows, setRows] = useState<SeatDeviceRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState('');
  // 'all' | 'missing' (no monitor AND no computer yet) | 'complete' (both registered)
  const [filter, setFilter] = useState<'all' | 'missing' | 'complete'>('all');

  useEffect(() => {
    api.ingestionEvents
      .seats()
      .then(setRows)
      .finally(() => setLoading(false));
  }, []);

  const needle = q.trim().toLowerCase();
  const filtered = rows.filter((r) => {
    if (filter === 'missing' && (r.monitor_serial || r.computer_serial)) return false;
    if (filter === 'complete' && !(r.monitor_serial && r.computer_serial)) return false;
    if (!needle) return true;
    return [r.seat_location, r.assigned_to, r.monitor_serial, r.computer_serial]
      .filter(Boolean)
      .some((v) => v!.toLowerCase().includes(needle));
  });

  function handleExport() {
    downloadCsv(
      `seat-assignments-${new Date().toISOString().slice(0, 10)}.csv`,
      ['Site', 'Floor', 'Seat Location', 'Monitor Serial', 'Computer Serial', 'Assigned To', 'Email'],
      filtered.map((r) => [
        r.site_name,
        r.floor_name,
        r.seat_location,
        r.monitor_serial ?? '',
        r.computer_serial ?? '',
        r.assigned_to ?? '',
        r.assigned_email ?? '',
      ])
    );
  }

  const missingCount = rows.filter((r) => !r.monitor_serial && !r.computer_serial).length;

  return (
    <>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <input
          className="w-64 rounded-lg border border-slate-300 px-3 py-2 text-sm"
          placeholder="Search seat, person, serial..."
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <select
          className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
          value={filter}
          onChange={(e) => setFilter(e.target.value as typeof filter)}
        >
          <option value="all">All seats</option>
          <option value="missing">Missing devices</option>
          <option value="complete">Fully registered</option>
        </select>
        <span className="text-xs text-slate-400">
          {rows.length} assigned seats · {missingCount} with no devices yet
        </span>
        <button
          className="ml-auto rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-600 hover:bg-slate-50"
          onClick={handleExport}
        >
          Export CSV
        </button>
      </div>

      <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-3 py-2">Seat Location</th>
                <th className="px-3 py-2">Monitor Serial</th>
                <th className="px-3 py-2">Computer Serial</th>
                <th className="px-3 py-2">Assigned To</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((r) => (
                <tr key={r.workspace_id} className="border-t border-slate-100">
                  <td className="whitespace-nowrap px-3 py-2">
                    <div className="font-medium">{r.seat_location}</div>
                    <div className="text-xs text-slate-400">
                      {r.site_name} · {r.floor_name}
                    </div>
                  </td>
                  <td className="px-3 py-2">
                    {r.monitor_serial ?? <span className="text-slate-300">—</span>}
                  </td>
                  <td className="px-3 py-2">
                    {r.computer_serial ?? <span className="text-slate-300">—</span>}
                  </td>
                  <td className="px-3 py-2">
                    <div>{r.assigned_to}</div>
                    {r.assigned_email && <div className="text-xs text-slate-400">{r.assigned_email}</div>}
                  </td>
                </tr>
              ))}
              {!loading && filtered.length === 0 && (
                <tr>
                  <td colSpan={4} className="px-3 py-6 text-center text-slate-400">
                    No matching seats.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}
