-- ============================================================
-- Migration 15: Fix update_sales stock check
--
-- Problem: update_sales was using flawed stock-check logic that
-- failed when packet_size was stored in grams (e.g. 1000g = 1kg).
-- After deleting the old ledger rows the stock IS restored, but the
-- subsequent SELECT from fg_stock_view used the wrong branch and
-- raised "Insufficient FG Stock" even when plenty of stock existed.
--
-- Fix: rewrite update_sales so that, after reversing the old
-- ledger, it applies exactly the same stock-check + ledger-insert
-- logic as post_sales. This guarantees consistency and fixes all
-- edge-cases (bulk FG, packet FG, raw items).
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

    -- ── Step 1: Reverse the previous sale (restore stock) ──────────────────
    DELETE FROM stock_ledger_fg  WHERE reference_id = p_header_id AND transaction_type = 'SALES';
    DELETE FROM stock_ledger_raw WHERE reference_id = p_header_id AND transaction_type = 'SALES';
    DELETE FROM sales_lines WHERE sales_header_id = p_header_id;

    UPDATE sales_headers
    SET customer_id = (payload->>'customer_id')::UUID,
        date        = (payload->>'date')::DATE
    WHERE id = p_header_id;

    -- ── Step 2: Re-post each line (same logic as post_sales) ───────────────
    FOR line IN SELECT * FROM jsonb_array_elements(payload->'lines')
    LOOP
        i_type       := COALESCE(line->>'item_type', 'fg');
        p_size       := CASE WHEN (line->>'packet_size') IS NULL OR (line->>'packet_size') = ''
                             THEN NULL ELSE (line->>'packet_size')::NUMERIC END;
        orig_qty     := (line->>'qty')::NUMERIC;
        is_bulk_flag := COALESCE((line->>'is_bulk')::BOOLEAN, FALSE);

        -- ── RAW ITEM LINE ──────────────────────────────────────────────────
        IF i_type = 'raw' THEN
            IF p_size IS NOT NULL THEN
                ledger_qty    := orig_qty * p_size;
                ledger_p_size := NULL;
            ELSE
                ledger_qty    := orig_qty;
                ledger_p_size := NULL;
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

        -- ── FG ITEM LINE ───────────────────────────────────────────────────
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
                -- Normal packet or bulk sale – look for exact packet_size match first
                SELECT balance INTO current_stock
                FROM fg_stock_view
                WHERE fg_item_id = (line->>'fg_item_id')::UUID
                  AND (packet_size = p_size OR (packet_size IS NULL AND p_size IS NULL))
                LIMIT 1;

                IF current_stock IS NULL AND p_size IS NOT NULL THEN
                    -- No exact match – fall back to bulk stock and deduct in grams
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
                    -- ledger_qty and ledger_p_size already set above
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
