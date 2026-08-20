import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { AppProvider } from './context/AppContext';
import Sidebar from './components/Sidebar';
import FloorMapPage from './pages/FloorMapPage';
import PeoplePage from './pages/PeoplePage';

export default function App() {
  return (
    <AppProvider>
      <BrowserRouter>
        <div className="grid h-screen grid-cols-[220px_1fr] bg-slate-100 text-slate-900">
          <Sidebar />
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
