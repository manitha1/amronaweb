import React, { useEffect, useState } from 'react';
import { supabase } from '../supabase';
import { Package, RefreshCw } from 'lucide-react';

export default function RawStockReport() {
    const [rawByPurchase, setRawByPurchase] = useState([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        fetchData();
    }, []);

    const fetchData = async () => {
        setLoading(true);

        const { data: purchaseLines } = await supabase
            .from('purchase_lines')
            .select('qty, purchase_header_id, raw_item_id, purchase_headers(purchase_no, date), raw_items(name, uom)')
            .order('purchase_header_id');

        const { data: consumptions } = await supabase
            .from('production_consumptions')
            .select('purchase_no, raw_item_id, qty');

        // Also fetch raw item sales lines so sold qty is subtracted from stock
        const { data: rawSalesLines } = await supabase
            .from('sales_lines')
            .select('raw_item_id, qty, packet_size')
            .eq('item_type', 'raw');

        // Build consumed map: key = "purchaseHeaderId|rawItemId" for production
        const consumedMap = {};
        (consumptions || []).forEach(c => {
            const key = `${c.purchase_no}|${c.raw_item_id}`;
            consumedMap[key] = (consumedMap[key] || 0) + Number(c.qty);
        });

        // Build map of total raw sales by raw_item_id (global, not per purchase)
        const soldByItem = {};
        (rawSalesLines || []).forEach(s => {
            if (!s.raw_item_id) return;
            // packet_size is already in native UOM; qty*packet_size = total deducted, or just qty for bulk
            const deducted = s.packet_size ? Number(s.qty) * Number(s.packet_size) : Number(s.qty);
            soldByItem[s.raw_item_id] = (soldByItem[s.raw_item_id] || 0) + deducted;
        });

        // Group by purchase header
        const purchaseGroups = {};
        (purchaseLines || []).forEach(pl => {
            const pid = pl.purchase_header_id;
            const pno = pl.purchase_headers?.purchase_no || '—';
            const pdate = pl.purchase_headers?.date;
            if (!purchaseGroups[pid]) {
                purchaseGroups[pid] = { purchase_no: pno, date: pdate, lines: [] };
            }
            const consumed = consumedMap[`${pid}|${pl.raw_item_id}`] || 0;
            // Distribute raw sales proportionally across purchase lines for the same item
            const soldTotal = soldByItem[pl.raw_item_id] || 0;
            // Calculate this line's share of sales: proportional to its purchased qty vs total purchased
            const totalPurchasedForItem = (purchaseLines || []).filter(p => p.raw_item_id === pl.raw_item_id).reduce((sum, p) => sum + Number(p.qty), 0);
            const soldShare = totalPurchasedForItem > 0 ? soldTotal * (Number(pl.qty) / totalPurchasedForItem) : 0;
            const totalOut = consumed + soldShare;
            purchaseGroups[pid].lines.push({
                item: pl.raw_items?.name,
                uom: pl.raw_items?.uom,
                purchased: Number(pl.qty),
                consumed: totalOut,
                remaining: Math.max(0, Number(pl.qty) - totalOut),
            });
        });

        setRawByPurchase(Object.values(purchaseGroups));
        setLoading(false);
    };

    return (
        <div className="page-container">
            <div className="page-header-row">
                <div>
                    <h2>Raw Stock</h2>
                    <p>Live stock status per purchase order</p>
                </div>
                <button className="btn-secondary" onClick={fetchData} style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <RefreshCw size={16} /> Refresh
                </button>
            </div>

            <div className="table-card">
                {loading ? (
                    <div className="loading-state">Loading...</div>
                ) : (
                    <table className="data-table">
                        <thead>
                            <tr>
                                <th>Purchase No</th>
                                <th>Raw Item</th>
                                <th>Purchased</th>
                                <th>Used</th>
                                <th>Remaining</th>
                                <th>Status</th>
                            </tr>
                        </thead>
                        <tbody>
                            {rawByPurchase.map(pg =>
                                pg.lines.map((line, i) => {
                                    const pct = line.purchased > 0 ? (line.remaining / line.purchased) * 100 : 0;
                                    const isLow = line.remaining > 0 && pct < 20;
                                    const isEmpty = line.remaining <= 0;
                                    const statusLabel = isEmpty ? 'Empty' : isLow ? 'Low' : 'Good';
                                    const statusColor = isEmpty ? '#dc2626' : isLow ? '#ca8a04' : '#16a34a';
                                    const statusBg = isEmpty ? '#fee2e2' : isLow ? '#fef9c3' : '#dcfce7';

                                    return (
                                        <tr key={`${pg.purchase_no}-${i}`}>
                                            {i === 0 && (
                                                <td
                                                    rowSpan={pg.lines.length}
                                                    style={{ fontWeight: 700, verticalAlign: 'top', paddingTop: '14px', color: '#3b82f6' }}
                                                >
                                                    {pg.purchase_no}
                                                </td>
                                            )}
                                            <td>{line.item}</td>
                                            <td>{line.purchased.toFixed(2)} {line.uom}</td>
                                            <td style={{ color: line.consumed > 0 ? '#dc2626' : '#64748b' }}>
                                                {line.consumed.toFixed(2)}
                                            </td>
                                            <td>
                                                <span style={{ fontWeight: 700, color: isEmpty ? '#dc2626' : isLow ? '#ca8a04' : '#16a34a' }}>
                                                    {line.remaining.toFixed(2)} {line.uom}
                                                </span>
                                            </td>
                                            <td>
                                                <span style={{
                                                    display: 'inline-block',
                                                    padding: '2px 10px',
                                                    borderRadius: '9999px',
                                                    fontSize: '0.75rem',
                                                    fontWeight: 600,
                                                    background: statusBg,
                                                    color: statusColor,
                                                }}>
                                                    {statusLabel}
                                                </span>
                                            </td>
                                        </tr>
                                    );
                                })
                            )}
                            {rawByPurchase.length === 0 && (
                                <tr><td colSpan="6" className="empty-state">No purchase records found.</td></tr>
                            )}
                        </tbody>
                    </table>
                )}
            </div>
        </div>
    );
}
