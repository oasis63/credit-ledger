import { StrictMode, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { AuthProvider, useAuth } from './auth';
import { Layout } from './layout';
import { Loading, ToastProvider } from './ui';
import { Login, Register } from './pages/Auth';
import { Dashboard } from './pages/Dashboard';
import { Customers } from './pages/Customers';
import { CustomerDetail } from './pages/CustomerDetail';
import { ImportCustomers } from './pages/ImportCustomers';
import { Bills } from './pages/Bills';
import { BillNew } from './pages/BillNew';
import { BillView } from './pages/BillView';
import { Collections } from './pages/Collections';
import { Field } from './pages/Field';
import { Reports } from './pages/Reports';
import { Disputes } from './pages/Disputes';
import { Settings } from './pages/Settings';
import { Statement } from './pages/Statement';
import './styles.css';
import 'leaflet/dist/leaflet.css';

try {
  document.documentElement.dataset.theme = localStorage.getItem('cl_theme') ?? (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
} catch {
  /* ignore */
}

function RequireAuth({ children, staffOnly, ownerOnly }: { children: ReactNode; staffOnly?: boolean; ownerOnly?: boolean }) {
  const { user, loading } = useAuth();
  if (loading) return <Loading />;
  if (!user) return <Navigate to="/login" replace />;
  if (staffOnly && user.role === 'salesman') return <Navigate to="/field" replace />;
  if (ownerOnly && user.role !== 'owner') return <Navigate to="/" replace />;
  return <>{children}</>;
}

function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/register" element={<Register />} />
      <Route path="/s/:token" element={<Statement />} />
      <Route path="/bills/:id/print" element={<RequireAuth><BillView printOnly /></RequireAuth>} />
      <Route element={<RequireAuth><Layout /></RequireAuth>}>
        <Route index element={<RequireAuth staffOnly><Dashboard /></RequireAuth>} />
        <Route path="customers" element={<Customers />} />
        <Route path="customers/import" element={<RequireAuth staffOnly><ImportCustomers /></RequireAuth>} />
        <Route path="customers/:id" element={<CustomerDetail />} />
        <Route path="bills" element={<RequireAuth staffOnly><Bills /></RequireAuth>} />
        <Route path="bills/new" element={<RequireAuth staffOnly><BillNew /></RequireAuth>} />
        <Route path="bills/:id" element={<RequireAuth><BillView /></RequireAuth>} />
        <Route path="collections" element={<Collections />} />
        <Route path="field" element={<Field />} />
        <Route path="reports" element={<RequireAuth staffOnly><Reports /></RequireAuth>} />
        <Route path="disputes" element={<RequireAuth staffOnly><Disputes /></RequireAuth>} />
        <Route path="settings" element={<RequireAuth ownerOnly><Settings /></RequireAuth>} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <AuthProvider>
        <ToastProvider>
          <App />
        </ToastProvider>
      </AuthProvider>
    </BrowserRouter>
  </StrictMode>,
);
