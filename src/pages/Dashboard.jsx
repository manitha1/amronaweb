import React, { useEffect, useState } from 'react';
import { supabase } from '../supabase';
import { useNavigate } from 'react-router-dom';
import {
    Package, PackageSearch, ShoppingCart, Factory,
    TrendingUp, AlertTriangle, ChevronRight, ArrowUpRight
} from 'lucide-react';

export default function Dashboard() {
    const navigate = useNavigate();
    const [loading, setLoading] = useState(true);

    // Format gram value → "25g", "100g", "1kg" etc.
    const formatPacketSize = (val) => {
        const g = Number(val);
        if (!g) return val;
        return g >= 1000 ? `${g / 1000}kg` : `${g}g`;
    };

    // Summary numbers
    const [rawBalance, setRawBalance] = useState(0);
    const [fgBalance, setFgBalance] = useState(0);
    const [totalSales, setTotalSales] = useState(0);
    const [activeBatches, setActiveBatches] = useState(0);

    // Table data
    const [recentPurchases, setRecentPurchases] = useState([]);
    const [recentSales, setRecentSales] = useState([]);
    const [rawByItem, setRawByItem] = useState([]);
    const [fgByItem, setFgByItem] = useState([]);

    useEffect(() => { fetchAll(); }, []);

    const fetchAll = async () => {
        setLoading(true);
        try {
            await Promise.all([
                fetchStockSummary(),
                fetchRecentPurchases(),
                fetchRecentSales(),
                fetchRawByItem(),
                fetchFgByItem(),
            ]);
        } finally {
            setLoading(false);
        }
    };

    const fetchStockSummary = async () => {
        const now = new Date();
        const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 10);
        const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0).toISOString().slice(0, 10);

        const [{ data: rawView }, { data: fgView }, { data: sales }, { data: batches }] = await Promise.all([
            supabase.from('raw_stock_view').select('balance'),
            supabase.from('fg_stock_view').select('balance'),
            supabase.from('sales_headers').select('total_amount').gte('date', monthStart).lte('date', monthEnd),
            supabase.from('production_headers').select('batch_no'),
        ]);
        setRawBalance((rawView || []).reduce((s, r) => s + Number(r.balance || 0), 0));
        setFgBalance((fgView || []).reduce((s, r) => s + Number(r.balance || 0), 0));
        setTotalSales((sales || []).reduce((s, r) => s + Number(r.total_amount || 0), 0));
        setActiveBatches((batches || []).length);
    };

    const fetchRecentPurchases = async () => {
        const { data } = await supabase
            .from('purchase_headers')
            .select('purchase_no, date, total_amount, suppliers(name)')
            .order('date', { ascending: false })
            .limit(5);
        setRecentPurchases((data || []).map(p => ({ ...p, supplier_name: p.suppliers?.name })));
    };

    const fetchRecentSales = async () => {
        const { data } = await supabase
            .from('sales_headers')
            .select('bill_no, date, total_amount, customers(name)')
            .order('date', { ascending: false })
            .limit(5);
        setRecentSales((data || []).map(s => ({ ...s, customer_name: s.customers?.name })));
    };

    const fetchRawByItem = async () => {
        const [{ data: purchaseLines }, { data: consumptions }] = await Promise.all([
            supabase.from('purchase_lines').select('qty, raw_item_id, raw_items(name, uom)'),
            supabase.from('production_consumptions').select('raw_item_id, qty'),
        ]);
        const purchasedMap = {}, uomMap = {}, consumedMap = {};
        (purchaseLines || []).forEach(pl => {
            const id = pl.raw_item_id;
            purchasedMap[id] = (purchasedMap[id] || 0) + Number(pl.qty);
            uomMap[id] = { name: pl.raw_items?.name, uom: pl.raw_items?.uom };
        });
        (consumptions || []).forEach(c => {
            consumedMap[c.raw_item_id] = (consumedMap[c.raw_item_id] || 0) + Number(c.qty);
        });
        const rows = Object.keys(purchasedMap).map(id => ({
            name: uomMap[id]?.name || '—',
            uom: uomMap[id]?.uom || '',
            purchased: purchasedMap[id],
            consumed: consumedMap[id] || 0,
            balance: Math.max(0, purchasedMap[id] - (consumedMap[id] || 0)),
        })).sort((a, b) => a.name.localeCompare(b.name));
        setRawByItem(rows);
    };

    const fetchFgByItem = async () => {
        // Fetch production lines to get produced quantities per item & packet size
        const { data: prodLines } = await supabase
            .from('production_lines')
            .select('fg_item_id, total_qty, qty_per_packet, fg_items(name, uom)');

        // Fetch sales lines to get sold quantities per item & packet size
        const { data: salesLines } = await supabase
            .from('sales_lines')
            .select('fg_item_id, qty, production_line_id, fg_items(name, uom), production_lines(qty_per_packet)');

        // Map sales lines that have production_line_id back to their qty_per_packet
        // For old sales without production_line_id, we can't accurately split by size, so we ignore or lump into a generic bucket, but here we'll assume new data has production_line_id.
        // First build a lookup for prod_line_id -> qty_per_packet
        const prodLineMap = {};
        (prodLines || []).forEach(pl => {
            prodLineMap[pl.id] = pl.qty_per_packet;
        });

        const groupedMap = {}; // Key: "fg_item_id|qty_per_packet"

        // Aggregate Produced
        (prodLines || []).forEach(pl => {
            const key = `${pl.fg_item_id}|${pl.qty_per_packet}`;
            if (!groupedMap[key]) {
                groupedMap[key] = {
                    name: pl.fg_items?.name || '—',
                    uom: pl.fg_items?.uom || '',
                    size: pl.qty_per_packet,
                    produced: 0, sold: 0
                };
            }
            groupedMap[key].produced += Number(pl.total_qty);
        });

        // Aggregate Sold
        (salesLines || []).forEach(sl => {
            // Find size: prefer loaded production_lines, then prodLineMap, then fallback
            const size = sl.production_lines?.qty_per_packet
                || (sl.production_line_id ? prodLineMap[sl.production_line_id] : null)
                || 'Unknown';
            const key = `${sl.fg_item_id}|${size}`;
            if (!groupedMap[key]) {
                groupedMap[key] = {
                    name: sl.fg_items?.name || '(Item ID: ' + sl.fg_item_id + ')',
                    uom: sl.fg_items?.uom || '',
                    size: size,
                    produced: 0, sold: 0
                };
            }
            groupedMap[key].sold += Number(sl.qty);
        });

        // Convert map to array and compute balance
        const rows = Object.values(groupedMap).map(g => ({
            name: g.name,
            uom: g.uom,
            sizeRaw: g.size,
            sizeLabel: g.size === 'Unknown' ? 'Unknown' : formatPacketSize(g.size),
            produced: g.produced,
            sold: g.sold,
            balance: Math.max(0, g.produced - g.sold)
        })).sort((a, b) => {
            if (a.name === b.name) return Number(a.sizeRaw) - Number(b.sizeRaw);
            return a.name.localeCompare(b.name);
        });

        setFgByItem(rows);
    };

    const fmt = (n) => Number(n).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
    const fmtCur = (n) => 'Rs. ' + Number(n).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 });

    // Low stock items: balance < 20% of purchased
    const lowStockRaw = rawByItem.filter(r => {
        const pct = r.purchased > 0 ? (r.balance / r.purchased) * 100 : 0;
        return pct < 20;
    });

    if (loading) return (
        <div className="page-container">
            <div className="loading-state" style={{ padding: '5rem', fontSize: '1rem' }}>
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '1rem' }}>
                    <div style={{
                        width: 40, height: 40,
                        border: '3px solid #e2e8f0',
                        borderTopColor: 'var(--blue)',
                        borderRadius: '50%',
                        animation: 'spin 0.8s linear infinite'
                    }} />
                    <span>Loading dashboard...</span>
                    <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
                </div>
            </div>
        </div>
    );

    return (
        <div className="page-container">

            {/* ── PAGE TITLE ── */}
            <div className="page-header">
                <h2>Welcome Back 👋</h2>
                <p>Here's what's happening with Amrona today.</p>
            </div>

            {/* ── STAT CARDS ── */}
            <div className="dashboard-cards">
                <div className="stat-card green">
                    <div className="stat-card-icon"><Package size={52} /></div>
                    <div className="stat-card-label">Raw Materials Stock</div>
                    <div className="stat-card-value">
                        {fmt(rawBalance)}<span className="stat-card-unit">Kg</span>
                    </div>
                    <div className="stat-card-sub">Balance from stock ledger</div>
                </div>

                <div className="stat-card orange">
                    <div className="stat-card-icon"><Factory size={52} /></div>
                    <div className="stat-card-label">Production Batches</div>
                    <div className="stat-card-value">
                        {activeBatches}<span className="stat-card-unit">Batches</span>
                    </div>
                    <div className="stat-card-sub">Total production runs</div>
                </div>

                <div className="stat-card blue">
                    <div className="stat-card-icon"><PackageSearch size={52} /></div>
                    <div className="stat-card-label">Finished Goods Stock</div>
                    <div className="stat-card-value">
                        {fmt(fgBalance)}<span className="stat-card-unit">Pkts</span>
                    </div>
                    <div className="stat-card-sub">Balance from stock ledger</div>
                </div>

                <div className="stat-card red">
                    <div className="stat-card-icon"><TrendingUp size={52} /></div>
                    <div className="stat-card-label">Total Sales</div>
                    <div className="stat-card-value" style={{ fontSize: '1.75rem' }}>
                        {fmtCur(totalSales)}
                    </div>
                    <div className="stat-card-sub">This month's revenue</div>
                </div>
            </div>

            {/* ── ROW 2: Recent Purchases + Low Stock ── */}
            <div className="dash-grid-2">

                {/* Recent Purchases */}
                <div className="card">
                    <div className="card-header">
                        <div className="card-title">
                            <span style={{
                                background: '#dbeafe', color: 'var(--blue)',
                                width: 28, height: 28, borderRadius: 8,
                                display: 'flex', alignItems: 'center', justifyContent: 'center'
                            }}>
                                <ShoppingCart size={15} />
                            </span>
                            Recent Purchases
                        </div>
                        <button className="view-all-btn" onClick={() => navigate('/purchasing')}>
                            View All <ChevronRight size={14} />
                        </button>
                    </div>
                    <table className="data-table">
                        <thead>
                            <tr>
                                <th>PO #</th>
                                <th>Supplier</th>
                                <th>Date</th>
                                <th>Amount</th>
                            </tr>
                        </thead>
                        <tbody>
                            {recentPurchases.map((p, i) => (
                                <tr key={i}>
                                    <td><span className="purchase-po">{p.purchase_no}</span></td>
                                    <td className="purchase-supplier">{p.supplier_name}</td>
                                    <td style={{ color: 'var(--muted)', fontSize: '0.8rem' }}>
                                        {p.date ? new Date(p.date).toLocaleDateString('en-GB') : '—'}
                                    </td>
                                    <td className="purchase-amount">{fmtCur(p.total_amount)}</td>
                                </tr>
                            ))}
                            {recentPurchases.length === 0 && (
                                <tr><td colSpan={4} className="empty-state">No purchases yet.</td></tr>
                            )}
                        </tbody>
                    </table>
                </div>

                {/* Low Stock Alerts */}
                <div className="card">
                    <div className="card-header">
                        <div className="card-title">
                            <span style={{
                                background: '#fef3c7', color: 'var(--amber)',
                                width: 28, height: 28, borderRadius: 8,
                                display: 'flex', alignItems: 'center', justifyContent: 'center'
                            }}>
                                <AlertTriangle size={15} />
                            </span>
                            Low Stock Alerts
                        </div>
                        {lowStockRaw.length > 0 && (
                            <span className="status-badge red">{lowStockRaw.length} items</span>
                        )}
                    </div>
                    <div className="card-body">
                        {lowStockRaw.length === 0 ? (
                            <div style={{ textAlign: 'center', padding: '2rem 0', color: 'var(--muted)' }}>
                                <div style={{ fontSize: '2rem', marginBottom: '0.5rem' }}>✅</div>
                                <p style={{ fontSize: '0.875rem' }}>All stocks are healthy!</p>
                            </div>
                        ) : (
                            lowStockRaw.map((item, i) => {
                                const pct = item.purchased > 0 ? (item.balance / item.purchased) * 100 : 0;
                                const isCritical = pct < 10;
                                return (
                                    <div key={i} className="low-stock-item">
                                        <div>
                                            <div className="low-stock-name">{item.name}</div>
                                            <div className="low-stock-qty">Balance: {fmt(item.balance)} {item.uom}</div>
                                        </div>
                                        <span className={`status-badge ${isCritical ? 'red' : 'amber'}`}>
                                            {isCritical ? 'Critical' : 'Low'}
                                        </span>
                                    </div>
                                );
                            })
                        )}
                    </div>
                </div>
            </div>

            {/* ── ROW 3: Raw Stock Table ── */}
            <div className="card">
                <div className="card-header">
                    <div className="card-title">
                        <span style={{
                            background: '#dcfce7', color: '#16a34a',
                            width: 28, height: 28, borderRadius: 8,
                            display: 'flex', alignItems: 'center', justifyContent: 'center'
                        }}>
                            <Package size={15} />
                        </span>
                        Raw Material Stock Overview
                    </div>
                    <button className="view-all-btn" onClick={() => navigate('/raw-stock')}>
                        Full Report <ArrowUpRight size={14} />
                    </button>
                </div>
                <table className="data-table">
                    <thead>
                        <tr>
                            <th>Raw Item</th>
                            <th>Purchased</th>
                            <th>Consumed</th>
                            <th>Balance</th>
                        </tr>
                    </thead>
                    <tbody>
                        {rawByItem.map((r, i) => {
                            const pct = r.purchased > 0 ? (r.balance / r.purchased) * 100 : 0;
                            const isLow = pct < 20;
                            const isEmpty = r.balance <= 0;
                            const color = isEmpty ? '#ef4444' : isLow ? '#f59e0b' : '#22c55e';
                            return (
                                <tr key={i}>
                                    <td style={{ fontWeight: 600 }}>{r.name}</td>
                                    <td>{fmt(r.purchased)} {r.uom}</td>
                                    <td style={{ color: r.consumed > 0 ? '#ef4444' : 'var(--muted)' }}>
                                        {fmt(r.consumed)}
                                    </td>
                                    <td>
                                        <span style={{ fontWeight: 700, color }}>
                                            {fmt(r.balance)} {r.uom}
                                        </span>
                                    </td>
                                </tr>
                            );
                        })}
                        {rawByItem.length === 0 && (
                            <tr><td colSpan={4} className="empty-state">No raw material records.</td></tr>
                        )}
                    </tbody>
                </table>
            </div>

            {/* ── ROW 4: FG Stock Table ── */}
            <div className="card">
                <div className="card-header">
                    <div className="card-title">
                        <span style={{
                            background: '#dbeafe', color: 'var(--blue)',
                            width: 28, height: 28, borderRadius: 8,
                            display: 'flex', alignItems: 'center', justifyContent: 'center'
                        }}>
                            <PackageSearch size={15} />
                        </span>
                        Finished Goods Stock Overview
                    </div>
                    <button className="view-all-btn" onClick={() => navigate('/fg-stock')}>
                        Full Report <ArrowUpRight size={14} />
                    </button>
                </div>
                <table className="data-table">
                    <thead>
                        <tr>
                            <th>FG Item</th>
                            <th>Packet Size</th>
                            <th>Produced (Pkts)</th>
                            <th>Sold (Pkts)</th>
                            <th>Balance (Pkts)</th>
                        </tr>
                    </thead>
                    <tbody>
                        {fgByItem.map((f, i) => {
                            const pct = f.produced > 0 ? (f.balance / f.produced) * 100 : 0;
                            const isLow = pct < 20;
                            const isEmpty = f.balance <= 0;
                            const color = isEmpty ? '#ef4444' : isLow ? '#f59e0b' : '#22c55e';
                            return (
                                <tr key={i}>
                                    <td style={{ fontWeight: 600 }}>{f.name}</td>
                                    <td>{f.sizeLabel}</td>
                                    <td>{fmt(f.produced)}</td>
                                    <td style={{ color: f.sold > 0 ? '#ef4444' : 'var(--muted)' }}>
                                        {fmt(f.sold)}
                                    </td>
                                    <td>
                                        <span style={{ fontWeight: 700, color }}>
                                            {fmt(f.balance)}
                                        </span>
                                    </td>
                                </tr>
                            );
                        })}
                        {fgByItem.length === 0 && (
                            <tr><td colSpan={5} className="empty-state">No finished goods records.</td></tr>
                        )}
                    </tbody>
                </table>
            </div>

            {/* ── ROW 5: Recent Sales ── */}
            <div className="card">
                <div className="card-header">
                    <div className="card-title">
                        <span style={{
                            background: '#fce7f3', color: '#be185d',
                            width: 28, height: 28, borderRadius: 8,
                            display: 'flex', alignItems: 'center', justifyContent: 'center'
                        }}>
                            <TrendingUp size={15} />
                        </span>
                        Recent Sales
                    </div>
                    <button className="view-all-btn" onClick={() => navigate('/sales')}>
                        View All <ChevronRight size={14} />
                    </button>
                </div>
                <table className="data-table">
                    <thead>
                        <tr>
                            <th>Bill #</th>
                            <th>Customer</th>
                            <th>Date</th>
                            <th>Amount</th>
                        </tr>
                    </thead>
                    <tbody>
                        {recentSales.map((s, i) => (
                            <tr key={i}>
                                <td><span className="purchase-po">{s.bill_no}</span></td>
                                <td className="purchase-supplier">{s.customer_name}</td>
                                <td style={{ color: 'var(--muted)', fontSize: '0.8rem' }}>
                                    {s.date ? new Date(s.date).toLocaleDateString('en-GB') : '—'}
                                </td>
                                <td className="purchase-amount">{fmtCur(s.total_amount)}</td>
                            </tr>
                        ))}
                        {recentSales.length === 0 && (
                            <tr><td colSpan={4} className="empty-state">No sales yet.</td></tr>
                        )}
                    </tbody>
                </table>
            </div>

        </div>
    );
}
