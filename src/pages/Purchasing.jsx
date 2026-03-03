import React, { useState, useEffect } from 'react';
import { supabase } from '../supabase';
import { Plus, Search, X, Trash2 } from 'lucide-react';
import toast from 'react-hot-toast';
import { format } from 'date-fns';

export default function Purchasing() {
    const [data, setData] = useState([]);
    const [loading, setLoading] = useState(true);
    const [searchTerm, setSearchTerm] = useState('');
    const [isModalOpen, setIsModalOpen] = useState(false);

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
        const { data: s } = await supabase.from('suppliers').select('id, name');
        const { data: r } = await supabase.from('raw_items').select('id, name, uom');
        if (s) setSuppliers(s);
        if (r) setRawItems(r);
    };

    const openModal = () => {
        setPurchaseNo('PUR-' + Math.floor(1000 + Math.random() * 9000));
        setSupplierId('');
        setDate(format(new Date(), 'yyyy-MM-dd'));
        setLines([]);
        setIsModalOpen(true);
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

    const handleSubmit = async (e) => {
        e.preventDefault();
        if (lines.length === 0) return toast.error('Add at least one item line');

        // Validate
        for (const l of lines) {
            if (!l.raw_item_id || l.qty <= 0 || l.unit_cost < 0) {
                return toast.error('Please fill all lines correctly (qty > 0, cost >= 0)');
            }
        }

        const payload = {
            purchase_no: purchaseNo,
            supplier_id: supplierId,
            date,
            lines: lines.map(l => ({
                raw_item_id: l.raw_item_id,
                qty: Number(l.qty),
                unit_cost: Number(l.unit_cost)
            }))
        };

        const { data: res, error } = await supabase.rpc('post_purchase', { payload });

        if (error) {
            toast.error('Transaction Failed: ' + error.message);
        } else {
            toast.success('Purchase Posted Successfully!');
            setIsModalOpen(false);
            fetchData();
        }
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
                <button className="btn-primary" onClick={openModal}>
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
                            </tr>
                        </thead>
                        <tbody>
                            {filteredData.map(row => (
                                <tr key={row.id}>
                                    <td><strong>{row.purchase_no}</strong></td>
                                    <td>{format(new Date(row.date), 'MMM dd, yyyy')}</td>
                                    <td>{row.suppliers?.name}</td>
                                    <td>{row.purchase_lines?.length || 0} items</td>
                                    <td>${Number(row.total_amount).toFixed(2)}</td>
                                </tr>
                            ))}
                            {filteredData.length === 0 && (
                                <tr><td colSpan="5" className="empty-state">No purchases found.</td></tr>
                            )}
                        </tbody>
                    </table>
                )}
            </div>

            {isModalOpen && (
                <div className="modal-backdrop">
                    <div className="modal-content" style={{ maxWidth: '800px' }}>
                        <div className="modal-header">
                            <h3>Create Purchase Document</h3>
                            <button className="btn-icon" onClick={() => setIsModalOpen(false)}><X size={20} /></button>
                        </div>

                        <form onSubmit={handleSubmit} className="modal-form">
                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '1rem', marginBottom: '2rem' }}>
                                <div className="form-group">
                                    <label>Purchase No</label>
                                    <input type="text" value={purchaseNo} onChange={e => setPurchaseNo(e.target.value)} required />
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
                                                <input className="form-group" style={{ marginBottom: 0, width: '80px' }} type="number" min="0.01" step="0.01" value={line.qty} onChange={e => updateLine(line.id, 'qty', e.target.value)} required />
                                            </td>
                                            <td>
                                                <input className="form-group" style={{ marginBottom: 0, width: '100px' }} type="number" min="0" step="0.01" value={line.unit_cost} onChange={e => updateLine(line.id, 'unit_cost', e.target.value)} required />
                                            </td>
                                            <td>${(line.qty * line.unit_cost).toFixed(2)}</td>
                                            <td><button type="button" className="btn-icon" onClick={() => removeLine(line.id)}><Trash2 size={16} /></button></td>
                                        </tr>
                                    ))}
                                    {lines.length === 0 && <tr><td colSpan="5" className="text-muted" style={{ textAlign: 'center' }}>No items added</td></tr>}
                                </tbody>
                            </table>

                            <div style={{ textAlign: 'right', fontSize: '1.25rem', marginBottom: '2rem' }}>
                                <strong>Total: ${calculateTotal().toFixed(2)}</strong>
                            </div>

                            <div className="modal-actions">
                                <button type="button" className="btn-secondary" onClick={() => setIsModalOpen(false)}>Cancel</button>
                                <button type="submit" className="btn-primary">Post Purchase (Update Stock)</button>
                            </div>
                        </form>
                    </div>
                </div>
            )}
        </div>
    );
}
