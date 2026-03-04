import React, { useState, useEffect } from 'react';
import { supabase } from '../supabase';
import { Plus, Search, X, Pencil, Trash2 } from 'lucide-react';
import toast from 'react-hot-toast';
import { format } from 'date-fns';

export default function MasterDataPage({ title, tableName, columns, formFields, codeRange }) {
    const [data, setData] = useState([]);
    const [loading, setLoading] = useState(true);
    const [searchTerm, setSearchTerm] = useState('');
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [formData, setFormData] = useState({});
    const [nextCode, setNextCode] = useState(null);
    const [editingId, setEditingId] = useState(null); // null = create, id = edit
    const [deleteTarget, setDeleteTarget] = useState(null); // row to confirm delete

    useEffect(() => {
        fetchData();
    }, [tableName]);

    const fetchData = async () => {
        setLoading(true);
        const { data: records, error } = await supabase
            .from(tableName)
            .select('*')
            .order('created_at', { ascending: false });
        if (error) toast.error(`Error fetching ${title}: ` + error.message);
        else setData(records);
        setLoading(false);
    };

    const handleInputChange = (e) => {
        setFormData({ ...formData, [e.target.name]: e.target.value });
    };

    // ── OPEN CREATE MODAL ──────────────────────────────────────────────────────
    const openCreateModal = async () => {
        setEditingId(null);
        setFormData({});
        if (codeRange) {
            const { data: rows } = await supabase
                .from(tableName)
                .select('code')
                .gte('code', codeRange.min)
                .lte('code', codeRange.max)
                .order('code', { ascending: false })
                .limit(1);
            const maxCode = rows && rows.length > 0 ? rows[0].code : codeRange.min - 1;
            const generated = maxCode + 1;
            if (generated > codeRange.max) {
                toast.error(`No more codes available in range ${codeRange.min}–${codeRange.max}`);
                return;
            }
            setNextCode(generated);
        } else {
            setNextCode(null);
        }
        setIsModalOpen(true);
    };

    // ── OPEN EDIT MODAL ────────────────────────────────────────────────────────
    const openEditModal = (row) => {
        setEditingId(row.id);
        // Pre-fill form with existing values
        const prefill = {};
        formFields.forEach(f => { prefill[f.name] = row[f.name] ?? ''; });
        setFormData(prefill);
        setNextCode(row.code ?? null);
        setIsModalOpen(true);
    };

    const closeModal = () => {
        setIsModalOpen(false);
        setEditingId(null);
        setFormData({});
        setNextCode(null);
    };

    // ── SUBMIT (CREATE or UPDATE) ──────────────────────────────────────────────
    const handleSubmit = async (e) => {
        e.preventDefault();
        const payload = codeRange ? { ...formData, code: nextCode } : { ...formData };

        if (editingId) {
            // UPDATE
            const { error } = await supabase
                .from(tableName)
                .update(payload)
                .eq('id', editingId);
            if (error) {
                toast.error('Failed to update record: ' + error.message);
            } else {
                toast.success('Record updated successfully!');
                closeModal();
                fetchData();
            }
        } else {
            // INSERT
            const { error } = await supabase.from(tableName).insert([payload]);
            if (error) {
                toast.error('Failed to create record: ' + error.message);
            } else {
                toast.success('Record created successfully!');
                closeModal();
                fetchData();
            }
        }
    };

    // ── DELETE ─────────────────────────────────────────────────────────────────
    const handleDelete = async () => {
        if (!deleteTarget) return;
        const { error } = await supabase.from(tableName).delete().eq('id', deleteTarget.id);
        if (error) {
            toast.error('Failed to delete record: ' + error.message);
        } else {
            toast.success('Record deleted.');
            fetchData();
        }
        setDeleteTarget(null);
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
                <button className="btn-primary" onClick={openCreateModal}>
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
                                <th style={{ textAlign: 'center' }}>Actions</th>
                            </tr>
                        </thead>
                        <tbody>
                            {filteredData.length === 0 ? (
                                <tr><td colSpan={columns.length + 2} className="empty-state">No records found.</td></tr>
                            ) : (
                                filteredData.map(row => (
                                    <tr key={row.id}>
                                        {columns.map(col => <td key={col.key}>{row[col.key]}</td>)}
                                        <td>{row.created_at ? format(new Date(row.created_at), 'MMM dd, yyyy') : ''}</td>
                                        <td style={{ textAlign: 'center', whiteSpace: 'nowrap' }}>
                                            <button
                                                className="btn-icon"
                                                title="Edit"
                                                onClick={() => openEditModal(row)}
                                                style={{ marginRight: '6px', color: '#3b82f6' }}
                                            >
                                                <Pencil size={15} />
                                            </button>
                                            <button
                                                className="btn-icon"
                                                title="Delete"
                                                onClick={() => setDeleteTarget(row)}
                                                style={{ color: '#ef4444' }}
                                            >
                                                <Trash2 size={15} />
                                            </button>
                                        </td>
                                    </tr>
                                ))
                            )}
                        </tbody>
                    </table>
                )}
            </div>

            {/* ── CREATE / EDIT MODAL ── */}
            {isModalOpen && (
                <div className="modal-backdrop">
                    <div className="modal-content">
                        <div className="modal-header">
                            <h3>{editingId ? `Edit ${title}` : `Create New ${title}`}</h3>
                            <button className="btn-icon" onClick={closeModal}><X size={20} /></button>
                        </div>

                        <form onSubmit={handleSubmit} className="modal-form">
                            {codeRange && nextCode !== null && (
                                <div className="form-group">
                                    <label style={{ fontWeight: 700 }}>Code</label>
                                    <input
                                        type="text"
                                        value={nextCode}
                                        readOnly
                                        style={{ background: '#f1f5f9', fontWeight: 700, color: '#0f172a', cursor: 'not-allowed' }}
                                    />
                                </div>
                            )}
                            {formFields.map(field => (
                                <div className="form-group" key={field.name}>
                                    <label>{field.label}</label>
                                    {field.type === 'select' ? (
                                        <select
                                            name={field.name}
                                            required={field.required}
                                            value={formData[field.name] || ''}
                                            onChange={handleInputChange}
                                        >
                                            <option value="">Select {field.label}</option>
                                            {(field.options || []).map(opt => (
                                                <option key={opt} value={opt}>{opt}</option>
                                            ))}
                                        </select>
                                    ) : (
                                        <input
                                            type={field.type || 'text'}
                                            name={field.name}
                                            required={field.required}
                                            value={formData[field.name] || ''}
                                            onChange={handleInputChange}
                                            placeholder={`Enter ${field.label.toLowerCase()}`}
                                        />
                                    )}
                                </div>
                            ))}

                            <div className="modal-actions">
                                <button type="button" className="btn-secondary" onClick={closeModal}>Cancel</button>
                                <button type="submit" className="btn-primary">
                                    {editingId ? 'Update Record' : 'Save Record'}
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}

            {/* ── DELETE CONFIRM MODAL ── */}
            {deleteTarget && (
                <div className="modal-backdrop">
                    <div className="modal-content" style={{ maxWidth: '420px' }}>
                        <div className="modal-header">
                            <h3>Confirm Delete</h3>
                            <button className="btn-icon" onClick={() => setDeleteTarget(null)}><X size={20} /></button>
                        </div>
                        <div className="modal-form">
                            <p style={{ marginBottom: '1.5rem', color: '#475569' }}>
                                Are you sure you want to delete <strong>{deleteTarget.name || deleteTarget.code}</strong>? This action cannot be undone.
                            </p>
                            <div className="modal-actions">
                                <button className="btn-secondary" onClick={() => setDeleteTarget(null)}>Cancel</button>
                                <button
                                    className="btn-primary"
                                    onClick={handleDelete}
                                    style={{ background: '#ef4444' }}
                                >
                                    Delete
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
