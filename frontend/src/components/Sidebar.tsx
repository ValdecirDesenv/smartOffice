import { useEffect, useState } from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import { useApp } from '../context/AppContext';
import { useAuth } from '../context/AuthContext';
import BackgroundUpload from './FloorMap/BackgroundUpload';

const navLinkClass = ({ isActive }: { isActive: boolean }) =>
  `block rounded-lg px-3 py-2 text-sm ${isActive ? 'bg-blue-600 text-white' : 'text-slate-300 hover:bg-slate-800'}`;

interface SidebarProps {
  collapsed: boolean;
  onToggleCollapse: () => void;
}

export default function Sidebar({ collapsed, onToggleCollapse }: SidebarProps) {
  const navigate = useNavigate();
  const { currentUser, canEdit } = useAuth();
  const {
    sites,
    currentSite,
    floors,
    currentFloor,
    setCurrentFloorId,
    selectSite,
    createSite,
    renameSite,
    deleteSite,
    createFloor,
    renameFloor,
    deleteFloor,
    editing,
    setEditing,
    floorStats,
    refresh,
  } = useApp();

  const [detailsOpen, setDetailsOpen] = useState(false);
  const [expandedSiteId, setExpandedSiteId] = useState<string | null>(null);
  const [addingSite, setAddingSite] = useState(false);
  const [newSiteName, setNewSiteName] = useState('');
  const [editingSiteId, setEditingSiteId] = useState<string | null>(null);
  const [editSiteName, setEditSiteName] = useState('');

  const [addingFloor, setAddingFloor] = useState(false);
  const [newFloorName, setNewFloorName] = useState('');
  const [editingFloorId, setEditingFloorId] = useState<string | null>(null);
  const [editFloorName, setEditFloorName] = useState('');

  // Auto-expand whichever office becomes current (e.g. via search-jumping to a desk on a
  // different site) so its floor list is visible without an extra click - but once expanded,
  // a manual toggle can still collapse it without this effect immediately reopening it, since
  // it only re-fires when the current site itself changes.
  useEffect(() => {
    if (currentSite) setExpandedSiteId(currentSite.id);
  }, [currentSite?.id]);

  async function submitNewSite() {
    const name = newSiteName.trim();
    if (!name) return;
    await createSite(name);
    setNewSiteName('');
    setAddingSite(false);
  }

  function startEditSite(id: string, currentName: string) {
    setEditingSiteId(id);
    setEditSiteName(currentName);
  }

  async function submitEditSite() {
    const name = editSiteName.trim();
    if (editingSiteId && name) await renameSite(editingSiteId, name);
    setEditingSiteId(null);
  }

  async function confirmDeleteSite(id: string, name: string) {
    if (!window.confirm(`Delete "${name}"? This also deletes every floor, desk, employee, and team in this office.`)) {
      return;
    }
    await deleteSite(id);
  }

  async function submitNewFloor() {
    const name = newFloorName.trim();
    if (!name) return;
    await createFloor(name);
    setNewFloorName('');
    setAddingFloor(false);
  }

  function startEditFloor(id: string, currentName: string) {
    setEditingFloorId(id);
    setEditFloorName(currentName);
  }

  async function submitEditFloor() {
    const name = editFloorName.trim();
    if (editingFloorId && name) await renameFloor(editingFloorId, name);
    setEditingFloorId(null);
  }

  async function confirmDeleteFloor(id: string, name: string) {
    if (!window.confirm(`Delete "${name}"? This also deletes every desk and label on this floor.`)) return;
    await deleteFloor(id);
  }

  if (collapsed) {
    return (
      <aside className="flex flex-col items-center bg-slate-900 py-5 text-slate-200">
        <button
          className="rounded-lg p-2 text-slate-300 hover:bg-slate-800"
          onClick={onToggleCollapse}
          title="Expand sidebar"
          aria-label="Expand sidebar"
        >
          »
        </button>
      </aside>
    );
  }

  return (
    <aside className="flex flex-col bg-slate-900 p-5 text-slate-200">
      <div className="mb-8 flex items-center justify-between">
        <div className="text-lg font-extrabold">▦ SmartOffice</div>
        <button
          className="rounded-lg p-1 text-slate-400 hover:bg-slate-800 hover:text-slate-200"
          onClick={onToggleCollapse}
          title="Collapse sidebar"
          aria-label="Collapse sidebar"
        >
          «
        </button>
      </div>

      <div className="mb-2 mt-2 text-[11px] uppercase tracking-wide text-slate-500">Workspace</div>
      <NavLink to="/" className={navLinkClass}>
        Floor Map
      </NavLink>
      <NavLink to="/people" className={navLinkClass}>
        People
      </NavLink>
      {canEdit && (
        <NavLink to="/desk-tickets" className={navLinkClass}>
          Desk Tickets
        </NavLink>
      )}
      <div className="mt-1 block cursor-not-allowed rounded-lg px-3 py-2 text-sm text-slate-600">Bookings (soon)</div>
      <div className="mb-1 block cursor-not-allowed rounded-lg px-3 py-2 text-sm text-slate-600">Analytics (soon)</div>
      {currentUser?.is_admin && (
        <NavLink to="/users" className={navLinkClass}>
          Users
        </NavLink>
      )}
      {currentUser?.is_admin && (
        <NavLink to="/config-snapshots" className={navLinkClass}>
          Config Snapshots
        </NavLink>
      )}
      {currentUser?.can_sync_hubspot && (
        <NavLink to="/offboarded" className={navLinkClass}>
          Offboarded
        </NavLink>
      )}
      {currentUser?.is_admin && (
        <NavLink to="/ingestion-events" className={navLinkClass}>
          Device Data
        </NavLink>
      )}

      {floorStats && currentFloor && (
        <div className="mt-4 rounded-lg border border-slate-800">
          <button
            className="flex w-full items-center justify-between px-3 py-2 text-left text-sm text-slate-300 hover:bg-slate-800"
            onClick={() => setDetailsOpen((v) => !v)}
          >
            <span>Floor Details</span>
            <span className="text-slate-500">{detailsOpen ? '▾' : '▸'}</span>
          </button>
          {detailsOpen && (
            <div className="space-y-2 border-t border-slate-800 p-3">
              <div className="grid grid-cols-2 gap-1.5 text-xs">
                <div className="rounded-md bg-slate-800 px-2 py-1.5">
                  <div className="uppercase text-slate-500">Total</div>
                  <b className="block text-sm text-slate-100">{floorStats.total}</b>
                </div>
                <div className="rounded-md bg-slate-800 px-2 py-1.5">
                  <div className="uppercase text-slate-500">Available</div>
                  <b className="block text-sm text-slate-100">{floorStats.available}</b>
                </div>
                <div className="rounded-md bg-slate-800 px-2 py-1.5">
                  <div className="uppercase text-slate-500">Occupied</div>
                  <b className="block text-sm text-slate-100">{floorStats.occupied}</b>
                </div>
                <div className="rounded-md bg-slate-800 px-2 py-1.5">
                  <div className="uppercase text-slate-500">Reserved</div>
                  <b className="block text-sm text-slate-100">{floorStats.reserved}</b>
                </div>
              </div>
              {canEdit && (
                <div className="flex flex-col gap-1.5">
                  <BackgroundUpload
                    floorId={currentFloor.id}
                    onUploaded={refresh}
                    className="w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-slate-200 hover:bg-slate-700 disabled:opacity-50"
                  />
                  <button
                    className={`w-full rounded-lg border px-3 py-2 text-sm ${
                      editing ? 'border-blue-500 bg-blue-600 text-white' : 'border-slate-700 bg-slate-800 text-slate-200 hover:bg-slate-700'
                    }`}
                    onClick={() => setEditing(!editing)}
                  >
                    {editing ? '✓ Done Editing' : '✎ Edit Desks'}
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      <div className="mb-2 mt-6 flex items-center justify-between">
        <span className="text-[11px] uppercase tracking-wide text-slate-500">Offices</span>
        {canEdit && (
          <button
            className="rounded px-1.5 text-sm text-slate-400 hover:bg-slate-800 hover:text-slate-200"
            onClick={() => setAddingSite((v) => !v)}
            title="Add office"
            aria-label="Add office"
          >
            +
          </button>
        )}
      </div>

      {sites.map((site) => {
        const isCurrent = currentSite?.id === site.id;
        const isExpanded = expandedSiteId === site.id;
        return (
          <div key={site.id} className="mb-1">
            {editingSiteId === site.id ? (
              <input
                autoFocus
                className="w-full min-w-0 rounded-md border border-blue-500 bg-slate-700 px-2 py-1.5 text-sm text-white ring-1 ring-blue-500"
                value={editSiteName}
                onChange={(e) => setEditSiteName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') submitEditSite();
                  if (e.key === 'Escape') setEditingSiteId(null);
                }}
                onBlur={submitEditSite}
              />
            ) : (
              <div className="group flex items-center">
                <button
                  onClick={() => {
                    if (!isCurrent) selectSite(site.id);
                    else setExpandedSiteId((prev) => (prev === site.id ? null : site.id));
                  }}
                  className={`flex w-full min-w-0 flex-1 items-center justify-between gap-1.5 truncate rounded-lg px-3 py-2 text-left text-sm font-semibold ${
                    isCurrent ? 'bg-slate-800 text-white' : 'text-slate-300 hover:bg-slate-800'
                  }`}
                >
                  <span className="min-w-0 flex-1 truncate">{site.name}</span>
                  <span className="shrink-0 text-xs text-slate-500">{isExpanded ? '▾' : '▸'}</span>
                </button>
                {canEdit && (
                  <>
                    <button
                      className="ml-0.5 hidden shrink-0 rounded px-1.5 text-slate-400 hover:bg-slate-800 hover:text-slate-200 group-hover:block"
                      onClick={() => startEditSite(site.id, site.name)}
                      title="Rename office"
                      aria-label="Rename office"
                    >
                      ✎
                    </button>
                    <button
                      className="hidden shrink-0 rounded px-1.5 text-slate-400 hover:bg-slate-800 hover:text-red-400 group-hover:block"
                      onClick={() => confirmDeleteSite(site.id, site.name)}
                      title="Delete office"
                      aria-label="Delete office"
                    >
                      🗑
                    </button>
                  </>
                )}
              </div>
            )}

            {isExpanded && (
              <div className="ml-3 mt-1 border-l border-slate-800 pl-2">
                {floors.map((floor) =>
                  editingFloorId === floor.id ? (
                    <div key={floor.id} className="mb-0.5 flex gap-1.5">
                      <input
                        autoFocus
                        className="w-full min-w-0 rounded-md border border-blue-500 bg-slate-700 px-2 py-1.5 text-sm text-white ring-1 ring-blue-500"
                        value={editFloorName}
                        onChange={(e) => setEditFloorName(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') submitEditFloor();
                          if (e.key === 'Escape') setEditingFloorId(null);
                        }}
                        onBlur={submitEditFloor}
                      />
                    </div>
                  ) : (
                    <div key={floor.id} className="group flex items-center">
                      <button
                        onClick={() => {
                          setCurrentFloorId(floor.id);
                          navigate('/');
                        }}
                        className={`block w-full min-w-0 flex-1 truncate rounded-lg px-3 py-2 text-left text-sm ${
                          currentFloor?.id === floor.id ? 'bg-blue-600 text-white' : 'text-slate-300 hover:bg-slate-800'
                        }`}
                      >
                        {floor.name}
                      </button>
                      {canEdit && (
                        <>
                          <button
                            className="ml-0.5 hidden shrink-0 rounded px-1.5 text-slate-400 hover:bg-slate-800 hover:text-slate-200 group-hover:block"
                            onClick={() => startEditFloor(floor.id, floor.name)}
                            title="Rename floor"
                            aria-label="Rename floor"
                          >
                            ✎
                          </button>
                          <button
                            className="hidden shrink-0 rounded px-1.5 text-slate-400 hover:bg-slate-800 hover:text-red-400 group-hover:block"
                            onClick={() => confirmDeleteFloor(floor.id, floor.name)}
                            title="Delete floor"
                            aria-label="Delete floor"
                          >
                            🗑
                          </button>
                        </>
                      )}
                    </div>
                  )
                )}
                {canEdit &&
                  (addingFloor ? (
                    <div className="mt-1 flex gap-1.5">
                      <input
                        autoFocus
                        className="w-full min-w-0 rounded-md border border-slate-700 bg-slate-800 px-2 py-1.5 text-sm text-slate-100 placeholder:text-slate-500"
                        placeholder="Floor name"
                        value={newFloorName}
                        onChange={(e) => setNewFloorName(e.target.value)}
                        onKeyDown={(e) => e.key === 'Enter' && submitNewFloor()}
                      />
                      <button
                        className="rounded-md bg-blue-600 px-2.5 text-sm text-white"
                        onClick={submitNewFloor}
                        aria-label="Create floor"
                      >
                        ✓
                      </button>
                    </div>
                  ) : (
                    <button
                      className="mt-1 block w-full rounded-lg px-3 py-1.5 text-left text-xs text-slate-500 hover:bg-slate-800 hover:text-slate-300"
                      onClick={() => setAddingFloor(true)}
                    >
                      + Add floor
                    </button>
                  ))}
              </div>
            )}
          </div>
        );
      })}

      {addingSite && (
        <div className="mt-1 flex gap-1.5">
          <input
            autoFocus
            className="w-full min-w-0 rounded-md border border-slate-700 bg-slate-800 px-2 py-1.5 text-sm text-slate-100 placeholder:text-slate-500"
            placeholder="Office name"
            value={newSiteName}
            onChange={(e) => setNewSiteName(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && submitNewSite()}
          />
          <button className="rounded-md bg-blue-600 px-2.5 text-sm text-white" onClick={submitNewSite} aria-label="Create office">
            ✓
          </button>
        </div>
      )}
    </aside>
  );
}
