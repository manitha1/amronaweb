import React, { useState, useEffect } from 'react';
import { supabase } from '../supabase';
import { Plus, Search, X, Trash2 } from 'lucide-react';
import toast from 'react-hot-toast';
import { format } from 'date-fns';

export default function Production() {
    const [data, setData] = useState([]);
    const [loading, setLoading] = useState(true);
    const [searchTerm, setSearchTerm] = useState('');
    const [isModalOpen, setIsModalOpen] = useState(false);

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

    const openModal = () => {
        setBatchNo('BATCH-' + Math.floor(1000 + Math.random() * 9000));
        setFgItemId('');
        setDate(format(new Date(), 'yyyy-MM-dd'));
        setConsumptions([]);
        setIsModalOpen(true);
    };

    const addConsumption = () => {
        setConsumptions([...consumptions, { id: Date.now(), purchase_no: '', raw_item_id: '', qty: '' }]);
    };

    const updateConsumption = (id, field, value) => {
        setConsumptions(consumptions.map(c => c.id === id ? { ...c, [field]: value } : c));
    };

    const removeConsumption = (id) => {
        setConsumptions(consumptions.filter(c => c.id !== id));
    };

    const handleSubmit = async (e) => {
        e.preventDefault();
        if (consumptions.length === 0) return toast.error('Add at least one raw material to consume');

        for (const c of consumptions) {
            if (!c.purchase_no || !c.raw_item_id || c.qty <= 0) {
                return toast.error('Please fill all consumption lines correctly');
            }
        }

        const payload = {
            batch_no: batchNo,
            fg_item_id: fgItemId,
            date,
            mfd,
            exp,
            qty_per_packet: Number(qtyPerPacket),
            total_qty: Number(totalQty),
            consumptions: consumptions.map(c => ({
                purchase_no: c.purchase_no,
                raw_item_id: c.raw_item_id,
                qty: Number(c.qty)
            }))
        };

        const { data: res, error } = await supabase.rpc('post_production', { payload });

        if (error) {
            // Graceful handling of our custom PG error
            toast.error(error.message || 'Transaction Failed');
        } else {
            toast.success('Production Posted Successfully!');
            setIsModalOpen(false);
            fetchData();
        }
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
                <button className="btn-primary" onClick={openModal}>
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
                                <th>Batch No</th>
                                <th>Finished Good</th>
                                <th>Date</th>
                                <th>Total Qty</th>
                                <th>Consumed Items</th>
                            </tr>
                        </thead>
                        <tbody>
                            {filteredData.map(row => (
                                <tr key={row.id}>
                                    <td><strong>{row.batch_no}</strong></td>
                                    <td>{row.fg_items?.name}</td>
                                    <td>{format(new Date(row.date), 'MMM dd, yyyy')}</td>
                                    <td>{row.total_qty}</td>
                                    <td>
                                        {row.production_consumptions?.map((c, i) => (
                                            <div key={i} style={{ fontSize: '0.8rem', color: '#64748b' }}>
                                                {c.qty} x {c.raw_items?.name} (from {c.purchase_headers?.purchase_no})
                                            </div>
                                        ))}
                                    </td>
                                </tr>
                            ))}
                            {filteredData.length === 0 && (
                                <tr><td colSpan="5" className="empty-state">No production records found.</td></tr>
                            )}
                        </tbody>
                    </table>
                )}
            </div>

            {isModalOpen && (
                <div className="modal-backdrop">
                    <div className="modal-content" style={{ maxWidth: '800px', maxHeight: '90vh', overflowY: 'auto' }}>
                        <div className="modal-header">
                            <h3>Create Production Batch</h3>
                            <button className="btn-icon" onClick={() => setIsModalOpen(false)}><X size={20} /></button>
                        </div>

                        <form onSubmit={handleSubmit} className="modal-form">
                            <h4>Finished Good Details</h4>
                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem', marginBottom: '1rem' }}>
                                <div className="form-group">
                                    <label>Batch No</label>
                                    <input type="text" value={batchNo} onChange={e => setBatchNo(e.target.value)} required />
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
                                    <label>Total Qty Produced</label>
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
                                                <input className="form-group" style={{ marginBottom: 0, width: '100px' }} type="number" min="0.01" step="0.01" value={line.qty} onChange={e => updateConsumption(line.id, 'qty', e.target.value)} required />
                                            </td>
                                            <td><button type="button" className="btn-icon" onClick={() => removeConsumption(line.id)}><Trash2 size={16} /></button></td>
                                        </tr>
                                    ))}
                                    {consumptions.length === 0 && <tr><td colSpan="4" className="text-muted" style={{ textAlign: 'center' }}>No consumptions added</td></tr>}
                                </tbody>
                            </table>

                            <div className="modal-actions">
                                <button type="button" className="btn-secondary" onClick={() => setIsModalOpen(false)}>Cancel</button>
                                <button type="submit" className="btn-primary">Post Production</button>
                            </div>
                        </form>
                    </div>
                </div>
            )}
        </div>
    );
}
