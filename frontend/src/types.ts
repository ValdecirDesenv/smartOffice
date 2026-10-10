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
  // Null for someone HubSpot doesn't say a real office for yet - they exist in the directory
  // ready to be assigned to any office/desk, rather than living in a placeholder office.
  site_id: string | null;
  team_id: string | null;
  name: string;
  email: string | null;
  job_title: string | null;
  status: 'active' | 'inactive';
  // From the HubSpot sync's hubspot_data - null for anyone never synced or with no photo on file.
  headshot_url?: string | null;
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
  floor_id: string | null;
  pos_x: number | string | null;
  pos_y: number | string | null;
  device_type_id: string;
  name: string | null;
  serial_number: string | null;
  asset_tag: string | null;
  mac_address: string | null;
  status: DeviceStatus;
  rotated: boolean;
}

export interface WorkspaceAssignment {
  id: string;
  workspace_id: string;
  employee_id: string;
  assigned_at: string;
  unassigned_at: string | null;
}

export interface User {
  id: string;
  username: string;
  email: string;
  employee_id: string | null;
  is_admin: boolean;
  can_edit: boolean;
  can_sync_hubspot: boolean;
}

export interface HubspotSyncResult {
  matched: number;
  updated: number;
  matchedByEmail: number;
  matchedByName: number;
  created: number;
  skippedNoIdentifier: number;
  skippedNoName: number;
  removedFormerEmployees: number;
  flaggedFormerEmployees: number;
  skippedFormerNoMatch: number;
  offboardedRecorded: number;
  errors: Array<{ row: string; message: string }>;
}

export interface OffboardedEmployee {
  id: string;
  first_name: string | null;
  last_name: string | null;
  email: string | null;
  job_title: string | null;
  department: string | null;
  start_date: string | null;
  termination_date: string | null;
  headshot_url: string | null;
  // Set only while they're still on the People list (flagged, still has a desk) - null means
  // they were removed from the People list entirely (or never existed locally to begin with).
  matched_employee_id: string | null;
  first_synced_at: string;
  last_synced_at: string;
}

export interface ConfigSnapshot {
  id: string;
  name: string;
  created_by_username: string;
  created_at: string;
  updated_at: string;
  sites_count: number;
  floors_count: number;
  workspaces_count: number;
  employees_count: number;
}

export type DeskRequestStatus = 'pending' | 'approved' | 'rejected';

export interface DeskRequest {
  id: string;
  status: DeskRequestStatus;
  note: string | null;
  requested_email: string | null;
  requested_first_name: string | null;
  requested_last_name: string | null;
  requested_by_username: string;
  created_at: string;
  reviewed_by_username: string | null;
  reviewed_at: string | null;
  review_note: string | null;
  site_id: string;
  site_name: string;
  floor_id: string;
  floor_name: string;
  workspace_id: string;
  workspace_code: string;
  employee_id: string | null;
  employee_name: string | null;
}

export type IngestionEventStatus = 'received' | 'processed' | 'ignored' | 'error';

export interface IngestionEvent {
  id: string;
  received_at: string;
  processed_at: string | null;
  processing_status: IngestionEventStatus;
  error_detail: string | null;
  site_id: string | null;
  desktop_serial: string | null;
  device_name: string | null;
  logged_in_user: string | null;
  ip_address: string | null;
  collected_at: string | null;
  monitors: Array<{ name?: string | null; serial?: string | null }> | null;
  monitor_info_raw: string | null;
}

export interface SeatDeviceRow {
  site_name: string;
  floor_name: string;
  seat_location: string;
  workspace_id: string;
  monitor_serial: string | null;
  computer_serial: string | null;
  employee_id: string | null;
  assigned_to: string | null;
  assigned_email: string | null;
}
