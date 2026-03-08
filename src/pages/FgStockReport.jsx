import React, { useEffect, useState } from "react";
import { supabase } from "../supabase";
import { RefreshCw } from "lucide-react";
import { format } from "date-fns";

export default function FgStockReport() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);

  // Format gram value → "25g", "100g", "1kg"
  const formatPacketSize = (val) => {
    const g = Number(val);
    if (!g) return val;
    return g >= 1000 ? `${g / 1000}kg` : `${g}g`;
  };

  useEffect(() => {
    fetchData();
  }, []);

  const fetchData = async () => {
    setLoading(true);

    const { data: prodLines } = await supabase
      .from("production_lines")
      .select(
        "id, fg_item_id, total_qty, production_header_id, fg_items(name, batch_code), production_headers(batch_no, date)",
      );

    const { data: salesLines } = await supabase
      .from("sales_lines")
      .select("fg_item_id, qty, packet_size, production_header_id");

    const soldByBatch = {};
    const soldByFgItem = {};
    (salesLines || []).forEach((sl) => {
      const grams = Number(sl.qty) * Number(sl.packet_size || 1);
      if (sl.production_header_id) {
        soldByBatch[sl.production_header_id] =
          (soldByBatch[sl.production_header_id] || 0) + grams;
      } else {
        soldByFgItem[sl.fg_item_id] =
          (soldByFgItem[sl.fg_item_id] || 0) + grams;
      }
    });

    const tableRows = (prodLines || []).map((pl) => {
      const produced = Number(pl.total_qty);
      const sold =
        soldByBatch[pl.production_header_id] ||
        soldByFgItem[pl.fg_item_id] ||
        0;
      const remaining = Math.max(0, produced - sold);
      return {
        batch_no: pl.production_headers?.batch_no || "—",
        date: pl.production_headers?.date,
        product: pl.fg_items?.name || "—",
        batch_code: pl.fg_items?.batch_code || "",
        produced,
        total_sold: sold,
        remaining,
      };
    });

    // Sort by date desc
    tableRows.sort((a, b) => new Date(b.date) - new Date(a.date));

    setRows(tableRows);
    setLoading(false);
  };

  return (
    <div className="page-container">
      <div className="page-header-row">
        <div>
          <h2>FG Stock</h2>
          <p>Live stock status per production batch</p>
        </div>
        <button
          className="btn-secondary"
          onClick={fetchData}
          style={{ display: "flex", alignItems: "center", gap: "6px" }}
        >
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
                <th>Date</th>
                <th>Product</th>
                <th>Weight Produced</th>
                <th>Weight Sold</th>
                <th>Stock Remaining</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => {
                const pct =
                  r.produced > 0 ? (r.remaining / r.produced) * 100 : 0;
                const isEmpty = r.remaining <= 0;
                const isLow = !isEmpty && pct < 20;
                const statusLabel = isEmpty
                  ? "Sold Out"
                  : isLow
                    ? "Low"
                    : "In Stock";
                const statusColor = isEmpty
                  ? "#dc2626"
                  : isLow
                    ? "#ca8a04"
                    : "#16a34a";
                const statusBg = isEmpty
                  ? "#fee2e2"
                  : isLow
                    ? "#fef9c3"
                    : "#dcfce7";

                return (
                  <tr key={i}>
                    <td style={{ fontWeight: 700, color: "#3b82f6" }}>
                      {r.batch_no}
                    </td>
                    <td>
                      {r.date ? format(new Date(r.date), "MMM dd, yyyy") : "—"}
                    </td>
                    <td style={{ fontWeight: 600 }}>
                      {r.product}
                      {r.batch_code && (
                        <div
                          style={{
                            fontSize: "0.75rem",
                            color: "#64748b",
                            fontWeight: 400,
                          }}
                        >
                          Code: {r.batch_code}
                        </div>
                      )}
                    </td>
                    <td>{formatPacketSize(r.produced)}</td>
                    <td
                      style={{
                        color: r.total_sold > 0 ? "#dc2626" : "#64748b",
                      }}
                    >
                      {formatPacketSize(r.total_sold)}
                    </td>
                    <td>
                      <span
                        style={{
                          fontWeight: 700,
                          color: isEmpty
                            ? "#dc2626"
                            : isLow
                              ? "#ca8a04"
                              : "#16a34a",
                        }}
                      >
                        {formatPacketSize(r.remaining)}
                      </span>
                    </td>
                    <td>
                      <span
                        style={{
                          display: "inline-block",
                          padding: "2px 10px",
                          borderRadius: "9999px",
                          fontSize: "0.75rem",
                          fontWeight: 600,
                          background: statusBg,
                          color: statusColor,
                        }}
                      >
                        {statusLabel}
                      </span>
                    </td>
                  </tr>
                );
              })}
              {rows.length === 0 && (
                <tr>
                  <td colSpan="8" className="empty-state">
                    No production batches found.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
