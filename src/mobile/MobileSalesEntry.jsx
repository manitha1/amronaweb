import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../supabase';
import toast from 'react-hot-toast';
import { format } from 'date-fns';
import { Plus, Trash2, CheckCircle2, LogOut, ShoppingCart } from 'lucide-react';
import './mobile.css';

/* ─────────────────────────────────────────────────────────────────────────── */
/*  Helpers (mirrored from desktop Sales.jsx)                                 */
/* ─────────────────────────────────────────────────────────────────────────── */
const packetSizeInNativeUom = (sizeValue, sizeUnit, nativeUom) => {
  const sizeInGrams = sizeUnit === 'kg' ? Number(sizeValue) * 1000 : Number(sizeValue);
  return (nativeUom || '').toLowerCase() === 'kg' ? sizeInGrams / 1000 : sizeInGrams;
};

const formatPacketSize = (val) => {
  const g = Number(val);
  if (!g) return String(val);
  return g >= 1000 ? `${g / 1000}kg` : `${g}g`;
};

const emptyLine = () => ({
  id: Date.now() + Math.random(),
  item_type: 'fg',
  // FG
  prod_line_id: '', batch_id: '', fg_item_id: '', fg_item_name: '', is_bulk: false,
  // Raw
  raw_item_id: '', raw_item_name: '', raw_sale_mode: 'bulk',
  // Shared
  packet_size: '', size_unit: 'g', qty: '', unit_price: '', availableQty: null,
});

/* ─────────────────────────────────────────────────────────────────────────── */
export default function MobileSalesEntry() {
  const navigate = useNavigate();

  // ── Auth guard ──────────────────────────────────────────────────────────────
  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (!session) navigate('/mobile/login');
    });
  }, [navigate]);

  // ── Lookup data ─────────────────────────────────────────────────────────────
  const [customers, setCustomers]   = useState([]);
  const [batches, setBatches]       = useState([]);
  const [rawItems, setRawItems]     = useState([]);
  const [rawStock, setRawStock]     = useState([]);
  const [lookupReady, setLookupReady] = useState(false);

  // ── Form state ───────────────────────────────────────────────────────────────
  const [billNo, setBillNo]         = useState('');
  const [customerId, setCustomerId] = useState('');
  const [date, setDate]             = useState(format(new Date(), 'yyyy-MM-dd'));
  const [lines, setLines]           = useState([emptyLine()]);
  const [submitting, setSubmitting] = useState(false);
  const [confirmed, setConfirmed]   = useState(null);   // { billNo, total }

  /* ── Load lookups ───────────────────────────────────────────────────────── */
  const fetchLookups = useCallback(async () => {
    const [
      { data: c },
      { data: b },
      { data: ri },
      { data: rs },
    ] = await Promise.all([
      supabase.from('customers').select('id, name'),
      supabase
        .from('production_lines')
        .select(`id, fg_item_id, total_qty, qty_per_packet,
                 production_headers(id, batch_no, date),
                 fg_items(name, batch_code)`)
        .order('production_headers(date)', { ascending: false }),
      supabase.from('raw_items').select('id, name, uom').order('name'),
      supabase.from('raw_stock_view').select('raw_item_id, raw_item_name, balance'),
    ]);

    if (c) setCustomers(c);
    if (b) {
      const sorted = [...b].sort((x, y) =>
        (x.fg_items?.name || '').toLowerCase().localeCompare((y.fg_items?.name || '').toLowerCase())
      );
      setBatches(sorted);
    }
    if (ri) setRawItems(ri);
    if (rs) setRawStock(rs);
    setLookupReady(true);
  }, []);

  /* ── Generate next bill number ──────────────────────────────────────────── */
  const generateBillNo = useCallback(async () => {
    const { data: rows } = await supabase
      .from('sales_headers')
      .select('bill_no')
      .ilike('bill_no', 'INV-%')
      .order('bill_no', { ascending: false })
      .limit(1);

    let next = 1;
    if (rows && rows.length > 0) {
      const parts = rows[0].bill_no.split('-');
      const n = parseInt(parts[1], 10);
      if (!isNaN(n)) next = n + 1;
    }
    return `INV-${String(next).padStart(4, '0')}`;
  }, []);

  useEffect(() => {
    fetchLookups();
    generateBillNo().then(setBillNo);
  }, [fetchLookups, generateBillNo]);

  /* ── Helpers ────────────────────────────────────────────────────────────── */
  const getRawBalance = (rawItemId) => {
    const row = rawStock.find((r) => r.raw_item_id === rawItemId);
    return row ? Number(row.balance) : 0;
  };

  const getRawUom = (rawItemId) =>
    rawItems.find((r) => r.id === rawItemId)?.uom || '';

  /* ── Line operations ────────────────────────────────────────────────────── */
  const updateLine = (id, field, value) =>
    setLines((prev) => prev.map((l) => (l.id === id ? { ...l, [field]: value } : l)));

  const removeLine = (id) =>
    setLines((prev) => prev.filter((l) => l.id !== id));

  const changeItemType = (lineId, newType) =>
    setLines((prev) =>
      prev.map((l) => (l.id === lineId ? { ...emptyLine(), id: l.id, item_type: newType } : l))
    );

  /* ── FG batch select (async: compute available qty) ────────────────────── */
  const selectBatch = async (lineId, prodLineId) => {
    const batchLine = batches.find((b) => b.id === prodLineId);
    if (!batchLine) {
      setLines((prev) =>
        prev.map((l) =>
          l.id === lineId
            ? { ...l, prod_line_id: '', batch_id: '', fg_item_id: '', fg_item_name: '', availableQty: null }
            : l
        )
      );
      return;
    }

    const { data: soldRows } = await supabase
      .from('sales_lines')
      .select('qty, packet_size')
      .eq('production_line_id', prodLineId);

    const isBulk = !batchLine.qty_per_packet;
    const totalSold = soldRows
      ? soldRows.reduce((s, r) => s + (isBulk ? Number(r.qty) * (r.packet_size || 0) : Number(r.qty)), 0)
      : 0;

    const available = Math.max(0, Number(batchLine.total_qty) - totalSold);

    setLines((prev) =>
      prev.map((l) =>
        l.id === lineId
          ? {
              ...l,
              prod_line_id: prodLineId,
              batch_id: batchLine.production_headers?.id,
              fg_item_id: batchLine.fg_item_id,
              fg_item_name: batchLine.fg_items?.name,
              is_bulk: !batchLine.qty_per_packet,
              packet_size: batchLine.qty_per_packet || '',
              size_unit: 'g',
              availableQty: available,
            }
          : l
      )
    );
  };

  /* ── Raw item select ─────────────────────────────────────────────────────── */
  const selectRawItem = (lineId, rawItemId) => {
    const ri = rawItems.find((r) => r.id === rawItemId);
    if (!ri) {
      setLines((prev) =>
        prev.map((l) => (l.id === lineId ? { ...l, raw_item_id: '', raw_item_name: '', availableQty: null } : l))
      );
      return;
    }
    setLines((prev) =>
      prev.map((l) =>
        l.id === lineId
          ? { ...l, raw_item_id: rawItemId, raw_item_name: ri.name, availableQty: getRawBalance(rawItemId) }
          : l
      )
    );
  };

  /* ── Calculate total ────────────────────────────────────────────────────── */
  const total = lines.reduce((acc, l) => acc + Number(l.qty) * Number(l.unit_price), 0);

  /* ── Submit ─────────────────────────────────────────────────────────────── */
  const handleSubmit = async () => {
    if (!customerId) return toast.error('Please select a customer');
    if (lines.length === 0) return toast.error('Add at least one item line');

    // ── Validate each line ──
    for (const l of lines) {
      if (l.item_type === 'raw') {
        if (!l.raw_item_id) return toast.error('Select a raw item for each raw line');
        if (!l.qty || Number(l.qty) <= 0) return toast.error('Enter a valid qty');
        if (Number(l.unit_price) < 0)  return toast.error('Unit price cannot be negative');

        const rawUom = getRawUom(l.raw_item_id);
        if (l.raw_sale_mode === 'packets') {
          if (!l.packet_size || Number(l.packet_size) <= 0)
            return toast.error(`Enter packet size for ${l.raw_item_name}`);
          const pSizeNative = packetSizeInNativeUom(l.packet_size, l.size_unit, rawUom);
          const totalNeeded = Number(l.qty) * pSizeNative;
          if (l.availableQty !== null && totalNeeded > l.availableQty)
            return toast.error(
              `Not enough stock for ${l.raw_item_name}. Need: ${totalNeeded.toFixed(3)} ${rawUom}, Have: ${l.availableQty} ${rawUom}`
            );
        } else {
          if (l.availableQty !== null && Number(l.qty) > l.availableQty)
            return toast.error(
              `Not enough stock for ${l.raw_item_name}. Need: ${l.qty} ${rawUom}, Have: ${l.availableQty} ${rawUom}`
            );
        }
      } else {
        if (!l.fg_item_id || Number(l.qty) <= 0 || Number(l.unit_price) < 0)
          return toast.error('Please fill all FG lines correctly');
        if (l.is_bulk && !l.packet_size)
          return toast.error(`Specify a packet size for ${l.fg_item_name || 'bulk FG item'}`);

        let pSize = l.packet_size ? Number(l.packet_size) : 0;
        if (l.is_bulk && l.size_unit === 'kg') pSize *= 1000;
        const totalNeeded = l.is_bulk ? Number(l.qty) * pSize : Number(l.qty);
        if (totalNeeded > l.availableQty)
          return toast.error(
            `Not enough stock for ${l.fg_item_name}. Need: ${totalNeeded}, Have: ${l.availableQty}`
          );
      }
    }

    // ── Build payload ──
    const linePayload = lines.map((l) => {
      if (l.item_type === 'raw') {
        const rawUom = getRawUom(l.raw_item_id);
        const pSize =
          l.raw_sale_mode === 'packets' && l.packet_size
            ? packetSizeInNativeUom(l.packet_size, l.size_unit, rawUom)
            : null;
        return {
          item_type: 'raw',
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
      if (l.is_bulk && l.size_unit === 'kg' && pSize) pSize *= 1000;
      return {
        item_type: 'fg',
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

    setSubmitting(true);
    const { error } = await supabase.rpc('post_sales', {
      payload: { bill_no: billNo, customer_id: customerId, date, lines: linePayload },
    });
    setSubmitting(false);

    if (error) {
      toast.error('Failed: ' + error.message);
    } else {
      setConfirmed({ billNo, total });
    }
  };

  /* ── Start a new sale ───────────────────────────────────────────────────── */
  const startNewSale = async () => {
    await fetchLookups();
    const nextBill = await generateBillNo();
    setBillNo(nextBill);
    setCustomerId('');
    setDate(format(new Date(), 'yyyy-MM-dd'));
    setLines([emptyLine()]);
    setConfirmed(null);
  };

  /* ── Sign out ───────────────────────────────────────────────────────────── */
  const handleSignOut = async () => {
    await supabase.auth.signOut();
    navigate('/mobile/login');
  };

  /* ─────────────────────────────────────────────────────────────────────────
   *  CONFIRMATION SCREEN
   * ───────────────────────────────────────────────────────────────────────── */
  if (confirmed) {
    return (
      <div className="m-root">
        <div className="m-confirm-wrap">
          <div className="m-confirm-icon">
            <CheckCircle2 size={42} color="#16a34a" />
          </div>
          <h2>Sale Posted!</h2>
          <p>Invoice successfully recorded.</p>
          <div className="m-confirm-bill">{confirmed.billNo}</div>
          <p style={{ marginBottom: '0.15rem' }}>Total Amount</p>
          <p style={{ fontSize: '1.25rem', fontWeight: 700, color: '#1e293b', marginBottom: '2.5rem' }}>
            LKR {confirmed.total.toFixed(2)}
          </p>
          <button className="m-btn-primary" style={{ maxWidth: 320 }} onClick={startNewSale}>
            + New Sale
          </button>
          <button
            className="m-btn-secondary"
            style={{ marginTop: '0.85rem', width: '100%', maxWidth: 320, justifyContent: 'center' }}
            onClick={handleSignOut}
          >
            Sign Out
          </button>
        </div>
      </div>
    );
  }

  /* ─────────────────────────────────────────────────────────────────────────
   *  MAIN FORM
   * ───────────────────────────────────────────────────────────────────────── */
  return (
    <div className="m-root">
      {/* ── HEADER ── */}
      <div className="m-header">
        <div className="m-header-title">
          <span>
            <ShoppingCart size={14} style={{ display: 'inline', marginRight: 5 }} />
            New Sales Invoice
          </span>
          <span>Amrona Sales Portal</span>
        </div>
        <div className="m-header-actions">
          <button className="m-sign-out-btn" onClick={handleSignOut}>
            <LogOut size={13} style={{ display: 'inline', marginRight: 4 }} />
            Sign Out
          </button>
        </div>
      </div>

      <div className="m-body">
        {/* ── INFO GRID ── */}
        <p className="m-section-label">Invoice Details</p>
        <div className="m-info-grid">
          <div className="m-field">
            <label>Bill No</label>
            <input
              type="text"
              value={billNo}
              readOnly
              style={{ background: '#f1f5f9', cursor: 'not-allowed', fontWeight: 700 }}
            />
          </div>
          <div className="m-field">
            <label>Date</label>
            <input
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              required
            />
          </div>
          <div className="m-field m-field-full">
            <label>Customer</label>
            <select value={customerId} onChange={(e) => setCustomerId(e.target.value)} required>
              <option value="">Select Customer…</option>
              {customers.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          </div>
        </div>

        {/* ── LINE CARDS ── */}
        <p className="m-section-label">Sale Items ({lines.length})</p>

        {lines.map((line, idx) => (
          <LineCard
            key={line.id}
            line={line}
            idx={idx}
            batches={batches}
            rawItems={rawItems}
            lookupReady={lookupReady}
            onChangeType={changeItemType}
            onSelectBatch={selectBatch}
            onSelectRaw={selectRawItem}
            onUpdate={updateLine}
            onRemove={removeLine}
            formatPacketSize={formatPacketSize}
            getRawUom={getRawUom}
          />
        ))}

        <button className="m-add-line-btn" type="button" onClick={() => setLines((p) => [...p, emptyLine()])}>
          <Plus size={18} /> Add Item Line
        </button>

        {/* ── TOTAL ── */}
        <div className="m-total-band">
          <span className="m-total-label">Total Amount</span>
          <span className="m-total-value">LKR {total.toFixed(2)}</span>
        </div>
      </div>

      {/* ── FIXED BOTTOM BAR ── */}
      <div className="m-bottom-bar">
        <button className="m-btn-secondary" type="button" onClick={startNewSale}>
          Reset
        </button>
        <button
          className="m-btn-primary"
          type="button"
          onClick={handleSubmit}
          disabled={submitting}
        >
          {submitting ? <span className="m-spinner" /> : '✓ Post Sale & Update Stock'}
        </button>
      </div>
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────────────────── */
/*  LineCard sub-component                                                    */
/* ─────────────────────────────────────────────────────────────────────────── */
function LineCard({
  line, idx, batches, rawItems, lookupReady,
  onChangeType, onSelectBatch, onSelectRaw, onUpdate, onRemove,
  formatPacketSize, getRawUom,
}) {
  const stockBadgeClass = (avail) => {
    if (avail === null) return '';
    if (avail <= 0) return 'm-stock-badge empty';
    if (avail < 5)  return 'm-stock-badge warn';
    return 'm-stock-badge ok';
  };

  const stockLabel = (line) => {
    if (line.availableQty === null) return null;
    if (line.item_type === 'raw') {
      return `In stock: ${line.availableQty} ${getRawUom(line.raw_item_id)}`;
    }
    return line.is_bulk
      ? `In stock: ${formatPacketSize(line.availableQty)}`
      : `In stock: ${line.availableQty} pkts`;
  };

  const showPacketSizeInput =
    (line.item_type === 'raw' && line.raw_sale_mode === 'packets') ||
    (line.item_type === 'fg'  && line.is_bulk);

  return (
    <div className="m-line-card">
      {/* ── Card header ── */}
      <div className="m-line-card-header">
        <span className="m-line-num">Item {idx + 1}</span>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          {/* FG / Raw toggle */}
          <div className="m-type-toggle">
            <button
              type="button"
              className={line.item_type === 'fg' ? 'active' : ''}
              onClick={() => onChangeType(line.id, 'fg')}
            >FG</button>
            <button
              type="button"
              className={line.item_type === 'raw' ? 'active' : ''}
              onClick={() => onChangeType(line.id, 'raw')}
            >Raw</button>
          </div>
          <button className="m-btn-danger" type="button" onClick={() => onRemove(line.id)}>
            <Trash2 size={16} />
          </button>
        </div>
      </div>

      {/* ── Item selector ── */}
      {line.item_type === 'fg' ? (
        <div className="m-field">
          <label>Batch / FG Item</label>
          <select
            value={line.prod_line_id}
            onChange={(e) => onSelectBatch(line.id, e.target.value)}
            disabled={!lookupReady}
          >
            <option value="">Select Batch…</option>
            {batches.map((b) => (
              <option key={b.id} value={b.id}>
                {b.production_headers?.batch_no} – {b.fg_items?.name}
                {b.fg_items?.batch_code ? ` [${b.fg_items.batch_code}]` : ''}{' '}
                ({b.qty_per_packet
                  ? `${b.total_qty} pkts of ${formatPacketSize(b.qty_per_packet)}`
                  : `Bulk ${formatPacketSize(b.total_qty)}`})
              </option>
            ))}
          </select>
          {line.fg_item_name && (
            <span style={{ fontSize: '0.78rem', color: '#16a34a', fontWeight: 600, marginTop: 2 }}>
              {line.fg_item_name}
            </span>
          )}
        </div>
      ) : (
        <>
          <div className="m-field">
            <label>Raw Item</label>
            <select
              value={line.raw_item_id}
              onChange={(e) => onSelectRaw(line.id, e.target.value)}
              disabled={!lookupReady}
            >
              <option value="">Select Raw Item…</option>
              {rawItems.map((ri) => (
                <option key={ri.id} value={ri.id}>{ri.name} ({ri.uom})</option>
              ))}
            </select>
          </div>
          <div className="m-field">
            <label>Sale Mode</label>
            <select
              value={line.raw_sale_mode}
              onChange={(e) => onUpdate(line.id, 'raw_sale_mode', e.target.value)}
            >
              <option value="bulk">Bulk</option>
              <option value="packets">Packets</option>
            </select>
          </div>
        </>
      )}

      {/* ── Packet size (raw-packets or FG-bulk) ── */}
      {showPacketSizeInput && (
        <div className="m-field">
          <label>Packet Size</label>
          <div className="m-pkt-row">
            <input
              type="number"
              min="0.1"
              step="any"
              value={line.packet_size}
              onChange={(e) => onUpdate(line.id, 'packet_size', e.target.value)}
              placeholder="e.g. 100"
            />
            <select
              className="m-pkt-unit"
              value={line.size_unit || 'g'}
              onChange={(e) => onUpdate(line.id, 'size_unit', e.target.value)}
            >
              <option value="g">g</option>
              <option value="kg">kg</option>
            </select>
          </div>
        </div>
      )}

      {/* ── FG fixed packet size (read-only label) ── */}
      {line.item_type === 'fg' && !line.is_bulk && line.packet_size && (
        <div style={{ fontSize: '0.8rem', color: '#64748b', marginBottom: '0.6rem' }}>
          Packet size: <strong>{formatPacketSize(line.packet_size)}</strong>
        </div>
      )}

      {/* ── Stock badge ── */}
      {line.availableQty !== null && (
        <div className={stockBadgeClass(line.availableQty)} style={{ marginBottom: '0.75rem' }}>
          {stockLabel(line)}
        </div>
      )}

      {/* ── Qty + Price row ── */}
      <div className="m-price-row">
        <div className="m-field" style={{ marginBottom: 0 }}>
          <label>
            Qty{line.item_type === 'fg' && !line.is_bulk ? ' (pkts)' : ''}
            {line.item_type === 'raw' && line.raw_sale_mode === 'bulk'
              ? ` (${getRawUom(line.raw_item_id) || 'unit'})`
              : ''}
          </label>
          <input
            type="number"
            min="0.001"
            step="any"
            value={line.qty}
            onChange={(e) => onUpdate(line.id, 'qty', e.target.value)}
            placeholder="0"
            required
          />
        </div>
        <div className="m-field" style={{ marginBottom: 0 }}>
          <label>Unit Price (LKR)</label>
          <input
            type="number"
            min="0"
            step="0.01"
            inputMode="decimal"
            value={line.unit_price}
            onChange={(e) => onUpdate(line.id, 'unit_price', e.target.value)}
            placeholder="0.00"
            required
          />
        </div>
      </div>

      {/* ── Subtotal ── */}
      {line.qty && line.unit_price && (
        <div style={{ textAlign: 'right', marginTop: '0.6rem', fontSize: '0.88rem', fontWeight: 700, color: '#16a34a' }}>
          Subtotal: LKR {(Number(line.qty) * Number(line.unit_price)).toFixed(2)}
        </div>
      )}
    </div>
  );
}
