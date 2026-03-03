import React, { useState, useEffect } from 'react';
import { supabase } from '../supabase';
import { Plus, Search, X, Trash2 } from 'lucide-react';
import toast from 'react-hot-toast';
import { format } from 'date-fns';

export default function Sales() {
    const [data, setData] = useState([]);
    const [loading, setLoading] = useState(true);
    const [searchTerm, setSearchTerm] = useState('');
    const [isModalOpen, setIsModalOpen] = useState(false);

    // Form State
    const [customers, setCustomers] = useState([]);
    const [fgItems, setFgItems] = useState([]);

    const [billNo, setBillNo] = useState('');
    const [customerId, setCustomerId] = useState('');
    const [date, setDate] = useState(format(new Date(), 'yyyy-MM-dd'));
    const [lines, setLines] = useState([]);

    useEffect(() => {
        fetchData();
        fetchLookups();
    }, []);

    const fetchData = async () => {
        setLoading(true);
        const { data: records, error } = await supabase
            .from('sales_headers')
            .select('*, customers(name), sales_lines(*, fg_items(name))')
            .order('created_at', { ascending: false });

        if (error) toast.error('Error fetching sales: ' + error.message);
        else setData(records);
        setLoading(false);
    };

    const fetchLookups = async () => {
        const { data: c } = await supabase.from('customers').select('id, name');
        const { data: f } = await supabase.from('fg_items').select('id, name, uom');
        if (c) setCustomers(c);
        if (f) setFgItems(f);
    };

    const openModal = () => {
        setBillNo('INV-' + Math.floor(1000 + Math.random() * 9000));
        setCustomerId('');
        setDate(format(new Date(), 'yyyy-MM-dd'));
        setLines([]);
        setIsModalOpen(true);
    };

    const addLine = () => {
        setLines([...lines, { id: Date.now(), fg_item_id: '', qty: 1, unit_price: 0 }]);
    };

    const updateLine = (id, field, value) => {
        setLines(lines.map(l => l.id === id ? { ...l, [field]: value } : l));
    };

    const removeLine = (id) => {
        setLines(lines.filter(l => l.id !== id));
    };

    const calculateTotal = () => {
        return lines.reduce((acc, l) => acc + (Number(l.qty) * Number(l.unit_price)), 0);
    };

    const handleSubmit = async (e) => {
        e.preventDefault();
        if (lines.length === 0) return toast.error('Add at least one item line');

        for (const l of lines) {
            if (!l.fg_item_id || l.qty <= 0 || l.unit_price < 0) {
                return toast.error('Please fill all lines correctly');
            }
        }

        const payload = {
            bill_no: billNo,
            customer_id: customerId,
            date,
            lines: lines.map(l => ({
                fg_item_id: l.fg_item_id,
                qty: Number(l.qty),
                unit_price: Number(l.unit_price)
            }))
        };

        const { data: res, error } = await supabase.rpc('post_sales', { payload });

        if (error) {
            toast.error('Transaction Failed: ' + error.message);
        } else {
            toast.success('Sale Posted Successfully!');
            setIsModalOpen(false);
            fetchData();
        }
    };

    const filteredData = data.filter(item =>
        item.bill_no.toLowerCase().includes(searchTerm.toLowerCase()) ||
        item.customers?.name.toLowerCase().includes(searchTerm.toLowerCase())
    );

    return (
        <div className="page-container">
            <div className="page-header-row">
                <div>
                    <h2>Sales (Out)</h2>
                    <p>Record finished goods sales to customers</p>
                </div>
                <button className="btn-primary" onClick={openModal}>
                    <Plus size={18} /> New Sale
                </button>
            </div>

            <div className="table-controls">
                <div className="search-box">
                    <Search size={18} className="text-muted" />
                    <input
                        type="text"
                        placeholder="Search by Bill No or Customer..."
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
                                <th>Bill No</th>
                                <th>Date</th>
                                <th>Customer</th>
                                <th>Lines</th>
                                <th>Total Amount</th>
                            </tr>
                        </thead>
                        <tbody>
                            {filteredData.map(row => (
                                <tr key={row.id}>
                                    <td><strong>{row.bill_no}</strong></td>
                                    <td>{format(new Date(row.date), 'MMM dd, yyyy')}</td>
                                    <td>{row.customers?.name}</td>
                                    <td>
                                        {row.sales_lines?.map((l, i) => (
                                            <div key={i} style={{ fontSize: '0.8rem', color: '#64748b' }}>
                                                {l.qty} x {l.fg_items?.name} (@ ${l.unit_price})
                                            </div>
                                        ))}
                                    </td>
                                    <td>${Number(row.total_amount).toFixed(2)}</td>
                                </tr>
                            ))}
                            {filteredData.length === 0 && (
                                <tr><td colSpan="5" className="empty-state">No sales found.</td></tr>
                            )}
                        </tbody>
                    </table>
                )}
            </div>

            {isModalOpen && (
                <div className="modal-backdrop">
                    <div className="modal-content" style={{ maxWidth: '800px' }}>
                        <div className="modal-header">
                            <h3>Create Sales Invoice</h3>
                            <button className="btn-icon" onClick={() => setIsModalOpen(false)}><X size={20} /></button>
                        </div>

                        <form onSubmit={handleSubmit} className="modal-form">
                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '1rem', marginBottom: '2rem' }}>
                                <div className="form-group">
                                    <label>Bill No</label>
                                    <input type="text" value={billNo} onChange={e => setBillNo(e.target.value)} required />
                                </div>
                                <div className="form-group">
                                    <label>Date</label>
                                    <input type="date" value={date} onChange={e => setDate(e.target.value)} required />
                                </div>
                                <div className="form-group">
                                    <label>Customer</label>
                                    <select value={customerId} onChange={e => setCustomerId(e.target.value)} required>
                                        <option value="">Select Customer</option>
                                        {customers.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                                    </select>
                                </div>
                            </div>

                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
                                <h4>Sale Items (FG)</h4>
                                <button type="button" className="btn-secondary" onClick={addLine}><Plus size={16} /> Add Line</button>
                            </div>

                            <table className="data-table" style={{ marginBottom: '1rem' }}>
                                <thead>
                                    <tr>
                                        <th>Finished Good Item</th>
                                        <th>Qty Sold</th>
                                        <th>Unit Price</th>
                                        <th>Subtotal</th>
                                        <th></th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {lines.map(line => (
                                        <tr key={line.id}>
                                            <td>
                                                <select className="form-group" style={{ marginBottom: 0 }} value={line.fg_item_id} onChange={e => updateLine(line.id, 'fg_item_id', e.target.value)} required>
                                                    <option value="">Select Item</option>
                                                    {fgItems.map(f => <option key={f.id} value={f.id}>{f.name} ({f.uom})</option>)}
                                                </select>
                                            </td>
                                            <td>
                                                <input className="form-group" style={{ marginBottom: 0, width: '80px' }} type="number" min="0.01" step="0.01" value={line.qty} onChange={e => updateLine(line.id, 'qty', e.target.value)} required />
                                            </td>
                                            <td>
                                                <input className="form-group" style={{ marginBottom: 0, width: '100px' }} type="number" min="0" step="0.01" value={line.unit_price} onChange={e => updateLine(line.id, 'unit_price', e.target.value)} required />
                                            </td>
                                            <td>${(line.qty * line.unit_price).toFixed(2)}</td>
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
                                <button type="submit" className="btn-primary">Post Sale (Update Stock)</button>
                            </div>
                        </form>
                    </div>
                </div>
            )}
        </div>
    );
}
