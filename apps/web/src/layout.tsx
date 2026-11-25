import { useEffect, useState } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import {
  BarChart3, Banknote, FileText, LayoutDashboard, LogOut, Map as MapIcon, Menu, MessageSquareWarning, Moon, Plus, Settings, Sun, Users, X,
} from 'lucide-react';
import { useAuth } from './auth';
import { Avatar } from './ui';

function useTheme() {
  const [theme, setTheme] = useState<'light' | 'dark'>(() => {
    try {
      return (localStorage.getItem('cl_theme') as 'light' | 'dark') ?? (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
    } catch {
      return 'light';
    }
  });
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    try {
      localStorage.setItem('cl_theme', theme);
    } catch {
      /* ignore */
    }
  }, [theme]);
  return [theme, setTheme] as const;
}

export function Layout() {
  const { user, signOut } = useAuth();
  const staff = user?.role === 'owner' || user?.role === 'accountant';
  const [theme, setTheme] = useTheme();
  const [open, setOpen] = useState(false);
  const loc = useLocation();
  const nav = useNavigate();
  useEffect(() => setOpen(false), [loc.pathname]);

  const links = [
    staff && { to: '/', label: 'Dashboard', icon: LayoutDashboard, end: true },
    { to: '/customers', label: 'Customers', icon: Users },
    staff && { to: '/bills', label: 'Bills', icon: FileText },
    { to: '/collections', label: 'Collections', icon: Banknote },
    { to: '/field', label: 'Field & beats', icon: MapIcon },
    staff && { to: '/reports', label: 'Reports', icon: BarChart3 },
    staff && { to: '/disputes', label: 'Disputes', icon: MessageSquareWarning },
    user?.role === 'owner' && { to: '/settings', label: 'Settings', icon: Settings },
  ].filter(Boolean) as Array<{ to: string; label: string; icon: typeof Users; end?: boolean }>;

  return (
    <div className={`shell ${open ? 'nav-open' : ''}`}>
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark">₹</div>
          <div>
            <div className="brand-name">Credit Ledger</div>
            <div className="brand-sub">Collections made simple</div>
          </div>
          <button className="icon-btn nav-close" onClick={() => setOpen(false)} aria-label="Close menu"><X size={18} /></button>
        </div>
        {staff && (
          <button className="btn btn-primary btn-block new-btn" onClick={() => nav('/bills/new')}>
            <Plus size={16} />New bill
          </button>
        )}
        <nav className="nav">
          {links.map(({ to, label, icon: Icon, end }) => (
            <NavLink key={to} to={to} end={end} className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}>
              <Icon size={18} />
              {label}
            </NavLink>
          ))}
        </nav>
        <div className="sidebar-foot">
          <div className="me">
            <Avatar name={user?.name ?? '?'} size={34} />
            <div className="me-text">
              <b>{user?.name}</b>
              <span>{user?.role}</span>
            </div>
          </div>
          <div className="foot-actions">
            <button className="icon-btn" title={theme === 'dark' ? 'Light mode' : 'Dark mode'} onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}>
              {theme === 'dark' ? <Sun size={17} /> : <Moon size={17} />}
            </button>
            <button className="icon-btn" title="Sign out" onClick={signOut}><LogOut size={17} /></button>
          </div>
        </div>
      </aside>
      <div className="scrim" onClick={() => setOpen(false)} />
      <div className="main">
        <header className="mobile-bar">
          <button className="icon-btn" onClick={() => setOpen(true)} aria-label="Open menu"><Menu size={20} /></button>
          <span className="brand-name">Credit Ledger</span>
        </header>
        <main className="content">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
