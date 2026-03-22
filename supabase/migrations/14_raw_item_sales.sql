-- ============================================================
-- Migration 14: Raw Item Sales Support
-- Allows raw materials to be sold directly (bulk or packets)
-- in sales_lines, deducting from stock_ledger_raw.
-- ============================================================

-- 1. Add item_type and raw_item_id to sales_lines
ALTER TABLE sales_lines
    ADD COLUMN IF NOT EXISTS item_type TEXT NOT NULL DEFAULT 'fg'
        CHECK (item_type IN ('fg', 'raw')),
    ADD COLUMN IF NOT EXISTS raw_item_id UUID REFERENCES raw_items(id);

-- Make fg_item_id nullable (raw lines won't have one)
ALTER TABLE sales_lines
    ALTER COLUMN fg_item_id DROP NOT NULL;

-- 2. Extend stock_ledger_raw to allow 'SALES' transaction type
ALTER TABLE stock_ledger_raw
    DROP CONSTRAINT IF EXISTS stock_ledger_raw_transaction_type_check;

ALTER TABLE stock_ledger_raw
    ADD CONSTRAINT stock_ledger_raw_transaction_type_check
    CHECK (transaction_type IN ('PURCHASE', 'PRODUCTION', 'SALES'));

-- ============================================================
-- 3. post_sales — handles both FG and Raw item lines
-- payload.lines fields:
--   item_type        : 'fg' | 'raw'
--   fg_item_id       : UUID (fg lines only)
--   raw_item_id      : UUID (raw lines only)
--   qty              : NUMERIC
--   unit_price       : NUMERIC
--   packet_size      : NUMERIC | null  (grams per packet, null = bulk)
--   is_bulk          : BOOLEAN (true when selling bulk-stored FG as packets)
--   production_header_id: UUID | null
--   production_line_id  : UUID | null
-- ============================================================
CREATE OR REPLACE FUNCTION post_sales(payload JSONB)
RETURNS JSONB
LANGUAGE plpgsql
AS $$
DECLARE
    new_header_id UUID;
    total_val     NUMERIC(15,2) := 0;
    line          JSONB;
    current_stock NUMERIC;
    p_size        NUMERIC;
    orig_qty      NUMERIC;
    ledger_qty    NUMERIC;
    ledger_p_size NUMERIC;
    is_bulk_flag  BOOLEAN;
    i_type        TEXT;
BEGIN
    INSERT INTO sales_headers (bill_no, customer_id, date)
    VALUES (
        payload->>'bill_no',
        (payload->>'customer_id')::UUID,
        (payload->>'date')::DATE
    ) RETURNING id INTO new_header_id;

    FOR line IN SELECT * FROM jsonb_array_elements(payload->'lines')
    LOOP
        i_type       := COALESCE(line->>'item_type', 'fg');
        p_size       := CASE WHEN (line->>'packet_size') IS NULL OR (line->>'packet_size') = ''
                             THEN NULL ELSE (line->>'packet_size')::NUMERIC END;
        orig_qty     := (line->>'qty')::NUMERIC;
        is_bulk_flag := COALESCE((line->>'is_bulk')::BOOLEAN, FALSE);

        -- ── RAW ITEM LINE ──────────────────────────────────────────
        IF i_type = 'raw' THEN
            -- packet_size present → selling N packets of p_size grams
            IF p_size IS NOT NULL THEN
                ledger_qty    := orig_qty * p_size;   -- total grams to deduct
                ledger_p_size := NULL;                 -- deduct from raw bulk stock
            ELSE
                -- bulk sale: qty is already in raw UOM (grams/kg as entered)
                ledger_qty    := orig_qty;
                ledger_p_size := NULL;
            END IF;

            -- Check raw stock
            SELECT balance INTO current_stock
            FROM raw_stock_view
            WHERE raw_item_id = (line->>'raw_item_id')::UUID;

            IF COALESCE(current_stock, 0) < ledger_qty THEN
                RAISE EXCEPTION 'Insufficient raw stock for item %. Needed: %, Available: %',
                    (line->>'raw_item_id'), ledger_qty, COALESCE(current_stock, 0);
            END IF;

            INSERT INTO sales_lines
                (sales_header_id, item_type, raw_item_id, fg_item_id,
                 qty, unit_price, total_amount, packet_size)
            VALUES (
                new_header_id, 'raw',
                (line->>'raw_item_id')::UUID, NULL,
                orig_qty,
                (line->>'unit_price')::NUMERIC,
                orig_qty * (line->>'unit_price')::NUMERIC,
                p_size
            );

            total_val := total_val + (orig_qty * (line->>'unit_price')::NUMERIC);

            -- Deduct raw stock
            INSERT INTO stock_ledger_raw (transaction_type, reference_id, raw_item_id, qty_out)
            VALUES ('SALES', new_header_id, (line->>'raw_item_id')::UUID, ledger_qty);

        -- ── FG ITEM LINE ───────────────────────────────────────────
        ELSE
            ledger_qty    := orig_qty;
            ledger_p_size := p_size;

            IF is_bulk_flag THEN
                -- Selling packets out of a bulk-stored FG batch
                SELECT balance INTO current_stock
                FROM fg_stock_view
                WHERE fg_item_id = (line->>'fg_item_id')::UUID
                  AND packet_size IS NULL
                LIMIT 1;

                IF COALESCE(current_stock, 0) < (orig_qty * COALESCE(p_size, 1)) THEN
                    RAISE EXCEPTION 'Insufficient Bulk FG Stock for item %', (line->>'fg_item_id');
                END IF;

                ledger_p_size := NULL;
                ledger_qty    := orig_qty * COALESCE(p_size, 1);
            ELSE
                SELECT balance INTO current_stock
                FROM fg_stock_view
                WHERE fg_item_id = (line->>'fg_item_id')::UUID
                  AND (packet_size = p_size OR (packet_size IS NULL AND p_size IS NULL))
                LIMIT 1;

                IF current_stock IS NULL AND p_size IS NOT NULL THEN
                    SELECT balance INTO current_stock
                    FROM fg_stock_view
                    WHERE fg_item_id = (line->>'fg_item_id')::UUID
                      AND packet_size IS NULL
                    LIMIT 1;

                    IF COALESCE(current_stock, 0) < (orig_qty * p_size) THEN
                        RAISE EXCEPTION 'Insufficient FG Stock for item % (Size: %)',
                            (line->>'fg_item_id'), p_size;
                    END IF;
                    ledger_p_size := NULL;
                    ledger_qty    := orig_qty * p_size;
                ELSE
                    IF COALESCE(current_stock, 0) < orig_qty THEN
                        RAISE EXCEPTION 'Insufficient FG Stock for item % (Size: %)',
                            (line->>'fg_item_id'), p_size;
                    END IF;
                END IF;
            END IF;

            INSERT INTO sales_lines
                (sales_header_id, item_type, fg_item_id, raw_item_id,
                 qty, unit_price, total_amount,
                 production_header_id, production_line_id, packet_size)
            VALUES (
                new_header_id, 'fg',
                (line->>'fg_item_id')::UUID, NULL,
                orig_qty,
                (line->>'unit_price')::NUMERIC,
                orig_qty * (line->>'unit_price')::NUMERIC,
                CASE WHEN line->>'production_header_id' IS NOT NULL AND line->>'production_header_id' NOT IN ('null','')
                     THEN (line->>'production_header_id')::UUID ELSE NULL END,
                CASE WHEN line->>'production_line_id' IS NOT NULL AND line->>'production_line_id' NOT IN ('null','')
                     THEN (line->>'production_line_id')::UUID ELSE NULL END,
                p_size
            );

            total_val := total_val + (orig_qty * (line->>'unit_price')::NUMERIC);

            INSERT INTO stock_ledger_fg (transaction_type, reference_id, fg_item_id, qty_out, packet_size)
            VALUES ('SALES', new_header_id, (line->>'fg_item_id')::UUID, ledger_qty, ledger_p_size);
        END IF;
    END LOOP;

    UPDATE sales_headers SET total_amount = total_val WHERE id = new_header_id;
    RETURN jsonb_build_object('success', true, 'sales_header_id', new_header_id);
END;
$$;


-- ============================================================
-- 4. update_sales — same branching, reverses both ledgers
-- ============================================================
CREATE OR REPLACE FUNCTION update_sales(payload JSONB)
RETURNS JSONB
LANGUAGE plpgsql
AS $$
DECLARE
    p_header_id   UUID;
    total_val     NUMERIC(15,2) := 0;
    line          JSONB;
    current_stock NUMERIC;
    p_size        NUMERIC;
    orig_qty      NUMERIC;
    ledger_qty    NUMERIC;
    ledger_p_size NUMERIC;
    is_bulk_flag  BOOLEAN;
    i_type        TEXT;
BEGIN
    p_header_id := (payload->>'header_id')::UUID;

    -- Reverse previous ledger entries for this sale
    DELETE FROM stock_ledger_fg  WHERE reference_id = p_header_id AND transaction_type = 'SALES';
    DELETE FROM stock_ledger_raw WHERE reference_id = p_header_id AND transaction_type = 'SALES';
    DELETE FROM sales_lines WHERE sales_header_id = p_header_id;

    UPDATE sales_headers
    SET customer_id = (payload->>'customer_id')::UUID,
        date        = (payload->>'date')::DATE
    WHERE id = p_header_id;

    FOR line IN SELECT * FROM jsonb_array_elements(payload->'lines')
    LOOP
        i_type       := COALESCE(line->>'item_type', 'fg');
        p_size       := CASE WHEN (line->>'packet_size') IS NULL OR (line->>'packet_size') = ''
                             THEN NULL ELSE (line->>'packet_size')::NUMERIC END;
        orig_qty     := (line->>'qty')::NUMERIC;
        is_bulk_flag := COALESCE((line->>'is_bulk')::BOOLEAN, FALSE);

        IF i_type = 'raw' THEN
            IF p_size IS NOT NULL THEN
                ledger_qty := orig_qty * p_size;
            ELSE
                ledger_qty := orig_qty;
            END IF;

            SELECT balance INTO current_stock
            FROM raw_stock_view
            WHERE raw_item_id = (line->>'raw_item_id')::UUID;

            IF COALESCE(current_stock, 0) < ledger_qty THEN
                RAISE EXCEPTION 'Insufficient raw stock for item %. Needed: %, Available: %',
                    (line->>'raw_item_id'), ledger_qty, COALESCE(current_stock, 0);
            END IF;

            INSERT INTO sales_lines
                (sales_header_id, item_type, raw_item_id, fg_item_id,
                 qty, unit_price, total_amount, packet_size)
            VALUES (
                p_header_id, 'raw',
                (line->>'raw_item_id')::UUID, NULL,
                orig_qty,
                (line->>'unit_price')::NUMERIC,
                orig_qty * (line->>'unit_price')::NUMERIC,
                p_size
            );

            total_val := total_val + (orig_qty * (line->>'unit_price')::NUMERIC);

            INSERT INTO stock_ledger_raw (transaction_type, reference_id, raw_item_id, qty_out)
            VALUES ('SALES', p_header_id, (line->>'raw_item_id')::UUID, ledger_qty);

        ELSE
            ledger_qty    := orig_qty;
            ledger_p_size := p_size;

            IF is_bulk_flag THEN
                SELECT balance INTO current_stock
                FROM fg_stock_view
                WHERE fg_item_id = (line->>'fg_item_id')::UUID
                  AND packet_size IS NULL
                LIMIT 1;

                IF COALESCE(current_stock, 0) < (orig_qty * COALESCE(p_size, 1)) THEN
                    RAISE EXCEPTION 'Insufficient Bulk FG Stock for item %', (line->>'fg_item_id');
                END IF;
                ledger_p_size := NULL;
                ledger_qty    := orig_qty * COALESCE(p_size, 1);
            ELSE
                SELECT balance INTO current_stock
                FROM fg_stock_view
                WHERE fg_item_id = (line->>'fg_item_id')::UUID
                  AND (packet_size = p_size OR (packet_size IS NULL AND p_size IS NULL))
                LIMIT 1;

                IF current_stock IS NULL AND p_size IS NOT NULL THEN
                    SELECT balance INTO current_stock
                    FROM fg_stock_view
                    WHERE fg_item_id = (line->>'fg_item_id')::UUID
                      AND packet_size IS NULL
                    LIMIT 1;

                    IF COALESCE(current_stock, 0) < (orig_qty * p_size) THEN
                        RAISE EXCEPTION 'Insufficient FG Stock for item % (Size: %)',
                            (line->>'fg_item_id'), p_size;
                    END IF;
                    ledger_p_size := NULL;
                    ledger_qty    := orig_qty * p_size;
                ELSE
                    IF COALESCE(current_stock, 0) < orig_qty THEN
                        RAISE EXCEPTION 'Insufficient FG Stock for item % (Size: %)',
                            (line->>'fg_item_id'), p_size;
                    END IF;
                END IF;
            END IF;

            INSERT INTO sales_lines
                (sales_header_id, item_type, fg_item_id, raw_item_id,
                 qty, unit_price, total_amount,
                 production_header_id, production_line_id, packet_size)
            VALUES (
                p_header_id, 'fg',
                (line->>'fg_item_id')::UUID, NULL,
                orig_qty,
                (line->>'unit_price')::NUMERIC,
                orig_qty * (line->>'unit_price')::NUMERIC,
                CASE WHEN line->>'production_header_id' IS NOT NULL AND line->>'production_header_id' NOT IN ('null','')
                     THEN (line->>'production_header_id')::UUID ELSE NULL END,
                CASE WHEN line->>'production_line_id' IS NOT NULL AND line->>'production_line_id' NOT IN ('null','')
                     THEN (line->>'production_line_id')::UUID ELSE NULL END,
                p_size
            );

            total_val := total_val + (orig_qty * (line->>'unit_price')::NUMERIC);

            INSERT INTO stock_ledger_fg (transaction_type, reference_id, fg_item_id, qty_out, packet_size)
            VALUES ('SALES', p_header_id, (line->>'fg_item_id')::UUID, ledger_qty, ledger_p_size);
        END IF;
    END LOOP;

    UPDATE sales_headers SET total_amount = total_val WHERE id = p_header_id;
    RETURN jsonb_build_object('success', true);
END;
$$;


-- ============================================================
-- 5. delete_sales — also reverses raw stock_ledger entries
-- ============================================================
CREATE OR REPLACE FUNCTION delete_sales(p_header_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
AS $$
BEGIN
    -- Reverse FG and Raw stock ledger entries
    DELETE FROM stock_ledger_fg  WHERE reference_id = p_header_id AND transaction_type = 'SALES';
    DELETE FROM stock_ledger_raw WHERE reference_id = p_header_id AND transaction_type = 'SALES';

    -- Delete lines (CASCADE also covers this, but be explicit)
    DELETE FROM sales_lines WHERE sales_header_id = p_header_id;

    -- Delete header
    DELETE FROM sales_headers WHERE id = p_header_id;

    RETURN jsonb_build_object('success', true);
END;
$$;
