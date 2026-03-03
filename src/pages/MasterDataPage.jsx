import React, { useState, useEffect } from 'react';
import { supabase } from '../supabase';
import { Plus, Search, X } from 'lucide-react';
import toast from 'react-hot-toast';
import { format } from 'date-fns';

export default function MasterDataPage({ title, tableName, columns, formFields }) {
    const [data, setData] = useState([]);
    const [loading, setLoading] = useState(true);
    const [searchTerm, setSearchTerm] = useState('');
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [formData, setFormData] = useState({});

    useEffect(() => {
        fetchData();
    }, [tableName]);

    const fetchData = async () => {
        setLoading(true);
        const { data: records, error } = await supabase.from(tableName).select('*').order('created_at', { ascending: false });
        if (error) {
            toast.error(`Error fetching ${title}: ` + error.message);
        } else {
            setData(records);
        }
        setLoading(false);
    };

    const handleInputChange = (e) => {
        setFormData({ ...formData, [e.target.name]: e.target.value });
    };

    const handleSubmit = async (e) => {
        e.preventDefault();
        const { error } = await supabase.from(tableName).insert([formData]);

        if (error) {
            toast.error('Failed to create record: ' + error.message);
        } else {
            toast.success('Record created successfully!');
            setFormData({});
            setIsModalOpen(false);
            fetchData();
        }
    };

    const filteredData = data.filter(item =>
        Object.values(item).some(val =>
            String(val).toLowerCase().includes(searchTerm.toLowerCase())
        )
    );

    return (
        <div className="page-container">
            <div className="page-header-row">
                <div>
                    <h2>{title}</h2>
                    <p>Manage your {title.toLowerCase()} records</p>
                </div>
                <button className="btn-primary" onClick={() => setIsModalOpen(true)}>
                    <Plus size={18} /> Add New
                </button>
            </div>

            <div className="table-controls">
                <div className="search-box">
                    <Search size={18} className="text-muted" />
                    <input
                        type="text"
                        placeholder={`Search ${title}...`}
                        value={searchTerm}
                        onChange={(e) => setSearchTerm(e.target.value)}
                    />
                </div>
            </div>

            <div className="table-card">
                {loading ? (
                    <div className="loading-state">Loading data...</div>
                ) : (
                    <table className="data-table">
                        <thead>
                            <tr>
                                {columns.map(col => <th key={col.key}>{col.label}</th>)}
                                <th>Created At</th>
                            </tr>
                        </thead>
                        <tbody>
                            {filteredData.length === 0 ? (
                                <tr><td colSpan={columns.length + 1} className="empty-state">No records found.</td></tr>
                            ) : (
                                filteredData.map(row => (
                                    <tr key={row.id}>
                                        {columns.map(col => <td key={col.key}>{row[col.key]}</td>)}
                                        <td>{row.created_at ? format(new Date(row.created_at), 'MMM dd, yyyy') : ''}</td>
                                    </tr>
                                ))
                            )}
                        </tbody>
                    </table>
                )}
            </div>

            {isModalOpen && (
                <div className="modal-backdrop">
                    <div className="modal-content">
                        <div className="modal-header">
                            <h3>Create New {title}</h3>
                            <button className="btn-icon" onClick={() => setIsModalOpen(false)}><X size={20} /></button>
                        </div>

                        <form onSubmit={handleSubmit} className="modal-form">
                            {formFields.map(field => (
                                <div className="form-group" key={field.name}>
                                    <label>{field.label}</label>
                                    <input
                                        type={field.type || "text"}
                                        name={field.name}
                                        required={field.required}
                                        value={formData[field.name] || ''}
                                        onChange={handleInputChange}
                                        placeholder={`Enter ${field.label.toLowerCase()}`}
                                    />
                                </div>
                            ))}

                            <div className="modal-actions">
                                <button type="button" className="btn-secondary" onClick={() => setIsModalOpen(false)}>Cancel</button>
                                <button type="submit" className="btn-primary">Save Record</button>
                            </div>
                        </form>
                    </div>
                </div>
            )}
        </div>
    );
}
