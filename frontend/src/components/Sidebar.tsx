import { NavLink } from 'react-router-dom';
import { useApp } from '../context/AppContext';

const navLinkClass = ({ isActive }: { isActive: boolean }) =>
  `block rounded-lg px-3 py-2 text-sm ${isActive ? 'bg-blue-600 text-white' : 'text-slate-300 hover:bg-slate-800'}`;

export default function Sidebar() {
  const { sites, currentSite, floors, currentFloor, setCurrentFloorId } = useApp();

  return (
    <aside className="flex flex-col bg-slate-900 p-5 text-slate-200">
      <div className="mb-8 text-lg font-extrabold">▦ SmartOffice</div>

      <div className="mb-2 mt-2 text-[11px] uppercase tracking-wide text-slate-500">Workspace</div>
      <NavLink to="/" className={navLinkClass}>
        Floor Map
      </NavLink>
      <NavLink to="/people" className={navLinkClass}>
        People
      </NavLink>
      <div className="mt-1 block cursor-not-allowed rounded-lg px-3 py-2 text-sm text-slate-600">Bookings (soon)</div>
      <div className="mb-1 block cursor-not-allowed rounded-lg px-3 py-2 text-sm text-slate-600">Analytics (soon)</div>

      {sites.length > 0 && (
        <>
          <div className="mb-2 mt-6 text-[11px] uppercase tracking-wide text-slate-500">
            {currentSite ? currentSite.name : 'Locations'}
          </div>
          {floors.map((floor) => (
            <button
              key={floor.id}
              onClick={() => setCurrentFloorId(floor.id)}
              className={`block w-full rounded-lg px-3 py-2 text-left text-sm ${
                currentFloor?.id === floor.id ? 'bg-blue-600 text-white' : 'text-slate-300 hover:bg-slate-800'
              }`}
            >
              {floor.name}
            </button>
          ))}
        </>
      )}
    </aside>
  );
}
