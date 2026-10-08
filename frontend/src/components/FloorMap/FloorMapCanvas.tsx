import { useEffect, useRef, useState } from 'react';
import { Device, DeviceType, Employee, Label, Team, Workspace, WorkspaceType } from '../../types';
import WorkspaceInfoPopover from './WorkspaceInfoPopover';
import DeviceInfoPopover from './DeviceInfoPopover';

// Fill/text stays keyed by desk status; border color is a separate concern below so a team's
// border color can be swapped in without touching the fill.
const STATUS_FILL_STYLES: Record<string, string> = {
  available: 'bg-emerald-100 text-emerald-800',
  occupied: 'bg-red-100 text-red-800',
  reserved: 'bg-amber-100 text-amber-800',
  assigned: 'bg-indigo-100 text-indigo-800',
  inactive: 'bg-slate-200 text-slate-500',
};
const STATUS_BORDER_STYLES: Record<string, string> = {
  available: 'border-emerald-500',
  occupied: 'border-red-500',
  reserved: 'border-amber-500',
  assigned: 'border-indigo-500',
  inactive: 'border-slate-400',
};

// Overrides the normal status fill for a desk whose occupant is flagged inactive (e.g. a former
// employee per the HubSpot sync) - distinct from every STATUS_FILL_STYLES color above so it
// reads as "needs attention" rather than a normal occupancy state. Takes priority over a team
// border too, since a flagged desk needing action is a more urgent signal than who sat there.
const FLAGGED_FILL = 'bg-orange-100 text-orange-800';
const FLAGGED_BORDER = 'border-orange-500';

// Fill used by the "Show Names" view toggle for a desk that has someone assigned - white so the
// name reads clearly regardless of what status/team/flagged color the border is carrying. Border
// is left as whatever it would normally be (team color takes priority, else flagged, else status)
// so that signal isn't lost just because name mode is on.
const NAME_FILL = 'bg-white text-slate-900';

// Border/dot colors used to show which team a desk's assigned employee belongs to. Deliberately
// avoids every hue already used above (emerald/red/amber/indigo/orange/slate) so a team color
// never gets mistaken for a status or the "should be unassigned" flag. Written out as complete
// class names (not built with string concatenation) so Tailwind's build-time scanner picks up
// both the border-* (used on the map) and bg-* (used for the legend dot) variants - a
// dynamically-concatenated class name wouldn't be detected and would silently render unstyled.
const TEAM_PALETTE = [
  { border: 'border-blue-500', bg: 'bg-blue-500' },
  { border: 'border-violet-500', bg: 'bg-violet-500' },
  { border: 'border-fuchsia-500', bg: 'bg-fuchsia-500' },
  { border: 'border-pink-500', bg: 'bg-pink-500' },
  { border: 'border-sky-500', bg: 'bg-sky-500' },
  { border: 'border-purple-500', bg: 'bg-purple-500' },
  { border: 'border-rose-500', bg: 'bg-rose-500' },
  { border: 'border-cyan-500', bg: 'bg-cyan-500' },
];

// Assigns each team a stable color based on its position in `orderedTeamIds` (pass the same
// ordering - e.g. every team for the current site, sorted by id - every time so a given team
// always gets the same color across renders and floors).
export function teamColors(teamId: string, orderedTeamIds: string[]): { border: string; bg: string } | null {
  const idx = orderedTeamIds.indexOf(teamId);
  if (idx < 0) return null;
  return TEAM_PALETTE[idx % TEAM_PALETTE.length];
}

const DEVICE_ICONS: Record<string, string> = {
  tv: '📺',
  printer: '🖨️',
  monitor: '🖥️',
  dock: '🔌',
  laptop: '💻',
  phone: '☎️',
  ipad: '📱',
  other: '📦',
};

function clamp(v: number, a: number, b: number) {
  return Math.max(a, Math.min(b, v));
}

// Pixel distance within which a dragged desk/label/device snaps to align with another one.
const SNAP_PX = 8;

// The map never renders narrower than this - below it the outer frame scrolls horizontally
// instead of continuing to shrink, so desks never get compressed into illegibly small,
// hard-to-tap targets on a narrow viewport (e.g. an iPad in portrait).
const MIN_MAP_RENDER_WIDTH = 700;

// Marker (desk/device) pixel sizes scale with the map's current render scale, clamped so they
// never get too small to read/tap on a narrow screen or too large on an ultra-wide one - this is
// what keeps desks a "consistent" size relative to the map instead of overlapping as it resizes.
const MARKER_SCALE_MIN = 0.6;
const MARKER_SCALE_MAX = 1.3;

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

type MarkerKind = 'workspace' | 'label' | 'device';

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
  mapDevices: Device[];
  selectedWorkspaceId: string | null;
  selectedLabelId: string | null;
  selectedDeviceId: string | null;
  onSelectWorkspace: (id: string) => void;
  onSelectLabel: (id: string) => void;
  onSelectDevice: (id: string) => void;
  onMoveWorkspace: (id: string, posX: number, posY: number) => void;
  onMoveLabel: (id: string, posX: number, posY: number) => void;
  onMoveDevice: (id: string, posX: number, posY: number) => void;
  workspaceTypes: WorkspaceType[];
  deviceTypes: DeviceType[];
  selectedWorkspaceEmployee: Employee | null;
  selectedWorkspaceEmployeeTeam: Team | null;
  selectedWorkspaceDevices: Device[];
  // Workspace ids whose currently-assigned employee is flagged inactive (status='inactive') -
  // rendered in a distinct warning color so it's visible at a glance that the desk should be
  // unassigned, without having to open each one's popover.
  flaggedWorkspaceIds?: Set<string>;
  // Workspace id -> border color class, for desks whose assigned employee belongs to a team -
  // lets desks for the same team be spotted at a glance regardless of their status fill.
  teamBorderClass?: Map<string, string>;
  // "Show Names" view toggle: when on, a desk with an assigned employee (per assignedNames below)
  // displays their first name on a white box instead of its code, leaving unassigned desks as-is.
  showNames?: boolean;
  // Workspace id -> the assigned employee's first/full name - first is what's drawn in the box,
  // full is the hover tooltip. Only consulted when showNames is true.
  assignedNames?: Map<string, { first: string; full: string }>;
}

const POPOVER_WIDTH = 256;

export default function FloorMapCanvas({
  backgroundUrl,
  editing,
  workspaces,
  labels,
  mapDevices,
  selectedWorkspaceId,
  selectedLabelId,
  selectedDeviceId,
  onSelectWorkspace,
  onSelectLabel,
  onSelectDevice,
  onMoveWorkspace,
  onMoveLabel,
  onMoveDevice,
  workspaceTypes,
  deviceTypes,
  selectedWorkspaceEmployee,
  selectedWorkspaceEmployeeTeam,
  selectedWorkspaceDevices,
  flaggedWorkspaceIds,
  teamBorderClass,
  showNames,
  assignedNames,
}: FloorMapCanvasProps) {
  const floorRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<DragTarget | null>(null);
  const dragKindRef = useRef<MarkerKind | null>(null);
  const vGuideRef = useRef<HTMLDivElement>(null);
  const hGuideRef = useRef<HTMLDivElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const outerRef = useRef<HTMLDivElement>(null);
  const [anchorRect, setAnchorRect] = useState<DOMRect | null>(null);

  const [naturalSize, setNaturalSize] = useState<{ w: number; h: number } | null>(null);
  const [availableWidth, setAvailableWidth] = useState(900);
  const [heightBudget, setHeightBudget] = useState(() => Math.max(300, window.innerHeight - 270));

  useEffect(() => {
    if (!backgroundUrl) {
      setNaturalSize(null);
      return;
    }
    const img = new Image();
    img.onload = () => setNaturalSize({ w: img.naturalWidth, h: img.naturalHeight });
    img.src = backgroundUrl;
  }, [backgroundUrl]);

  useEffect(() => {
    const el = outerRef.current;
    if (!el) return;
    const update = () => setAvailableWidth(el.clientWidth);
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    function onResize() {
      setHeightBudget(Math.max(300, window.innerHeight - 270));
    }
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  const baseW = naturalSize?.w ?? 900;
  const baseH = naturalSize?.h ?? 570;
  // Fit-to-width: the map fills the full available width (no side margins) down to a minimum
  // render width, below which it holds that minimum and the outer frame scrolls horizontally
  // instead of continuing to shrink. Height follows the image's real aspect ratio - even taller
  // than the viewport budget, in which case the outer frame scrolls vertically too.
  const renderedWidth = Math.round(Math.max(availableWidth, MIN_MAP_RENDER_WIDTH));
  const fitScale = (renderedWidth / baseW) || 1;
  const renderedHeight = Math.round(baseH * fitScale);
  const markerScale = clamp(fitScale, MARKER_SCALE_MIN, MARKER_SCALE_MAX);
  const px = (basePx: number) => Math.round(basePx * markerScale);

  const selectedMarker: { kind: 'workspace' | 'device'; id: string } | null = selectedWorkspaceId
    ? { kind: 'workspace', id: selectedWorkspaceId }
    : selectedDeviceId
      ? { kind: 'device', id: selectedDeviceId }
      : null;

  // Brings a newly-selected desk into view (e.g. after jumping here from a people search) -
  // scrollIntoView walks every scrollable ancestor, so this works whether the map itself needs
  // to scroll, the page does, or both. A no-op if it's already visible.
  useEffect(() => {
    if (!selectedWorkspaceId) return;
    document.getElementById(`workspace-${selectedWorkspaceId}`)?.scrollIntoView({
      behavior: 'smooth',
      block: 'center',
      inline: 'center',
    });
  }, [selectedWorkspaceId]);

  // Popover anchor: recomputed whenever the selected desk/device (or its position) changes, view mode only.
  useEffect(() => {
    if (editing || !selectedMarker) {
      setAnchorRect(null);
      return;
    }
    const el = document.getElementById(`${selectedMarker.kind}-${selectedMarker.id}`);
    setAnchorRect(el ? el.getBoundingClientRect() : null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editing, selectedMarker?.kind, selectedMarker?.id, workspaces, mapDevices]);

  // Clicking anywhere outside the popover and outside any desk/label/device closes it (their own
  // pointerup->onSelect* toggle already handles clicks on the markers themselves).
  useEffect(() => {
    if (editing || !selectedMarker) return;
    function onPointerDownOutside(e: PointerEvent) {
      const target = e.target as HTMLElement;
      if (popoverRef.current?.contains(target)) return;
      if (target.closest('[id^="workspace-"], [id^="label-"], [id^="device-"]')) return;
      if (selectedMarker!.kind === 'workspace') onSelectWorkspace(selectedMarker!.id);
      else onSelectDevice(selectedMarker!.id);
    }
    window.addEventListener('pointerdown', onPointerDownOutside, true);
    return () => window.removeEventListener('pointerdown', onPointerDownOutside, true);
  }, [editing, selectedMarker, onSelectWorkspace, onSelectDevice]);

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
  // the (possibly stale) workspaces/labels/devices prop would drop presses; this always builds on the
  // last value WE sent, regardless of whether its response has come back yet.
  const lastNudgeRef = useRef<{ id: string; x: number; y: number } | null>(null);
  useEffect(() => {
    lastNudgeRef.current = null;
  }, [selectedWorkspaceId, selectedLabelId, selectedDeviceId]);

  // Nudges the selected desk/label/device with the arrow keys while editing — a normal press moves
  // ~1px, Shift+press moves ~10px, converted to percent using the floor's current on-screen size so
  // the feel stays consistent regardless of canvas width.
  useEffect(() => {
    if (!editing || (!selectedWorkspaceId && !selectedLabelId && !selectedDeviceId)) return;

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

      const selectedId = selectedWorkspaceId ?? selectedLabelId ?? selectedDeviceId;
      if (!selectedId) return;
      const items = selectedWorkspaceId ? workspaces : selectedLabelId ? labels : mapDevices;
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
      else if (selectedLabelId) onMoveLabel(selectedId, newX, newY);
      else onMoveDevice(selectedId, newX, newY);
    }

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [
    editing,
    selectedWorkspaceId,
    selectedLabelId,
    selectedDeviceId,
    workspaces,
    labels,
    mapDevices,
    onMoveWorkspace,
    onMoveLabel,
    onMoveDevice,
  ]);

  function startDrag(kind: MarkerKind, id: string, posX: number, posY: number) {
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

    // Snap to other desks/labels/devices when close, and show a guide line along the matched axis.
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
    for (const d of mapDevices) {
      if (dragKindRef.current === 'device' && d.id === drag.id) continue;
      otherX.push(Number(d.pos_x ?? 0));
      otherY.push(Number(d.pos_y ?? 0));
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
      else if (kind === 'label') onMoveLabel(drag.id, drag.currentLeft, drag.currentTop);
      else onMoveDevice(drag.id, drag.currentLeft, drag.currentTop);
    } else {
      if (kind === 'workspace') onSelectWorkspace(drag.id);
      else if (kind === 'label') onSelectLabel(drag.id);
      else onSelectDevice(drag.id);
    }
  }

  return (
    <div ref={outerRef} className="relative">
      <div
        className="flex overflow-auto bg-slate-100 p-3"
        style={{ height: Math.min(renderedHeight + 24, heightBudget + 24) }}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
      >
      <div className="relative m-auto shrink-0" style={{ width: renderedWidth, height: renderedHeight }}>
        {backgroundUrl ? (
          <img
            src={backgroundUrl}
            alt=""
            draggable={false}
            className="block h-full w-full select-none"
          />
        ) : (
          <div className="h-full w-full bg-white" />
        )}
        <div
          ref={floorRef}
          className={`absolute inset-0 border-[5px] border-slate-300 shadow-lg ${
            editing ? 'outline outline-[3px] -outline-offset-[3px] outline-dashed outline-blue-600' : ''
          }`}
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

        {workspaces.map((w) => {
          const flagged = flaggedWorkspaceIds?.has(w.id) ?? false;
          const nameInfo = showNames ? assignedNames?.get(w.id) : undefined;
          const fill = nameInfo ? NAME_FILL : flagged ? FLAGGED_FILL : STATUS_FILL_STYLES[w.status];
          const border = flagged ? FLAGGED_BORDER : teamBorderClass?.get(w.id) ?? STATUS_BORDER_STYLES[w.status];
          const title = flagged
            ? 'Assigned employee is no longer active - this desk should be unassigned'
            : nameInfo?.full;
          return (
            <button
              key={w.id}
              id={`workspace-${w.id}`}
              title={title}
              onPointerDown={startDrag('workspace', w.id, Number(w.pos_x ?? 0), Number(w.pos_y ?? 0))}
              className={`absolute flex items-center justify-center overflow-hidden whitespace-nowrap rounded border-[3px] font-bold leading-none ${
                nameInfo ? 'px-0.5' : ''
              } ${fill} ${border} ${
                editing ? 'cursor-grab active:cursor-grabbing' : 'cursor-pointer hover:z-20 hover:scale-150'
              } ${w.id === selectedWorkspaceId ? 'z-20 ring-2 ring-slate-900' : ''}`}
              style={{
                left: `${w.pos_x ?? 0}%`,
                top: `${w.pos_y ?? 0}%`,
                width: editing ? px(24) : px(36),
                height: editing ? px(24) : px(32),
                // Names run longer than desk codes, so they get a smaller size than the code/non-name
                // case to actually fit the (unchanged) box width instead of clipping edge-to-edge.
                fontSize: nameInfo ? (editing ? px(6) : px(8)) : editing ? px(7) : px(10),
              }}
            >
              {nameInfo ? nameInfo.first : w.code}
            </button>
          );
        })}

        {labels.map((l) => (
          <div
            key={l.id}
            id={`label-${l.id}`}
            onPointerDown={startDrag('label', l.id, Number(l.pos_x ?? 0), Number(l.pos_y ?? 0))}
            className={`absolute rounded-md bg-slate-900/85 font-semibold text-white ${
              editing ? 'cursor-grab active:cursor-grabbing' : 'cursor-default'
            } ${l.id === selectedLabelId ? 'ring-2 ring-blue-600' : ''}`}
            style={{
              left: `${l.pos_x ?? 0}%`,
              top: `${l.pos_y ?? 0}%`,
              padding: `${px(4)}px ${px(10)}px`,
              fontSize: px(11),
            }}
          >
            {l.text}
          </div>
        ))}

        {mapDevices.map((d) => {
          const deviceType = deviceTypes.find((t) => t.id === d.device_type_id);
          const code = deviceType?.code ?? 'other';
          const dim = d.status !== 'active';
          const commonProps = {
            key: d.id,
            id: `device-${d.id}`,
            onPointerDown: startDrag('device', d.id, Number(d.pos_x ?? 0), Number(d.pos_y ?? 0)),
            style: { left: `${d.pos_x ?? 0}%`, top: `${d.pos_y ?? 0}%` },
          };

          // TVs get the same named-label treatment as desks, but as a wide landscape rectangle
          // (rather than square) so a name like "TV-Boardroom" fits on one line, sized to be a
          // bigger, more prominent fixture than the small icon-only circle other devices use.
          if (code === 'tv') {
            return (
              <button
                {...commonProps}
                title={d.name ?? undefined}
                className={`absolute flex items-center justify-center overflow-hidden whitespace-nowrap rounded border-2 bg-white px-2 text-center font-bold leading-none ${
                  d.rotated ? 'rotate-90' : ''
                } ${dim ? 'border-red-400 opacity-60' : 'border-slate-500'} ${
                  editing ? 'cursor-grab active:cursor-grabbing' : 'cursor-pointer hover:z-20 hover:scale-125'
                } ${d.id === selectedDeviceId ? 'z-20 ring-2 ring-slate-900' : ''}`}
                style={{
                  ...commonProps.style,
                  width: editing ? px(96) : px(128),
                  height: editing ? px(28) : px(36),
                  fontSize: editing ? px(9) : px(11),
                }}
              >
                {d.name || deviceType?.label || 'TV'}
              </button>
            );
          }

          return (
            <button
              {...commonProps}
              title={d.name ?? undefined}
              className={`absolute flex items-center justify-center rounded-full border-2 bg-white leading-none ${
                dim ? 'border-red-400 opacity-60' : 'border-slate-400'
              } ${
                editing ? 'cursor-grab active:cursor-grabbing' : 'cursor-pointer hover:z-20 hover:scale-150'
              } ${d.id === selectedDeviceId ? 'z-20 ring-2 ring-slate-900' : ''}`}
              style={{
                ...commonProps.style,
                width: editing ? px(24) : px(32),
                height: editing ? px(24) : px(32),
                fontSize: editing ? px(11) : px(14),
              }}
            >
              {DEVICE_ICONS[code] ?? '📦'}
            </button>
          );
        })}
        </div>
      </div>
      </div>

      {!editing && anchorRect && selectedMarker && selectedMarker.kind === 'workspace' && (
        (() => {
          const w = workspaces.find((x) => x.id === selectedMarker!.id);
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
                onClose={() => onSelectWorkspace(selectedMarker!.id)}
              />
            </div>
          );
        })()
      )}

      {!editing && anchorRect && selectedMarker && selectedMarker.kind === 'device' && (
        (() => {
          const d = mapDevices.find((x) => x.id === selectedMarker!.id);
          if (!d) return null;
          return (
            <div ref={popoverRef}>
              <DeviceInfoPopover
                device={d}
                deviceType={deviceTypes.find((t) => t.id === d.device_type_id) ?? null}
                style={popoverStyle(anchorRect)}
                onClose={() => onSelectDevice(selectedMarker!.id)}
              />
            </div>
          );
        })()
      )}
    </div>
  );
}
