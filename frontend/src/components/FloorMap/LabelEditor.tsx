import { Label } from '../../types';

interface LabelEditorProps {
  label: Label;
  onUpdate: (patch: Partial<Label>) => void;
  onDelete: () => void;
}

export default function LabelEditor({ label, onUpdate, onDelete }: LabelEditorProps) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4">
      <label className="mb-1 block text-[11px] uppercase tracking-wide text-slate-500">Label text</label>
      <input
        className="mb-3 w-full rounded-md border border-slate-300 px-2.5 py-2 text-sm"
        value={label.text}
        onChange={(e) => onUpdate({ text: e.target.value })}
      />
      <button className="w-full rounded-lg bg-indigo-50 py-2.5 text-sm font-bold text-red-600" onClick={onDelete}>
        🗑 Delete Label
      </button>
    </div>
  );
}
