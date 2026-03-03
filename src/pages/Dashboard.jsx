import React, { useEffect, useState } from 'react';
import { supabase } from '../supabase';
import { Package, PackageSearch, TrendingUp } from 'lucide-react';

export default function Dashboard() {
    const [rawTotal, setRawTotal] = useState(0);
    const [fgTotal, setFgTotal] = useState(0);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        async function fetchStats() {
            try {
                // Fetch sums from stock views
                const { data: rawData, error: rawError } = await supabase.from('raw_stock_view').select('balance');
                if (rawError) throw rawError;

                const { data: fgData, error: fgError } = await supabase.from('fg_stock_view').select('balance');
                if (fgError) throw fgError;

                const rTotal = rawData.reduce((acc, curr) => acc + Number(curr.balance || 0), 0);
                const fTotal = fgData.reduce((acc, curr) => acc + Number(curr.balance || 0), 0);

                setRawTotal(rTotal);
                setFgTotal(fTotal);
            } catch (err) {
                console.error('Error fetching dashboard stats:', err);
            } finally {
                setLoading(false);
            }
        }

        fetchStats();
    }, []);

    return (
        <div className="dashboard">
            <div className="page-header">
                <h2>Dashboard Overview</h2>
                <p>Live inventory statistics</p>
            </div>

            <div className="dashboard-cards">
                <div className="stat-card">
                    <div className="stat-icon raw"><Package size={24} /></div>
                    <div className="stat-content">
                        <h3>Raw Material Stock</h3>
                        <div className="stat-value">{loading ? '...' : rawTotal.toLocaleString()} <span className="stat-unit">Units</span></div>
                        <p className="stat-desc">Total balance from ledger</p>
                    </div>
                </div>

                <div className="stat-card">
                    <div className="stat-icon fg"><PackageSearch size={24} /></div>
                    <div className="stat-content">
                        <h3>Finished Goods Stock</h3>
                        <div className="stat-value">{loading ? '...' : fgTotal.toLocaleString()} <span className="stat-unit">Units</span></div>
                        <p className="stat-desc">Total balance from ledger</p>
                    </div>
                </div>
            </div>
        </div>
    );
}
