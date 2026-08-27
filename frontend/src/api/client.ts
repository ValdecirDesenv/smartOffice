import type {
  Site,
  Floor,
  WorkspaceType,
  Workspace,
  Label,
  Team,
  Employee,
  DeviceType,
  Device,
  WorkspaceAssignment,
  User,
  ConfigSnapshot,
  DeskRequest,
} from '../types';

export class ApiError extends Error {
  status: number;
  detail?: unknown;

  constructor(status: number, message: string, detail?: unknown) {
    super(message);
    this.status = status;
    this.detail = detail;
  }
}

async function request<T>(method: string, url: string, body?: unknown): Promise<T> {
  const res = await fetch(url, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });

  if (res.status === 204) {
    return undefined as T;
  }

  const text = await res.text();
  const data = text ? JSON.parse(text) : undefined;

  if (!res.ok) {
    throw new ApiError(res.status, (data && data.error) || res.statusText, data?.detail);
  }
  return data as T;
}

function query(params: Record<string, string | number | boolean | undefined>): string {
  const entries = Object.entries(params).filter(([, v]) => v !== undefined && v !== '');
  if (!entries.length) return '';
  return '?' + entries.map(([k, v]) => `${k}=${encodeURIComponent(String(v))}`).join('&');
}

export const api = {
  sites: {
    list: () => request<Site[]>('GET', '/api/sites'),
    create: (data: Partial<Site>) => request<Site>('POST', '/api/sites', data),
    update: (id: string, data: Partial<Site>) => request<Site>('PUT', `/api/sites/${id}`, data),
    remove: (id: string) => request<void>('DELETE', `/api/sites/${id}`),
  },
  floors: {
    list: (siteId?: string) => request<Floor[]>('GET', `/api/floors${query({ site_id: siteId })}`),
    create: (data: Partial<Floor>) => request<Floor>('POST', '/api/floors', data),
    update: (id: string, data: Partial<Floor>) => request<Floor>('PUT', `/api/floors/${id}`, data),
    remove: (id: string) => request<void>('DELETE', `/api/floors/${id}`),
    uploadBackground: async (id: string, file: File): Promise<Floor> => {
      const form = new FormData();
      form.append('file', file);
      const res = await fetch(`/api/floors/${id}/background`, { method: 'POST', body: form });
      const data = await res.json();
      if (!res.ok) throw new ApiError(res.status, data?.error || res.statusText, data?.detail);
      return data;
    },
  },
  workspaceTypes: {
    list: () => request<WorkspaceType[]>('GET', '/api/workspace-types'),
  },
  workspaces: {
    list: (params: { siteId?: string; floorId?: string } = {}) =>
      request<Workspace[]>('GET', `/api/workspaces${query({ site_id: params.siteId, floor_id: params.floorId })}`),
    create: (data: Partial<Workspace>) => request<Workspace>('POST', '/api/workspaces', data),
    update: (id: string, data: Partial<Workspace>) => request<Workspace>('PUT', `/api/workspaces/${id}`, data),
    remove: (id: string) => request<void>('DELETE', `/api/workspaces/${id}`),
  },
  labels: {
    list: (floorId?: string) => request<Label[]>('GET', `/api/labels${query({ floor_id: floorId })}`),
    create: (data: Partial<Label>) => request<Label>('POST', '/api/labels', data),
    update: (id: string, data: Partial<Label>) => request<Label>('PUT', `/api/labels/${id}`, data),
    remove: (id: string) => request<void>('DELETE', `/api/labels/${id}`),
  },
  teams: {
    list: (siteId?: string) => request<Team[]>('GET', `/api/teams${query({ site_id: siteId })}`),
    create: (data: Partial<Team>) => request<Team>('POST', '/api/teams', data),
    update: (id: string, data: Partial<Team>) => request<Team>('PUT', `/api/teams/${id}`, data),
    remove: (id: string) => request<void>('DELETE', `/api/teams/${id}`),
  },
  employees: {
    list: (params: { siteId?: string; teamId?: string } = {}) =>
      request<Employee[]>('GET', `/api/employees${query({ site_id: params.siteId, team_id: params.teamId })}`),
    create: (data: Partial<Employee>) => request<Employee>('POST', '/api/employees', data),
    update: (id: string, data: Partial<Employee>) => request<Employee>('PUT', `/api/employees/${id}`, data),
    remove: (id: string) => request<void>('DELETE', `/api/employees/${id}`),
  },
  deviceTypes: {
    list: () => request<DeviceType[]>('GET', '/api/device-types'),
  },
  devices: {
    list: (params: { siteId?: string; workspaceId?: string; floorId?: string } = {}) =>
      request<Device[]>(
        'GET',
        `/api/devices${query({ site_id: params.siteId, workspace_id: params.workspaceId, floor_id: params.floorId })}`
      ),
    create: (data: Partial<Device>) => request<Device>('POST', '/api/devices', data),
    update: (id: string, data: Partial<Device>) => request<Device>('PUT', `/api/devices/${id}`, data),
    remove: (id: string) => request<void>('DELETE', `/api/devices/${id}`),
  },
  auth: {
    login: (username: string, password: string) => request<User>('POST', '/api/auth/login', { username, password }),
    logout: () => request<void>('POST', '/api/auth/logout'),
    me: () => request<User>('GET', '/api/auth/me'),
    forgotPassword: (email: string) => request<{ ok: true }>('POST', '/api/auth/forgot-password', { email }),
    resetPassword: (token: string, password: string) =>
      request<{ ok: true }>('POST', '/api/auth/reset-password', { token, password }),
    getInvite: (token: string) => request<{ email: string }>('GET', `/api/auth/invites/${token}`),
    acceptInvite: (token: string, username: string, password: string) =>
      request<User>('POST', '/api/auth/accept-invite', { token, username, password }),
  },
  users: {
    list: () => request<User[]>('GET', '/api/users'),
    invite: (email: string, canEdit: boolean = true) =>
      request<{ id: string; email: string }>('POST', '/api/users/invites', { email, canEdit }),
    updateRole: (id: string, role: 'admin' | 'member' | 'guest') =>
      request<User>('PATCH', `/api/users/${id}/role`, { role }),
  },
  assignments: {
    list: (params: { workspaceId?: string; employeeId?: string; all?: boolean } = {}) =>
      request<WorkspaceAssignment[]>(
        'GET',
        `/api/assignments${query({ workspace_id: params.workspaceId, employee_id: params.employeeId, all: params.all })}`
      ),
    create: (data: { workspace_id: string; employee_id: string }) =>
      request<WorkspaceAssignment>('POST', '/api/assignments', data),
    remove: (id: string) => request<WorkspaceAssignment>('DELETE', `/api/assignments/${id}`),
  },
  configSnapshots: {
    list: () => request<ConfigSnapshot[]>('GET', '/api/config-snapshots'),
    create: (name: string) => request<ConfigSnapshot>('POST', '/api/config-snapshots', { name }),
    overwrite: (id: string, name: string) => request<ConfigSnapshot>('PUT', `/api/config-snapshots/${id}`, { name }),
    restore: (id: string) => request<{ id: string; name: string }>('POST', `/api/config-snapshots/${id}/restore`),
    remove: (id: string) => request<void>('DELETE', `/api/config-snapshots/${id}`),
  },
  deskRequests: {
    create: (data: {
      workspace_id: string;
      employee_id?: string;
      requested_first_name?: string;
      requested_last_name?: string;
      requested_email?: string;
      note?: string;
    }) => request<DeskRequest>('POST', '/api/desk-requests', data),
    list: (status?: string) => request<DeskRequest[]>('GET', `/api/desk-requests${query({ status })}`),
    approve: (
      id: string,
      data: {
        workspace_id?: string;
        employee_id?: string;
        first_name?: string;
        last_name?: string;
        email?: string;
        job_title?: string;
        team_id?: string;
      } = {}
    ) => request<DeskRequest>('POST', `/api/desk-requests/${id}/approve`, data),
    reject: (id: string, review_note?: string) =>
      request<DeskRequest>('POST', `/api/desk-requests/${id}/reject`, { review_note }),
  },
};
