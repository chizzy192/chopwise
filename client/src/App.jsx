import { useEffect, useRef, useState } from 'react';
import { Routes, Route, Navigate, NavLink, Link, useNavigate, useLocation } from 'react-router-dom';
import { api } from './api.js';
import Login from './pages/Login.jsx';
import Register from './pages/Register.jsx';
import Onboarding from './pages/Onboarding.jsx';
import Checkin from './pages/Checkin.jsx';
import Order from './pages/Order.jsx';
import Intake from './pages/Intake.jsx';
import Health from './pages/Health.jsx';
import Notifications from './pages/Notifications.jsx';
import CatererDishes from './pages/CatererDishes.jsx';
import AdminMeals from './pages/AdminMeals.jsx';
import AdminUsers from './pages/AdminUsers.jsx';
import AdminReport from './pages/AdminReport.jsx';
import AdminSettings from './pages/AdminSettings.jsx';
import AdminAudit from './pages/AdminAudit.jsx';
import Checkout from './pages/Checkout.jsx';
import PaymentReturn from './pages/PaymentReturn.jsx';
import MyOrders from './pages/MyOrders.jsx';
import CatererOrders from './pages/CatererOrders.jsx';
import CatererStock from './pages/CatererStock.jsx';
import ChangePassword from './pages/ChangePassword.jsx';
import ForgotPassword from './pages/ForgotPassword.jsx';
import ResetPassword from './pages/ResetPassword.jsx';
import FeedbackPrompt from './FeedbackPrompt.jsx';
import { CartProvider } from './cart.jsx';
import { CartBadge, CartSheet } from './cartUi.jsx';
import Landing from './pages/Landing.jsx';
import DishDetail from './pages/DishDetail.jsx';
import { Loading, ThemeToggle } from './components.jsx';
import { afterExit } from './motion.js';

const NAV = {
  staff: [['/order', 'Order'], ['/orders', 'My orders'], ['/checkin', "Today's check-in"], ['/intake', 'My intake'], ['/health', 'Health profile'], ['/notifications', 'Notifications']],
  caterer: [['/caterer/orders', "Today's orders"], ['/caterer', 'My dishes and photos'], ['/caterer/stock', "Today's stock"]],
  admin: [['/admin/meals', 'Meal approval'], ['/admin/users', 'Users'], ['/admin/report', 'Report'], ['/admin/settings', 'Settings'], ['/admin/audit', 'Audit log']],
};
const HOME = { staff: '/order', caterer: '/caterer', admin: '/admin/meals' };

export default function App() {
  // undefined while checking the session cookie, null when logged out.
  // For staff it also carries onboarded and checkedInToday.
  const [session, setSession] = useState(undefined);
  const navigate = useNavigate();

  const refresh = () => api('/auth/me').then(setSession).catch(() => setSession(null));
  useEffect(() => { refresh(); }, []);

  // After login, staff go to onboarding or today's check-in first when either is still to do.
  const login = async ({ user, home }) => {
    const me = await api('/auth/me').catch(() => ({ user }));
    setSession(me);
    if (me.user?.mustChangePassword) return navigate('/change-password');
    if (user.role !== 'staff') return navigate(home || HOME[user.role]);
    navigate(!me.onboarded ? '/onboarding' : !me.checkedInToday ? '/checkin' : '/order');
  };
  const logout = async () => {
    try { await api('/auth/logout', { method: 'POST' }); } catch { /* the cookie expires on its own */ }
    setSession(null);
    navigate('/login');
  };

  if (session === undefined) return <main><Loading label="Opening ChopWise…" /></main>;

  // Signed out: the landing page at /, plus log in and sign up. Anything else asks to log in.
  if (!session) {
    return (
      <Routes>
        <Route path="/" element={<Landing />} />
        <Route path="/register" element={<Register onLogin={login} />} />
        <Route path="/login" element={<Login onLogin={login} />} />
        <Route path="/forgot-password" element={<ForgotPassword />} />
        <Route path="/reset-password" element={<ResetPassword />} />
        <Route path="*" element={<Navigate to="/login" replace />} />
      </Routes>
    );
  }

  const { user } = session;
  const { role } = user;

  // A temporary password from an admin: nothing else opens until it is changed (the server agrees).
  if (user.mustChangePassword) {
    const changed = async () => { await refresh(); navigate(HOME[role]); };
    return (
      <Routes>
        <Route path="/change-password" element={<ChangePassword forced onDone={changed} onLogout={logout} />} />
        <Route path="*" element={<Navigate to="/change-password" replace />} />
      </Routes>
    );
  }
  const onboarding = role === 'staff' && !session.onboarded;
  const guard = (r, el) => (role === r ? el : <Navigate to={HOME[role]} replace />);
  // Staff pages stay closed until the health question is answered (the server refuses them too).
  const staff = (el) => guard('staff', onboarding ? <Navigate to="/onboarding" replace /> : el);
  const ordering = (el) => staff(session.checkedInToday ? el : <Navigate to="/checkin" replace />);

  return (
    <CartProvider key={user.id} userId={user.id}>
      <a className="skip-link" href="#main">Skip to content</a>
      <TopBar
        home={onboarding ? '/onboarding' : HOME[role]}
        links={onboarding ? [] : NAV[role]}
        cart={role === 'staff' && !onboarding}
        userName={user.name}
        onLogout={logout}
      />
      <main id="main" tabIndex={-1}>
        <Routes>
          <Route
            path="/onboarding"
            element={guard('staff', onboarding
              ? <Onboarding onDone={async () => { await refresh(); navigate('/checkin'); }} />
              : <Navigate to="/order" replace />)}
          />
          <Route path="/checkin" element={staff(<Checkin onDone={refresh} />)} />
          <Route path="/order" element={ordering(<Order />)} />
          <Route path="/dish/:id" element={ordering(<DishDetail />)} />
          <Route path="/checkout" element={ordering(<Checkout />)} />
          <Route path="/payment/return" element={staff(<PaymentReturn />)} />
          <Route path="/orders" element={staff(<MyOrders />)} />
          <Route path="/intake" element={staff(<Intake />)} />
          <Route path="/health" element={staff(<Health />)} />
          <Route path="/notifications" element={staff(<Notifications />)} />
          <Route path="/caterer" element={guard('caterer', <CatererDishes />)} />
          <Route path="/caterer/orders" element={guard('caterer', <CatererOrders />)} />
          <Route path="/caterer/stock" element={guard('caterer', <CatererStock />)} />
          <Route path="/admin/meals" element={guard('admin', <AdminMeals />)} />
          <Route path="/admin/users" element={guard('admin', <AdminUsers me={user} />)} />
          <Route path="/admin/report" element={guard('admin', <AdminReport />)} />
          <Route path="/admin/settings" element={guard('admin', <AdminSettings />)} />
          <Route path="/admin/audit" element={guard('admin', <AdminAudit />)} />
          <Route path="*" element={<Navigate to={onboarding ? '/onboarding' : HOME[role]} replace />} />
        </Routes>
      </main>
      {role === 'staff' && <CartSheet />}
      {role === 'staff' && !onboarding && <FeedbackPrompt />}
    </CartProvider>
  );
}

/**
 * The app's top bar. From 861 px: logo, page links, cart, name, theme and log out in one row.
 * On phones and small tablets only the logo, the cart and a Menu button show; the menu opens a
 * panel under the bar with the page links, the name, the theme switch and Log out.
 */
function TopBar({ home, links, cart, userName, onLogout }) {
  const [open, setOpen] = useState(false);
  // While closing, the panel stays in the page until it has slid out to the right.
  const [closing, setClosing] = useState(false);
  const location = useLocation();
  const bar = useRef(null);
  const button = useRef(null);

  const close = () => {
    if (!open || closing) return;
    setClosing(true);
    afterExit(() => { setClosing(false); setOpen(false); });
  };
  const toggle = () => (open ? close() : setOpen(true));

  // A page change closes the menu.
  useEffect(() => { close(); }, [location.pathname]);

  // Escape (back to the Menu button) or a tap outside the bar closes it.
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => { if (e.key === 'Escape') { close(); button.current?.focus(); } };
    const onPointer = (e) => { if (!bar.current?.contains(e.target)) close(); };
    document.addEventListener('keydown', onKey);
    document.addEventListener('pointerdown', onPointer);
    return () => { document.removeEventListener('keydown', onKey); document.removeEventListener('pointerdown', onPointer); };
  }, [open]);

  const pageLinks = links.map(([to, label]) => <NavLink key={to} to={to} end>{label}</NavLink>);
  return (
    <header className="topbar" ref={bar}>
      <Link to={home} className="brand">Chop<b>Wise</b></Link>
      {links.length > 0 && <nav className="nav" aria-label="Main">{pageLinks}</nav>}
      <div className="topbar-end">
        {cart && <CartBadge />}
        <span className="who">{userName}</span>
        <span className="wide-only"><ThemeToggle /></span>
        <button className="quiet wide-only" onClick={onLogout}>Log out</button>
        <button
          ref={button} type="button" className="quiet icon-button menu-button"
          aria-expanded={open && !closing} aria-controls="app-menu" aria-label={open && !closing ? 'Close menu' : 'Menu'}
          onClick={toggle}
        >
          <svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true">
            {open && !closing
              ? <path d="M6 6l12 12M18 6 6 18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
              : <path d="M4 7h16M4 12h16M4 17h16" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />}
          </svg>
        </button>
      </div>
      <div id="app-menu" className={`app-menu ${open ? 'is-open' : ''} ${closing ? 'is-closing' : ''}`} hidden={!open}>
        {links.length > 0 && <nav className="app-menu-links" aria-label="Menu">{pageLinks}</nav>}
        <div className="app-menu-foot">
          <span className="who-menu">{userName}</span>
          <ThemeToggle />
          <button className="quiet" onClick={onLogout}>Log out</button>
        </div>
      </div>
    </header>
  );
}
