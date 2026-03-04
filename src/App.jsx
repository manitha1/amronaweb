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
import RawStockReport from './pages/RawStockReport';
import FgStockReport from './pages/FgStockReport';

const itemColumns = [
    { key: 'code', label: 'Item Code' },
    { key: 'name', label: 'Item Name' },
    { key: 'uom', label: 'UOM / Unit' }
];

const itemFields = [
    { name: 'name', label: 'Item Name', required: true },
    { name: 'uom', label: 'UOM / Unit', required: true, type: 'select', options: ['Kg', 'g'] }
];

const contactColumns = [
    { key: 'code', label: 'Code' },
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

                            <Route path="raw-items" element={<MasterDataPage title="Raw Items" tableName="raw_items" columns={itemColumns} formFields={itemFields} codeRange={{ min: 1000, max: 1999 }} />} />
                            <Route path="fg-items" element={<MasterDataPage title="Finished Goods" tableName="fg_items" columns={itemColumns} formFields={itemFields} codeRange={{ min: 2000, max: 2999 }} />} />
                            <Route path="suppliers" element={<MasterDataPage title="Suppliers" tableName="suppliers" columns={contactColumns} formFields={contactFields} codeRange={{ min: 3000, max: 4000 }} />} />
                            <Route path="customers" element={<MasterDataPage title="Customers" tableName="customers" columns={contactColumns} formFields={contactFields} codeRange={{ min: 4001, max: 5000 }} />} />

                            <Route path="purchasing" element={<Purchasing />} />
                            <Route path="production" element={<Production />} />
                            <Route path="sales" element={<Sales />} />
                            <Route path="raw-stock" element={<RawStockReport />} />
                            <Route path="fg-stock" element={<FgStockReport />} />
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
