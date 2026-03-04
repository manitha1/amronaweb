import React, { useState, useEffect } from 'react';
import { supabase } from '../supabase';
import { Plus, Search, X, Trash2, Pencil, Printer } from 'lucide-react';
import toast from 'react-hot-toast';
import { format } from 'date-fns';

export default function Sales() {
    const [data, setData] = useState([]);
    const [loading, setLoading] = useState(true);
    const [searchTerm, setSearchTerm] = useState('');
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [viewTarget, setViewTarget] = useState(null);
    const [deleteTarget, setDeleteTarget] = useState(null);
    const [editingId, setEditingId] = useState(null);

    // Form State
    const [customers, setCustomers] = useState([]);
    const [batches, setBatches] = useState([]);

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
            .select('*, customers(name), sales_lines(*, fg_items(name), production_headers(batch_no), production_lines(qty_per_packet))')
            .order('created_at', { ascending: false });
        if (error) toast.error('Error fetching sales: ' + error.message);
        else setData(records);
        setLoading(false);
    };

    const fetchLookups = async () => {
        const { data: c } = await supabase.from('customers').select('id, name');
        const { data: b } = await supabase
            .from('production_lines')
            .select(`
                id, fg_item_id, total_qty, qty_per_packet,
                production_headers(id, batch_no, date),
                fg_items(name, uom)
            `)
            .order('production_headers(date)', { ascending: false });
        if (c) setCustomers(c);
        if (b) setBatches(b);
    };

    // ── OPEN CREATE ────────────────────────────────────────────────────────────
    const openCreateModal = () => {
        setEditingId(null);
        setBillNo('INV-' + Math.floor(1000 + Math.random() * 9000));
        setCustomerId('');
        setDate(format(new Date(), 'yyyy-MM-dd'));
        setLines([]);
        setIsModalOpen(true);
    };

    // ── OPEN EDIT ──────────────────────────────────────────────────────────────
    const openEditModal = (row) => {
        setEditingId(row.id);
        setBillNo(row.bill_no);
        setCustomerId(row.customer_id);
        setDate(row.date);
        setLines((row.sales_lines || []).map(l => ({
            id: l.id,
            batch_id: l.production_header_id || '',
            prod_line_id: '', // since old rows won't easily map back if we only know batch_id + fg_item_id, we just keep batch_id for edit mode display
            fg_item_id: l.fg_item_id,
            fg_item_name: l.fg_items?.name,
            qty_per_packet_display: '',
            qty: l.qty,
            unit_price: l.unit_price,
            availableQty: null
        })));
        setIsModalOpen(true);
    };

    const closeModal = () => {
        setIsModalOpen(false);
        setEditingId(null);
        setBillNo('');
        setCustomerId('');
        setDate(format(new Date(), 'yyyy-MM-dd'));
        setLines([{ id: Date.now(), fg_item_id: '', batch_id: '', prod_line_id: '', fg_item_name: '', qty_per_packet_display: '', availableQty: null, qty: 1, unit_price: 0 }]);
    };

    const handlePrint = (row) => {
        setViewTarget(row);
        // Wait for React to mount the hidden print container into the DOM
        setTimeout(() => {
            window.print();
        }, 300);
    };

    useEffect(() => {
        // When the print dialog is closed, unmount the print container
        // so it doesn't stay invisibly loaded or accidentally re-printed.
        const afterPrint = () => setViewTarget(null);
        window.addEventListener('afterprint', afterPrint);
        return () => window.removeEventListener('afterprint', afterPrint);
    }, []);

    const addLine = () => {
        setLines([...lines, { id: Date.now(), prod_line_id: '', batch_id: '', fg_item_id: '', fg_item_name: '', qty_per_packet_display: '', qty: '', unit_price: '', availableQty: null }]);
    };

    const selectBatchLine = async (lineId, prodLineId) => {
        const batchLine = batches.find(b => b.id === prodLineId);
        if (!batchLine) {
            setLines(lines.map(l => l.id === lineId ? { ...l, prod_line_id: '', batch_id: '', fg_item_id: '', fg_item_name: '', qty_per_packet_display: '', availableQty: null } : l));
            return;
        }

        const { data: soldRows } = await supabase
            .from('sales_lines')
            .select('qty')
            .eq('fg_item_id', batchLine.fg_item_id)
            .eq('production_header_id', batchLine.production_headers?.id); // We have to track sold per batch! But standard DB currently doesn't enforce strict batch selling. It relies on total stock ledger. To be safe, we just use the original stock ledger rules, or rough calculation.

        // Accurate remaining is really just checking overall FG stock, but for this specific batch, we approximate:
        const totalSold = soldRows ? soldRows.reduce((s, r) => s + Number(r.qty), 0) : 0;
        const batchQty = Number(batchLine.total_qty);
        const available = Math.max(0, Math.min(batchQty, batchQty - totalSold));

        setLines(lines.map(l => l.id === lineId ? {
            ...l,
            prod_line_id: prodLineId,
            batch_id: batchLine.production_headers?.id,
            fg_item_id: batchLine.fg_item_id,
            fg_item_name: batchLine.fg_items?.name,
            qty_per_packet_display: batchLine.qty_per_packet,
            availableQty: available
        } : l));
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

    // Format gram value → "25g", "100g", "1kg" etc.
    const formatPacketSize = (val) => {
        const g = Number(val);
        if (!g) return val;
        return g >= 1000 ? `${g / 1000}kg` : `${g}g`;
    };

    // ── SUBMIT (CREATE or UPDATE) ──────────────────────────────────────────────
    const handleSubmit = async (e) => {
        e.preventDefault();
        if (lines.length === 0) return toast.error('Add at least one item line');

        for (const l of lines) {
            if (!l.fg_item_id || l.qty <= 0 || l.unit_price < 0) {
                return toast.error('Please fill all lines correctly');
            }
        }

        const linePayload = lines.map(l => ({
            fg_item_id: l.fg_item_id,
            qty: Number(l.qty),
            unit_price: Number(l.unit_price),
            production_header_id: l.batch_id || null,
            production_line_id: l.prod_line_id || null
        }));

        if (editingId) {
            const payload = { header_id: editingId, customer_id: customerId, date, lines: linePayload };
            const { error } = await supabase.rpc('update_sales', { payload });
            if (error) {
                toast.error('Update Failed: ' + error.message);
            } else {
                toast.success('Sale Updated Successfully!');
                closeModal();
                fetchData();
            }
        } else {
            const payload = { bill_no: billNo, customer_id: customerId, date, lines: linePayload };
            const { error } = await supabase.rpc('post_sales', { payload });
            if (error) {
                toast.error('Transaction Failed: ' + error.message);
            } else {
                toast.success('Sale Posted Successfully!');
                closeModal();
                fetchData();
            }
        }
    };

    // ── DELETE ─────────────────────────────────────────────────────────────────
    const handleDelete = async () => {
        if (!deleteTarget) return;
        const { error } = await supabase.rpc('delete_sales', { p_header_id: deleteTarget.id });
        if (error) {
            toast.error('Delete Failed: ' + error.message);
        } else {
            toast.success('Sale deleted and FG stock restored.');
            fetchData();
        }
        setDeleteTarget(null);
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
                <button className="btn-primary" onClick={openCreateModal}>
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
                                <th>Items</th>
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
                                            {row.bill_no}
                                        </button>
                                    </td>
                                    <td>{format(new Date(row.date), 'MMM dd, yyyy')}</td>
                                    <td>{row.customers?.name}</td>
                                    <td>{row.sales_lines?.length || 0} items</td>
                                    <td>LKR {Number(row.total_amount).toFixed(2)}</td>
                                    <td style={{ textAlign: 'center', whiteSpace: 'nowrap' }}>
                                        <button
                                            className="btn-icon"
                                            title="Print"
                                            onClick={() => handlePrint(row)}
                                            style={{ marginRight: '6px', color: '#64748b' }}
                                        >
                                            <Printer size={15} />
                                        </button>
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
                                <tr><td colSpan="6" className="empty-state">No sales found.</td></tr>
                            )}
                        </tbody>
                    </table>
                )}
            </div>

            {/* ── CREATE / EDIT MODAL ── */}
            {isModalOpen && (
                <div className="modal-backdrop">
                    <div className="modal-content" style={{ maxWidth: '860px' }}>
                        <div className="modal-header">
                            <h3>{editingId ? 'Edit Sales Invoice' : 'Create Sales Invoice'}</h3>
                            <button className="btn-icon" onClick={closeModal}><X size={20} /></button>
                        </div>

                        <form onSubmit={handleSubmit} className="modal-form">
                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '1rem', marginBottom: '2rem' }}>
                                <div className="form-group">
                                    <label>Bill No</label>
                                    <input
                                        type="text"
                                        value={billNo}
                                        onChange={e => setBillNo(e.target.value)}
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
                                    <label>Customer</label>
                                    <select value={customerId} onChange={e => setCustomerId(e.target.value)} required>
                                        <option value="">Select Customer</option>
                                        {customers.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                                    </select>
                                </div>
                            </div>

                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
                                <h4>Sale Items</h4>
                                <button type="button" className="btn-secondary" onClick={addLine}><Plus size={16} /> Add Line</button>
                            </div>

                            <table className="data-table" style={{ marginBottom: '1rem' }}>
                                <thead>
                                    <tr>
                                        <th>Production Batch</th>
                                        <th>Product (FG)</th>
                                        <th>Packets</th>
                                        <th>Unit Price (LKR)</th>
                                        <th>Subtotal</th>
                                        <th></th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {lines.map(line => (
                                        <tr key={line.id}>
                                            <td>
                                                <select
                                                    className="form-group"
                                                    style={{ marginBottom: 0, minWidth: '180px' }}
                                                    value={line.prod_line_id}
                                                    onChange={e => selectBatchLine(line.id, e.target.value)}
                                                >
                                                    <option value="">Select Batch Item</option>
                                                    {batches.map(b => (
                                                        <option key={b.id} value={b.id}>{b.production_headers?.batch_no} - {b.fg_items?.name} ({formatPacketSize(b.qty_per_packet)})</option>
                                                    ))}
                                                </select>
                                            </td>
                                            <td>
                                                {line.fg_item_name ? (
                                                    <span style={{ fontWeight: 600, color: '#1e293b' }}>
                                                        {line.fg_item_name} {line.qty_per_packet_display && `(${formatPacketSize(line.qty_per_packet_display)})`}
                                                    </span>
                                                ) : (
                                                    <span style={{ color: '#94a3b8', fontSize: '0.85rem' }}>— select item —</span>
                                                )}
                                            </td>
                                            <td>
                                                <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                                                    <input
                                                        className="form-group"
                                                        style={{ marginBottom: 0, width: '90px' }}
                                                        type="number" min="1" step="1"
                                                        value={line.qty}
                                                        onChange={e => updateLine(line.id, 'qty', e.target.value)}
                                                        required
                                                    />
                                                    {line.availableQty !== null && (
                                                        <span style={{
                                                            fontSize: '0.72rem', fontWeight: 600, padding: '2px 6px',
                                                            borderRadius: '4px', whiteSpace: 'nowrap',
                                                            background: line.availableQty <= 0 ? '#fee2e2' : line.availableQty < 20 ? '#fef9c3' : '#dcfce7',
                                                            color: line.availableQty <= 0 ? '#dc2626' : line.availableQty < 20 ? '#ca8a04' : '#16a34a',
                                                        }}>
                                                            In stock: {Number(line.availableQty).toFixed(0)} pkts
                                                        </span>
                                                    )}
                                                </div>
                                            </td>
                                            <td>
                                                <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                                                    <span style={{ fontSize: '0.8rem', color: '#64748b', fontWeight: 600 }}>LKR</span>
                                                    <input
                                                        className="form-group"
                                                        style={{ marginBottom: 0, width: '100px' }}
                                                        type="number" min="0" step="0.01"
                                                        value={line.unit_price}
                                                        onChange={e => updateLine(line.id, 'unit_price', e.target.value)}
                                                        required
                                                    />
                                                </div>
                                            </td>
                                            <td>LKR {(Number(line.qty) * Number(line.unit_price)).toFixed(2)}</td>
                                            <td><button type="button" className="btn-icon" onClick={() => removeLine(line.id)}><Trash2 size={16} /></button></td>
                                        </tr>
                                    ))}
                                    {lines.length === 0 && (
                                        <tr><td colSpan="6" className="text-muted" style={{ textAlign: 'center' }}>No items added</td></tr>
                                    )}
                                </tbody>
                            </table>

                            <div style={{ textAlign: 'right', fontSize: '1.25rem', marginBottom: '2rem' }}>
                                <strong>Total: LKR {calculateTotal().toFixed(2)}</strong>
                            </div>

                            <div className="modal-actions">
                                <button type="button" className="btn-secondary" onClick={closeModal}>Cancel</button>
                                <button type="submit" className="btn-primary">
                                    {editingId ? 'Update Sale' : 'Post Sale (Update Stock)'}
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
                                Are you sure you want to delete invoice <strong>{deleteTarget.bill_no}</strong>?
                                <br /><span style={{ color: '#ef4444', fontSize: '0.9rem' }}>⚠ This will restore the FG stock quantities sold in this invoice.</span>
                            </p>
                            <div className="modal-actions">
                                <button className="btn-secondary" onClick={() => setDeleteTarget(null)}>Cancel</button>
                                <button className="btn-primary" onClick={handleDelete} style={{ background: '#ef4444' }}>
                                    Delete & Restore Stock
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {/* ── BILL DETAIL MODAL ── */}
            {viewTarget && (
                <div className="modal-backdrop">
                    <div className="modal-content" style={{ maxWidth: '650px' }}>
                        <div className="modal-header">
                            <div>
                                <h3>{viewTarget.bill_no}</h3>
                                <p style={{ margin: 0, fontSize: '0.85rem', color: '#64748b' }}>
                                    {format(new Date(viewTarget.date), 'MMM dd, yyyy')}&nbsp;|&nbsp;{viewTarget.customers?.name}
                                </p>
                            </div>
                            <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                                <button className="btn-icon" onClick={() => setViewTarget(null)}><X size={20} /></button>
                            </div>
                        </div>
                        <div className="modal-form">
                            <table className="data-table" style={{ marginBottom: '1rem' }}>
                                <thead>
                                    <tr>
                                        <th>#</th>
                                        <th>Batch No</th>
                                        <th>Product</th>
                                        <th>Packet Size</th>
                                        <th>Qty (Pkts)</th>
                                        <th>Unit Price</th>
                                        <th>Subtotal</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {(viewTarget.sales_lines || []).map((l, i) => (
                                        <tr key={l.id}>
                                            <td style={{ color: '#94a3b8' }}>{i + 1}</td>
                                            <td><strong>{l.production_headers?.batch_no || '—'}</strong></td>
                                            <td>{l.fg_items?.name}</td>
                                            <td>
                                                {l.production_lines?.qty_per_packet
                                                    ? formatPacketSize(l.production_lines.qty_per_packet)
                                                    : '—'}
                                            </td>
                                            <td>{Number(l.qty).toFixed(0)}</td>
                                            <td>LKR {Number(l.unit_price).toFixed(2)}</td>
                                            <td>LKR {Number(l.total_amount).toFixed(2)}</td>
                                        </tr>
                                    ))}
                                    {(viewTarget.sales_lines || []).length === 0 && (
                                        <tr><td colSpan="7" className="empty-state">No lines found.</td></tr>
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
            {/* ── PRINT ONLY INVOICE TEMPLATE ── */}
            {viewTarget && (
                <div className="print-invoice-container">

                    {/* --- HEADER --- */}
                    <div className="invoice-header">
                        <div className="invoice-top-left" style={{ fontWeight: 'bold' }}>
                            Invoice no <span style={{ marginLeft: '5px' }}>{viewTarget.bill_no}</span>
                        </div>
                        <div className="invoice-company-details">
                            <h1 style={{ fontSize: '32px', marginBottom: '10px' }}>Amrona</h1>
                            <h2>Spices Manufacturing, Distributing &<br />Exporting</h2>
                            <p>Bubula Road, Pasyala.</p>
                            <p>Tel +94 77 731 7550, +94 33 22 84129</p>
                            <p>Email - amrona@gmail.com</p>
                        </div>
                        <div className="invoice-top-right"></div>
                    </div>

                    <div style={{ fontSize: '13px', marginBottom: '15px' }}>
                        M/S <span className="mt-dotted" style={{ width: '90%' }}>{viewTarget.customers?.name || 'Cash Customer'}</span>
                    </div>

                    <div className="invoice-meta">
                        <div>
                            Order No - <span className="mt-dotted" style={{ width: '60px' }}></span>
                        </div>
                        <div>
                            Job No - <span className="mt-dotted" style={{ width: '60px' }}></span>
                        </div>
                        <div>
                            Date - {new Date(viewTarget.date).toLocaleDateString('en-GB')}
                        </div>
                    </div>

                    {/* --- TABLE --- */}
                    <table className="invoice-table">
                        <thead>
                            <tr>
                                <th style={{ width: '45px' }}>Qty</th>
                                <th>Particulars</th>
                                <th style={{ width: '80px' }}>Rate</th>
                                <th style={{ width: '100px' }}>Amount</th>
                            </tr>
                        </thead>
                        <tbody>
                            {/* Render up to 14 rows minimum to match physical book layout */}
                            {Array.from({ length: Math.max(14, (viewTarget.sales_lines || []).length) }).map((_, i) => {
                                const l = viewTarget.sales_lines?.[i];
                                return (
                                    <tr key={i}>
                                        <td className="center" style={{ fontWeight: 'bold' }}>{l ? Number(l.qty).toFixed(0) : ''}</td>
                                        <td>
                                            {l ? `${l.fg_items?.name} ${l.production_lines?.qty_per_packet ? formatPacketSize(l.production_lines.qty_per_packet) : ''}` : ''}
                                        </td>
                                        <td className="num">{l ? Number(l.unit_price).toFixed(2) : ''}</td>
                                        <td className="num">{l ? Number(l.total_amount).toFixed(2) : ''}</td>
                                    </tr>
                                )
                            })}
                            <tr>
                                <td colSpan="2" style={{ border: 'none' }}></td>
                                <td className="center" style={{ fontWeight: 'bold', fontSize: '14px', border: 'none' }}>Total</td>
                                <td className="num" style={{ fontWeight: 'bold', borderBottom: '3px double black' }}>
                                    {Number(viewTarget.total_amount).toFixed(2)}
                                </td>
                            </tr>
                        </tbody>
                    </table>

                    {/* --- FOOTER --- */}
                    <div className="invoice-footer-grid">
                        <div className="payment-box">
                            <div className="payment-row">
                                <div className="payment-cell">Cash</div>
                                <div className="payment-cell border-left"></div>
                            </div>
                            <div className="payment-row">
                                <div className="payment-cell">Credit</div>
                                <div className="payment-cell border-left"></div>
                            </div>
                        </div>
                        <div className="signature-box">
                            <div className="signature-line">Signature of Recipient</div>
                        </div>
                    </div>

                    <div className="invoice-banner">
                        Payment Should be made in favour of "AMRONA" only
                    </div>
                    <div className="invoice-reg">
                        Registered No-W/M/BNR/10243
                    </div>

                </div>
            )}

        </div>
    );
}
