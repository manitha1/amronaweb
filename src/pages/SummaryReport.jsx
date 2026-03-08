import React, { useEffect, useState } from "react";
import { supabase } from "../supabase";
import { format, startOfMonth, endOfMonth } from "date-fns";
import {
  Printer,
  Calendar,
  ArrowRight,
  Package,
  PackageSearch,
  Activity,
  ShoppingCart,
} from "lucide-react";

const formatPacketSize = (grams) => {
  if (!grams || grams === 0) return "Bulk";
  if (grams >= 1000)
    return (grams / 1000).toFixed(2).replace(/\.?0+$/, "") + "kg";
  return grams + "g";
};

export default function SummaryReport() {
  const [loading, setLoading] = useState(false);

  // Default to current month
  const [startDate, setStartDate] = useState(
    format(startOfMonth(new Date()), "yyyy-MM-dd"),
  );
  const [endDate, setEndDate] = useState(
    format(endOfMonth(new Date()), "yyyy-MM-dd"),
  );

  // Print state
  const [isPrinting, setIsPrinting] = useState(false);

  // Summaries
  const [totalPurchases, setTotalPurchases] = useState(0);
  const [totalSales, setTotalSales] = useState(0);
  const [totalProdBatches, setTotalProdBatches] = useState(0);

  // Details Lists
  const [purchases, setPurchases] = useState([]);
  const [sales, setSales] = useState([]);
  const [productions, setProductions] = useState([]);

  // Movements
  const [rawMovements, setRawMovements] = useState([]);
  const [fgMovements, setFgMovements] = useState([]);

  // Lookups
  const [rawItems, setRawItems] = useState({});
  const [fgItems, setFgItems] = useState({});

  useEffect(() => {
    fetchLookups().then((lookups) => fetchData(lookups));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const fetchLookups = async () => {
    const { data: raw } = await supabase
      .from("raw_items")
      .select("id, name, uom");
    const { data: fg } = await supabase.from("fg_items").select("id, name");

    const rMap = {};
    (raw || []).forEach((r) => (rMap[r.id] = { name: r.name, uom: r.uom }));
    setRawItems(rMap);

    const fMap = {};
    (fg || []).forEach((f) => (fMap[f.id] = { name: f.name }));
    setFgItems(fMap);

    return { rMap, fMap };
  };

  const fetchData = async (lookups) => {
    setLoading(true);

    try {
      // 1. Fetch Headers within Date Range
      const startStr = `${startDate}T00:00:00`;
      const endStr = `${endDate}T23:59:59`;

      const [
        { data: purchHeaders },
        { data: saleHeaders },
        { data: prodHeaders },
      ] = await Promise.all([
        supabase
          .from("purchase_headers")
          .select("id, purchase_no, date, total_amount, suppliers(name)")
          .gte("date", startStr)
          .lte("date", endStr)
          .order("date"),
        supabase
          .from("sales_headers")
          .select("id, bill_no, date, total_amount, customers(name)")
          .gte("date", startStr)
          .lte("date", endStr)
          .order("date"),
        supabase
          .from("production_headers")
          .select("id, batch_no, date")
          .gte("date", startStr)
          .lte("date", endStr)
          .order("date"),
      ]);

      setPurchases(purchHeaders || []);
      setSales(saleHeaders || []);
      setProductions(prodHeaders || []);

      setTotalPurchases(
        (purchHeaders || []).reduce(
          (s, row) => s + Number(row.total_amount || 0),
          0,
        ),
      );
      setTotalSales(
        (saleHeaders || []).reduce(
          (s, row) => s + Number(row.total_amount || 0),
          0,
        ),
      );
      setTotalProdBatches((prodHeaders || []).length);

      // 2. Fetch Lines strictly for fetched headers to calculate In/Outs
      const purchHeaderIds = (purchHeaders || []).map((h) => h.id);
      const purchNos = (purchHeaders || []).map((h) => h.purchase_no);
      const prodHeaderIds = (prodHeaders || []).map((h) => h.id);
      const saleHeaderIds = (saleHeaders || []).map((h) => h.id);

      // RAW ITEMS IN
      const { data: rawInLines } =
        purchHeaderIds.length > 0
          ? await supabase
              .from("purchase_lines")
              .select("raw_item_id, qty")
              .in("purchase_header_id", purchHeaderIds)
          : { data: [] };

      // RAW ITEMS OUT (consumed) - we join via the production records in date range
      const { data: rawOutLines } =
        prodHeaderIds.length > 0
          ? await supabase
              .from("production_consumptions")
              .select("raw_item_id, qty")
              .in("header_id", prodHeaderIds)
          : { data: [] };

      // Wait... production_consumptions doesn't link to header_id directly? Yes it does via foreign key `header_id` in RPC. Let's check table structure?
      // Wait, production_consumptions usually has `header_id` or we can just fetch all and filter locally by production header batch_no / ids?
      // Wait, Amrona's production_consumptions uses `header_id`. Wait, no, Amrona uses `batch_no` occasionally but usually it's `production_header_id` or fetched via prodHeaders.
      // In Production.jsx we see `select('*, production_consumptions(*)')` so the relationship exists. It is linked to `header_id` or `production_header_id`.
      // Alternatively, let's fetch based on date in headers:

      const [{ data: rawOutData }, { data: fgInData }, { data: fgOutData }] =
        await Promise.all([
          supabase
            .from("production_consumptions")
            .select("raw_item_id, qty, production_headers!inner(date)")
            .gte("production_headers.date", startStr)
            .lte("production_headers.date", endStr),

          supabase
            .from("production_lines")
            .select(
              "fg_item_id, total_qty, qty_per_packet, production_headers!inner(date)",
            )
            .gte("production_headers.date", startStr)
            .lte("production_headers.date", endStr),

          supabase
            .from("sales_lines")
            .select("fg_item_id, qty, packet_size, sales_headers!inner(date)")
            .gte("sales_headers.date", startStr)
            .lte("sales_headers.date", endStr),
        ]);

      // Aggregate RAW
      const rawMap = {};
      (rawInLines || []).forEach((r) => {
        if (!rawMap[r.raw_item_id]) rawMap[r.raw_item_id] = { in: 0, out: 0 };
        rawMap[r.raw_item_id].in += Number(r.qty);
      });
      (rawOutData || []).forEach((r) => {
        if (!rawMap[r.raw_item_id]) rawMap[r.raw_item_id] = { in: 0, out: 0 };
        rawMap[r.raw_item_id].out += Number(r.qty);
      });

      // Flatten RAW Movements
      const usedRawItems = lookups ? lookups.rMap : rawItems;
      const rawMovRows = Object.keys(rawMap)
        .map((id) => ({
          id,
          name: usedRawItems[id]?.name || "Unknown",
          in: rawMap[id].in,
          out: rawMap[id].out,
          uom: usedRawItems[id]?.uom || "",
        }))
        .sort((a, b) => a.name.localeCompare(b.name));
      setRawMovements(rawMovRows);

      // Aggregate FG by Item + Size
      const fgMap = {};
      (fgInData || []).forEach((f) => {
        const pSize = f.qty_per_packet ? String(f.qty_per_packet) : "bulk";
        const key = `${f.fg_item_id}_${pSize}`;
        if (!fgMap[key])
          fgMap[key] = {
            id: f.fg_item_id,
            pSize: f.qty_per_packet,
            in: 0,
            out: 0,
          };
        fgMap[key].in += Number(f.total_qty);
      });
      (fgOutData || []).forEach((f) => {
        const pSize = f.packet_size ? String(f.packet_size) : "bulk";
        const key = `${f.fg_item_id}_${pSize}`;
        if (!fgMap[key])
          fgMap[key] = {
            id: f.fg_item_id,
            pSize: f.packet_size,
            in: 0,
            out: 0,
          };
        fgMap[key].out += Number(f.qty);
      });

      // Flatten FG Movements
      const usedFgItems = lookups ? lookups.fMap : fgItems;
      const fgMovRows = Object.values(fgMap)
        .map((row) => {
          const name = usedFgItems[row.id]?.name || "Unknown";
          const isPacket = !!row.pSize;
          const remaining = row.in - row.out;

          return {
            ...row,
            name,
            variant: isPacket ? `${formatPacketSize(row.pSize)} pkts` : "Bulk",
            isPacket,
            remaining,
            inDisplay: isPacket ? `${row.in} pkts` : formatPacketSize(row.in),
            outDisplay: isPacket
              ? `${row.out} pkts`
              : formatPacketSize(row.out),
            remainingDisplay: isPacket
              ? `${remaining} pkts`
              : formatPacketSize(remaining),
          };
        })
        .sort((a, b) => a.name.localeCompare(b.name));
      setFgMovements(fgMovRows);
    } catch (error) {
      console.error("Error fetching summary:", error);
    } finally {
      setLoading(false);
    }
  };

  const handlePrint = () => {
    setIsPrinting(true);
    setTimeout(() => window.print(), 300);
  };

  useEffect(() => {
    const afterPrint = () => setIsPrinting(false);
    window.addEventListener("afterprint", afterPrint);
    return () => window.removeEventListener("afterprint", afterPrint);
  }, []);

  const fmt = (n) =>
    Number(n).toLocaleString("en-US", {
      minimumFractionDigits: 0,
      maximumFractionDigits: 2,
    });
  const fmtCur = (n) =>
    "Rs. " +
    Number(n).toLocaleString("en-US", {
      minimumFractionDigits: 0,
      maximumFractionDigits: 2,
    });

  return (
    <div className="page-container">
      {/* ── STANDARD VIEW (HIDDEN ON PRINT) ── */}
      {!isPrinting && (
        <>
          <div className="page-header-row" style={{ alignItems: "flex-start" }}>
            <div>
              <h2>Summary Report</h2>
              <p>View consolidated business activity within a date range</p>
            </div>
            <button className="btn-secondary" onClick={handlePrint}>
              <Printer size={16} style={{ marginRight: "6px" }} /> Print Report
            </button>
          </div>

          <div className="card" style={{ marginBottom: "2rem" }}>
            <div
              className="card-body"
              style={{
                display: "flex",
                gap: "1rem",
                alignItems: "flex-end",
                flexWrap: "wrap",
              }}
            >
              <div
                className="form-group"
                style={{ marginBottom: 0, flex: 1, minWidth: "150px" }}
              >
                <label>Start Date</label>
                <div
                  style={{ display: "flex", alignItems: "center", gap: "8px" }}
                >
                  <Calendar size={18} className="text-muted" />
                  <input
                    type="date"
                    value={startDate}
                    onChange={(e) => setStartDate(e.target.value)}
                  />
                </div>
              </div>
              <div
                className="form-group"
                style={{ marginBottom: 0, flex: 1, minWidth: "150px" }}
              >
                <label>End Date</label>
                <div
                  style={{ display: "flex", alignItems: "center", gap: "8px" }}
                >
                  <Calendar size={18} className="text-muted" />
                  <input
                    type="date"
                    value={endDate}
                    onChange={(e) => setEndDate(e.target.value)}
                  />
                </div>
              </div>
              <button
                className="btn-primary"
                onClick={fetchData}
                disabled={loading}
                style={{ height: "42px", padding: "0 1.5rem" }}
              >
                {loading ? "Loading..." : "Run Report"}
              </button>
            </div>
          </div>

          {/* OVERVIEW CARDS */}
          <div
            className="dashboard-cards"
            style={{
              gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))",
            }}
          >
            <div className="stat-card green">
              <div className="stat-card-icon">
                <ShoppingCart size={40} />
              </div>
              <div className="stat-card-label">Total Purchases</div>
              <div className="stat-card-value">{fmtCur(totalPurchases)}</div>
              <div className="stat-card-sub">
                {purchases.length} Purchase Orders
              </div>
            </div>
            <div className="stat-card orange">
              <div className="stat-card-icon">
                <Activity size={40} />
              </div>
              <div className="stat-card-label">Total Production</div>
              <div className="stat-card-value">{totalProdBatches}</div>
              <div className="stat-card-sub">Batches manufactured</div>
            </div>
            <div className="stat-card blue">
              <div className="stat-card-icon">
                <ArrowRight size={40} />
              </div>
              <div className="stat-card-label">Total Sales</div>
              <div className="stat-card-value">{fmtCur(totalSales)}</div>
              <div className="stat-card-sub">
                {sales.length} Invoices issued
              </div>
            </div>
          </div>

          <div style={{ marginTop: "2rem" }}>
            {/* RAW MOVEMENTS */}
            <div className="card" style={{ marginBottom: "2rem" }}>
              <div className="card-header">
                <div className="card-title">
                  <span
                    style={{
                      background: "#dcfce7",
                      color: "#16a34a",
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
                  Raw Material Stock Flow
                </div>
              </div>
              <div className="table-card">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Item Name</th>
                      <th style={{ textAlign: "right", color: "#16a34a" }}>
                        IN (Purchased)
                      </th>
                      <th style={{ textAlign: "right", color: "#ef4444" }}>
                        OUT (Consumed)
                      </th>
                      <th style={{ textAlign: "right" }}>Net Change</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rawMovements.map((r, i) => (
                      <tr key={i}>
                        <td style={{ fontWeight: 600 }}>{r.name}</td>
                        <td
                          style={{
                            textAlign: "right",
                            color: "#16a34a",
                            fontWeight: 500,
                          }}
                        >
                          {r.in > 0 ? `+${fmt(r.in)} ${r.uom}` : "-"}
                        </td>
                        <td
                          style={{
                            textAlign: "right",
                            color: "#ef4444",
                            fontWeight: 500,
                          }}
                        >
                          {r.out > 0 ? `-${fmt(r.out)} ${r.uom}` : "-"}
                        </td>
                        <td style={{ textAlign: "right", fontWeight: 600 }}>
                          {fmt(r.in - r.out)} {r.uom}
                        </td>
                      </tr>
                    ))}
                    {rawMovements.length === 0 && (
                      <tr>
                        <td colSpan="4" className="empty-state">
                          No movements in this period
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>

            {/* FG MOVEMENTS */}
            <div className="card" style={{ marginBottom: "2rem" }}>
              <div className="card-header">
                <div className="card-title">
                  <span
                    style={{
                      background: "#dbeafe",
                      color: "var(--blue)",
                      width: 28,
                      height: 28,
                      borderRadius: 8,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                    }}
                  >
                    <PackageSearch size={15} />
                  </span>
                  Finished Goods Stock Flow
                </div>
              </div>
              <div className="table-card">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Item Name</th>
                      <th>Variant</th>
                      <th style={{ textAlign: "right", color: "#16a34a" }}>
                        IN
                      </th>
                      <th style={{ textAlign: "right", color: "#be185d" }}>
                        OUT
                      </th>
                      <th style={{ textAlign: "right" }}>Remaining</th>
                    </tr>
                  </thead>
                  <tbody>
                    {fgMovements.map((f, i) => (
                      <tr key={i}>
                        <td style={{ fontWeight: 600 }}>{f.name}</td>
                        <td>
                          <span
                            style={{
                              fontSize: "0.8rem",
                              padding: "2px 6px",
                              background: "#f1f5f9",
                              borderRadius: "4px",
                              color: "#475569",
                            }}
                          >
                            {f.variant}
                          </span>
                        </td>
                        <td
                          style={{
                            textAlign: "right",
                            color: "#16a34a",
                            fontWeight: 500,
                          }}
                        >
                          {f.in > 0 ? `+${f.inDisplay}` : "-"}
                        </td>
                        <td
                          style={{
                            textAlign: "right",
                            color: "#be185d",
                            fontWeight: 500,
                          }}
                        >
                          {f.out > 0 ? `-${f.outDisplay}` : "-"}
                        </td>
                        <td style={{ textAlign: "right", fontWeight: 600 }}>
                          {f.remainingDisplay}
                        </td>
                      </tr>
                    ))}
                    {fgMovements.length === 0 && (
                      <tr>
                        <td colSpan="5" className="empty-state">
                          No movements in this period
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>

          <div style={{ marginTop: "2rem" }}>
            {/* PURCHASES LIST */}
            <div className="card" style={{ marginBottom: "2rem" }}>
              <div className="card-header">
                <div className="card-title">Purchases List</div>
              </div>
              <div className="table-card">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Date</th>
                      <th>PO No</th>
                      <th>Supplier</th>
                      <th style={{ textAlign: "right" }}>Amount</th>
                    </tr>
                  </thead>
                  <tbody>
                    {purchases.map((p) => (
                      <tr key={p.id}>
                        <td>{format(new Date(p.date), "MMM dd")}</td>
                        <td>
                          <strong>{p.purchase_no}</strong>
                        </td>
                        <td>{p.suppliers?.name}</td>
                        <td style={{ textAlign: "right" }}>
                          {fmtCur(p.total_amount)}
                        </td>
                      </tr>
                    ))}
                    {purchases.length === 0 && (
                      <tr>
                        <td colSpan="4" className="empty-state">
                          No purchases
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>

            {/* SALES LIST */}
            <div className="card" style={{ marginBottom: "2rem" }}>
              <div className="card-header">
                <div className="card-title">Sales List</div>
              </div>
              <div className="table-card">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Date</th>
                      <th>Bill No</th>
                      <th>Customer</th>
                      <th style={{ textAlign: "right" }}>Amount</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sales.map((s) => (
                      <tr key={s.id}>
                        <td>{format(new Date(s.date), "MMM dd")}</td>
                        <td>
                          <strong>{s.bill_no}</strong>
                        </td>
                        <td>{s.customers?.name}</td>
                        <td style={{ textAlign: "right" }}>
                          {fmtCur(s.total_amount)}
                        </td>
                      </tr>
                    ))}
                    {sales.length === 0 && (
                      <tr>
                        <td colSpan="4" className="empty-state">
                          No sales
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>

          <div className="card" style={{ marginTop: "2rem" }}>
            <div className="card-header">
              <div className="card-title">Production Batches</div>
            </div>
            <div className="table-card">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>Batch No</th>
                  </tr>
                </thead>
                <tbody>
                  {productions.map((p) => (
                    <tr key={p.id}>
                      <td>{format(new Date(p.date), "MMM dd, yyyy")}</td>
                      <td>
                        <strong>{p.batch_no}</strong>
                      </td>
                    </tr>
                  ))}
                  {productions.length === 0 && (
                    <tr>
                      <td colSpan="2" className="empty-state">
                        No production
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}

      {/* ── PRINT VIEW ── */}
      {isPrinting && (
        <div className="print-invoice-container">
          <div className="invoice-header">
            <div
              className="invoice-company-details"
              style={{ width: "100%", textAlign: "center" }}
            >
              <h1 style={{ fontSize: "32px", marginBottom: "10px" }}>Amrona</h1>
              <h2>Summary Report</h2>
              <p>
                Activity Period: {format(new Date(startDate), "MMM dd, yyyy")}{" "}
                to {format(new Date(endDate), "MMM dd, yyyy")}
              </p>
              <p>Generated on: {format(new Date(), "MMM dd, yyyy")}</p>
            </div>
          </div>

          <div
            style={{
              display: "grid",
              gridTemplateColumns: "1fr 1fr 1fr",
              gap: "20px",
              marginTop: "30px",
              marginBottom: "30px",
              textAlign: "center",
            }}
          >
            <div
              style={{
                padding: "15px",
                border: "1px solid #e2e8f0",
                borderRadius: "8px",
              }}
            >
              <div
                style={{
                  fontSize: "12px",
                  color: "#64748b",
                  textTransform: "uppercase",
                }}
              >
                Total Purchases
              </div>
              <div style={{ fontSize: "24px", fontWeight: "bold" }}>
                {fmtCur(totalPurchases)}
              </div>
              <div style={{ fontSize: "12px", color: "#64748b" }}>
                {purchases.length} POs
              </div>
            </div>
            <div
              style={{
                padding: "15px",
                border: "1px solid #e2e8f0",
                borderRadius: "8px",
              }}
            >
              <div
                style={{
                  fontSize: "12px",
                  color: "#64748b",
                  textTransform: "uppercase",
                }}
              >
                Production Batches
              </div>
              <div style={{ fontSize: "24px", fontWeight: "bold" }}>
                {totalProdBatches}
              </div>
              <div style={{ fontSize: "12px", color: "#64748b" }}>Batches</div>
            </div>
            <div
              style={{
                padding: "15px",
                border: "1px solid #e2e8f0",
                borderRadius: "8px",
              }}
            >
              <div
                style={{
                  fontSize: "12px",
                  color: "#64748b",
                  textTransform: "uppercase",
                }}
              >
                Total Sales
              </div>
              <div style={{ fontSize: "24px", fontWeight: "bold" }}>
                {fmtCur(totalSales)}
              </div>
              <div style={{ fontSize: "12px", color: "#64748b" }}>
                {sales.length} Invoices
              </div>
            </div>
          </div>

          <h3>Raw Material Stock Flow</h3>
          <table className="invoice-table" style={{ marginBottom: "30px" }}>
            <thead>
              <tr>
                <th>Item Name</th>
                <th style={{ textAlign: "right" }}>IN (Purchased)</th>
                <th style={{ textAlign: "right" }}>OUT (Consumed)</th>
                <th style={{ textAlign: "right" }}>Net Change</th>
              </tr>
            </thead>
            <tbody>
              {rawMovements.map((r, i) => (
                <tr key={i}>
                  <td>{r.name}</td>
                  <td style={{ textAlign: "right" }}>
                    {r.in > 0 ? `+${fmt(r.in)} ${r.uom}` : "-"}
                  </td>
                  <td style={{ textAlign: "right" }}>
                    {r.out > 0 ? `-${fmt(r.out)} ${r.uom}` : "-"}
                  </td>
                  <td style={{ textAlign: "right" }}>
                    {fmt(r.in - r.out)} {r.uom}
                  </td>
                </tr>
              ))}
              {rawMovements.length === 0 && (
                <tr>
                  <td colSpan="4" style={{ textAlign: "center" }}>
                    No movements
                  </td>
                </tr>
              )}
            </tbody>
          </table>

          <h3>Finished Goods Stock Flow</h3>
          <table className="invoice-table" style={{ marginBottom: "30px" }}>
            <thead>
              <tr>
                <th>Item Name</th>
                <th>Variant</th>
                <th style={{ textAlign: "right" }}>IN</th>
                <th style={{ textAlign: "right" }}>OUT</th>
                <th style={{ textAlign: "right" }}>Remaining</th>
              </tr>
            </thead>
            <tbody>
              {fgMovements.map((f, i) => (
                <tr key={i}>
                  <td>{f.name}</td>
                  <td>{f.variant}</td>
                  <td style={{ textAlign: "right" }}>
                    {f.in > 0 ? `+${f.inDisplay}` : "-"}
                  </td>
                  <td style={{ textAlign: "right" }}>
                    {f.out > 0 ? `-${f.outDisplay}` : "-"}
                  </td>
                  <td style={{ textAlign: "right" }}>{f.remainingDisplay}</td>
                </tr>
              ))}
              {fgMovements.length === 0 && (
                <tr>
                  <td colSpan="5" style={{ textAlign: "center" }}>
                    No movements
                  </td>
                </tr>
              )}
            </tbody>
          </table>

          <div
            style={{
              display: "grid",
              gridTemplateColumns: "1fr 1fr",
              gap: "30px",
              marginTop: "30px",
            }}
          >
            <div>
              <h4>Purchases</h4>
              <table className="invoice-table">
                <thead>
                  <tr>
                    <th>PO No</th>
                    <th>Date</th>
                    <th style={{ textAlign: "right" }}>Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {purchases.map((p) => (
                    <tr key={p.id}>
                      <td>{p.purchase_no}</td>
                      <td>{format(new Date(p.date), "MM/dd")}</td>
                      <td style={{ textAlign: "right" }}>
                        {fmtCur(p.total_amount)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div>
              <h4>Sales</h4>
              <table className="invoice-table">
                <thead>
                  <tr>
                    <th>Bill No</th>
                    <th>Date</th>
                    <th style={{ textAlign: "right" }}>Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {sales.map((s) => (
                    <tr key={s.id}>
                      <td>{s.bill_no}</td>
                      <td>{format(new Date(s.date), "MM/dd")}</td>
                      <td style={{ textAlign: "right" }}>
                        {fmtCur(s.total_amount)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div style={{ marginTop: "30px" }}>
            <h4>Production Batches</h4>
            <table className="invoice-table">
              <thead>
                <tr>
                  <th>Batch No</th>
                  <th>Date</th>
                </tr>
              </thead>
              <tbody>
                {productions.map((p) => (
                  <tr key={p.id}>
                    <td>{p.batch_no}</td>
                    <td>{format(new Date(p.date), "MMM dd, yyyy")}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div
            style={{
              marginTop: "50px",
              fontSize: "12px",
              textAlign: "center",
              color: "#94a3b8",
            }}
          >
            -- End of Report --
          </div>
        </div>
      )}
    </div>
  );
}
