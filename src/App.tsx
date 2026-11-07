import { lazy, Suspense } from 'react';
import { Route, Routes, useNavigate } from 'react-router-dom';
import { Lock } from 'lucide-react';
import { AppShell } from './components/Layout';
import { ROLE_LABELS, canAny, type Permission } from './domain/permissions';
import { useApp } from './store/AppStore';
import { EmptyState } from './components/ui';

const Dashboard = lazy(() => import('./pages/Dashboard'));
const Catalogue = lazy(() => import('./pages/Catalogue'));
const Inventory = lazy(() => import('./pages/Inventory'));
const Purchasing = lazy(() => import('./pages/Purchasing'));
const Receiving = lazy(() => import('./pages/Receiving'));
const Sales = lazy(() => import('./pages/Sales'));
const Counts = lazy(() => import('./pages/Counts'));
const Alerts = lazy(() => import('./pages/Alerts'));
const Reports = lazy(() => import('./pages/Reports'));
const Admin = lazy(() => import('./pages/Admin'));

function PageFallback() {
  return (
    <div className="page">
      <div className="card">
        <div
          className="card__body"
          role="status"
          style={{ display: 'grid', placeItems: 'center', minHeight: 220, color: 'var(--muted)' }}
        >
          Loading…
        </div>
      </div>
    </div>
  );
}

function Guard({ permissions, children }: { permissions: Permission[]; children: React.ReactNode }) {
  const { currentUser } = useApp();
  const navigate = useNavigate();
  if (!canAny(currentUser, permissions)) {
    return (
      <div className="page">
        <div className="no-access card">
          <div className="empty">
            <div className="empty__icon">
              <Lock size={24} />
            </div>
            <h2>This area is outside your role</h2>
            <p className="mt-8">
              {currentUser.name} is signed in as {ROLE_LABELS[currentUser.role]}. Access is enforced by role, not only
              by hiding the menu. Switch to a role with the right permission from the avatar menu.
            </p>
            <button className="btn btn--primary mt-16" onClick={() => navigate('/')}>
              Back to Today
            </button>
          </div>
        </div>
      </div>
    );
  }
  return <>{children}</>;
}

function NotFound() {
  return (
    <div className="page">
      <EmptyState
        title="That screen does not exist"
        description="The link may be old. Use the navigation to return to a work area."
        action={
          <a className="btn btn--primary" href="/">
            Back to Today
          </a>
        }
      />
    </div>
  );
}

export default function App() {
  return (
    <AppShell>
      <Suspense fallback={<PageFallback />}>
        <Routes>
          <Route path="/" element={<Dashboard />} />
        <Route
          path="/catalogue"
          element={
            <Guard permissions={['catalog.view']}>
              <Catalogue />
            </Guard>
          }
        />
        <Route
          path="/inventory"
          element={
            <Guard permissions={['stock.view']}>
              <Inventory />
            </Guard>
          }
        />
        <Route
          path="/purchasing"
          element={
            <Guard permissions={['po.create', 'po.approve', 'receipt.view']}>
              <Purchasing />
            </Guard>
          }
        />
        <Route
          path="/receiving"
          element={
            <Guard permissions={['receipt.view']}>
              <Receiving />
            </Guard>
          }
        />
        <Route
          path="/sales"
          element={
            <Guard permissions={['sale.view']}>
              <Sales />
            </Guard>
          }
        />
        <Route
          path="/counts"
          element={
            <Guard permissions={['count.view']}>
              <Counts />
            </Guard>
          }
        />
        <Route
          path="/alerts"
          element={
            <Guard permissions={['alert.view']}>
              <Alerts />
            </Guard>
          }
        />
        <Route
          path="/reports"
          element={
            <Guard permissions={['report.view']}>
              <Reports />
            </Guard>
          }
        />
        <Route
          path="/admin"
          element={
            <Guard permissions={['admin.users', 'admin.settings', 'admin.audit', 'admin.data']}>
              <Admin />
            </Guard>
          }
        />
          <Route path="*" element={<NotFound />} />
        </Routes>
      </Suspense>
    </AppShell>
  );
}
