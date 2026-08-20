interface TopBarProps {
  search: string;
  onSearchChange: (value: string) => void;
}

export default function TopBar({ search, onSearchChange }: TopBarProps) {
  return (
    <header className="flex h-[70px] items-center gap-3 border-b border-slate-200 bg-white px-6">
      <input
        className="max-w-[520px] flex-1 rounded-lg border border-slate-300 px-3 py-2.5 text-sm"
        placeholder="Search people, desks, rooms or teams..."
        value={search}
        onChange={(e) => onSearchChange(e.target.value)}
      />
      <button className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-600" disabled>
        Today ▾
      </button>
      <div className="grid h-[42px] w-[42px] place-items-center rounded-full bg-blue-100 font-bold text-blue-600">
        VO
      </div>
    </header>
  );
}
