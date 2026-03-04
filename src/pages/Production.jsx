import React, { useState, useEffect } from 'react';
import { supabase } from '../supabase';
import { Plus, Search, X, Trash2, Pencil } from 'lucide-react';
import toast from 'react-hot-toast';
import { format } from 'date-fns';

export default function Production() {
    const [data, setData] = useState([]);
    const [loading, setLoading] = useState(true);
    const [searchTerm, setSearchTerm] = useState('');
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [viewTarget, setViewTarget] = useState(null);
    const [deleteTarget, setDeleteTarget] = useState(null);
    const [editingId, setEditingId] = useState(null);

    // Form State
    const [fgItems, setFgItems] = useState([]);
    const [purchases, setPurchases] = useState([]);
    const [rawItems, setRawItems] = useState([]);

    const [batchNo, setBatchNo] = useState('');
    const [fgItemId, setFgItemId] = useState('');
    const [date, setDate] = useState(format(new Date(), 'yyyy-MM-dd'));
    const [mfd, setMfd] = useState(format(new Date(), 'yyyy-MM-dd'));
    const [exp, setExp] = useState(format(new Date(new Date().setFullYear(new Date().getFullYear() + 1)), 'yyyy-MM-dd'));
    const [qtyPerPacket, setQtyPerPacket] = useState('');
    const [totalQty, setTotalQty] = useState('');
    const [consumptions, setConsumptions] = useState([]);

    useEffect(() => {
        fetchData();
        fetchLookups();
    }, []);

    const fetchData = async () => {
        setLoading(true);
        const { data: records, error } = await supabase
            .from('production_headers')
            .select('*, fg_items(name), production_consumptions(*, raw_items(name), purchase_headers(purchase_no))')
            .order('created_at', { ascending: false });
        if (error) toast.error('Error fetching production: ' + error.message);
        else setData(records);
        setLoading(false);
    };

    const fetchLookups = async () => {
        const { data: f } = await supabase.from('fg_items').select('id, name, uom');
        const { data: p } = await supabase.from('purchase_headers').select('id, purchase_no');
        const { data: r } = await supabase.from('raw_items').select('id, name, uom');
        if (f) setFgItems(f);
        if (p) setPurchases(p);
        if (r) setRawItems(r);
    };

    // ── OPEN CREATE ────────────────────────────────────────────────────────────
    const openCreateModal = () => {
        setEditingId(null);
        setBatchNo('BATCH-' + Math.floor(1000 + Math.random() * 9000));
        setFgItemId('');
        setDate(format(new Date(), 'yyyy-MM-dd'));
        setMfd(format(new Date(), 'yyyy-MM-dd'));
        setExp(format(new Date(new Date().setFullYear(new Date().getFullYear() + 1)), 'yyyy-MM-dd'));
        setQtyPerPacket('');
        setTotalQty('');
        setConsumptions([]);
        setIsModalOpen(true);
    };

    // ── OPEN EDIT ──────────────────────────────────────────────────────────────
    const openEditModal = (row) => {
        setEditingId(row.id);
        setBatchNo(row.batch_no);
        setFgItemId(row.fg_item_id);
        setDate(row.date);
        setMfd(row.mfd);
        setExp(row.exp);
        setQtyPerPacket(row.qty_per_packet);
        setTotalQty(row.total_qty);
        setConsumptions((row.production_consumptions || []).map(c => ({
            id: c.id,
            purchase_no: c.purchase_no,
            raw_item_id: c.raw_item_id,
            qty: c.qty,
            remainingQty: null
        })));
        setIsModalOpen(true);
    };

    const closeModal = () => {
        setIsModalOpen(false);
        setEditingId(null);
        setConsumptions([]);
    };

    const addConsumption = () => {
        setConsumptions([...consumptions, { id: Date.now(), purchase_no: '', raw_item_id: '', qty: '' }]);
    };

    const updateConsumption = async (id, field, value) => {
        const updated = consumptions.map(c => c.id === id ? { ...c, [field]: value } : c);
        setConsumptions(updated);

        const line = updated.find(c => c.id === id);
        const purchaseId = field === 'purchase_no' ? value : line?.purchase_no;
        const rawItemId = field === 'raw_item_id' ? value : line?.raw_item_id;

        if (purchaseId && rawItemId) {
            const { data: plRows } = await supabase
                .from('purchase_lines')
                .select('qty')
                .eq('purchase_header_id', purchaseId)
                .eq('raw_item_id', rawItemId)
                .single();

            const { data: pcRows } = await supabase
                .from('production_consumptions')
                .select('qty')
                .eq('purchase_no', purchaseId)
                .eq('raw_item_id', rawItemId);

            const purchased = plRows?.qty ? Number(plRows.qty) : 0;
            const consumed = pcRows ? pcRows.reduce((s, r) => s + Number(r.qty), 0) : 0;
            const remaining = purchased - consumed;

            setConsumptions(prev => prev.map(c =>
                c.id === id ? { ...c, remainingQty: remaining } : c
            ));
        } else {
            setConsumptions(prev => prev.map(c =>
                c.id === id ? { ...c, remainingQty: null } : c
            ));
        }
    };

    const removeConsumption = (id) => {
        setConsumptions(consumptions.filter(c => c.id !== id));
    };

    // ── SUBMIT (CREATE or UPDATE) ──────────────────────────────────────────────
    const handleSubmit = async (e) => {
        e.preventDefault();
        if (consumptions.length === 0) return toast.error('Add at least one raw material to consume');

        for (const c of consumptions) {
            if (!c.purchase_no || !c.raw_item_id || c.qty <= 0) {
                return toast.error('Please fill all consumption lines correctly');
            }
        }

        const consumptionPayload = consumptions.map(c => ({
            purchase_no: c.purchase_no,
            raw_item_id: c.raw_item_id,
            qty: Number(c.qty)
        }));

        if (editingId) {
            const payload = {
                header_id: editingId,
                fg_item_id: fgItemId,
                date, mfd, exp,
                qty_per_packet: Number(qtyPerPacket),
                total_qty: Number(totalQty),
                consumptions: consumptionPayload
            };
            const { error } = await supabase.rpc('update_production', { payload });
            if (error) {
                toast.error('Update Failed: ' + error.message);
            } else {
                toast.success('Production Updated Successfully!');
                closeModal();
                fetchData();
            }
        } else {
            const payload = {
                batch_no: batchNo,
                fg_item_id: fgItemId,
                date, mfd, exp,
                qty_per_packet: Number(qtyPerPacket),
                total_qty: Number(totalQty),
                consumptions: consumptionPayload
            };
            const { error } = await supabase.rpc('post_production', { payload });
            if (error) {
                toast.error(error.message || 'Transaction Failed');
            } else {
                toast.success('Production Posted Successfully!');
                closeModal();
                fetchData();
            }
        }
    };

    // ── DELETE ─────────────────────────────────────────────────────────────────
    const handleDelete = async () => {
        if (!deleteTarget) return;
        const { error } = await supabase.rpc('delete_production', { p_header_id: deleteTarget.id });
        if (error) {
            toast.error('Delete Failed: ' + error.message);
        } else {
            toast.success('Production deleted and stock reversed.');
            fetchData();
        }
        setDeleteTarget(null);
    };

    const filteredData = data.filter(item =>
        item.batch_no.toLowerCase().includes(searchTerm.toLowerCase()) ||
        item.fg_items?.name.toLowerCase().includes(searchTerm.toLowerCase())
    );

    return (
        <div className="page-container">
            <div className="page-header-row">
                <div>
                    <h2>Production</h2>
                    <p>Record finished goods manufacturing</p>
                </div>
                <button className="btn-primary" onClick={openCreateModal}>
                    <Plus size={18} /> New Batch
                </button>
            </div>

            <div className="table-controls">
                <div className="search-box">
                    <Search size={18} className="text-muted" />
                    <input
                        type="text"
                        placeholder="Search by Batch No or Product..."
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
                                <th>Date</th>
                                <th>Batch No</th>
                                <th>Product</th>
                                <th>MFD</th>
                                <th>EXP</th>
                                <th>Qty / Packet</th>
                                <th>Packets</th>
                                <th style={{ textAlign: 'center' }}>Actions</th>
                            </tr>
                        </thead>
                        <tbody>
                            {filteredData.map(row => (
                                <tr key={row.id}>
                                    <td>{format(new Date(row.date), 'MMM dd, yyyy')}</td>
                                    <td>
                                        <button
                                            onClick={() => setViewTarget(row)}
                                            style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', color: '#3b82f6', fontWeight: 700, textDecoration: 'underline' }}
                                        >
                                            {row.batch_no}
                                        </button>
                                    </td>
                                    <td>{row.fg_items?.name}</td>
                                    <td>{row.mfd ? format(new Date(row.mfd), 'MMM dd, yyyy') : '—'}</td>
                                    <td>{row.exp ? format(new Date(row.exp), 'MMM dd, yyyy') : '—'}</td>
                                    <td>{row.qty_per_packet}</td>
                                    <td>{row.total_qty}</td>
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
                                <tr><td colSpan="8" className="empty-state">No production records found.</td></tr>
                            )}
                        </tbody>
                    </table>
                )}
            </div>

            {/* ── CREATE / EDIT MODAL ── */}
            {isModalOpen && (
                <div className="modal-backdrop">
                    <div className="modal-content" style={{ maxWidth: '800px', maxHeight: '90vh', overflowY: 'auto' }}>
                        <div className="modal-header">
                            <h3>{editingId ? 'Edit Production Batch' : 'Create Production Batch'}</h3>
                            <button className="btn-icon" onClick={closeModal}><X size={20} /></button>
                        </div>

                        <form onSubmit={handleSubmit} className="modal-form">
                            <h4>Finished Good Details</h4>
                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem', marginBottom: '1rem' }}>
                                <div className="form-group">
                                    <label>Batch No</label>
                                    <input
                                        type="text"
                                        value={batchNo}
                                        onChange={e => setBatchNo(e.target.value)}
                                        readOnly={!!editingId}
                                        style={editingId ? { background: '#f1f5f9', cursor: 'not-allowed' } : {}}
                                        required
                                    />
                                </div>
                                <div className="form-group">
                                    <label>Finished Good Item</label>
                                    <select value={fgItemId} onChange={e => setFgItemId(e.target.value)} required>
                                        <option value="">Select FG</option>
                                        {fgItems.map(f => <option key={f.id} value={f.id}>{f.name} ({f.uom})</option>)}
                                    </select>
                                </div>
                                <div className="form-group">
                                    <label>Date</label>
                                    <input type="date" value={date} onChange={e => setDate(e.target.value)} required />
                                </div>
                                <div className="form-group">
                                    <label>Total Packet Produced</label>
                                    <input type="number" min="1" step="0.01" value={totalQty} onChange={e => setTotalQty(e.target.value)} required />
                                </div>
                                <div className="form-group">
                                    <label>MFD Date</label>
                                    <input type="date" value={mfd} onChange={e => setMfd(e.target.value)} required />
                                </div>
                                <div className="form-group">
                                    <label>EXP Date</label>
                                    <input type="date" value={exp} onChange={e => setExp(e.target.value)} required />
                                </div>
                                <div className="form-group">
                                    <label>Qty Per Packet (Grams/KG)</label>
                                    <input type="number" min="0" step="0.01" value={qtyPerPacket} onChange={e => setQtyPerPacket(e.target.value)} required />
                                </div>
                            </div>

                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem', marginTop: '2rem' }}>
                                <h4>Raw Materials Consumed</h4>
                                <button type="button" className="btn-secondary" onClick={addConsumption}><Plus size={16} /> Add Material</button>
                            </div>

                            <table className="data-table" style={{ marginBottom: '2rem' }}>
                                <thead>
                                    <tr>
                                        <th>Purchase No (Source)</th>
                                        <th>Raw Item</th>
                                        <th>Qty Consumed</th>
                                        <th></th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {consumptions.map(line => (
                                        <tr key={line.id}>
                                            <td>
                                                <select className="form-group" style={{ marginBottom: 0 }} value={line.purchase_no} onChange={e => updateConsumption(line.id, 'purchase_no', e.target.value)} required>
                                                    <option value="">Select Purchase</option>
                                                    {purchases.map(p => <option key={p.id} value={p.id}>{p.purchase_no}</option>)}
                                                </select>
                                            </td>
                                            <td>
                                                <select className="form-group" style={{ marginBottom: 0 }} value={line.raw_item_id} onChange={e => updateConsumption(line.id, 'raw_item_id', e.target.value)} required>
                                                    <option value="">Select Item</option>
                                                    {rawItems.map(r => <option key={r.id} value={r.id}>{r.name} ({r.uom})</option>)}
                                                </select>
                                            </td>
                                            <td>
                                                <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                                                    <input className="form-group" style={{ marginBottom: 0, width: '100px' }} type="number" min="0.01" step="0.01" value={line.qty} onChange={e => updateConsumption(line.id, 'qty', e.target.value)} required />
                                                    {line.remainingQty !== null && line.remainingQty !== undefined && (
                                                        <span style={{
                                                            fontSize: '0.75rem', fontWeight: 600,
                                                            padding: '2px 6px', borderRadius: '4px', whiteSpace: 'nowrap',
                                                            background: line.remainingQty <= 0 ? '#fee2e2' : line.remainingQty < 10 ? '#fef9c3' : '#dcfce7',
                                                            color: line.remainingQty <= 0 ? '#dc2626' : line.remainingQty < 10 ? '#ca8a04' : '#16a34a',
                                                        }}>
                                                            Available: {Number(line.remainingQty).toFixed(2)} Kg
                                                        </span>
                                                    )}
                                                </div>
                                            </td>
                                            <td><button type="button" className="btn-icon" onClick={() => removeConsumption(line.id)}><Trash2 size={16} /></button></td>
                                        </tr>
                                    ))}
                                    {consumptions.length === 0 && <tr><td colSpan="4" className="text-muted" style={{ textAlign: 'center' }}>No consumptions added</td></tr>}
                                </tbody>
                            </table>

                            <div className="modal-actions">
                                <button type="button" className="btn-secondary" onClick={closeModal}>Cancel</button>
                                <button type="submit" className="btn-primary">
                                    {editingId ? 'Update Production' : 'Post Production'}
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
                                Are you sure you want to delete batch <strong>{deleteTarget.batch_no}</strong>?
                                <br /><span style={{ color: '#ef4444', fontSize: '0.9rem' }}>⚠ This will reverse FG stock and return raw material consumption.</span>
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

            {/* ── BATCH CONSUMPTION DETAIL MODAL ── */}
            {viewTarget && (
                <div className="modal-backdrop">
                    <div className="modal-content" style={{ maxWidth: '680px' }}>
                        <div className="modal-header">
                            <div>
                                <h3>{viewTarget.batch_no}</h3>
                                <p style={{ margin: 0, fontSize: '0.85rem', color: '#64748b' }}>
                                    {viewTarget.fg_items?.name}&nbsp;|&nbsp;
                                    {format(new Date(viewTarget.date), 'MMM dd, yyyy')}&nbsp;|&nbsp;
                                    {viewTarget.total_qty} Packets
                                </p>
                            </div>
                            <button className="btn-icon" onClick={() => setViewTarget(null)}><X size={20} /></button>
                        </div>
                        <div className="modal-form">
                            <h4 style={{ marginBottom: '0.75rem' }}>Raw Materials Consumed</h4>
                            <table className="data-table" style={{ marginBottom: '1rem' }}>
                                <thead>
                                    <tr>
                                        <th>#</th>
                                        <th>Purchase No</th>
                                        <th>Raw Item</th>
                                        <th>Qty Consumed</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {(viewTarget.production_consumptions || []).map((c, i) => (
                                        <tr key={c.id}>
                                            <td style={{ color: '#94a3b8' }}>{i + 1}</td>
                                            <td>{c.purchase_headers?.purchase_no || '—'}</td>
                                            <td><strong>{c.raw_items?.name}</strong></td>
                                            <td>{Number(c.qty).toFixed(2)} Kg</td>
                                        </tr>
                                    ))}
                                    {(viewTarget.production_consumptions || []).length === 0 && (
                                        <tr><td colSpan="4" className="empty-state">No consumption records found.</td></tr>
                                    )}
                                </tbody>
                            </table>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
