'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Home, List, PieChart, Settings, TrendingUp, Menu, X, LogOut, Monitor, Twitter, LineChart, Clock } from 'lucide-react';
import { useState } from 'react';
import { useSession, signOut } from 'next-auth/react';
import styles from './Sidebar.module.css';

// 10 Strictly Ordered Menu Items
const MENU_SCHEMA = [
  { name: 'Home', href: '/', icon: Home },              // 0
  { name: 'Watchlist', href: '/watchlist', icon: List },    // 1
  { name: 'Portfolio', href: '/portfolio', icon: PieChart }, // 2
  { name: 'Penny Stocks', href: '/penny-stocks', icon: TrendingUp }, // 3
  { name: 'Common Lists', href: '/common-lists', icon: List }, // 4 --- End Guest/User ---
  { name: 'Overnight Analysis', href: '/overnight-analysis', icon: LineChart }, // 5
  { name: 'Market Sessions', href: '/market-sessions', icon: Clock }, // 6
  { name: 'Settings', href: '/settings', icon: Settings }, // 7 
  { name: 'Automation', href: '/automation', icon: Monitor }, // 8
  { name: 'Twitter', href: '/twitter', icon: Twitter }, // 9 
];

export default function Sidebar() {
  const pathname = usePathname();
  const [isOpen, setIsOpen] = useState(false);
  const { data: session, status } = useSession();

  // Don't show sidebar on login, admin-login, or registration pages
  if (pathname === '/login' || pathname === '/admin-login' || pathname === '/register') return null;

  const toggleSidebar = () => setIsOpen(!isOpen);
  const closeSidebar = () => setIsOpen(false);

  // --- Role & Status Detection ---
  const email = session?.user?.email?.toLowerCase() || '';
  const rawRole = (session?.user as any)?.role || 'user';
  const role = String(rawRole).toLowerCase();
  const accountStatus = (session?.user as any)?.status || 'approved';

  // Pending and rejected users are restricted
  const isPending = accountStatus === 'pending';
  const isRejected = accountStatus === 'rejected';

  // ANY approved admin/owner sees all 10 items
  const isAdmin = !isPending && !isRejected && (
    role === 'owner' ||
    role === 'master' ||
    role === 'root' ||
    role === 'admin' ||
    email === 'admin@stocktrack.com' ||
    email.includes('admin')
  );

  // --- Visibility Slicing ---
  const visibleCount = isAdmin ? 10 : 5;
  const visibleItems = MENU_SCHEMA.slice(0, visibleCount);

  // --- UI Helpers ---
  const userInitials = (session?.user?.name && typeof session.user.name === 'string' && session.user.name.trim().length > 0)
    ? session.user.name.trim().split(/\s+/).map((n: string) => n[0]).join('').toUpperCase()
    : (session?.user?.email ? session.user.email[0].toUpperCase() : 'U');

  // Badge config
  const badgeConfig = isPending
    ? { label: 'PENDING', bg: '#f59e0b', border: '#d97706' }
    : isRejected
      ? { label: 'REJECTED', bg: '#ef4444', border: '#dc2626' }
      : isAdmin
        ? { label: 'ADMIN', bg: '#ef4444', border: '#dc2626' }
        : { label: role.toUpperCase(), bg: '#3b82f6', border: '#2563eb' };

  return (
    <>
      <button className={styles.hamburger} onClick={toggleSidebar} aria-label="Toggle menu">
        {isOpen ? <X size={24} /> : <Menu size={24} />}
      </button>

      {isOpen && <div className={styles.overlay} onClick={closeSidebar} />}

      <aside className={`${styles.sidebar} ${isOpen ? styles.open : ''}`}>
        <Link href="/" className={styles.logo} onClick={closeSidebar}>
          <TrendingUp className={styles.logoIcon} />
          <span>StockTrack</span>
        </Link>

        {/* Pending/Rejected Notification Banner */}
        {isPending && (
          <div style={{
            margin: '8px 12px',
            padding: '10px 14px',
            background: '#fef3c7',
            border: '1px solid #fde68a',
            borderRadius: '8px',
            fontSize: '11px',
            color: '#92400e',
            lineHeight: 1.5
          }}>
            <strong>⏳ Awaiting Approval</strong><br />
            Your account is pending owner review. You'll get full access once approved.
          </div>
        )}
        {isRejected && (
          <div style={{
            margin: '8px 12px',
            padding: '10px 14px',
            background: '#fef2f2',
            border: '1px solid #fecaca',
            borderRadius: '8px',
            fontSize: '11px',
            color: '#991b1b',
            lineHeight: 1.5
          }}>
            <strong>❌ Access Denied</strong><br />
            Your request was rejected. Contact the owner for assistance.
          </div>
        )}

        <nav className={styles.nav}>
          <div className="flex flex-col">
            {visibleItems.map((item) => {
              const Icon = item.icon;
              const isActive = pathname === item.href;

              return (
                <Link
                  key={item.href}
                  href={item.href}
                  prefetch={true}
                  className={`${styles.navItem} ${isActive ? styles.active : ''}`}
                  onClick={closeSidebar}
                >
                  <Icon size={20} />
                  <span>{item.name}</span>
                </Link>
              );
            })}
          </div>
        </nav>

        <div className={styles.footer}>
          {session ? (
            <div className="flex items-center gap-3 px-4 py-4 border-t border-[var(--border-color)] bg-gray-50/50">
              <div className="w-8 h-8 rounded bg-[var(--accent-blue)] flex items-center justify-center text-[10px] font-bold text-white shadow-sm shrink-0">
                {userInitials}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-[11px] font-bold text-[var(--text-primary)] truncate uppercase tracking-tight">{session.user?.name || 'Operator'}</p>
                <div className="mt-0.5">
                  <span style={{
                    fontSize: '9px',
                    padding: '2px 8px',
                    borderRadius: '999px',
                    fontWeight: 900,
                    textTransform: 'uppercase',
                    letterSpacing: '0.1em',
                    border: `1px solid ${badgeConfig.border}`,
                    background: badgeConfig.bg,
                    color: '#fff',
                  }}>
                    {badgeConfig.label}
                  </span>
                </div>
              </div>
              <button
                onClick={() => signOut({ callbackUrl: '/login' })}
                className="p-1.5 text-[var(--text-tertiary)] hover:text-[var(--accent-red)] transition-colors hover:bg-red-50 rounded"
                title="Sign Out"
              >
                <LogOut size={14} />
              </button>
            </div>
          ) : (
            <div className="px-4 py-4 border-t border-[var(--border-color)]">
              <Link
                href="/login"
                className="flex items-center justify-center gap-2 w-full py-2 bg-[var(--accent-blue)] text-white text-[10px] font-bold rounded hover:opacity-90 transition-opacity"
              >
                SIGN IN FOR FULL ACCESS
              </Link>
              {status === 'loading' && (
                <p className="text-[9px] text-center mt-2 text-[var(--text-tertiary)] animate-pulse">Verifying credentials...</p>
              )}
              {status === 'unauthenticated' && (
                <p className="text-[9px] text-center mt-2 text-[var(--text-tertiary)]">Viewing as Guest (Limited Menu)</p>
              )}
            </div>
          )}
        </div>
      </aside>
    </>
  );
}
