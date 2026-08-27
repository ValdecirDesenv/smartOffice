import { useState } from 'react';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { AuthProvider, useAuth } from './context/AuthContext';
import { AppProvider } from './context/AppContext';
import Sidebar from './components/Sidebar';
import FloorMapPage from './pages/FloorMapPage';
import PeoplePage from './pages/PeoplePage';
import UsersPage from './pages/UsersPage';
import ConfigSnapshotsPage from './pages/ConfigSnapshotsPage';
import LoginPage from './pages/LoginPage';
import ForgotPasswordPage from './pages/ForgotPasswordPage';
import ResetPasswordPage from './pages/ResetPasswordPage';
import AcceptInvitePage from './pages/AcceptInvitePage';

const SIDEBAR_COLLAPSED_KEY = 'smartoffice.sidebarCollapsed';

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <AppRoutes />
      </BrowserRouter>
    </AuthProvider>
  );
}

function AppRoutes() {
  const { loading, currentUser } = useAuth();
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === '1');

  function toggleSidebar() {
    setSidebarCollapsed((prev) => {
      const next = !prev;
      localStorage.setItem(SIDEBAR_COLLAPSED_KEY, next ? '1' : '0');
      return next;
    });
  }

  if (loading) {
    return <div className="p-10 text-sm text-slate-500">Loading…</div>;
  }

  // Logged out: only the public auth pages exist; everything else redirects to /login. No
  // sidebar/app shell here - these are standalone centered forms.
  if (!currentUser) {
    return (
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/forgot-password" element={<ForgotPasswordPage />} />
        <Route path="/reset-password" element={<ResetPasswordPage />} />
        <Route path="/accept-invite" element={<AcceptInvitePage />} />
        <Route path="*" element={<Navigate to="/login" replace />} />
      </Routes>
    );
  }

  return (
    <AppProvider>
      <div
        className="grid h-screen bg-slate-100 text-slate-900 transition-[grid-template-columns] duration-150"
        style={{ gridTemplateColumns: sidebarCollapsed ? '44px 1fr' : '220px 1fr' }}
      >
        <Sidebar collapsed={sidebarCollapsed} onToggleCollapse={toggleSidebar} />
        <main className="min-w-0 overflow-auto">
          <Routes>
            <Route path="/" element={<FloorMapPage />} />
            <Route path="/people" element={<PeoplePage />} />
            <Route path="/users" element={<UsersPage />} />
            <Route path="/config-snapshots" element={<ConfigSnapshotsPage />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </main>
      </div>
    </AppProvider>
  );
}
