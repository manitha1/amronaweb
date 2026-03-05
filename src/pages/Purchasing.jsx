import React, { useState, useEffect } from 'react';
import { supabase } from '../supabase';
import { Plus, Search, X, Trash2, Pencil } from 'lucide-react';
import toast from 'react-hot-toast';
import { format } from 'date-fns';

export default function Purchasing() {
    const [data, setData] = useState([]);
    const [loading, setLoading] = useState(true);
    const [searchTerm, setSearchTerm] = useState('');
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [deleteTarget, setDeleteTarget] = useState(null);
    const [viewTarget, setViewTarget] = useState(null); // detail view
    const [editingId, setEditingId] = useState(null); // null = create, UUID = edit

    // Form State
    const [suppliers, setSuppliers] = useState([]);
    const [rawItems, setRawItems] = useState([]);

    const [purchaseNo, setPurchaseNo] = useState('');
    const [supplierId, setSupplierId] = useState('');
    const [date, setDate] = useState(format(new Date(), 'yyyy-MM-dd'));
    const [lines, setLines] = useState([]);

    useEffect(() => {
        fetchData();
        fetchLookups();
    }, []);

    const fetchData = async () => {
        setLoading(true);
        const { data: records, error } = await supabase
            .from('purchase_headers')
            .select('*, suppliers(name), purchase_lines(*, raw_items(name))')
            .order('created_at', { ascending: false });

        if (error) toast.error('Error fetching purchases: ' + error.message);
        else setData(records);
        setLoading(false);
    };

    const fetchLookups = async () => {
        const { data: s } = await supabase.from('suppliers').select('id, name').order('name');
        const { data: r } = await supabase.from('raw_items').select('id, name, uom').order('name');
        if (s) setSuppliers(s);
        if (r) setRawItems(r);
    };

    // ── OPEN CREATE MODAL ──────────────────────────────────────────────────────
    const openCreateModal = () => {
        setEditingId(null);
        setPurchaseNo('PUR-' + Math.floor(1000 + Math.random() * 9000));
        setSupplierId('');
        setDate(format(new Date(), 'yyyy-MM-dd'));
        setLines([]);
        setIsModalOpen(true);
    };

    // ── OPEN EDIT MODAL ────────────────────────────────────────────────────────
    const openEditModal = (row) => {
        setEditingId(row.id);
        setPurchaseNo(row.purchase_no);
        setSupplierId(row.supplier_id);
        setDate(row.date);
        // Map existing lines into form shape
        setLines((row.purchase_lines || []).map(l => ({
            id: l.id,
            raw_item_id: l.raw_item_id,
            qty: l.qty,
            unit_cost: l.unit_cost
        })));
        setIsModalOpen(true);
    };

    const closeModal = () => {
        setIsModalOpen(false);
        setEditingId(null);
        setLines([]);
    };

    const addLine = () => {
        setLines([...lines, { id: Date.now(), raw_item_id: '', qty: 1, unit_cost: 0 }]);
    };

    const updateLine = (id, field, value) => {
        setLines(lines.map(l => l.id === id ? { ...l, [field]: value } : l));
    };

    const removeLine = (id) => {
        setLines(lines.filter(l => l.id !== id));
    };

    const calculateTotal = () => {
        return lines.reduce((acc, l) => acc + (Number(l.qty) * Number(l.unit_cost)), 0);
    };

    // ── SUBMIT (CREATE or UPDATE) ──────────────────────────────────────────────
    const handleSubmit = async (e) => {
        e.preventDefault();
        if (lines.length === 0) return toast.error('Add at least one item line');

        for (const l of lines) {
            if (!l.raw_item_id || l.qty <= 0 || l.unit_cost < 0) {
                return toast.error('Please fill all lines correctly (qty > 0, cost >= 0)');
            }
        }

        const linePayload = lines.map(l => ({
            raw_item_id: l.raw_item_id,
            qty: Number(l.qty),
            unit_cost: Number(l.unit_cost)
        }));

        if (editingId) {
            // UPDATE
            const payload = {
                header_id: editingId,
                supplier_id: supplierId,
                date,
                lines: linePayload
            };
            const { error } = await supabase.rpc('update_purchase', { payload });
            if (error) {
                toast.error('Update Failed: ' + error.message);
            } else {
                toast.success('Purchase Updated Successfully!');
                closeModal();
                fetchData();
            }
        } else {
            // CREATE
            const payload = {
                purchase_no: purchaseNo,
                supplier_id: supplierId,
                date,
                lines: linePayload
            };
            const { error } = await supabase.rpc('post_purchase', { payload });
            if (error) {
                toast.error('Transaction Failed: ' + error.message);
            } else {
                toast.success('Purchase Posted Successfully!');
                closeModal();
                fetchData();
            }
        }
    };

    // ── DELETE ─────────────────────────────────────────────────────────────────
    const handleDelete = async () => {
        if (!deleteTarget) return;
        const { error } = await supabase.rpc('delete_purchase', { p_header_id: deleteTarget.id });
        if (error) {
            toast.error('Delete Failed: ' + error.message);
        } else {
            toast.success('Purchase deleted and stock reversed.');
            fetchData();
        }
        setDeleteTarget(null);
    };

    const filteredData = data.filter(item =>
        item.purchase_no.toLowerCase().includes(searchTerm.toLowerCase()) ||
        item.suppliers?.name.toLowerCase().includes(searchTerm.toLowerCase())
    );

    return (
        <div className="page-container">
            <div className="page-header-row">
                <div>
                    <h2>Purchasing (In)</h2>
                    <p>Record raw material purchases</p>
                </div>
                <button className="btn-primary" onClick={openCreateModal}>
                    <Plus size={18} /> New Purchase
                </button>
            </div>

            <div className="table-controls">
                <div className="search-box">
                    <Search size={18} className="text-muted" />
                    <input
                        type="text"
                        placeholder="Search by PO or Supplier..."
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
                                <th>Purchase No</th>
                                <th>Date</th>
                                <th>Supplier</th>
                                <th>Lines</th>
                                <th>Total Amount</th>
                                <th style={{ textAlign: 'center' }}>Actions</th>
                            </tr>
                        </thead>
                        <tbody>
                            {filteredData.map(row => (
                                <tr key={row.id}>
                                    <td>
                                        <button
                                            onClick={() => setViewTarget(row)}
                                            style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', color: '#3b82f6', fontWeight: 700, textDecoration: 'underline' }}
                                        >
                                            {row.purchase_no}
                                        </button>
                                    </td>
                                    <td>{format(new Date(row.date), 'MMM dd, yyyy')}</td>
                                    <td>{row.suppliers?.name}</td>
                                    <td>{row.purchase_lines?.length || 0} items</td>
                                    <td>LKR {Number(row.total_amount).toFixed(2)}</td>
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
                            ))}
                            {filteredData.length === 0 && (
                                <tr><td colSpan="6" className="empty-state">No purchases found.</td></tr>
                            )}
                        </tbody>
                    </table>
                )}
            </div>

            {/* ── CREATE / EDIT MODAL ── */}
            {isModalOpen && (
                <div className="modal-backdrop">
                    <div className="modal-content" style={{ maxWidth: '800px' }}>
                        <div className="modal-header">
                            <h3>{editingId ? 'Edit Purchase Document' : 'Create Purchase Document'}</h3>
                            <button className="btn-icon" onClick={closeModal}><X size={20} /></button>
                        </div>

                        <form onSubmit={handleSubmit} className="modal-form">
                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '1rem', marginBottom: '2rem' }}>
                                <div className="form-group">
                                    <label>Purchase No</label>
                                    <input
                                        type="text"
                                        value={purchaseNo}
                                        onChange={e => setPurchaseNo(e.target.value)}
                                        readOnly={!!editingId}
                                        style={editingId ? { background: '#f1f5f9', cursor: 'not-allowed' } : {}}
                                        required
                                    />
                                </div>
                                <div className="form-group">
                                    <label>Date</label>
                                    <input type="date" value={date} onChange={e => setDate(e.target.value)} required />
                                </div>
                                <div className="form-group">
                                    <label>Supplier</label>
                                    <select value={supplierId} onChange={e => setSupplierId(e.target.value)} required>
                                        <option value="">Select Supplier</option>
                                        {suppliers.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                                    </select>
                                </div>
                            </div>

                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
                                <h4>Item Lines</h4>
                                <button type="button" className="btn-secondary" onClick={addLine}><Plus size={16} /> Add Line</button>
                            </div>

                            <table className="data-table" style={{ marginBottom: '1rem' }}>
                                <thead>
                                    <tr>
                                        <th>Raw Item</th>
                                        <th>Qty</th>
                                        <th>Unit Cost</th>
                                        <th>Subtotal</th>
                                        <th></th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {lines.map(line => (
                                        <tr key={line.id}>
                                            <td>
                                                <select className="form-group" style={{ marginBottom: 0 }} value={line.raw_item_id} onChange={e => updateLine(line.id, 'raw_item_id', e.target.value)} required>
                                                    <option value="">Select Item</option>
                                                    {rawItems.map(r => <option key={r.id} value={r.id}>{r.name} ({r.uom})</option>)}
                                                </select>
                                            </td>
                                            <td>
                                                <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                                                    <input className="form-group" style={{ marginBottom: 0, width: '70px' }} type="number" min="0.01" step="0.01" value={line.qty} onChange={e => updateLine(line.id, 'qty', e.target.value)} required />
                                                    <span style={{ fontSize: '0.8rem', color: '#64748b', fontWeight: 600, whiteSpace: 'nowrap' }}>Kg</span>
                                                </div>
                                            </td>
                                            <td>
                                                <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                                                    <span style={{ fontSize: '0.8rem', color: '#64748b', fontWeight: 600, whiteSpace: 'nowrap' }}>LKR</span>
                                                    <input className="form-group" style={{ marginBottom: 0, width: '90px' }} type="number" min="0" step="0.01" value={line.unit_cost} onChange={e => updateLine(line.id, 'unit_cost', e.target.value)} required />
                                                </div>
                                            </td>
                                            <td>LKR {(line.qty * line.unit_cost).toFixed(2)}</td>
                                            <td><button type="button" className="btn-icon" onClick={() => removeLine(line.id)}><Trash2 size={16} /></button></td>
                                        </tr>
                                    ))}
                                    {lines.length === 0 && <tr><td colSpan="5" className="text-muted" style={{ textAlign: 'center' }}>No items added</td></tr>}
                                </tbody>
                            </table>

                            <div style={{ textAlign: 'right', fontSize: '1.25rem', marginBottom: '2rem' }}>
                                <strong>Total: LKR {calculateTotal().toFixed(2)}</strong>
                            </div>

                            <div className="modal-actions">
                                <button type="button" className="btn-secondary" onClick={closeModal}>Cancel</button>
                                <button type="submit" className="btn-primary">
                                    {editingId ? 'Update Purchase' : 'Post Purchase (Update Stock)'}
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
                                Are you sure you want to delete purchase <strong>{deleteTarget.purchase_no}</strong>?
                                <br /><span style={{ color: '#ef4444', fontSize: '0.9rem' }}>⚠ This will reverse the stock quantities added by this purchase.</span>
                            </p>
                            <div className="modal-actions">
                                <button className="btn-secondary" onClick={() => setDeleteTarget(null)}>Cancel</button>
                                <button className="btn-primary" onClick={handleDelete} style={{ background: '#ef4444' }}>
                                    Delete & Reverse Stock
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            )}
            {/* ── VIEW DETAIL MODAL ── */}
            {viewTarget && (
                <div className="modal-backdrop">
                    <div className="modal-content" style={{ maxWidth: '700px' }}>
                        <div className="modal-header">
                            <div>
                                <h3>{viewTarget.purchase_no}</h3>
                                <p style={{ margin: 0, fontSize: '0.85rem', color: '#64748b' }}>
                                    {format(new Date(viewTarget.date), 'MMM dd, yyyy')} &nbsp;|&nbsp; {viewTarget.suppliers?.name}
                                </p>
                            </div>
                            <button className="btn-icon" onClick={() => setViewTarget(null)}><X size={20} /></button>
                        </div>
                        <div className="modal-form">
                            <table className="data-table" style={{ marginBottom: '1rem' }}>
                                <thead>
                                    <tr>
                                        <th>#</th>
                                        <th>Raw Item</th>
                                        <th>Qty</th>
                                        <th>Unit Cost</th>
                                        <th>Subtotal</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {(viewTarget.purchase_lines || []).map((l, i) => (
                                        <tr key={l.id}>
                                            <td style={{ color: '#94a3b8' }}>{i + 1}</td>
                                            <td><strong>{l.raw_items?.name}</strong></td>
                                            <td>{Number(l.qty).toFixed(2)} Kg</td>
                                            <td>LKR {Number(l.unit_cost).toFixed(2)}</td>
                                            <td>LKR {Number(l.total_amount).toFixed(2)}</td>
                                        </tr>
                                    ))}
                                    {(viewTarget.purchase_lines || []).length === 0 && (
                                        <tr><td colSpan="5" className="empty-state">No lines found.</td></tr>
                                    )}
                                </tbody>
                            </table>
                            <div style={{ textAlign: 'right', fontSize: '1.1rem', fontWeight: 700, borderTop: '1px solid #e2e8f0', paddingTop: '0.75rem' }}>
                                Grand Total: LKR {Number(viewTarget.total_amount).toFixed(2)}
                            </div>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
