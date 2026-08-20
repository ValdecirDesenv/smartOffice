import { useEffect, useRef, useState } from 'react';
import { Device, DeviceType, Employee, Label, Team, Workspace, WorkspaceType } from '../../types';
import WorkspaceInfoPopover from './WorkspaceInfoPopover';

const STATUS_STYLES: Record<string, string> = {
  available: 'bg-emerald-100 border-emerald-500 text-emerald-800',
  occupied: 'bg-red-100 border-red-500 text-red-800',
  reserved: 'bg-amber-100 border-amber-500 text-amber-800',
  assigned: 'bg-indigo-100 border-indigo-500 text-indigo-800',
  inactive: 'bg-slate-200 border-slate-400 text-slate-500',
};

function clamp(v: number, a: number, b: number) {
  return Math.max(a, Math.min(b, v));
}

// Pixel distance within which a dragged desk/label snaps to align with another one.
const SNAP_PX = 8;

function closestWithin(value: number, candidates: number[], thresholdPercent: number): number | null {
  let best: number | null = null;
  let bestDist = Infinity;
  for (const c of candidates) {
    const dist = Math.abs(value - c);
    if (dist <= thresholdPercent && dist < bestDist) {
      best = c;
      bestDist = dist;
    }
  }
  return best;
}

interface DragTarget {
  id: string;
  startLeft: number;
  startTop: number;
  startX: number;
  startY: number;
  dragged: boolean;
  currentLeft?: number;
  currentTop?: number;
}

interface FloorMapCanvasProps {
  backgroundUrl?: string | null;
  editing: boolean;
  workspaces: Workspace[];
  labels: Label[];
  selectedWorkspaceId: string | null;
  selectedLabelId: string | null;
  onSelectWorkspace: (id: string) => void;
  onSelectLabel: (id: string) => void;
  onMoveWorkspace: (id: string, posX: number, posY: number) => void;
  onMoveLabel: (id: string, posX: number, posY: number) => void;
  workspaceTypes: WorkspaceType[];
  deviceTypes: DeviceType[];
  selectedWorkspaceEmployee: Employee | null;
  selectedWorkspaceEmployeeTeam: Team | null;
  selectedWorkspaceDevices: Device[];
}

const POPOVER_WIDTH = 256;

export default function FloorMapCanvas({
  backgroundUrl,
  editing,
  workspaces,
  labels,
  selectedWorkspaceId,
  selectedLabelId,
  onSelectWorkspace,
  onSelectLabel,
  onMoveWorkspace,
  onMoveLabel,
  workspaceTypes,
  deviceTypes,
  selectedWorkspaceEmployee,
  selectedWorkspaceEmployeeTeam,
  selectedWorkspaceDevices,
}: FloorMapCanvasProps) {
  const floorRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<DragTarget | null>(null);
  const dragKindRef = useRef<'workspace' | 'label' | null>(null);
  const vGuideRef = useRef<HTMLDivElement>(null);
  const hGuideRef = useRef<HTMLDivElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const [anchorRect, setAnchorRect] = useState<DOMRect | null>(null);

  // Popover anchor: recomputed whenever the selected desk (or its position) changes, in view mode only.
  useEffect(() => {
    if (editing || !selectedWorkspaceId) {
      setAnchorRect(null);
      return;
    }
    const el = document.getElementById(`workspace-${selectedWorkspaceId}`);
    setAnchorRect(el ? el.getBoundingClientRect() : null);
  }, [editing, selectedWorkspaceId, workspaces]);

  // Clicking anywhere outside the popover and outside any desk/label closes it (desk/label clicks
  // are already handled by their own pointerup->onSelectWorkspace/onSelectLabel toggle).
  useEffect(() => {
    if (editing || !selectedWorkspaceId) return;
    function onPointerDownOutside(e: PointerEvent) {
      const target = e.target as HTMLElement;
      if (popoverRef.current?.contains(target)) return;
      if (target.closest('[id^="workspace-"], [id^="label-"]')) return;
      onSelectWorkspace(selectedWorkspaceId as string);
    }
    window.addEventListener('pointerdown', onPointerDownOutside, true);
    return () => window.removeEventListener('pointerdown', onPointerDownOutside, true);
  }, [editing, selectedWorkspaceId, onSelectWorkspace]);

  function popoverStyle(rect: DOMRect): React.CSSProperties {
    const estimatedHeight = 220;
    const left = clamp(rect.left + rect.width / 2 - POPOVER_WIDTH / 2, 8, window.innerWidth - POPOVER_WIDTH - 8);
    const flip = rect.bottom + estimatedHeight + 8 > window.innerHeight;
    return flip
      ? { position: 'fixed', left, bottom: window.innerHeight - rect.top + 8, zIndex: 50 }
      : { position: 'fixed', left, top: rect.bottom + 8, zIndex: 50 };
  }

  function hideGuides() {
    if (vGuideRef.current) vGuideRef.current.style.display = 'none';
    if (hGuideRef.current) hGuideRef.current.style.display = 'none';
  }

  const ARROW_DELTAS: Record<string, [number, number]> = {
    ArrowUp: [0, -1],
    ArrowDown: [0, 1],
    ArrowLeft: [-1, 0],
    ArrowRight: [1, 0],
  };

  // Tracks the position intended by the nudges issued so far for the current selection. Holding an
  // arrow key fires keydown faster than the PUT round-trip resolves, so building the next step from
  // the (possibly stale) workspaces/labels prop would drop presses; this always builds on the last
  // value WE sent, regardless of whether its response has come back yet.
  const lastNudgeRef = useRef<{ id: string; x: number; y: number } | null>(null);
  useEffect(() => {
    lastNudgeRef.current = null;
  }, [selectedWorkspaceId, selectedLabelId]);

  // Nudges the selected desk/label with the arrow keys while editing — a normal press moves ~1px,
  // Shift+press moves ~10px, converted to percent using the floor's current on-screen size so the
  // feel stays consistent regardless of canvas width.
  useEffect(() => {
    if (!editing || (!selectedWorkspaceId && !selectedLabelId)) return;

    function onKeyDown(e: KeyboardEvent) {
      const dir = ARROW_DELTAS[e.key];
      if (!dir) return;
      const tag = (document.activeElement as HTMLElement | null)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      const floor = floorRef.current;
      if (!floor) return;

      const rect = floor.getBoundingClientRect();
      const pxStep = e.shiftKey ? 10 : 1;
      const dxPercent = (dir[0] * pxStep) / rect.width * 100;
      const dyPercent = (dir[1] * pxStep) / rect.height * 100;
      e.preventDefault();

      const selectedId = selectedWorkspaceId ?? selectedLabelId;
      if (!selectedId) return;
      const items = selectedWorkspaceId ? workspaces : labels;
      const current = items.find((x) => x.id === selectedId);
      if (!current) return;

      const base =
        lastNudgeRef.current?.id === selectedId
          ? lastNudgeRef.current
          : { id: selectedId, x: Number(current.pos_x ?? 0), y: Number(current.pos_y ?? 0) };
      const newX = clamp(base.x + dxPercent, 0, 95);
      const newY = clamp(base.y + dyPercent, 0, 93);
      lastNudgeRef.current = { id: selectedId, x: newX, y: newY };

      if (selectedWorkspaceId) onMoveWorkspace(selectedId, newX, newY);
      else onMoveLabel(selectedId, newX, newY);
    }

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [editing, selectedWorkspaceId, selectedLabelId, workspaces, labels, onMoveWorkspace, onMoveLabel]);

  function startDrag(kind: 'workspace' | 'label', id: string, posX: number, posY: number) {
    return (e: React.PointerEvent) => {
      // Always tracked, even outside editing: onPointerUp needs this to recognize a plain click
      // (for the view-mode info popover) as distinct from a drag, which onPointerMove gates on editing.
      e.preventDefault();
      (e.target as HTMLElement).setPointerCapture(e.pointerId);
      dragKindRef.current = kind;
      dragRef.current = { id, startLeft: posX, startTop: posY, startX: e.clientX, startY: e.clientY, dragged: false };
    };
  }

  function onPointerMove(e: React.PointerEvent) {
    const drag = dragRef.current;
    const floor = floorRef.current;
    if (!drag || !floor || !editing) return;
    const rect = floor.getBoundingClientRect();
    const dx = e.clientX - drag.startX;
    const dy = e.clientY - drag.startY;
    if (Math.abs(dx) > 3 || Math.abs(dy) > 3) drag.dragged = true;
    let newLeft = clamp(drag.startLeft + (dx / rect.width) * 100, 0, 95);
    let newTop = clamp(drag.startTop + (dy / rect.height) * 100, 0, 93);

    // Snap to other desks/labels when close, and show a guide line along the matched axis.
    const thresholdX = (SNAP_PX / rect.width) * 100;
    const thresholdY = (SNAP_PX / rect.height) * 100;
    const otherX: number[] = [];
    const otherY: number[] = [];
    for (const w of workspaces) {
      if (dragKindRef.current === 'workspace' && w.id === drag.id) continue;
      otherX.push(Number(w.pos_x ?? 0));
      otherY.push(Number(w.pos_y ?? 0));
    }
    for (const l of labels) {
      if (dragKindRef.current === 'label' && l.id === drag.id) continue;
      otherX.push(Number(l.pos_x ?? 0));
      otherY.push(Number(l.pos_y ?? 0));
    }
    const snappedX = closestWithin(newLeft, otherX, thresholdX);
    const snappedY = closestWithin(newTop, otherY, thresholdY);
    if (snappedX !== null) newLeft = clamp(snappedX, 0, 95);
    if (snappedY !== null) newTop = clamp(snappedY, 0, 93);

    if (vGuideRef.current) {
      vGuideRef.current.style.display = snappedX !== null ? 'block' : 'none';
      vGuideRef.current.style.left = `${newLeft}%`;
    }
    if (hGuideRef.current) {
      hGuideRef.current.style.display = snappedY !== null ? 'block' : 'none';
      hGuideRef.current.style.top = `${newTop}%`;
    }

    const el = document.getElementById(`${dragKindRef.current}-${drag.id}`);
    if (el) {
      el.style.left = `${newLeft}%`;
      el.style.top = `${newTop}%`;
    }
    drag.currentLeft = newLeft;
    drag.currentTop = newTop;
  }

  function onPointerUp() {
    const drag = dragRef.current;
    const kind = dragKindRef.current;
    dragRef.current = null;
    dragKindRef.current = null;
    hideGuides();
    if (!drag) return;
    if (editing && drag.dragged && drag.currentLeft !== undefined && drag.currentTop !== undefined) {
      if (kind === 'workspace') onMoveWorkspace(drag.id, drag.currentLeft, drag.currentTop);
      else onMoveLabel(drag.id, drag.currentLeft, drag.currentTop);
    } else {
      if (kind === 'workspace') onSelectWorkspace(drag.id);
      else onSelectLabel(drag.id);
    }
  }

  return (
    <div className="h-[570px] overflow-hidden bg-slate-100" onPointerMove={onPointerMove} onPointerUp={onPointerUp}>
      <div
        ref={floorRef}
        className={`relative h-full border-[5px] border-slate-300 bg-white bg-center bg-no-repeat shadow-lg ${
          editing ? 'outline outline-[3px] -outline-offset-[3px] outline-dashed outline-blue-600' : ''
        }`}
        style={
          backgroundUrl ? { backgroundImage: `url(${backgroundUrl})`, backgroundSize: '100% 100%' } : undefined
        }
      >
        <div
          ref={vGuideRef}
          className="pointer-events-none absolute inset-y-0 z-10 w-px bg-fuchsia-500"
          style={{ display: 'none' }}
        />
        <div
          ref={hGuideRef}
          className="pointer-events-none absolute inset-x-0 z-10 h-px bg-fuchsia-500"
          style={{ display: 'none' }}
        />

        {workspaces.map((w) => (
          <button
            key={w.id}
            id={`workspace-${w.id}`}
            onPointerDown={startDrag('workspace', w.id, Number(w.pos_x ?? 0), Number(w.pos_y ?? 0))}
            className={`absolute flex items-center justify-center overflow-hidden rounded border-2 font-bold leading-none ${
              editing ? 'h-6 w-6 text-[7px]' : 'h-8 w-8 text-[10px]'
            } ${STATUS_STYLES[w.status]} ${
              editing ? 'cursor-grab active:cursor-grabbing' : 'cursor-pointer hover:z-20 hover:scale-150'
            } ${w.id === selectedWorkspaceId ? 'z-20 ring-2 ring-slate-900' : ''}`}
            style={{ left: `${w.pos_x ?? 0}%`, top: `${w.pos_y ?? 0}%` }}
          >
            {w.code}
          </button>
        ))}

        {labels.map((l) => (
          <div
            key={l.id}
            id={`label-${l.id}`}
            onPointerDown={startDrag('label', l.id, Number(l.pos_x ?? 0), Number(l.pos_y ?? 0))}
            className={`absolute rounded-md bg-slate-900/85 px-2.5 py-1 text-[11px] font-semibold text-white ${
              editing ? 'cursor-grab active:cursor-grabbing' : 'cursor-default'
            } ${l.id === selectedLabelId ? 'ring-2 ring-blue-600' : ''}`}
            style={{ left: `${l.pos_x ?? 0}%`, top: `${l.pos_y ?? 0}%` }}
          >
            {l.text}
          </div>
        ))}
      </div>

      {!editing && anchorRect && selectedWorkspaceId && (
        (() => {
          const w = workspaces.find((x) => x.id === selectedWorkspaceId);
          if (!w) return null;
          return (
            <div ref={popoverRef}>
              <WorkspaceInfoPopover
                workspace={w}
                workspaceType={workspaceTypes.find((t) => t.id === w.workspace_type_id) ?? null}
                assignedEmployee={selectedWorkspaceEmployee}
                assignedEmployeeTeam={selectedWorkspaceEmployeeTeam}
                devices={selectedWorkspaceDevices}
                deviceTypes={deviceTypes}
                style={popoverStyle(anchorRect)}
                onClose={() => onSelectWorkspace(selectedWorkspaceId)}
              />
            </div>
          );
        })()
      )}
    </div>
  );
}
