import React from 'react';
import { Outlet, Navigate } from 'react-router-dom';
import Sidebar from './Sidebar';
import { useAuth } from '../context/AuthContext';

export default function Layout() {
    const { user, loading } = useAuth();

    if (loading) {
        return <div className="loading-screen">Loading...</div>;
    }

    if (!user) {
        return <Navigate to="/login" replace />;
    }

    return (
        <div className="layout-container">
            <Sidebar />
            <main className="main-content">
                <div className="top-header">
                    <div className="user-info">Logged in as: {user.email}</div>
                </div>
                <div className="content-wrapper">
                    <Outlet />
                </div>
            </main>
        </div>
    );
}
