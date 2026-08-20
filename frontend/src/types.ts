export interface Site {
  id: string;
  name: string;
  address: string | null;
  timezone: string | null;
}

export interface Floor {
  id: string;
  site_id: string;
  name: string;
  level: number | null;
  background_image_path: string | null;
}

export interface WorkspaceType {
  id: string;
  code: string;
  label: string;
}

export type WorkspaceStatus = 'available' | 'occupied' | 'reserved' | 'assigned' | 'inactive';

export interface Workspace {
  id: string;
  site_id: string;
  floor_id: string;
  workspace_type_id: string;
  code: string;
  pos_x: number | string | null;
  pos_y: number | string | null;
  status: WorkspaceStatus;
}

export interface Label {
  id: string;
  floor_id: string;
  text: string;
  pos_x: number | string | null;
  pos_y: number | string | null;
}

export interface Team {
  id: string;
  site_id: string;
  name: string;
  department: string | null;
}

export interface Employee {
  id: string;
  site_id: string;
  team_id: string | null;
  name: string;
  email: string | null;
  job_title: string | null;
  status: 'active' | 'inactive';
}

export type DeviceStatus = 'active' | 'inactive' | 'missing' | 'retired';

export interface DeviceType {
  id: string;
  code: string;
  label: string;
}

export interface Device {
  id: string;
  site_id: string;
  workspace_id: string | null;
  device_type_id: string;
  name: string | null;
  serial_number: string | null;
  asset_tag: string | null;
  mac_address: string | null;
  status: DeviceStatus;
}

export interface WorkspaceAssignment {
  id: string;
  workspace_id: string;
  employee_id: string;
  assigned_at: string;
  unassigned_at: string | null;
}
