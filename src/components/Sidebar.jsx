import React from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import { LayoutDashboard, Package, ShoppingCart, Users, Truck, Factory, LogOut, PackageSearch, X, BarChart2 } from 'lucide-react';
import { useAuth } from '../context/AuthContext';

export default function Sidebar({ isOpen, onClose }) {
    const { signOut, role } = useAuth();
    const navigate = useNavigate();

    const handleNavClick = () => {
        // Close sidebar on mobile after navigation
        if (onClose) onClose();
    };

    const handleSignOut = () => {
        signOut();
        if (onClose) onClose();
    };

    return (
        <>
            {/* Overlay — visible on mobile when sidebar is open */}
            {isOpen && (
                <div className="sidebar-overlay" onClick={onClose} />
            )}

            <aside className={`sidebar${isOpen ? ' sidebar-open' : ''}`}>
                <div className="sidebar-header">
                    <img
                        src="/src/assests/logo.png.png"
                        alt="Amrona Logo"
                        style={{ height: '64px', width: 'auto', objectFit: 'contain' }}
                    />
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                        <span className="badge">{role}</span>
                        {/* Close button — visible on mobile only */}
                        <button className="btn-icon sidebar-close-btn" onClick={onClose} aria-label="Close menu">
                            <X size={20} />
                        </button>
                    </div>
                </div>

                <nav className="sidebar-nav">
                    <div className="nav-group">
                        <p className="nav-label">General</p>
                        <NavLink to="/" onClick={handleNavClick} className={({ isActive }) => isActive ? "nav-link active" : "nav-link"}>
                            <LayoutDashboard size={20} /> Dashboard
                        </NavLink>
                        <NavLink to="/raw-stock" onClick={handleNavClick} className={({ isActive }) => isActive ? "nav-link active" : "nav-link"}>
                            <Package size={20} /> Raw Stock
                        </NavLink>
                        <NavLink to="/fg-stock" onClick={handleNavClick} className={({ isActive }) => isActive ? "nav-link active" : "nav-link"}>
                            <PackageSearch size={20} /> FG Stock
                        </NavLink>
                    </div>

                    <div className="nav-group">
                        <p className="nav-label">Transactions</p>
                        <NavLink to="/purchasing" onClick={handleNavClick} className={({ isActive }) => isActive ? "nav-link active" : "nav-link"}>
                            <ShoppingCart size={20} /> Purchasing (In)
                        </NavLink>
                        <NavLink to="/production" onClick={handleNavClick} className={({ isActive }) => isActive ? "nav-link active" : "nav-link"}>
                            <Factory size={20} /> Production
                        </NavLink>
                        <NavLink to="/sales" onClick={handleNavClick} className={({ isActive }) => isActive ? "nav-link active" : "nav-link"}>
                            <ShoppingCart size={20} /> Sales (Out)
                        </NavLink>
                    </div>

                    <div className="nav-group">
                        <p className="nav-label">Master Data</p>
                        <NavLink to="/raw-items" onClick={handleNavClick} className={({ isActive }) => isActive ? "nav-link active" : "nav-link"}>
                            <Package size={20} /> Raw Items
                        </NavLink>
                        <NavLink to="/fg-items" onClick={handleNavClick} className={({ isActive }) => isActive ? "nav-link active" : "nav-link"}>
                            <PackageSearch size={20} /> Finished Goods
                        </NavLink>
                        <NavLink to="/suppliers" onClick={handleNavClick} className={({ isActive }) => isActive ? "nav-link active" : "nav-link"}>
                            <Truck size={20} /> Suppliers
                        </NavLink>
                        <NavLink to="/customers" onClick={handleNavClick} className={({ isActive }) => isActive ? "nav-link active" : "nav-link"}>
                            <Users size={20} /> Customers
                        </NavLink>
                    </div>
                </nav>

                <div className="sidebar-footer">
                    <button onClick={handleSignOut} className="btn-logout">
                        <LogOut size={20} /> Logout
                    </button>
                </div>
            </aside>
        </>
    );
}
