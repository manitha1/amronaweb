import React, { useEffect, useState } from "react";
import { supabase } from "../supabase";
import { useNavigate } from "react-router-dom";
import {
  Package,
  PackageSearch,
  ShoppingCart,
  Factory,
  TrendingUp,
  AlertTriangle,
  ChevronRight,
  ChevronDown,
  ChevronUp,
  ArrowUpRight,
  Printer,
} from "lucide-react";

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

  // New Summary numbers
  const [rawStockValue, setRawStockValue] = useState(0);
  const [currentMonthConsumedValue, setCurrentMonthConsumedValue] = useState(0);

  // Table data
  const [rawByItem, setRawByItem] = useState([]);
  const [fgByItem, setFgByItem] = useState([]);

  // Print State
  const [printingRawStock, setPrintingRawStock] = useState(false);

  // Toggle States for Tables
  const [showRawStock, setShowRawStock] = useState(true);
  const [showFgStock, setShowFgStock] = useState(true);

  useEffect(() => {
    fetchAll();
  }, []);

  const fetchAll = async () => {
    setLoading(true);
    try {
      await Promise.all([
        fetchStockSummary(),
        fetchRawByItem(),
        fetchFgByItem(),
      ]);
    } finally {
      setLoading(false);
    }
  };

  const fetchStockSummary = async () => {
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1)
      .toISOString()
      .slice(0, 10);
    const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0)
      .toISOString()
      .slice(0, 10);

    const currentMonth = now.getMonth();
    const currentYear = now.getFullYear();

    const [
      { data: rawView },
      { data: fgView },
      { data: sales },
      { data: batches },
      { data: purchaseLines },
      { data: consumptions }
    ] = await Promise.all([
      supabase.from("raw_stock_view").select("balance"),
      supabase.from("fg_stock_view").select("balance, packet_size"),
      supabase
        .from("sales_headers")
        .select("total_amount")
        .gte("date", monthStart)
        .lte("date", monthEnd),
      supabase.from("production_headers").select("batch_no"),
      supabase.from("purchase_lines").select("purchase_header_id, raw_item_id, qty, unit_cost"),
      supabase.from("production_consumptions").select("purchase_no, raw_item_id, qty, production_headers!inner(date)")
    ]);
    setRawBalance(
      (rawView || []).reduce((s, r) => s + Number(r.balance || 0), 0),
    );
    setFgBalance(
      (fgView || []).reduce(
        (s, r) => s + Number(r.balance || 0) * Number(r.packet_size || 1),
        0,
      ),
    );
    setTotalSales(
      (sales || []).reduce((s, r) => s + Number(r.total_amount || 0), 0),
    );
    setActiveBatches((batches || []).length);

    let stockVal = 0;
    let consumedVal = 0;
    const consumedMap = {};

    for (const c of consumptions || []) {
      const key = c.purchase_no + "_" + c.raw_item_id;
      consumedMap[key] = (consumedMap[key] || 0) + Number(c.qty);

      // Check if consumed in current month
      if (c.production_headers && c.production_headers.date) {
        const prodDate = new Date(c.production_headers.date);
        if (prodDate.getMonth() === currentMonth && prodDate.getFullYear() === currentYear) {
          const pl = (purchaseLines || []).find(
            (p) => p.purchase_header_id === c.purchase_no && p.raw_item_id === c.raw_item_id
          );
          if (pl) {
            consumedVal += (Number(c.qty) * Number(pl.unit_cost));
          }
        }
      }
    }

    for (const pl of purchaseLines || []) {
      const key = pl.purchase_header_id + "_" + pl.raw_item_id;
      const consumed = consumedMap[key] || 0;
      const remaining = Number(pl.qty) - consumed;
      if (remaining > 0) {
        stockVal += (remaining * Number(pl.unit_cost));
      }
    }

    setRawStockValue(stockVal);
    setCurrentMonthConsumedValue(consumedVal);
  };

  const fetchRawByItem = async () => {
    const [{ data: purchaseLines }, { data: consumptions }] = await Promise.all(
      [
        supabase
          .from("purchase_lines")
          .select("qty, raw_item_id, raw_items(name, uom)"),
        supabase.from("production_consumptions").select("raw_item_id, qty"),
      ],
    );
    const purchasedMap = {},
      uomMap = {},
      consumedMap = {};
    (purchaseLines || []).forEach((pl) => {
      const id = pl.raw_item_id;
      purchasedMap[id] = (purchasedMap[id] || 0) + Number(pl.qty);
      uomMap[id] = { name: pl.raw_items?.name, uom: pl.raw_items?.uom };
    });
    (consumptions || []).forEach((c) => {
      consumedMap[c.raw_item_id] =
        (consumedMap[c.raw_item_id] || 0) + Number(c.qty);
    });
    const rows = Object.keys(purchasedMap)
      .map((id) => ({
        name: uomMap[id]?.name || "—",
        uom: uomMap[id]?.uom || "",
        purchased: purchasedMap[id],
        consumed: consumedMap[id] || 0,
        balance: Math.max(0, purchasedMap[id] - (consumedMap[id] || 0)),
      }))
      .sort((a, b) => a.name.localeCompare(b.name));
    setRawByItem(rows);
  };

  const fetchFgByItem = async () => {
    const { data: stockView } = await supabase
      .from("fg_stock_view")
      .select(
        "fg_item_id, fg_item_name, packet_size, total_in, total_out, balance",
      );

    // Fetch UOMs separately since they are in fg_items
    const { data: fgItems } = await supabase.from("fg_items").select("id, uom");
    const uomMap = {};
    (fgItems || []).forEach((item) => {
      uomMap[item.id] = item.uom;
    });

    const rows = (stockView || [])
      .filter((row) => Number(row.total_in) > 0)
      .map((row) => {
        const isPacket = !!row.packet_size;
        return {
          name: row.fg_item_name || "(Unknown)",
          variant: isPacket
            ? `${formatPacketSize(row.packet_size)} pkts`
            : "Bulk",
          isPacket,
          uom: uomMap[row.fg_item_id] || "",
          produced: Number(row.total_in),
          sold: Number(row.total_out),
          balance: Number(row.balance),
        };
      })
      .sort((a, b) => a.name.localeCompare(b.name));

    setFgByItem(rows);
  };

  const fmt = (n) =>
    Number(n).toLocaleString("en-US", {
      minimumFractionDigits: 0,
      maximumFractionDigits: 2,
    });
  const fmtCur = (n) =>
    "Rs. " +
    Number(n).toLocaleString("en-US", {
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    });

  const handleRawStockPrint = () => {
    setPrintingRawStock(true);
    setTimeout(() => {
      window.print();
    }, 300);
  };

  useEffect(() => {
    const afterPrint = () => setPrintingRawStock(false);
    window.addEventListener("afterprint", afterPrint);
    return () => window.removeEventListener("afterprint", afterPrint);
  }, []);

  useEffect(() => {
    const afterPrint = () => setPrintingRawStock(false);
    window.addEventListener("afterprint", afterPrint);
    return () => window.removeEventListener("afterprint", afterPrint);
  }, []);

  // Build a combined stock view — each FG variant (packet size or bulk) gets its own row.
  // If a raw item name matches the FG name, the raw balance is shown on every FG variant row.
  // Raw-only items (no matching FG at all) appear as a single row with FG balance = null.
  const getCombinedStockView = () => {
    // Build raw lookup by name (lowercase)
    const rawMap = {};
    rawByItem.forEach((r) => {
      if (!r.name || r.name === '—') return;
      rawMap[r.name.toLowerCase()] = r;
    });

    const rows = [];
    const rawNamesUsed = new Set();

    // One row per FG variant
    fgByItem.forEach((f) => {
      if (!f.name || f.name === '(Unknown)') return;
      const key = f.name.toLowerCase();
      const raw = rawMap[key] || null;
      if (raw) rawNamesUsed.add(key);

      rows.push({
        name: f.name,
        variant: f.variant,
        rawBalance: raw ? raw.balance : null,
        rawPurchased: raw ? raw.purchased : null,
        rawUom: raw ? raw.uom : '',
        fgBalance: f.balance,
        fgProduced: f.produced,
        fgSold: f.sold,
        fgIsPacket: f.isPacket,
      });
    });

    // Add raw-only items (no FG match)
    rawByItem.forEach((r) => {
      if (!r.name || r.name === '—') return;
      if (!rawNamesUsed.has(r.name.toLowerCase())) {
        rows.push({
          name: r.name,
          variant: null,
          rawBalance: r.balance,
          rawPurchased: r.purchased,
          rawUom: r.uom,
          fgBalance: null,
          fgProduced: null,
          fgSold: null,
          fgIsPacket: false,
        });
      }
    });

    return rows.sort((a, b) =>
      a.name.localeCompare(b.name) || (a.variant || '').localeCompare(b.variant || '')
    );
  };

  // Low stock items: balance < 20% of purchased for raw, balance < 20% of produced for FG
  const getLowStockAlerts = () => {
    const combinedMap = {};

    // 1. Process Raw Materials
    rawByItem.forEach((r) => {
      if (r.name && r.name !== '—') {
        combinedMap[r.name.toLowerCase()] = {
          name: r.name,
          balance: r.balance,
          uom: r.uom,
          purchased: r.purchased,
        };
      }
    });

    // 2. Process Finished Goods and merge if name matches
    fgByItem.forEach((f) => {
      if (f.name && f.name !== '(Unknown)') {
        const key = f.name.toLowerCase();
        
        if (combinedMap[key]) {
          combinedMap[key].balance += f.balance;
          combinedMap[key].purchased += f.produced; 
        } else {
          combinedMap[key] = {
            name: f.name,
            balance: f.balance,
            uom: f.uom || (f.isPacket ? 'pkts' : 'Kg'),
            purchased: f.produced,
          };
        }
      }
    });

    // 3. Filter for low stock (< 20% of combined purchased/produced)
    const alerts = [];
    Object.values(combinedMap).forEach(item => {
      const pct = item.purchased > 0 ? (item.balance / item.purchased) * 100 : 0;
      if (pct < 20) {
        alerts.push({
          ...item,
          isCritical: pct < 10
        });
      }
    });

    return alerts;
  };

  const lowStockCombined = getLowStockAlerts();
  const combinedStockView = getCombinedStockView();

  if (loading)
    return (
      <div className="page-container">
        <div
          className="loading-state"
          style={{ padding: "5rem", fontSize: "1rem" }}
        >
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              gap: "1rem",
            }}
          >
            <div
              style={{
                width: 40,
                height: 40,
                border: "3px solid #e2e8f0",
                borderTopColor: "var(--blue)",
                borderRadius: "50%",
                animation: "spin 0.8s linear infinite",
              }}
            />
            <span>Loading dashboard...</span>
            <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
          </div>
        </div>
      </div>
    );

  return (
    <div className="page-container">
      {/* ── STANDARD DASHBOARD (HIDDEN DURING PRINT) ── */}
      {!printingRawStock && (
        <>
          {/* ── PAGE TITLE ── */}
          <div className="page-header">
            <h2>Welcome Back 👋</h2>
            <p>Here's what's happening with Amrona today.</p>
          </div>

          {/* ── STAT CARDS ── */}
          <div className="dashboard-cards">
            <div className="stat-card green">
              <div className="stat-card-icon">
                <Package size={52} />
              </div>
              <div className="stat-card-label">Raw Materials Stock Value</div>
              <div className="stat-card-value" style={{ fontSize: "1.75rem" }}>
                {fmtCur(rawStockValue)}
              </div>
              <div className="stat-card-sub">Total price of raw material in stock</div>
            </div>

            <div className="stat-card orange">
              <div className="stat-card-icon">
                <Factory size={52} />
              </div>
              <div className="stat-card-label">RM Consumed Value</div>
              <div className="stat-card-value" style={{ fontSize: "1.75rem" }}>
                {fmtCur(currentMonthConsumedValue)}
              </div>
              <div className="stat-card-sub">Consumed in current month</div>
            </div>

            <div className="stat-card blue">
              <div className="stat-card-icon">
                <PackageSearch size={52} />
              </div>
              <div className="stat-card-label">Finished Goods Stock</div>
              <div className="stat-card-value">
                {formatPacketSize(fgBalance)}
              </div>
              <div className="stat-card-sub">Balance from stock ledger</div>
            </div>

            <div className="stat-card red">
              <div className="stat-card-icon">
                <TrendingUp size={52} />
              </div>
              <div className="stat-card-label">Total Sales</div>
              <div className="stat-card-value" style={{ fontSize: "1.75rem" }}>
                {fmtCur(totalSales)}
              </div>
              <div className="stat-card-sub">This month's revenue</div>
            </div>
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: "1.75rem" }}>
            {/* Low Stock Alerts */}
            <div className="card">
              <div className="card-header">
                <div className="card-title">
                  <span
                    style={{
                      background: "#fef3c7",
                      color: "var(--amber)",
                      width: 28,
                      height: 28,
                      borderRadius: 8,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                    }}
                  >
                    <AlertTriangle size={15} />
                  </span>
                  Low Stock Alerts
                </div>
                {lowStockCombined.length > 0 && (
                  <span className="status-badge red">
                    {lowStockCombined.length} items
                  </span>
                )}
              </div>
              <div className="card-body" style={{ maxHeight: "310px", overflowY: "auto" }}>
                {lowStockCombined.length === 0 ? (
                  <div
                    style={{
                      textAlign: "center",
                      padding: "2rem 0",
                      color: "var(--muted)",
                    }}
                  >
                    <div style={{ fontSize: "2rem", marginBottom: "0.5rem" }}>
                      ✅
                    </div>
                    <p style={{ fontSize: "0.875rem" }}>
                      All stocks are healthy!
                    </p>
                  </div>
                ) : (
                  lowStockCombined.map((item, i) => {
                    return (
                      <div key={i} className="low-stock-item">
                        <div>
                          <div className="low-stock-name">{item.name}</div>
                          <div className="low-stock-qty">
                            Balance: {fmt(item.balance)} {item.uom}
                          </div>
                        </div>
                        <span
                          className={`status-badge ${item.isCritical ? "red" : "amber"}`}
                        >
                          {item.isCritical ? "Critical" : "Low"}
                        </span>
                      </div>
                    );
                  })
                )}
              </div>
            </div>
          </div>

          {/* ── COMBINED STOCK TABLE ── */}
          <div className="card">
            <div className="card-header">
              <div className="card-title">
                <span
                  style={{
                    background: "#ede9fe",
                    color: "#7c3aed",
                    width: 28,
                    height: 28,
                    borderRadius: 8,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                >
                  <Package size={15} />
                </span>
                Stock Overview
              </div>
              <div style={{ display: "flex", gap: "0.5rem" }}>
                <button
                  className="view-all-btn"
                  onClick={handleRawStockPrint}
                  style={{ color: "#64748b", background: "transparent", border: "none", display: "flex", alignItems: "center", cursor: "pointer", fontSize: "0.85rem", fontWeight: "600" }}
                >
                  <Printer size={14} style={{ marginRight: "4px" }} /> Print
                </button>
                <button
                  className="view-all-btn"
                  onClick={() => navigate("/raw-stock")}
                  style={{ background: "transparent", border: "none", color: "var(--blue)", display: "flex", alignItems: "center", cursor: "pointer", fontSize: "0.85rem", fontWeight: "600" }}
                >
                  Raw Report <ArrowUpRight size={14} style={{ marginLeft: "4px" }} />
                </button>
                <button
                  className="view-all-btn"
                  onClick={() => navigate("/fg-stock")}
                  style={{ background: "transparent", border: "none", color: "var(--blue)", display: "flex", alignItems: "center", cursor: "pointer", fontSize: "0.85rem", fontWeight: "600" }}
                >
                  FG Report <ArrowUpRight size={14} style={{ marginLeft: "4px" }} />
                </button>
                <button
                  className="btn-icon"
                  style={{ marginLeft: "0.5rem" }}
                  onClick={() => setShowRawStock(!showRawStock)}
                >
                  {showRawStock ? <ChevronUp size={18} /> : <ChevronDown size={18} />}
                </button>
              </div>
            </div>

            {showRawStock && (
              <div className="table-card" style={{ borderTopLeftRadius: 0, borderTopRightRadius: 0 }}>
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Item</th>
                      <th style={{ background: "#f0fdf4", color: "#16a34a" }}>Raw Balance</th>
                      <th style={{ background: "#eff6ff", color: "#1d4ed8" }}>FG Balance</th>
                      <th style={{ background: "#eff6ff", color: "#1d4ed8" }}>Variant</th>
                      <th>Type</th>
                    </tr>
                  </thead>
                  <tbody>
                    {combinedStockView.map((row, i) => {
                      const hasRaw = row.rawBalance !== null;
                      const hasFg = row.fgBalance !== null;

                      const rawIsLow = hasRaw && row.rawPurchased > 0 && (row.rawBalance / row.rawPurchased) * 100 < 20;
                      const rawIsEmpty = hasRaw && row.rawBalance <= 0;
                      const rawColor = !hasRaw ? "var(--muted)" : rawIsEmpty ? "#ef4444" : rawIsLow ? "#f59e0b" : "#22c55e";

                      const fgIsLow = hasFg && row.fgProduced > 0 && (row.fgBalance / row.fgProduced) * 100 < 20;
                      const fgIsEmpty = hasFg && row.fgBalance <= 0;
                      const fgColor = !hasFg ? "var(--muted)" : fgIsEmpty ? "#ef4444" : fgIsLow ? "#f59e0b" : "#22c55e";

                      const typeLabel = hasRaw && hasFg ? "Both" : hasRaw ? "Raw" : "FG";
                      const typeBg = hasRaw && hasFg ? "#ede9fe" : hasRaw ? "#dcfce7" : "#dbeafe";
                      const typeColor = hasRaw && hasFg ? "#7c3aed" : hasRaw ? "#16a34a" : "#1d4ed8";

                      return (
                        <tr key={i}>
                          <td style={{ fontWeight: 600 }}>{row.name}</td>
                          <td>
                            {hasRaw ? (
                              <span style={{ fontWeight: 700, color: rawColor }}>
                                {fmt(row.rawBalance)} {row.rawUom}
                              </span>
                            ) : (
                              <span style={{ color: "var(--muted)" }}>—</span>
                            )}
                          </td>
                          <td>
                            {hasFg ? (
                              <span style={{ fontWeight: 700, color: fgColor }}>
                                {row.fgIsPacket
                                  ? `${row.fgBalance} pkts`
                                  : formatPacketSize(row.fgBalance)}
                              </span>
                            ) : (
                              <span style={{ color: "var(--muted)" }}>—</span>
                            )}
                          </td>
                          <td style={{ color: "#64748b", fontSize: "0.82rem" }}>
                            {row.variant || <span style={{ color: "var(--muted)" }}>—</span>}
                          </td>
                          <td>
                            <span
                              style={{
                                background: typeBg,
                                color: typeColor,
                                padding: "2px 10px",
                                borderRadius: 12,
                                fontSize: "0.78rem",
                                fontWeight: 600,
                              }}
                            >
                              {typeLabel}
                            </span>
                          </td>
                        </tr>
                      );
                    })}
                    {combinedStockView.length === 0 && (
                      <tr>
                        <td colSpan={5} className="empty-state">
                          No stock records.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      )}

      {/* ── PRINT ONLY RAW STOCK TEMPLATE ── */}
      {printingRawStock && (
        <div className="print-invoice-container">
          <div className="invoice-header">
            <div
              className="invoice-company-details"
              style={{ width: "100%", textAlign: "center" }}
            >
              <h1 style={{ fontSize: "32px", marginBottom: "10px" }}>Amrona</h1>
              <h2>Raw Material Stock Overview</h2>
              <p>Printed on: {new Date().toLocaleDateString("en-GB")}</p>
            </div>
          </div>

          <table className="invoice-table" style={{ marginTop: "20px" }}>
            <thead>
              <tr>
                <th>Raw Material Item</th>
                <th style={{ textAlign: "right" }}>Total Purchased</th>
                <th style={{ textAlign: "right" }}>Total Consumed</th>
                <th style={{ textAlign: "right" }}>Current Balance</th>
              </tr>
            </thead>
            <tbody>
              {rawByItem.map((r, i) => (
                <tr key={i}>
                  <td style={{ fontWeight: 600 }}>{r.name}</td>
                  <td style={{ textAlign: "right" }}>
                    {fmt(r.purchased)} {r.uom}
                  </td>
                  <td style={{ textAlign: "right" }}>
                    {fmt(r.consumed)} {r.uom}
                  </td>
                  <td style={{ textAlign: "right", fontWeight: "bold" }}>
                    {fmt(r.balance)} {r.uom}
                  </td>
                </tr>
              ))}
              {rawByItem.length === 0 && (
                <tr>
                  <td colSpan="4" style={{ textAlign: "center" }}>
                    No raw material records found.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
