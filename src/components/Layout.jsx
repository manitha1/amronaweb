import React, { useState } from 'react';
import { Outlet, Navigate, useLocation } from 'react-router-dom';
import { Menu } from 'lucide-react';
import Sidebar from './Sidebar';
import { useAuth } from '../context/AuthContext';

const PAGE_TITLES = {
    '/': 'Dashboard',
    '/raw-stock': 'Raw Stock',
    '/fg-stock': 'FG Stock',
    '/purchasing': 'Purchasing',
    '/production': 'Production',
    '/sales': 'Sales',
    '/raw-items': 'Raw Items',
    '/fg-items': 'Finished Goods',
    '/suppliers': 'Suppliers',
    '/customers': 'Customers',
};

function getInitials(email) {
    if (!email) return 'U';
    return email.split('@')[0].slice(0, 2).toUpperCase();
}

export default function Layout() {
    const { user, loading, role } = useAuth();
    const [sidebarOpen, setSidebarOpen] = useState(false);
    const location = useLocation();
    const pageTitle = PAGE_TITLES[location.pathname] || 'Amrona';

    if (loading) {
        return (
            <div style={{
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                minHeight: '100vh', background: 'var(--bg)', flexDirection: 'column', gap: '1rem'
            }}>
                <div style={{
                    width: 48, height: 48,
                    border: '3px solid #e2e8f0',
                    borderTopColor: 'var(--blue)',
                    borderRadius: '50%',
                    animation: 'spin 0.8s linear infinite'
                }} />
                <p style={{ color: 'var(--muted)', fontSize: '0.875rem' }}>Loading...</p>
                <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
            </div>
        );
    }

    if (!user) return <Navigate to="/login" replace />;

    return (
        <div className="layout-container">
            <Sidebar isOpen={sidebarOpen} onClose={() => setSidebarOpen(false)} />
            <main className="main-content">
                {/* Top header */}
                <div className="top-header">
                    <div className="top-header-left">
                        <button
                            className="hamburger-btn"
                            onClick={() => setSidebarOpen(true)}
                            aria-label="Open menu"
                        >
                            <Menu size={22} />
                        </button>
                        <span className="top-header-title">{pageTitle}</span>
                    </div>
                    <div className="top-header-right">
                        <div className="user-chip">
                            <div className="user-avatar">{getInitials(user?.email)}</div>
                            <span style={{ maxWidth: 160, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                {user?.email}
                            </span>
                            {role && (
                                <span style={{
                                    background: '#e0e7ff', color: '#4338ca',
                                    fontSize: '0.65rem', fontWeight: 700, padding: '0.1rem 0.45rem',
                                    borderRadius: '999px', textTransform: 'uppercase', letterSpacing: '0.04em'
                                }}>
                                    {role}
                                </span>
                            )}
                        </div>
                    </div>
                </div>

                {/* Page content */}
                <div className="content-wrapper">
                    <Outlet />
                </div>
            </main>
        </div>
    );
}
