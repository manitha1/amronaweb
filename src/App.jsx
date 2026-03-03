import React from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { Toaster } from 'react-hot-toast';
import { AuthProvider } from './context/AuthContext';

import Layout from './components/Layout';
import Login from './pages/Login';
import Dashboard from './pages/Dashboard';
import MasterDataPage from './pages/MasterDataPage';
import Purchasing from './pages/Purchasing';
import Production from './pages/Production';
import Sales from './pages/Sales';

const itemColumns = [
    { key: 'name', label: 'Item Name' },
    { key: 'type', label: 'Category / Type' },
    { key: 'uom', label: 'UOM / Unit' }
];

const itemFields = [
    { name: 'name', label: 'Item Name', required: true },
    { name: 'type', label: 'Category / Type' },
    { name: 'uom', label: 'UOM / Unit', required: true }
];

const contactColumns = [
    { key: 'name', label: 'Company / Name' },
    { key: 'contact_person', label: 'Contact Person' },
    { key: 'phone', label: 'Phone' },
    { key: 'email', label: 'Email' }
];

const contactFields = [
    { name: 'name', label: 'Company / Name', required: true },
    { name: 'contact_person', label: 'Contact Person' },
    { name: 'phone', label: 'Phone' },
    { name: 'email', label: 'Email', type: 'email' },
    { name: 'address', label: 'Address' }
];

// Placeholder imports for transactions
const TransactionModule = ({ title }) => <div className="page-header"><h2>{title}</h2><p>Coming Soon</p></div>;

function App() {
    return (
        <AuthProvider>
            <BrowserRouter>
                <div className="app-container">
                    <Routes>
                        <Route path="/login" element={<Login />} />

                        <Route path="/" element={<Layout />}>
                            <Route index element={<Dashboard />} />

                            <Route path="raw-items" element={<MasterDataPage title="Raw Items" tableName="raw_items" columns={itemColumns} formFields={itemFields} />} />
                            <Route path="fg-items" element={<MasterDataPage title="Finished Goods" tableName="fg_items" columns={itemColumns} formFields={itemFields} />} />
                            <Route path="suppliers" element={<MasterDataPage title="Suppliers" tableName="suppliers" columns={contactColumns} formFields={contactFields} />} />
                            <Route path="customers" element={<MasterDataPage title="Customers" tableName="customers" columns={contactColumns} formFields={contactFields} />} />

                            <Route path="purchasing" element={<Purchasing />} />
                            <Route path="production" element={<Production />} />
                            <Route path="sales" element={<Sales />} />
                        </Route>

                        <Route path="*" element={<Navigate to="/" replace />} />
                    </Routes>
                </div>
                <Toaster position="top-right" />
            </BrowserRouter>
        </AuthProvider>
    );
}

export default App;
