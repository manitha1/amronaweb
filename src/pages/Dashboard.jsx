import React, { useEffect, useState } from 'react';
import { supabase } from '../supabase';
import { Package, PackageSearch } from 'lucide-react';

export default function Dashboard() {
    const [rawByPurchase, setRawByPurchase] = useState([]);
    const [fgByBatch, setFgByBatch] = useState([]);
    const [rawTotalBalance, setRawTotalBalance] = useState(0);
    const [fgTotalBalance, setFgTotalBalance] = useState(0);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        fetchAll();
    }, []);

    const fetchAll = async () => {
        setLoading(true);

        // ── SUMMARY TOTALS from stock ledger views (source of truth) ──────────
        const { data: rawView } = await supabase.from('raw_stock_view').select('balance');
        const { data: fgView } = await supabase.from('fg_stock_view').select('balance');
        setRawTotalBalance((rawView || []).reduce((s, r) => s + Number(r.balance || 0), 0));
        setFgTotalBalance((fgView || []).reduce((s, r) => s + Number(r.balance || 0), 0));

        // ── RAW STOCK PER PURCHASE ─────────────────────────────────────────────
        // *** FIX: include raw_item_id in the select so consumed map key works ***
        const { data: purchaseLines } = await supabase
            .from('purchase_lines')
            .select('qty, purchase_header_id, raw_item_id, purchase_headers(purchase_no, date), raw_items(name, uom)')
            .order('purchase_header_id');

        // Total consumed per purchase_header_id + raw_item_id from production_consumptions
        const { data: consumptions } = await supabase
            .from('production_consumptions')
            .select('purchase_no, raw_item_id, qty'); // purchase_no column = purchase_headers UUID

        // Build consumed map  key = "purchaseHeaderId|rawItemId"
        const consumedMap = {};
        (consumptions || []).forEach(c => {
            const key = `${c.purchase_no}|${c.raw_item_id}`;
            consumedMap[key] = (consumedMap[key] || 0) + Number(c.qty);
        });

        // Group by purchase header UUID
        const purchaseGroups = {};
        (purchaseLines || []).forEach(pl => {
            const pid = pl.purchase_header_id;
            const pno = pl.purchase_headers?.purchase_no || '—';
            if (!purchaseGroups[pid]) {
                purchaseGroups[pid] = { purchase_no: pno, date: pl.purchase_headers?.date, lines: [] };
            }
            const consumed = consumedMap[`${pid}|${pl.raw_item_id}`] || 0;
            purchaseGroups[pid].lines.push({
                item: pl.raw_items?.name,
                uom: pl.raw_items?.uom,
                purchased: Number(pl.qty),
                consumed,
                remaining: Math.max(0, Number(pl.qty) - consumed),
            });
        });

        setRawByPurchase(Object.values(purchaseGroups));

        // ── FG STOCK PER BATCH ─────────────────────────────────────────────────
        const { data: batches } = await supabase
            .from('production_headers')
            .select('id, batch_no, date, total_qty, fg_items(name, uom)')
            .order('date', { ascending: false });

        // Sum qty_out from stock_ledger_fg for SALES per fg_item
        // Use sales_lines (direct) — supports both old + new schema
        const { data: salesLines } = await supabase
            .from('sales_lines')
            .select('fg_item_id, qty, production_header_id');

        // Sold per batch (if production_header_id exists) + global sold per fg_item
        const soldByBatch = {};
        const soldByFgItem = {};
        (salesLines || []).forEach(sl => {
            if (sl.production_header_id) {
                soldByBatch[sl.production_header_id] = (soldByBatch[sl.production_header_id] || 0) + Number(sl.qty);
            } else {
                // Old records without batch tracking: attribute globally to fg_item
                soldByFgItem[sl.fg_item_id] = (soldByFgItem[sl.fg_item_id] || 0) + Number(sl.qty);
            }
        });

        const fgData = (batches || []).map(b => {
            const produced = Number(b.total_qty);
            const soldDirect = soldByBatch[b.id] || 0;
            const soldGlobal = soldByFgItem[b.fg_item_id] || 0; // only for old records
            const sold = soldDirect + soldGlobal;
            const remaining = Math.max(0, produced - sold);
            return { batch_no: b.batch_no, date: b.date, product: b.fg_items?.name, uom: b.fg_items?.uom, produced, sold, remaining };
        });

        setFgByBatch(fgData);
        setLoading(false);
    };

    if (loading) return <div className="page-container"><div className="loading-state">Loading dashboard...</div></div>;

    return (
        <div className="page-container">
            <div className="page-header">
                <h2>Dashboard Overview</h2>
                <p>Live inventory by purchase and batch</p>
            </div>

            {/* ── SUMMARY CARDS (from stock ledger — source of truth) ── */}
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

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1.5rem' }}>

                {/* ── RAW STOCK BY PURCHASE ── */}
                <div>
                    <h3 style={{ marginBottom: '0.75rem', display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <Package size={18} style={{ color: '#3b82f6' }} /> Raw Material Stock by Purchase
                    </h3>
                    <div className="table-card" style={{ padding: 0 }}>
                        <table className="data-table">
                            <thead>
                                <tr>
                                    <th>Purchase No</th>
                                    <th>Raw Item</th>
                                    <th>Purchased</th>
                                    <th>Used</th>
                                    <th>Remaining</th>
                                </tr>
                            </thead>
                            <tbody>
                                {rawByPurchase.map(pg =>
                                    pg.lines.map((line, i) => {
                                        const isLow = line.remaining > 0 && line.remaining < (line.purchased * 0.2);
                                        return (
                                            <tr key={`${pg.purchase_no}-${i}`}>
                                                {i === 0 && (
                                                    <td rowSpan={pg.lines.length} style={{ fontWeight: 700, verticalAlign: 'top', paddingTop: '12px', color: '#3b82f6' }}>
                                                        {pg.purchase_no}
                                                    </td>
                                                )}
                                                <td>{line.item}</td>
                                                <td>{line.purchased.toFixed(2)} {line.uom}</td>
                                                <td style={{ color: line.consumed > 0 ? '#dc2626' : '#64748b' }}>
                                                    {line.consumed.toFixed(2)}
                                                </td>
                                                <td>
                                                    <span style={{
                                                        fontWeight: 700,
                                                        color: line.remaining <= 0 ? '#dc2626' : isLow ? '#ca8a04' : '#16a34a'
                                                    }}>
                                                        {line.remaining.toFixed(2)} {line.uom}
                                                    </span>
                                                </td>
                                            </tr>
                                        );
                                    })
                                )}
                                {rawByPurchase.length === 0 && (
                                    <tr><td colSpan="5" className="empty-state">No purchase records.</td></tr>
                                )}
                            </tbody>
                        </table>
                    </div>
                </div>

                {/* ── FG STOCK BY BATCH ── */}
                <div>
                    <h3 style={{ marginBottom: '0.75rem', display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <PackageSearch size={18} style={{ color: '#22c55e' }} /> Finished Goods Stock by Batch
                    </h3>
                    <div className="table-card" style={{ padding: 0 }}>
                        <table className="data-table">
                            <thead>
                                <tr>
                                    <th>Batch No</th>
                                    <th>Product</th>
                                    <th>Produced</th>
                                    <th>Sold</th>
                                    <th>Remaining</th>
                                </tr>
                            </thead>
                            <tbody>
                                {fgByBatch.map((b, i) => {
                                    const isLow = b.remaining > 0 && b.remaining < (b.produced * 0.2);
                                    return (
                                        <tr key={i}>
                                            <td style={{ fontWeight: 700, color: '#3b82f6' }}>{b.batch_no}</td>
                                            <td>{b.product}</td>
                                            <td>{b.produced} pkts</td>
                                            <td style={{ color: b.sold > 0 ? '#dc2626' : '#64748b' }}>{b.sold}</td>
                                            <td>
                                                <span style={{
                                                    fontWeight: 700,
                                                    color: b.remaining <= 0 ? '#dc2626' : isLow ? '#ca8a04' : '#16a34a'
                                                }}>
                                                    {b.remaining} pkts
                                                </span>
                                            </td>
                                        </tr>
                                    );
                                })}
                                {fgByBatch.length === 0 && (
                                    <tr><td colSpan="5" className="empty-state">No production batches.</td></tr>
                                )}
                            </tbody>
                        </table>
                    </div>
                </div>

            </div>
        </div>
    );
}
