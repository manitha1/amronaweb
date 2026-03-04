import React, { useEffect, useState } from 'react';
import { supabase } from '../supabase';
import { PackageSearch, RefreshCw } from 'lucide-react';

export default function FgStockReport() {
    const [fgByBatch, setFgByBatch] = useState([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        fetchData();
    }, []);

    const fetchData = async () => {
        setLoading(true);

        const { data: batches } = await supabase
            .from('production_headers')
            .select('id, batch_no, date, total_qty, fg_item_id, fg_items(name, uom)')
            .order('date', { ascending: false });

        const { data: salesLines } = await supabase
            .from('sales_lines')
            .select('fg_item_id, qty, production_header_id');

        // Sold per batch
        const soldByBatch = {};
        const soldByFgItem = {};
        (salesLines || []).forEach(sl => {
            if (sl.production_header_id) {
                soldByBatch[sl.production_header_id] = (soldByBatch[sl.production_header_id] || 0) + Number(sl.qty);
            } else {
                soldByFgItem[sl.fg_item_id] = (soldByFgItem[sl.fg_item_id] || 0) + Number(sl.qty);
            }
        });

        const fgData = (batches || []).map(b => {
            const produced = Number(b.total_qty);
            const soldDirect = soldByBatch[b.id] || 0;
            const soldGlobal = soldByFgItem[b.fg_item_id] || 0;
            const sold = soldDirect + soldGlobal;
            const remaining = Math.max(0, produced - sold);
            return {
                batch_no: b.batch_no,
                date: b.date,
                product: b.fg_items?.name,
                uom: b.fg_items?.uom,
                produced,
                sold,
                remaining,
            };
        });

        setFgByBatch(fgData);
        setLoading(false);
    };

    return (
        <div className="page-container">
            <div className="page-header-row">
                <div>
                    <h2>Finished Goods Stock by Batch</h2>
                    <p>Live stock status per production batch</p>
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
                                <th>Batch No</th>
                                <th>Product</th>
                                <th>Produced</th>
                                <th>Sold</th>
                                <th>Remaining</th>
                                <th>Status</th>
                            </tr>
                        </thead>
                        <tbody>
                            {fgByBatch.map((b, i) => {
                                const pct = b.produced > 0 ? (b.remaining / b.produced) * 100 : 0;
                                const isLow = b.remaining > 0 && pct < 20;
                                const isEmpty = b.remaining <= 0;
                                const statusLabel = isEmpty ? 'Sold Out' : isLow ? 'Low' : 'Good';
                                const statusColor = isEmpty ? '#dc2626' : isLow ? '#ca8a04' : '#16a34a';
                                const statusBg = isEmpty ? '#fee2e2' : isLow ? '#fef9c3' : '#dcfce7';

                                return (
                                    <tr key={i}>
                                        <td style={{ fontWeight: 700, color: '#3b82f6' }}>{b.batch_no}</td>
                                        <td>{b.product}</td>
                                        <td>{b.produced} pkts</td>
                                        <td style={{ color: b.sold > 0 ? '#dc2626' : '#64748b' }}>{b.sold}</td>
                                        <td>
                                            <span style={{ fontWeight: 700, color: isEmpty ? '#dc2626' : isLow ? '#ca8a04' : '#16a34a' }}>
                                                {b.remaining} pkts
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
                            })}
                            {fgByBatch.length === 0 && (
                                <tr><td colSpan="6" className="empty-state">No production batches found.</td></tr>
                            )}
                        </tbody>
                    </table>
                )}
            </div>
        </div>
    );
}
