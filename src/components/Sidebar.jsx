import React from 'react';
import { NavLink } from 'react-router-dom';
import { LayoutDashboard, Package, ShoppingCart, Users, Truck, Factory, LogOut, PackageSearch } from 'lucide-react';
import { useAuth } from '../context/AuthContext';

export default function Sidebar() {
    const { signOut, role } = useAuth();

    return (
        <aside className="sidebar">
            <div className="sidebar-header">
                <h2>Amrona</h2>
                <span className="badge">{role}</span>
            </div>

            <nav className="sidebar-nav">
                <div className="nav-group">
                    <p className="nav-label">General</p>
                    <NavLink to="/" className={({ isActive }) => isActive ? "nav-link active" : "nav-link"}>
                        <LayoutDashboard size={20} /> Dashboard
                    </NavLink>
                </div>

                <div className="nav-group">
                    <p className="nav-label">Transactions</p>
                    <NavLink to="/purchasing" className={({ isActive }) => isActive ? "nav-link active" : "nav-link"}>
                        <ShoppingCart size={20} /> Purchasing (In)
                    </NavLink>
                    <NavLink to="/production" className={({ isActive }) => isActive ? "nav-link active" : "nav-link"}>
                        <Factory size={20} /> Production
                    </NavLink>
                    <NavLink to="/sales" className={({ isActive }) => isActive ? "nav-link active" : "nav-link"}>
                        <ShoppingCart size={20} /> Sales (Out)
                    </NavLink>
                </div>

                <div className="nav-group">
                    <p className="nav-label">Master Data</p>
                    <NavLink to="/raw-items" className={({ isActive }) => isActive ? "nav-link active" : "nav-link"}>
                        <Package size={20} /> Raw Items
                    </NavLink>
                    <NavLink to="/fg-items" className={({ isActive }) => isActive ? "nav-link active" : "nav-link"}>
                        <PackageSearch size={20} /> Finished Goods
                    </NavLink>
                    <NavLink to="/suppliers" className={({ isActive }) => isActive ? "nav-link active" : "nav-link"}>
                        <Truck size={20} /> Suppliers
                    </NavLink>
                    <NavLink to="/customers" className={({ isActive }) => isActive ? "nav-link active" : "nav-link"}>
                        <Users size={20} /> Customers
                    </NavLink>
                </div>
            </nav>

            <div className="sidebar-footer">
                <button onClick={() => signOut()} className="btn-logout">
                    <LogOut size={20} /> Logout
                </button>
            </div>
        </aside>
    );
}
