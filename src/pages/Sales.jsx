import React, { useState, useEffect } from "react";
import { supabase } from "../supabase";
import { Plus, Search, X, Trash2, Pencil, Printer } from "lucide-react";
import toast from "react-hot-toast";
import { format } from "date-fns";

export default function Sales() {
  const [data, setData] = useState([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState("");
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [viewTarget, setViewTarget] = useState(null);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [editingId, setEditingId] = useState(null);

  // Form State
  const [customers, setCustomers] = useState([]);
  const [batches, setBatches] = useState([]);
  const [rawItems, setRawItems] = useState([]);      // list of raw items
  const [rawStock, setRawStock] = useState([]);       // raw_stock_view rows

  const [billNo, setBillNo] = useState("");
  const [customerId, setCustomerId] = useState("");
  const [date, setDate] = useState(format(new Date(), "yyyy-MM-dd"));
  const [lines, setLines] = useState([]);

  useEffect(() => {
    fetchData();
    fetchLookups();
  }, []);

  const fetchData = async () => {
    setLoading(true);
    const { data: records, error } = await supabase
      .from("sales_headers")
      .select(
        "*, customers(name), sales_lines(*, fg_items(name), raw_items(name), production_headers(batch_no))",
      )
      .order("created_at", { ascending: false });
    if (error) toast.error("Error fetching sales: " + error.message);
    else setData(records);
    setLoading(false);
  };

  const fetchLookups = async () => {
    // Customers
    const { data: c } = await supabase.from("customers").select("id, name");

    // FG production batches
    const { data: b } = await supabase
      .from("production_lines")
      .select(
        `id, fg_item_id, total_qty, qty_per_packet,
         production_headers(id, batch_no, date),
         fg_items(name, batch_code)`,
      )
      .order("production_headers(date)", { ascending: false });

    // Raw items
    const { data: ri } = await supabase
      .from("raw_items")
      .select("id, name, uom")
      .order("name");

    // Raw stock balances
    const { data: rs } = await supabase
      .from("raw_stock_view")
      .select("raw_item_id, raw_item_name, balance");

    if (c) setCustomers(c);
    if (b) {
      const sortedBatches = b.sort((x, y) => {
        const nameX = x.fg_items?.name?.toLowerCase() || "";
        const nameY = y.fg_items?.name?.toLowerCase() || "";
        return nameX.localeCompare(nameY);
      });
      setBatches(sortedBatches);
    }
    if (ri) setRawItems(ri);
    if (rs) setRawStock(rs);
  };

  const getRawBalance = (rawItemId) => {
    const row = rawStock.find((r) => r.raw_item_id === rawItemId);
    return row ? Number(row.balance) : 0;
  };

  // Returns the raw item's native UOM string (e.g. "Kg", "g")
  const getRawItemUom = (rawItemId) =>
    rawItems.find((r) => r.id === rawItemId)?.uom || "";

  // Converts a packet_size (entered in sizeUnit: "g"|"kg") to the raw item's native UOM.
  // Example: 500g → 0.5 if native UOM is "Kg"; 500g → 500 if native UOM is "g"
  const packetSizeInNativeUom = (sizeValue, sizeUnit, nativeUom) => {
    const sizeInGrams = sizeUnit === "kg" ? Number(sizeValue) * 1000 : Number(sizeValue);
    const uomLower = (nativeUom || "").toLowerCase();
    if (uomLower === "kg") return sizeInGrams / 1000;
    return sizeInGrams; // g or any non-kg UOM
  };

  const generateNextInvoiceNo = async () => {
    const { data: rows, error } = await supabase
      .from("sales_headers")
      .select("bill_no")
      .ilike("bill_no", "INV-%")
      .order("bill_no", { ascending: false })
      .limit(1);

    if (error) {
      console.error("Error generating invoice no:", error);
      return "INV-0001";
    }

    let nextNum = 1;
    if (rows && rows.length > 0) {
      const lastNo = rows[0].bill_no;
      const parts = lastNo.split("-");
      if (parts.length > 1) {
        const lastNum = parseInt(parts[1], 10);
        if (!isNaN(lastNum)) {
          nextNum = lastNum + 1;
        }
      }
    }
    return `INV-${String(nextNum).padStart(4, "0")}`;
  };

  // ── OPEN CREATE ────────────────────────────────────────────────────────────
  const openCreateModal = async () => {
    setEditingId(null);
    const nextInv = await generateNextInvoiceNo();
    setBillNo(nextInv);
    setCustomerId("");
    setDate(format(new Date(), "yyyy-MM-dd"));
    setLines([]);
    setIsModalOpen(true);
  };

  // ── OPEN EDIT ──────────────────────────────────────────────────────────────
  const openEditModal = (row) => {
    setEditingId(row.id);
    setBillNo(row.bill_no);
    setCustomerId(row.customer_id);
    setDate(row.date);
    const parsedLines = (row.sales_lines || []).map((l) => {
      const itype = l.item_type || "fg";
      let size = l.packet_size || "";
      let sUnit = "g";
      if (size && size >= 1000 && size % 1000 === 0) {
        size = size / 1000;
        sUnit = "kg";
      }

      if (itype === "raw") {
        return {
          id: l.id,
          item_type: "raw",
          raw_item_id: l.raw_item_id || "",
          raw_item_name: l.raw_items?.name || "",
          raw_sale_mode: l.packet_size ? "packets" : "bulk",
          fg_item_id: "",
          fg_item_name: "",
          batch_id: "",
          prod_line_id: "",
          is_bulk: false,
          packet_size: size,
          size_unit: sUnit,
          qty: l.qty,
          unit_price: l.unit_price,
          availableQty: null,
        };
      }

      return {
        id: l.id,
        item_type: "fg",
        raw_item_id: "",
        raw_item_name: "",
        raw_sale_mode: "bulk",
        batch_id: l.production_header_id || "",
        prod_line_id: "",
        fg_item_id: l.fg_item_id,
        fg_item_name: l.fg_items?.name,
        is_bulk: !l.packet_size && !l.production_headers?.id,
        packet_size: size,
        size_unit: sUnit,
        qty: l.qty,
        unit_price: l.unit_price,
        availableQty: null,
      };
    });
    setLines(parsedLines);
    setIsModalOpen(true);
  };

  const emptyLine = () => ({
    id: Date.now(),
    item_type: "fg",            // 'fg' | 'raw'
    // FG fields
    prod_line_id: "",
    batch_id: "",
    fg_item_id: "",
    fg_item_name: "",
    is_bulk: false,
    // Raw fields
    raw_item_id: "",
    raw_item_name: "",
    raw_sale_mode: "bulk",      // 'bulk' | 'packets'
    // Shared
    packet_size: "",
    size_unit: "g",
    qty: "",
    unit_price: "",
    availableQty: null,
  });

  const closeModal = () => {
    setIsModalOpen(false);
    setEditingId(null);
    setBillNo("");
    setCustomerId("");
    setDate(format(new Date(), "yyyy-MM-dd"));
    setLines([emptyLine()]);
  };

  const handlePrint = (row) => {
    setViewTarget(row);
    setTimeout(() => { window.print(); }, 300);
  };

  useEffect(() => {
    const afterPrint = () => setViewTarget(null);
    window.addEventListener("afterprint", afterPrint);
    return () => window.removeEventListener("afterprint", afterPrint);
  }, []);

  const addLine = () => {
    setLines([...lines, emptyLine()]);
  };

  // ── FG batch lookup ────────────────────────────────────────────────────────
  const selectBatchLine = async (lineId, prodLineId) => {
    const batchLine = batches.find((b) => b.id === prodLineId);
    if (!batchLine) {
      setLines(
        lines.map((l) =>
          l.id === lineId
            ? {
                ...l,
                prod_line_id: "",
                batch_id: "",
                fg_item_id: "",
                fg_item_name: "",
                packet_size: "",
                availableQty: null,
              }
            : l,
        ),
      );
      return;
    }

    const { data: soldRows } = await supabase
      .from("sales_lines")
      .select("qty, packet_size")
      .eq("production_line_id", prodLineId);

    const isBulk = !batchLine.qty_per_packet;
    const totalSoldConsumed = soldRows
      ? soldRows.reduce((s, r) => {
          const v = isBulk
            ? Number(r.qty) * (r.packet_size || 0)
            : Number(r.qty);
          return s + v;
        }, 0)
      : 0;

    const batchCapacity = Number(batchLine.total_qty);
    const availableUnits = Math.max(0, batchCapacity - totalSoldConsumed);

    setLines(
      lines.map((l) =>
        l.id === lineId
          ? {
              ...l,
              prod_line_id: prodLineId,
              batch_id: batchLine.production_headers?.id,
              fg_item_id: batchLine.fg_item_id,
              fg_item_name: batchLine.fg_items?.name,
              is_bulk: !batchLine.qty_per_packet,
              packet_size: batchLine.qty_per_packet || "",
              size_unit: "g",
              availableQty: availableUnits,
            }
          : l,
      ),
    );
  };

  // ── Raw item pick ──────────────────────────────────────────────────────────
  const selectRawItem = (lineId, rawItemId) => {
    const ri = rawItems.find((r) => r.id === rawItemId);
    if (!ri) {
      setLines(
        lines.map((l) =>
          l.id === lineId
            ? { ...l, raw_item_id: "", raw_item_name: "", availableQty: null }
            : l,
        ),
      );
      return;
    }
    const bal = getRawBalance(rawItemId);
    setLines(
      lines.map((l) =>
        l.id === lineId
          ? {
              ...l,
              raw_item_id: rawItemId,
              raw_item_name: ri.name,
              availableQty: bal,
            }
          : l,
      ),
    );
  };

  const updateLine = (id, field, value) => {
    setLines(lines.map((l) => (l.id === id ? { ...l, [field]: value } : l)));
  };

  // Switching item_type resets fields
  const changeItemType = (lineId, newType) => {
    setLines(
      lines.map((l) =>
        l.id === lineId
          ? {
              ...emptyLine(),
              id: l.id,
              item_type: newType,
            }
          : l,
      ),
    );
  };

  const removeLine = (id) => {
    setLines(lines.filter((l) => l.id !== id));
  };

  const calculateTotal = () => {
    return lines.reduce(
      (acc, l) => acc + Number(l.qty) * Number(l.unit_price),
      0,
    );
  };

  const formatPacketSize = (val) => {
    const g = Number(val);
    if (!g) return val;
    return g >= 1000 ? `${g / 1000}kg` : `${g}g`;
  };

  // ── SUBMIT ─────────────────────────────────────────────────────────────────
  const handleSubmit = async (e) => {
    e.preventDefault();
    if (lines.length === 0) return toast.error("Add at least one item line");

    for (const l of lines) {
      if (l.item_type === "raw") {
        if (!l.raw_item_id) return toast.error("Select a raw item for each raw line");
        if (!l.qty || Number(l.qty) <= 0) return toast.error("Enter a valid qty for each line");
        if (Number(l.unit_price) < 0) return toast.error("Unit price cannot be negative");

        const rawUom = getRawItemUom(l.raw_item_id);

        if (l.raw_sale_mode === "packets") {
          if (!l.packet_size || Number(l.packet_size) <= 0)
            return toast.error(`Enter packet size for ${l.raw_item_name}`);

          // Convert packet_size to native UOM for comparison
          const pSizeNative = packetSizeInNativeUom(l.packet_size, l.size_unit, rawUom);
          const totalNeeded = Number(l.qty) * pSizeNative;

          if (l.availableQty !== null && totalNeeded > l.availableQty) {
            return toast.error(
              `Not enough raw stock for ${l.raw_item_name}. Needed: ${totalNeeded.toFixed(3)} ${rawUom}, Available: ${l.availableQty} ${rawUom}`,
            );
          }
        } else {
          // bulk: qty is directly in raw item's native UOM
          if (l.availableQty !== null && Number(l.qty) > l.availableQty) {
            return toast.error(
              `Not enough raw stock for ${l.raw_item_name}. Needed: ${l.qty} ${rawUom}, Available: ${l.availableQty} ${rawUom}`,
            );
          }
        }
      } else {
        // FG
        if (!l.fg_item_id || Number(l.qty) <= 0 || Number(l.unit_price) < 0) {
          return toast.error("Please fill all FG lines correctly");
        }
        if (l.is_bulk && !l.packet_size) {
          return toast.error(
            "Please specify a packet size for bulk FG items being sold as packets.",
          );
        }

        let pSize = l.packet_size ? Number(l.packet_size) : 0;
        if (l.is_bulk && l.size_unit === "kg") pSize = pSize * 1000;

        const totalGramsNeeded = l.is_bulk ? Number(l.qty) * pSize : Number(l.qty);
        if (totalGramsNeeded > l.availableQty) {
          return toast.error(
            `Not enough stock for ${l.fg_item_name}. Needed: ${totalGramsNeeded}, Available: ${l.availableQty}`,
          );
        }
      }
    }

    const linePayload = lines.map((l) => {
      if (l.item_type === "raw") {
        // Send packet_size in the raw item's native UOM so the DB stock check
        // uses the same unit as raw_stock_view.balance
        const rawUom = getRawItemUom(l.raw_item_id);
        let pSize = l.raw_sale_mode === "packets" && l.packet_size
          ? packetSizeInNativeUom(l.packet_size, l.size_unit, rawUom)
          : null;

        return {
          item_type: "raw",
          raw_item_id: l.raw_item_id,
          fg_item_id: null,
          qty: Number(l.qty),
          packet_size: pSize,
          unit_price: Number(l.unit_price),
          is_bulk: false,
          production_header_id: null,
          production_line_id: null,
        };
      }

      let pSize = l.packet_size ? Number(l.packet_size) : null;
      if (l.is_bulk && l.size_unit === "kg" && pSize) pSize = pSize * 1000;

      return {
        item_type: "fg",
        fg_item_id: l.fg_item_id,
        raw_item_id: null,
        qty: Number(l.qty),
        packet_size: pSize,
        unit_price: Number(l.unit_price),
        production_header_id: l.batch_id || null,
        production_line_id: l.prod_line_id || null,
        is_bulk: l.is_bulk || false,
      };
    });

    if (editingId) {
      const payload = {
        header_id: editingId,
        customer_id: customerId,
        date,
        lines: linePayload,
      };
      const { error } = await supabase.rpc("update_sales", { payload });
      if (error) {
        toast.error("Update Failed: " + error.message);
      } else {
        toast.success("Sale Updated Successfully!");
        closeModal();
        await fetchData();
        await fetchLookups();
      }
    } else {
      const payload = {
        bill_no: billNo,
        customer_id: customerId,
        date,
        lines: linePayload,
      };
      const { error } = await supabase.rpc("post_sales", { payload });
      if (error) {
        toast.error("Transaction Failed: " + error.message);
      } else {
        toast.success("Sale Posted Successfully!");
        closeModal();
        await fetchData();
        await fetchLookups();
      }
    }
  };

  // ── DELETE ─────────────────────────────────────────────────────────────────
  const handleDelete = async () => {
    if (!deleteTarget) return;
    const { error } = await supabase.rpc("delete_sales", {
      p_header_id: deleteTarget.id,
    });
    if (error) {
      toast.error("Delete Failed: " + error.message);
    } else {
      toast.success("Sale deleted and stock restored.");
      fetchData();
      fetchLookups();
    }
    setDeleteTarget(null);
  };

  const filteredData = data.filter(
    (item) =>
      item.bill_no.toLowerCase().includes(searchTerm.toLowerCase()) ||
      item.customers?.name.toLowerCase().includes(searchTerm.toLowerCase()),
  );

  // ── RENDER ─────────────────────────────────────────────────────────────────
  return (
    <div className="page-container">
      <div className="page-header-row">
        <div>
          <h2>Sales (Out)</h2>
          <p>Record finished goods & raw material sales to customers</p>
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
                <th style={{ textAlign: "center" }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filteredData.map((row) => (
                <tr key={row.id}>
                  <td>
                    <button
                      onClick={() => setViewTarget(row)}
                      style={{
                        background: "none",
                        border: "none",
                        padding: 0,
                        cursor: "pointer",
                        color: "#3b82f6",
                        fontWeight: 700,
                        textDecoration: "underline",
                      }}
                    >
                      {row.bill_no}
                    </button>
                  </td>
                  <td>{format(new Date(row.date), "MMM dd, yyyy")}</td>
                  <td>{row.customers?.name}</td>
                  <td>{row.sales_lines?.length || 0} items</td>
                  <td>LKR {Number(row.total_amount).toFixed(2)}</td>
                  <td style={{ textAlign: "center", whiteSpace: "nowrap" }}>
                    <button
                      className="btn-icon"
                      title="Print"
                      onClick={() => handlePrint(row)}
                      style={{ marginRight: "6px", color: "#64748b" }}
                    >
                      <Printer size={15} />
                    </button>
                    <button
                      className="btn-icon"
                      title="Edit"
                      onClick={() => openEditModal(row)}
                      style={{ marginRight: "6px", color: "#3b82f6" }}
                    >
                      <Pencil size={15} />
                    </button>
                    <button
                      className="btn-icon"
                      title="Delete"
                      onClick={() => setDeleteTarget(row)}
                      style={{ color: "#ef4444" }}
                    >
                      <Trash2 size={15} />
                    </button>
                  </td>
                </tr>
              ))}
              {filteredData.length === 0 && (
                <tr>
                  <td colSpan="6" className="empty-state">
                    No sales found.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        )}
      </div>

      {/* ── CREATE / EDIT MODAL ── */}
      {isModalOpen && (
        <div className="modal-backdrop">
          <div className="modal-content" style={{ maxWidth: "1200px" }}>
            <div className="modal-header">
              <h3>
                {editingId ? "Edit Sales Invoice" : "Create Sales Invoice"}
              </h3>
              <button className="btn-icon" onClick={closeModal}>
                <X size={20} />
              </button>
            </div>

            <form onSubmit={handleSubmit} className="modal-form">
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "1fr 1fr 1fr",
                  gap: "1rem",
                  marginBottom: "2rem",
                }}
              >
                <div className="form-group">
                  <label>Bill No</label>
                  <input
                    type="text"
                    value={billNo}
                    onChange={(e) => setBillNo(e.target.value)}
                    readOnly={!!editingId}
                    style={
                      editingId
                        ? { background: "#f1f5f9", cursor: "not-allowed" }
                        : {}
                    }
                    required
                  />
                </div>
                <div className="form-group">
                  <label>Date</label>
                  <input
                    type="date"
                    value={date}
                    onChange={(e) => setDate(e.target.value)}
                    required
                  />
                </div>
                <div className="form-group">
                  <label>Customer</label>
                  <select
                    value={customerId}
                    onChange={(e) => setCustomerId(e.target.value)}
                    required
                  >
                    <option value="">Select Customer</option>
                    {customers.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  marginBottom: "1rem",
                }}
              >
                <h4>Sale Items</h4>
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={addLine}
                >
                  <Plus size={16} /> Add Line
                </button>
              </div>

              <div style={{ overflowX: "auto" }}>
                <table className="data-table" style={{ marginBottom: "1rem", minWidth: "950px" }}>
                  <thead>
                    <tr>
                      <th style={{ width: "100px" }}>Type</th>
                      <th>Item / Batch</th>
                      <th style={{ width: "110px" }}>Mode</th>
                      <th style={{ width: "150px" }}>Packet Size</th>
                      <th style={{ width: "120px" }}>Qty</th>
                      <th style={{ width: "130px" }}>Unit Price (LKR)</th>
                      <th style={{ width: "100px" }}>Subtotal</th>
                      <th style={{ width: "36px" }}></th>
                    </tr>
                  </thead>
                  <tbody>
                    {lines.map((line) => (
                      <tr key={line.id}>
                        {/* ── TYPE TOGGLE ── */}
                        <td>
                          <select
                            className="form-group"
                            style={{ marginBottom: 0, minWidth: "90px", fontWeight: 700 }}
                            value={line.item_type}
                            onChange={(e) => changeItemType(line.id, e.target.value)}
                          >
                            <option value="fg">FG</option>
                            <option value="raw">Raw</option>
                          </select>
                        </td>

                        {/* ── ITEM / BATCH ── */}
                        <td>
                          {line.item_type === "raw" ? (
                            <select
                              className="form-group"
                              style={{ marginBottom: 0, minWidth: "200px" }}
                              value={line.raw_item_id}
                              onChange={(e) => selectRawItem(line.id, e.target.value)}
                            >
                              <option value="">Select Raw Item</option>
                              {rawItems.map((ri) => (
                                <option key={ri.id} value={ri.id}>
                                  {ri.name} ({ri.uom})
                                </option>
                              ))}
                            </select>
                          ) : (
                            <select
                              className="form-group"
                              style={{ marginBottom: 0, minWidth: "220px" }}
                              value={line.prod_line_id}
                              onChange={(e) =>
                                selectBatchLine(line.id, e.target.value)
                              }
                            >
                              <option value="">Select Batch Item</option>
                              {batches.map((b) => (
                                <option key={b.id} value={b.id}>
                                  {b.production_headers?.batch_no} -{" "}
                                  {b.fg_items?.name}{" "}
                                  {b.fg_items?.batch_code
                                    ? `[${b.fg_items.batch_code}]`
                                    : ""}{" "}
                                  (
                                  {b.qty_per_packet
                                    ? `${b.total_qty} pkts of ${formatPacketSize(b.qty_per_packet)}`
                                    : `Bulk ${formatPacketSize(b.total_qty)}`}
                                  )
                                </option>
                              ))}
                            </select>
                          )}
                          {/* show item name for FG lines */}
                          {line.item_type === "fg" && line.fg_item_name && (
                            <div style={{ fontSize: "0.8rem", color: "#64748b", marginTop: "2px" }}>
                              {line.fg_item_name}
                            </div>
                          )}
                        </td>

                        {/* ── MODE (Raw only) ── */}
                        <td>
                          {line.item_type === "raw" ? (
                            <select
                              className="form-group"
                              style={{ marginBottom: 0 }}
                              value={line.raw_sale_mode}
                              onChange={(e) =>
                                updateLine(line.id, "raw_sale_mode", e.target.value)
                              }
                            >
                              <option value="bulk">Bulk</option>
                              <option value="packets">Packets</option>
                            </select>
                          ) : (
                            <span style={{ fontSize: "0.8rem", color: "#94a3b8" }}>
                              {line.is_bulk ? "Bulk→Pkts" : "Packets"}
                            </span>
                          )}
                        </td>

                        {/* ── PACKET SIZE ── */}
                        <td>
                          {/* Raw packets OR FG bulk-to-packet: show size input */}
                          {(line.item_type === "raw" && line.raw_sale_mode === "packets") ||
                           (line.item_type === "fg" && line.is_bulk) ? (
                            <div style={{ display: "flex", alignItems: "center", gap: "4px" }}>
                              <input
                                className="form-group"
                                style={{ marginBottom: 0, width: "70px" }}
                                type="number"
                                min="0.1"
                                step="any"
                                value={line.packet_size}
                                onChange={(e) =>
                                  updateLine(line.id, "packet_size", e.target.value)
                                }
                                placeholder="e.g. 50"
                              />
                              <select
                                style={{
                                  border: "1px solid #e2e8f0",
                                  borderRadius: "6px",
                                  padding: "2px 4px",
                                  fontSize: "0.85rem",
                                  color: "#64748b",
                                  cursor: "pointer",
                                  background: "#f8fafc",
                                }}
                                value={line.size_unit || "g"}
                                onChange={(e) =>
                                  updateLine(line.id, "size_unit", e.target.value)
                                }
                              >
                                <option value="g">g</option>
                                <option value="kg">kg</option>
                              </select>
                            </div>
                          ) : (
                            /* FG fixed packet size (read-only) or Raw bulk (N/A) */
                            <span style={{ color: "#94a3b8", fontSize: "0.85rem" }}>
                              {line.item_type === "fg" && line.packet_size
                                ? formatPacketSize(line.packet_size)
                                : "—"}
                            </span>
                          )}
                        </td>

                        {/* ── QTY ── */}
                        <td>
                          <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
                            <input
                              className="form-group"
                              style={{ marginBottom: 0, width: "90px" }}
                              type="number"
                              min="0.001"
                              step="any"
                              value={line.qty}
                              onChange={(e) =>
                                updateLine(line.id, "qty", e.target.value)
                              }
                              placeholder={
                                line.item_type === "raw" && line.raw_sale_mode === "bulk"
                                  ? (rawItems.find(r => r.id === line.raw_item_id)?.uom || "qty")
                                  : "qty"
                              }
                              required
                            />
                            {/* Stock availability badge */}
                            {line.availableQty !== null && (
                              <span
                                style={{
                                  fontSize: "0.72rem",
                                  fontWeight: 600,
                                  padding: "2px 6px",
                                  borderRadius: "4px",
                                  whiteSpace: "nowrap",
                                  background:
                                    line.availableQty <= 0
                                      ? "#fee2e2"
                                      : line.availableQty < (line.item_type === "raw" ? 5 : 1000)
                                        ? "#fef9c3"
                                        : "#dcfce7",
                                  color:
                                    line.availableQty <= 0
                                      ? "#dc2626"
                                      : line.availableQty < (line.item_type === "raw" ? 5 : 1000)
                                        ? "#ca8a04"
                                        : "#16a34a",
                                }}
                              >
                                {line.item_type === "raw"
                                  ? `In stock: ${line.availableQty} ${rawItems.find(r => r.id === line.raw_item_id)?.uom || ""}`
                                  : line.is_bulk
                                    ? `In stock: ${formatPacketSize(line.availableQty)}`
                                    : `In stock: ${line.availableQty} pkts`}
                                {/* Needs label for raw packet mode — show in native UOM */}
                                {line.item_type === "raw" &&
                                  line.raw_sale_mode === "packets" &&
                                  line.packet_size &&
                                  line.qty && (() => {
                                    const rawUom = getRawItemUom(line.raw_item_id);
                                    const pSizeNative = packetSizeInNativeUom(
                                      line.packet_size, line.size_unit, rawUom
                                    );
                                    const totalNeeded = (Number(line.qty) * pSizeNative).toFixed(3);
                                    return (
                                      <span style={{ marginLeft: "4px", fontStyle: "italic", fontWeight: "normal" }}>
                                        (Needs {totalNeeded} {rawUom})
                                      </span>
                                    );
                                  })()}
                                {line.item_type === "fg" && line.is_bulk && line.packet_size && line.qty && (
                                  <span style={{ marginLeft: "4px", fontStyle: "italic", fontWeight: "normal" }}>
                                    (Needs{" "}
                                    {formatPacketSize(
                                      Number(line.qty) * Number(line.packet_size),
                                    )}
                                    )
                                  </span>
                                )}
                              </span>
                            )}
                          </div>
                        </td>

                        {/* ── UNIT PRICE ── */}
                        <td>
                          <div style={{ display: "flex", alignItems: "center", gap: "4px" }}>
                            <span style={{ fontSize: "0.8rem", color: "#64748b", fontWeight: 600 }}>
                              LKR
                            </span>
                            <input
                              className="form-group"
                              style={{ marginBottom: 0, width: "90px" }}
                              type="number"
                              min="0"
                              step="0.01"
                              value={line.unit_price}
                              onChange={(e) =>
                                updateLine(line.id, "unit_price", e.target.value)
                              }
                              required
                            />
                          </div>
                        </td>

                        {/* ── SUBTOTAL ── */}
                        <td>
                          LKR{" "}
                          {(Number(line.qty) * Number(line.unit_price)).toFixed(2)}
                        </td>

                        {/* ── REMOVE ── */}
                        <td>
                          <button
                            type="button"
                            className="btn-icon"
                            onClick={() => removeLine(line.id)}
                          >
                            <Trash2 size={16} />
                          </button>
                        </td>
                      </tr>
                    ))}
                    {lines.length === 0 && (
                      <tr>
                        <td
                          colSpan="8"
                          className="text-muted"
                          style={{ textAlign: "center" }}
                        >
                          No items added
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>

              <div
                style={{
                  textAlign: "right",
                  fontSize: "1.25rem",
                  marginBottom: "2rem",
                }}
              >
                <strong>Total: LKR {calculateTotal().toFixed(2)}</strong>
              </div>

              <div className="modal-actions">
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={closeModal}
                >
                  Cancel
                </button>
                <button type="submit" className="btn-primary">
                  {editingId ? "Update Sale" : "Post Sale (Update Stock)"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ── DELETE CONFIRM MODAL ── */}
      {deleteTarget && (
        <div className="modal-backdrop">
          <div className="modal-content" style={{ maxWidth: "420px" }}>
            <div className="modal-header">
              <h3>Confirm Delete</h3>
              <button
                className="btn-icon"
                onClick={() => setDeleteTarget(null)}
              >
                <X size={20} />
              </button>
            </div>
            <div className="modal-form">
              <p style={{ marginBottom: "1.5rem", color: "#475569" }}>
                Are you sure you want to delete invoice{" "}
                <strong>{deleteTarget.bill_no}</strong>?
                <br />
                <span style={{ color: "#ef4444", fontSize: "0.9rem" }}>
                  ⚠ This will restore the stock quantities sold in this invoice
                  (FG and Raw).
                </span>
              </p>
              <div className="modal-actions">
                <button
                  className="btn-secondary"
                  onClick={() => setDeleteTarget(null)}
                >
                  Cancel
                </button>
                <button
                  className="btn-primary"
                  onClick={handleDelete}
                  style={{ background: "#ef4444" }}
                >
                  Delete &amp; Restore Stock
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── BILL DETAIL MODAL ── */}
      {viewTarget && (
        <div className="modal-backdrop">
          <div className="modal-content" style={{ maxWidth: "700px" }}>
            <div className="modal-header">
              <div>
                <h3>{viewTarget.bill_no}</h3>
                <p style={{ margin: 0, fontSize: "0.85rem", color: "#64748b" }}>
                  {format(new Date(viewTarget.date), "MMM dd, yyyy")}
                  &nbsp;|&nbsp;{viewTarget.customers?.name}
                </p>
              </div>
              <div style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
                <button
                  className="btn-icon"
                  onClick={() => setViewTarget(null)}
                >
                  <X size={20} />
                </button>
              </div>
            </div>
            <div className="modal-form">
              <table className="data-table" style={{ marginBottom: "1rem" }}>
                <thead>
                  <tr>
                    <th>#</th>
                    <th>Type</th>
                    <th>Batch / Item</th>
                    <th>Product</th>
                    <th>Packet Size</th>
                    <th>Qty</th>
                    <th>Unit Price</th>
                    <th>Subtotal</th>
                  </tr>
                </thead>
                <tbody>
                  {(viewTarget.sales_lines || []).map((l, i) => (
                    <tr key={l.id}>
                      <td style={{ color: "#94a3b8" }}>{i + 1}</td>
                      <td>
                        <span
                          style={{
                            padding: "2px 8px",
                            borderRadius: "12px",
                            fontSize: "0.75rem",
                            fontWeight: 700,
                            background: l.item_type === "raw" ? "#fef9c3" : "#dcfce7",
                            color: l.item_type === "raw" ? "#92400e" : "#166534",
                          }}
                        >
                          {l.item_type === "raw" ? "Raw" : "FG"}
                        </span>
                      </td>
                      <td>
                        <strong>{l.production_headers?.batch_no || (l.item_type === "raw" ? "—" : "—")}</strong>
                      </td>
                      <td>
                        {l.item_type === "raw" ? l.raw_items?.name : l.fg_items?.name}
                      </td>
                      <td>
                        {l.packet_size ? formatPacketSize(l.packet_size) : "Bulk"}
                      </td>
                      <td>{Number(l.qty).toFixed(0)}</td>
                      <td>LKR {Number(l.unit_price).toFixed(2)}</td>
                      <td>LKR {Number(l.total_amount).toFixed(2)}</td>
                    </tr>
                  ))}
                  {(viewTarget.sales_lines || []).length === 0 && (
                    <tr>
                      <td colSpan="8" className="empty-state">
                        No lines found.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
              <div
                style={{
                  textAlign: "right",
                  fontSize: "1.1rem",
                  fontWeight: 700,
                  borderTop: "1px solid #e2e8f0",
                  paddingTop: "0.75rem",
                }}
              >
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
            <div className="invoice-top-left" style={{ fontWeight: "bold" }}>
              Invoice no{" "}
              <span style={{ marginLeft: "5px" }}>{viewTarget.bill_no}</span>
            </div>
            <div className="invoice-company-details">
              <h1 style={{ fontSize: "32px", marginBottom: "10px" }}>Amrona</h1>
              <h2>
                Spices Manufacturing, Distributing &<br />
                Exporting
              </h2>
              <p>Bubula Road, Pasyala.</p>
              <p>Tel +94 77 731 7550, +94 33 22 84129</p>
              <p>Email - amrona@gmail.com</p>
            </div>
            <div className="invoice-top-right"></div>
          </div>

          <div style={{ fontSize: "13px", marginBottom: "15px" }}>
            M/S{" "}
            <span className="mt-dotted" style={{ width: "90%" }}>
              {viewTarget.customers?.name || "Cash Customer"}
            </span>
          </div>

          <div className="invoice-meta">
            <div>
              Order No -{" "}
              <span className="mt-dotted" style={{ width: "60px" }}></span>
            </div>
            <div>
              Job No -{" "}
              <span className="mt-dotted" style={{ width: "60px" }}></span>
            </div>
            <div>
              Date - {new Date(viewTarget.date).toLocaleDateString("en-GB")}
            </div>
          </div>

          {/* --- TABLE --- */}
          <table className="invoice-table">
            <thead>
              <tr>
                <th style={{ width: "45px" }}>Qty</th>
                <th>Particulars</th>
                <th style={{ width: "80px" }}>Rate</th>
                <th style={{ width: "100px" }}>Amount</th>
              </tr>
            </thead>
            <tbody>
              {Array.from({
                length: Math.max(14, (viewTarget.sales_lines || []).length),
              }).map((_, i) => {
                const l = viewTarget.sales_lines?.[i];
                const itemName = l
                  ? l.item_type === "raw"
                    ? l.raw_items?.name
                    : l.fg_items?.name
                  : "";
                return (
                  <tr key={i}>
                    <td className="center" style={{ fontWeight: "bold" }}>
                      {l ? Number(l.qty).toFixed(0) : ""}
                    </td>
                    <td>
                      {l
                        ? `${itemName} ${l.packet_size ? formatPacketSize(l.packet_size) : "(Bulk)"}${l.item_type === "raw" ? " [Raw]" : ""}`
                        : ""}
                    </td>
                    <td className="num">
                      {l ? Number(l.unit_price).toFixed(2) : ""}
                    </td>
                    <td className="num">
                      {l ? Number(l.total_amount).toFixed(2) : ""}
                    </td>
                  </tr>
                );
              })}
              <tr>
                <td colSpan="2" style={{ border: "none" }}></td>
                <td
                  className="center"
                  style={{
                    fontWeight: "bold",
                    fontSize: "14px",
                    border: "none",
                  }}
                >
                  Total
                </td>
                <td
                  className="num"
                  style={{
                    fontWeight: "bold",
                    borderBottom: "3px double black",
                  }}
                >
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
          <div className="invoice-reg">Registered No-W/M/BNR/10243</div>
        </div>
      )}
    </div>
  );
}
