import { useState } from 'react';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { AppProvider } from './context/AppContext';
import Sidebar from './components/Sidebar';
import FloorMapPage from './pages/FloorMapPage';
import PeoplePage from './pages/PeoplePage';

const SIDEBAR_COLLAPSED_KEY = 'smartoffice.sidebarCollapsed';

export default function App() {
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === '1');

  function toggleSidebar() {
    setSidebarCollapsed((prev) => {
      const next = !prev;
      localStorage.setItem(SIDEBAR_COLLAPSED_KEY, next ? '1' : '0');
      return next;
    });
  }

  return (
    <AppProvider>
      <BrowserRouter>
        <div
          className="grid h-screen bg-slate-100 text-slate-900 transition-[grid-template-columns] duration-150"
          style={{ gridTemplateColumns: sidebarCollapsed ? '44px 1fr' : '220px 1fr' }}
        >
          <Sidebar collapsed={sidebarCollapsed} onToggleCollapse={toggleSidebar} />
          <main className="min-w-0 overflow-auto">
            <Routes>
              <Route path="/" element={<FloorMapPage />} />
              <Route path="/people" element={<PeoplePage />} />
              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          </main>
        </div>
      </BrowserRouter>
    </AppProvider>
  );
}
