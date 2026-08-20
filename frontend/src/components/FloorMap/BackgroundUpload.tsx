import { useRef, useState } from 'react';
import { api } from '../../api/client';

interface BackgroundUploadProps {
  floorId: string;
  onUploaded: () => void;
}

export default function BackgroundUpload({ floorId, onUploaded }: BackgroundUploadProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);

  async function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      await api.floors.uploadBackground(floorId, file);
      onUploaded();
    } finally {
      setUploading(false);
      e.target.value = '';
    }
  }

  return (
    <>
      <button
        className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm disabled:opacity-50"
        onClick={() => inputRef.current?.click()}
        disabled={uploading}
      >
        {uploading ? 'Uploading…' : '🖼 Set Background'}
      </button>
      <input ref={inputRef} type="file" accept="image/*" className="hidden" onChange={handleChange} />
    </>
  );
}
