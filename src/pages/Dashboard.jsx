import React, { useEffect, useState } from 'react';
import { supabase } from '../supabase';
import { Package, PackageSearch } from 'lucide-react';

export default function Dashboard() {
    const [rawTotalBalance, setRawTotalBalance] = useState(0);
    const [fgTotalBalance, setFgTotalBalance] = useState(0);
    const [rawByItem, setRawByItem] = useState([]);
    const [fgByItem, setFgByItem] = useState([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        fetchAll();
    }, []);

    const fetchAll = async () => {
        setLoading(true);

        // ── SUMMARY TOTALS ───────────────────────────────────────────────────
        const { data: rawView } = await supabase.from('raw_stock_view').select('balance');
        const { data: fgView } = await supabase.from('fg_stock_view').select('balance');
        setRawTotalBalance((rawView || []).reduce((s, r) => s + Number(r.balance || 0), 0));
        setFgTotalBalance((fgView || []).reduce((s, r) => s + Number(r.balance || 0), 0));

        // ── RAW STOCK BY ITEM NAME ───────────────────────────────────────────
        const { data: purchaseLines } = await supabase
            .from('purchase_lines')
            .select('qty, raw_item_id, raw_items(name, uom)');

        const { data: consumptions } = await supabase
            .from('production_consumptions')
            .select('raw_item_id, qty');

        // Total purchased per raw item
        const purchasedMap = {};
        const uomMap = {};
        (purchaseLines || []).forEach(pl => {
            const id = pl.raw_item_id;
            purchasedMap[id] = (purchasedMap[id] || 0) + Number(pl.qty);
            uomMap[id] = { name: pl.raw_items?.name, uom: pl.raw_items?.uom };
        });

        // Total consumed per raw item
        const consumedMap = {};
        (consumptions || []).forEach(c => {
            consumedMap[c.raw_item_id] = (consumedMap[c.raw_item_id] || 0) + Number(c.qty);
        });

        const rawData = Object.keys(purchasedMap).map(id => {
            const purchased = purchasedMap[id];
            const consumed = consumedMap[id] || 0;
            return {
                name: uomMap[id]?.name || '—',
                uom: uomMap[id]?.uom || '',
                purchased,
                consumed,
                balance: Math.max(0, purchased - consumed),
            };
        }).sort((a, b) => a.name.localeCompare(b.name));

        setRawByItem(rawData);

        // ── FG STOCK BY ITEM NAME ────────────────────────────────────────────
        const { data: prodHeaders } = await supabase
            .from('production_headers')
            .select('fg_item_id, total_qty, fg_items(name, uom)');

        const { data: salesLines } = await supabase
            .from('sales_lines')
            .select('fg_item_id, qty');

        // Total produced per fg item
        const producedMap = {};
        const fgUomMap = {};
        (prodHeaders || []).forEach(ph => {
            const id = ph.fg_item_id;
            producedMap[id] = (producedMap[id] || 0) + Number(ph.total_qty);
            fgUomMap[id] = { name: ph.fg_items?.name, uom: ph.fg_items?.uom };
        });

        // Total sold per fg item
        const soldMap = {};
        (salesLines || []).forEach(sl => {
            soldMap[sl.fg_item_id] = (soldMap[sl.fg_item_id] || 0) + Number(sl.qty);
        });

        const fgData = Object.keys(producedMap).map(id => {
            const produced = producedMap[id];
            const sold = soldMap[id] || 0;
            return {
                name: fgUomMap[id]?.name || '—',
                uom: fgUomMap[id]?.uom || '',
                produced,
                sold,
                balance: Math.max(0, produced - sold),
            };
        }).sort((a, b) => a.name.localeCompare(b.name));

        setFgByItem(fgData);
        setLoading(false);
    };

    if (loading) return <div className="page-container"><div className="loading-state">Loading dashboard...</div></div>;

    return (
        <div className="page-container">
            <div className="page-header">
                <h2>Dashboard Overview</h2>
                <p>Live inventory summary</p>
            </div>

            {/* ── SUMMARY CARDS ── */}
            <div className="dashboard-cards" style={{ marginBottom: '2rem' }}>
                <div className="stat-card">
                    <div className="stat-icon raw"><Package size={24} /></div>
                    <div className="stat-content">
                        <h3>Raw Material Stock</h3>
                        <div className="stat-value">
                            {rawTotalBalance.toFixed(2)} <span className="stat-unit">Kg</span>
                        </div>
                        <p className="stat-desc">Balance from stock ledger</p>
                    </div>
                </div>
                <div className="stat-card">
                    <div className="stat-icon fg"><PackageSearch size={24} /></div>
                    <div className="stat-content">
                        <h3>Finished Goods Stock</h3>
                        <div className="stat-value">
                            {fgTotalBalance.toFixed(0)} <span className="stat-unit">Pkts</span>
                        </div>
                        <p className="stat-desc">Balance from stock ledger</p>
                    </div>
                </div>
            </div>

            {/* ── STOCK TABLES ── */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1.5rem' }}>

                {/* Raw Items */}
                <div>
                    <h3 style={{ marginBottom: '0.75rem', display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <Package size={18} style={{ color: '#3b82f6' }} /> Raw Material Stock
                    </h3>
                    <div className="table-card" style={{ padding: 0 }}>
                        <table className="data-table">
                            <thead>
                                <tr>
                                    <th>Raw Item</th>
                                    <th>Purchased</th>
                                    <th>Used</th>
                                    <th>Balance</th>
                                </tr>
                            </thead>
                            <tbody>
                                {rawByItem.map((r, i) => {
                                    const pct = r.purchased > 0 ? (r.balance / r.purchased) * 100 : 0;
                                    const isLow = r.balance > 0 && pct < 20;
                                    const isEmpty = r.balance <= 0;
                                    return (
                                        <tr key={i}>
                                            <td style={{ fontWeight: 600 }}>{r.name}</td>
                                            <td>{r.purchased.toFixed(2)} {r.uom}</td>
                                            <td style={{ color: r.consumed > 0 ? '#dc2626' : '#64748b' }}>
                                                {r.consumed.toFixed(2)}
                                            </td>
                                            <td>
                                                <span style={{
                                                    fontWeight: 700,
                                                    color: isEmpty ? '#dc2626' : isLow ? '#ca8a04' : '#16a34a'
                                                }}>
                                                    {r.balance.toFixed(2)} {r.uom}
                                                </span>
                                            </td>
                                        </tr>
                                    );
                                })}
                                {rawByItem.length === 0 && (
                                    <tr><td colSpan="4" className="empty-state">No raw material records.</td></tr>
                                )}
                            </tbody>
                        </table>
                    </div>
                </div>

                {/* FG Items */}
                <div>
                    <h3 style={{ marginBottom: '0.75rem', display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <PackageSearch size={18} style={{ color: '#22c55e' }} /> Finished Goods Stock
                    </h3>
                    <div className="table-card" style={{ padding: 0 }}>
                        <table className="data-table">
                            <thead>
                                <tr>
                                    <th>FG Item</th>
                                    <th>Produced</th>
                                    <th>Sold</th>
                                    <th>Balance</th>
                                </tr>
                            </thead>
                            <tbody>
                                {fgByItem.map((f, i) => {
                                    const pct = f.produced > 0 ? (f.balance / f.produced) * 100 : 0;
                                    const isLow = f.balance > 0 && pct < 20;
                                    const isEmpty = f.balance <= 0;
                                    return (
                                        <tr key={i}>
                                            <td style={{ fontWeight: 600 }}>{f.name}</td>
                                            <td>{f.produced} pkts</td>
                                            <td style={{ color: f.sold > 0 ? '#dc2626' : '#64748b' }}>{f.sold}</td>
                                            <td>
                                                <span style={{
                                                    fontWeight: 700,
                                                    color: isEmpty ? '#dc2626' : isLow ? '#ca8a04' : '#16a34a'
                                                }}>
                                                    {f.balance} pkts
                                                </span>
                                            </td>
                                        </tr>
                                    );
                                })}
                                {fgByItem.length === 0 && (
                                    <tr><td colSpan="4" className="empty-state">No finished goods records.</td></tr>
                                )}
                            </tbody>
                        </table>
                    </div>
                </div>

            </div>
        </div>
    );
}

