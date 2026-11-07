import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Link, NavLink, useLocation } from 'react-router-dom';
import {
  AlertTriangle,
  BarChart3,
  Bell,
  Boxes,
  CheckCircle2,
  ChevronDown,
  ClipboardList,
  LayoutDashboard,
  ListChecks,
  Menu,
  PackageCheck,
  PackageSearch,
  RefreshCw,
  Settings,
  ShieldCheck,
  ShoppingCart,
  Store,
  UserPlus,
  Wifi,
  WifiOff,
  X,
  XCircle,
  Info,
} from 'lucide-react';
import { useApp } from '../store/AppStore';
import { canAny, ROLE_LABELS, type Permission } from '../domain/permissions';
import { Avatar } from './ui';
import { UserFormModal } from './UserFormModal';
import { dateShort, relative } from '../lib/format';

const PRIMARY_NAV: {
  to: string;
  label: string;
  icon: ReactNode;
  permissions?: Permission[];
  end?: boolean;
}[] = [
  { to: '/', label: 'Today', icon: <LayoutDashboard size={17} />, end: true },
  { to: '/sales', label: 'Sales & POS', icon: <ShoppingCart size={17} />, permissions: ['sale.view'] },
  { to: '/inventory', label: 'Stock', icon: <Boxes size={17} />, permissions: ['stock.view'] },
  { to: '/counts', label: 'Counts', icon: <ListChecks size={17} />, permissions: ['count.view'] },
];

const SUPPLY_NAV: typeof PRIMARY_NAV = [
  { to: '/catalogue', label: 'Catalogue', icon: <PackageSearch size={17} />, permissions: ['catalog.view'] },
  {
    to: '/purchasing',
    label: 'Purchasing',
    icon: <ClipboardList size={17} />,
    permissions: ['po.create', 'po.approve', 'receipt.view'],
  },
  { to: '/receiving', label: 'Receiving', icon: <PackageCheck size={17} />, permissions: ['receipt.view'] },
];

const OVERSEE_NAV: typeof PRIMARY_NAV = [
  { to: '/alerts', label: 'Alerts', icon: <Bell size={17} />, permissions: ['alert.view'] },
  { to: '/reports', label: 'Reports', icon: <BarChart3 size={17} />, permissions: ['report.view'] },
  {
    to: '/admin',
    label: 'Administration',
    icon: <Settings size={17} />,
    permissions: ['admin.users', 'admin.settings', 'admin.audit', 'admin.data'],
  },
];

export function AppShell({ children }: { children: ReactNode }) {
  const {
    state,
    currentUser,
    activeAlerts,
    pendingSyncCount,
    online,
    simulateOffline,
    setSimulateOffline,
    actions,
    toasts,
    dismissToast,
  } = useApp();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [userMenu, setUserMenu] = useState(false);
  const [addUserOpen, setAddUserOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const location = useLocation();

  useEffect(() => {
    setSidebarOpen(false);
    setUserMenu(false);
  }, [location.pathname]);

  useEffect(() => {
    if (!userMenu) return;
    const onClick = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) setUserMenu(false);
    };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, [userMenu]);

  const visible = (item: (typeof PRIMARY_NAV)[number]) =>
    !item.permissions || canAny(currentUser, item.permissions);

  const renderNav = (items: typeof PRIMARY_NAV) =>
    items
      .filter(visible)
      .map((item) => (
        <NavLink
          key={item.to}
          to={item.to}
          end={item.end}
          className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}
        >
          {item.icon}
          <span>{item.label}</span>
          {item.to === '/alerts' && activeAlerts.length > 0 && (
            <span className="nav-count">{activeAlerts.length}</span>
          )}
        </NavLink>
      ));

  const today = new Date();

  return (
    <div className="app-shell">
      <a className="skip-link" href="#main-content" style={{ position: 'absolute', left: -9999 }}>
        Skip to content
      </a>
      <aside className={`sidebar ${sidebarOpen ? 'open' : ''}`}>
        <div className="sidebar__brand">
          <span className="brand-mark">
            <Store size={21} />
          </span>
          <div>
            <div className="brand-name">Storehouse</div>
            <div className="brand-sub">Inventory Control</div>
          </div>
          <button
            className="modal__close"
            style={{ marginLeft: 'auto', display: sidebarOpen ? 'grid' : 'none', background: 'rgba(255,255,255,.1)', color: '#fff' }}
            onClick={() => setSidebarOpen(false)}
            aria-label="Close menu"
          >
            <X size={15} />
          </button>
        </div>

        <div className="sidebar__store">
          <Store size={16} />
          <div>
            <div className="sidebar__store-name">{state.store.name}</div>
            <div className="sidebar__store-meta">
              {state.store.code} · Lekki, Lagos
            </div>
          </div>
        </div>

        <nav aria-label="Primary">
          <div className="nav-section">Operate</div>
          {renderNav(PRIMARY_NAV)}
          <div className="nav-section">Supply</div>
          {renderNav(SUPPLY_NAV)}
          <div className="nav-section">Oversight</div>
          {renderNav(OVERSEE_NAV)}
        </nav>

        <div className="sidebar__footer">
          <div className="sidebar__sync">
            <div className="sync-line">
              <span className="flex gap-6">
                <span className={`sync-dot ${online ? '' : 'off'}`} />
                {online ? 'Online' : 'Offline mode'}
              </span>
              <strong>{pendingSyncCount > 0 ? `${pendingSyncCount} queued` : 'All synced'}</strong>
            </div>
            <div className="sync-line mt-8" style={{ fontSize: '0.68rem' }}>
              <span>Last sync</span>
              <span>{relative(state.lastSyncAt)}</span>
            </div>
          </div>
          <div className="sidebar__version">
            <span>Storehouse v1.0</span>
            <span>{state.deviceId}</span>
          </div>
        </div>
      </aside>

      {sidebarOpen && <div className="sidebar-backdrop" onClick={() => setSidebarOpen(false)} />}

      <div className="main">
        <header className="topbar">
          <button className="icon-btn menu-btn" onClick={() => setSidebarOpen(true)} aria-label="Open menu">
            <Menu size={18} />
          </button>
          <div className="topbar__context">
            <div>
              <div className="eyebrow">Trading day</div>
              <div className="topbar__date">
                {today.toLocaleDateString('en-NG', { weekday: 'short', day: 'numeric', month: 'long', year: 'numeric' })}
              </div>
            </div>
          </div>
          <div className="topbar__spacer" />

          <div className="topbar__right">
            <button
              className={`sync-chip ${pendingSyncCount > 0 || !online ? 'pending' : ''}`}
              onClick={actions.syncNow}
              title={
                online
                  ? pendingSyncCount > 0
                    ? 'Sync queued work'
                    : 'Synced with the central service'
                  : 'Offline — changes are queued on this device'
              }
            >
              <span className={`sync-dot ${online ? '' : 'off'}`} />
              <span className="label">
                {!online ? 'Offline' : pendingSyncCount > 0 ? `${pendingSyncCount} to sync` : `Synced ${relative(state.lastSyncAt)}`}
              </span>
            </button>

            <button
              className="icon-btn"
              title={simulateOffline ? 'Turn off offline simulation' : 'Simulate offline trading'}
              onClick={() => setSimulateOffline(!simulateOffline)}
              aria-label="Toggle offline simulation"
            >
              {simulateOffline || !online ? <WifiOff size={17} /> : <Wifi size={17} />}
            </button>

            {canAny(currentUser, ['alert.view']) && (
              <Link to="/alerts" className="icon-btn" aria-label={`${activeAlerts.length} active alerts`} title="Alerts">
                <Bell size={17} />
                {activeAlerts.length > 0 && <span className="icon-btn__dot" />}
              </Link>
            )}

            <div className="dropdown" ref={menuRef}>
              <button className="user-chip" onClick={() => setUserMenu((v) => !v)} aria-expanded={userMenu}>
                <Avatar name={currentUser.name} />
                <span className="user-chip__text">
                  <div className="user-chip__name">{currentUser.name}</div>
                  <div className="user-chip__role">{ROLE_LABELS[currentUser.role]}</div>
                </span>
                <ChevronDown size={14} className="muted" />
              </button>
              {userMenu && (
                <div className="dropdown__menu">
                  <div className="dropdown__label">Switch demo user</div>
                  {state.users.map((user) => (
                    <button
                      key={user.id}
                      className={`dropdown__item ${user.id === currentUser.id ? 'active' : ''}`}
                      onClick={() => {
                        actions.switchUser(user.id);
                        setUserMenu(false);
                      }}
                      disabled={!user.active}
                    >
                      <Avatar name={user.name} />
                      <span>
                        <div style={{ fontWeight: 600 }}>{user.name}</div>
                        <div className="tiny muted">{ROLE_LABELS[user.role]}</div>
                      </span>
                      {user.id === currentUser.id && <CheckCircle2 size={14} style={{ marginLeft: 'auto', color: 'var(--brand)' }} />}
                    </button>
                  ))}
                  {canAny(currentUser, ['admin.users']) && (
                    <button
                      className="dropdown__item"
                      style={{ borderTop: '1px solid var(--line)', marginTop: 4 }}
                      onClick={() => {
                        setUserMenu(false);
                        setAddUserOpen(true);
                      }}
                    >
                      <UserPlus size={14} />
                      Add a new user
                    </button>
                  )}
                  <div className="dropdown__label" style={{ marginTop: 4 }}>
                    Seeded {dateShort(state.seededAt)}
                  </div>
                  <button
                    className="dropdown__item"
                    onClick={() => {
                      setUserMenu(false);
                      actions.resetDemo();
                    }}
                  >
                    <RefreshCw size={14} />
                    Reset demo data
                  </button>
                </div>
              )}
            </div>
          </div>
        </header>

        <div className="demo-bar">
          <ShieldCheck size={14} />
          <span>
            <strong>Pilot demo.</strong> Signed in as {currentUser.name} ({ROLE_LABELS[currentUser.role]}). Switch
            users from the avatar menu to test approvals and role limits.
          </span>
        </div>

        <main id="main-content">{children}</main>

        <nav className="mobile-nav" aria-label="Mobile navigation">
          {visible(PRIMARY_NAV[0]) && (
            <NavLink to="/" end className={({ isActive }) => (isActive ? 'active' : '')}>
              <LayoutDashboard /> Today
            </NavLink>
          )}
          {visible(PRIMARY_NAV[1]) && (
            <NavLink to="/sales" className={({ isActive }) => (isActive ? 'active' : '')}>
              <ShoppingCart /> Sell
            </NavLink>
          )}
          {visible(PRIMARY_NAV[2]) && (
            <NavLink to="/inventory" className={({ isActive }) => (isActive ? 'active' : '')}>
              <Boxes /> Stock
            </NavLink>
          )}
          {visible(OVERSEE_NAV[0]) && (
            <NavLink to="/alerts" className={({ isActive }) => (isActive ? 'active' : '')}>
              <Bell /> Alerts
            </NavLink>
          )}
          <button
            className="mobile-nav__more"
            onClick={() => setSidebarOpen(true)}
            style={{ border: 0, background: 'transparent', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2, fontSize: '0.58rem', color: 'var(--muted)', fontWeight: 600, padding: '5px 10px' }}
          >
            <Menu size={19} /> More
          </button>
        </nav>
      </div>

      <div className="toast-stack" role="status" aria-live="polite">
        {toasts.map((toast) => (
          <div key={toast.id} className={`toast ${toast.kind === 'error' ? 'toast--error' : toast.kind === 'info' ? 'toast--info' : ''}`}>
            {toast.kind === 'error' ? (
              <XCircle />
            ) : toast.kind === 'info' ? (
              <Info />
            ) : toast.kind === 'success' ? (
              <CheckCircle2 />
            ) : (
              <AlertTriangle />
            )}
            <span>{toast.message}</span>
            <button onClick={() => dismissToast(toast.id)} aria-label="Dismiss">
              <X size={14} />
            </button>
          </div>
        ))}
      </div>

      <UserFormModal open={addUserOpen} onClose={() => setAddUserOpen(false)} />
    </div>
  );
}
