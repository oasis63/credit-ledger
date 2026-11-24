import { StrictMode, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { AuthProvider, useAuth } from './auth';
import { Layout } from './components';
import { Login, Register } from './pages/Auth';
import { Dashboard } from './pages/Dashboard';
import { Customers } from './pages/Customers';
import { CustomerDetail } from './pages/CustomerDetail';
import { Collections } from './pages/Collections';
import { Disputes } from './pages/Disputes';
import { Settings } from './pages/Settings';
import { Statement } from './pages/Statement';
import './styles.css';

function RequireAuth({ children, staffOnly }: { children: ReactNode; staffOnly?: boolean }) {
  const { user, loading } = useAuth();
  if (loading) return <p className="content">Loading…</p>;
  if (!user) return <Navigate to="/login" replace />;
  if (staffOnly && user.role === 'salesman') return <Navigate to="/collections" replace />;
  return <>{children}</>;
}

function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/register" element={<Register />} />
      <Route path="/s/:token" element={<Statement />} />
      <Route
        element={
          <RequireAuth>
            <Layout />
          </RequireAuth>
        }
      >
        <Route index element={<RequireAuth staffOnly><Dashboard /></RequireAuth>} />
        <Route path="customers" element={<Customers />} />
        <Route path="customers/:id" element={<CustomerDetail />} />
        <Route path="collections" element={<Collections />} />
        <Route path="disputes" element={<RequireAuth staffOnly><Disputes /></RequireAuth>} />
        <Route path="settings" element={<RequireAuth staffOnly><Settings /></RequireAuth>} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <AuthProvider>
        <App />
      </AuthProvider>
    </BrowserRouter>
  </StrictMode>,
);
