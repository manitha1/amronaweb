-- Migration 10: Multi UOM FG Stock

ALTER TABLE stock_ledger_fg ADD COLUMN IF NOT EXISTS packet_size NUMERIC(10, 2);

-- Revert 09 conversion for stock_ledger_fg and set packet_size
-- Since 09 multiplied qty_in by qty_per_packet, we divide it back if qty_per_packet is present.
UPDATE stock_ledger_fg sl
SET packet_size = (
    SELECT pl.qty_per_packet
    FROM production_lines pl
    WHERE pl.production_header_id = sl.reference_id AND pl.fg_item_id = sl.fg_item_id
    LIMIT 1
)
WHERE transaction_type = 'PRODUCTION';

UPDATE stock_ledger_fg
SET qty_in = qty_in / COALESCE(packet_size, 1)
WHERE transaction_type = 'PRODUCTION' AND packet_size > 0;

-- Now for SALES
UPDATE stock_ledger_fg sl
SET packet_size = COALESCE((
    SELECT s.packet_size
    FROM sales_lines s
    WHERE s.sales_header_id = sl.reference_id AND s.fg_item_id = sl.fg_item_id
    LIMIT 1
), (
    SELECT pl.qty_per_packet
    FROM sales_lines s
    LEFT JOIN production_headers ph ON s.production_header_id = ph.id
    LEFT JOIN production_lines pl ON ph.id = pl.production_header_id AND pl.fg_item_id = s.fg_item_id
    WHERE s.sales_header_id = sl.reference_id AND s.fg_item_id = sl.fg_item_id
    LIMIT 1
))
WHERE transaction_type = 'SALES';

UPDATE stock_ledger_fg
SET qty_out = qty_out / COALESCE(packet_size, 1)
WHERE transaction_type = 'SALES' AND packet_size > 0;

-- Also revert production_lines total_qty to be packet count (produced qty)
UPDATE production_lines
SET total_qty = total_qty / COALESCE(qty_per_packet, 1)
WHERE qty_per_packet > 0;

-- Recreate fg_stock_view to include packet_size
DROP VIEW IF EXISTS fg_stock_view;
CREATE VIEW fg_stock_view AS
SELECT 
    f.id AS fg_item_id,
    f.name AS fg_item_name,
    l.packet_size,
    COALESCE(SUM(l.qty_in), 0) AS total_in,
    COALESCE(SUM(l.qty_out), 0) AS total_out,
    COALESCE(SUM(l.qty_in) - SUM(l.qty_out), 0) AS balance
FROM fg_items f
LEFT JOIN stock_ledger_fg l ON f.id = l.fg_item_id
GROUP BY f.id, f.name, l.packet_size;

-- ============================================================
-- post_production (Multi-UOM based)
-- ============================================================
CREATE OR REPLACE FUNCTION post_production(payload JSONB)
RETURNS JSONB
LANGUAGE plpgsql
AS $$
DECLARE
    new_header_id UUID;
    prod_line     JSONB;
    consumption   JSONB;
    current_stock NUMERIC;
BEGIN
    INSERT INTO production_headers (batch_no, date, mfd, exp)
    VALUES (
        payload->>'batch_no',
        (payload->>'date')::DATE,
        (payload->>'mfd')::DATE,
        (payload->>'exp')::DATE
    ) RETURNING id INTO new_header_id;

    FOR prod_line IN SELECT * FROM jsonb_array_elements(payload->'prod_lines')
    LOOP
        INSERT INTO production_lines (production_header_id, fg_item_id, total_qty, qty_per_packet)
        VALUES (
            new_header_id,
            (prod_line->>'fg_item_id')::UUID,
            (prod_line->>'total_qty')::NUMERIC,
            CASE WHEN (prod_line->>'qty_per_packet') IS NULL OR (prod_line->>'qty_per_packet') = '' THEN NULL ELSE (prod_line->>'qty_per_packet')::NUMERIC END
        );

        INSERT INTO stock_ledger_fg (transaction_type, reference_id, fg_item_id, qty_in, packet_size)
        VALUES ('PRODUCTION', new_header_id,
                (prod_line->>'fg_item_id')::UUID,
                (prod_line->>'total_qty')::NUMERIC,
                CASE WHEN (prod_line->>'qty_per_packet') IS NULL OR (prod_line->>'qty_per_packet') = '' THEN NULL ELSE (prod_line->>'qty_per_packet')::NUMERIC END);
    END LOOP;

    FOR consumption IN SELECT * FROM jsonb_array_elements(payload->'consumptions')
    LOOP
        SELECT balance INTO current_stock
        FROM raw_stock_view
        WHERE raw_item_id = (consumption->>'raw_item_id')::UUID;

        IF COALESCE(current_stock, 0) < (consumption->>'qty')::NUMERIC THEN
            RAISE EXCEPTION 'Insufficient raw stock for item %', (consumption->>'raw_item_id');
        END IF;

        INSERT INTO production_consumptions (production_header_id, purchase_no, raw_item_id, qty)
        VALUES (
            new_header_id,
            (consumption->>'purchase_no')::UUID,
            (consumption->>'raw_item_id')::UUID,
            (consumption->>'qty')::NUMERIC
        );

        INSERT INTO stock_ledger_raw (transaction_type, reference_id, raw_item_id, qty_out)
        VALUES ('PRODUCTION', new_header_id,
                (consumption->>'raw_item_id')::UUID,
                (consumption->>'qty')::NUMERIC);
    END LOOP;

    RETURN jsonb_build_object('success', true, 'production_header_id', new_header_id);
END;
$$;

-- ============================================================
-- update_production (Multi-UOM based)
-- ============================================================
CREATE OR REPLACE FUNCTION update_production(payload JSONB)
RETURNS JSONB
LANGUAGE plpgsql
AS $$
DECLARE
    p_header_id   UUID;
    prod_line     JSONB;
    consumption   JSONB;
    current_stock NUMERIC;
BEGIN
    p_header_id := (payload->>'header_id')::UUID;

    DELETE FROM stock_ledger_fg  WHERE reference_id = p_header_id AND transaction_type = 'PRODUCTION';
    DELETE FROM stock_ledger_raw WHERE reference_id = p_header_id AND transaction_type = 'PRODUCTION';
    DELETE FROM production_lines        WHERE production_header_id = p_header_id;
    DELETE FROM production_consumptions WHERE production_header_id = p_header_id;

    UPDATE production_headers
    SET date = (payload->>'date')::DATE,
        mfd  = (payload->>'mfd')::DATE,
        exp  = (payload->>'exp')::DATE
    WHERE id = p_header_id;

    FOR prod_line IN SELECT * FROM jsonb_array_elements(payload->'prod_lines')
    LOOP
        INSERT INTO production_lines (production_header_id, fg_item_id, total_qty, qty_per_packet)
        VALUES (
            p_header_id,
            (prod_line->>'fg_item_id')::UUID,
            (prod_line->>'total_qty')::NUMERIC,
            CASE WHEN (prod_line->>'qty_per_packet') IS NULL OR (prod_line->>'qty_per_packet') = '' THEN NULL ELSE (prod_line->>'qty_per_packet')::NUMERIC END
        );

        INSERT INTO stock_ledger_fg (transaction_type, reference_id, fg_item_id, qty_in, packet_size)
        VALUES ('PRODUCTION', p_header_id,
                (prod_line->>'fg_item_id')::UUID,
                (prod_line->>'total_qty')::NUMERIC,
                CASE WHEN (prod_line->>'qty_per_packet') IS NULL OR (prod_line->>'qty_per_packet') = '' THEN NULL ELSE (prod_line->>'qty_per_packet')::NUMERIC END);
    END LOOP;

    FOR consumption IN SELECT * FROM jsonb_array_elements(payload->'consumptions')
    LOOP
        SELECT balance INTO current_stock
        FROM raw_stock_view
        WHERE raw_item_id = (consumption->>'raw_item_id')::UUID;

        IF COALESCE(current_stock, 0) < (consumption->>'qty')::NUMERIC THEN
            RAISE EXCEPTION 'Insufficient raw stock for item %', (consumption->>'raw_item_id');
        END IF;

        INSERT INTO production_consumptions (production_header_id, purchase_no, raw_item_id, qty)
        VALUES (
            p_header_id,
            (consumption->>'purchase_no')::UUID,
            (consumption->>'raw_item_id')::UUID,
            (consumption->>'qty')::NUMERIC
        );

        INSERT INTO stock_ledger_raw (transaction_type, reference_id, raw_item_id, qty_out)
        VALUES ('PRODUCTION', p_header_id,
                (consumption->>'raw_item_id')::UUID,
                (consumption->>'qty')::NUMERIC);
    END LOOP;

    RETURN jsonb_build_object('success', true);
END;
$$;

-- ============================================================
-- post_sales (Multi-UOM based)
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
BEGIN
    INSERT INTO sales_headers (bill_no, customer_id, date)
    VALUES (
        payload->>'bill_no',
        (payload->>'customer_id')::UUID,
        (payload->>'date')::DATE
    ) RETURNING id INTO new_header_id;

    FOR line IN SELECT * FROM jsonb_array_elements(payload->'lines')
    LOOP
        p_size := CASE WHEN (line->>'packet_size') IS NULL OR (line->>'packet_size') = '' THEN NULL ELSE (line->>'packet_size')::NUMERIC END;
        orig_qty := (line->>'qty')::NUMERIC;
        ledger_qty := orig_qty;
        ledger_p_size := p_size;

        -- Check if there is a specific variant stock, otherwise treat as bulk stock deduction
        SELECT balance INTO current_stock
        FROM fg_stock_view
        WHERE fg_item_id = (line->>'fg_item_id')::UUID
          AND (
            (packet_size = p_size AND p_size IS NOT NULL) OR 
            (packet_size IS NULL AND p_size IS NULL) OR
            (packet_size IS NULL AND p_size IS NOT NULL) -- Selling packets from bulk
          )
        ORDER BY CASE WHEN packet_size = p_size THEN 0 ELSE 1 END
        LIMIT 1;

        -- If it's a packet sale, but we are pulling from bulk (packet_size is null in view), calculate grams needed
        IF (SELECT packet_size FROM fg_stock_view WHERE fg_item_id = (line->>'fg_item_id')::UUID AND packet_size IS NULL LIMIT 1) IS NULL AND p_size IS NOT NULL THEN
            IF NOT EXISTS (SELECT 1 FROM fg_stock_view WHERE fg_item_id = (line->>'fg_item_id')::UUID AND packet_size = p_size LIMIT 1) THEN
                 -- Fallback to bulk check
                 IF COALESCE((SELECT balance FROM fg_stock_view WHERE fg_item_id = (line->>'fg_item_id')::UUID AND packet_size IS NULL LIMIT 1), 0) < (orig_qty * p_size) THEN
                    RAISE EXCEPTION 'Insufficient Bulk FG Stock for item % to make packets', (line->>'fg_item_id');
                 END IF;
                 -- Deduct from bulk
                 ledger_p_size := NULL;
                 -- The qty to deduct from bulk is qty * original p_size
                 ledger_qty := orig_qty * p_size;
            ELSE
                 IF COALESCE(current_stock, 0) < orig_qty THEN
                    RAISE EXCEPTION 'Insufficient FG Stock for item % (Size: %)', (line->>'fg_item_id'), p_size;
                 END IF;
            END IF;
        ELSE
             IF COALESCE(current_stock, 0) < orig_qty THEN
                RAISE EXCEPTION 'Insufficient FG Stock for item % (Size: %)', (line->>'fg_item_id'), p_size;
             END IF;
        END IF;

        INSERT INTO sales_lines
            (sales_header_id, fg_item_id, qty, unit_price, total_amount,
             production_header_id, production_line_id, packet_size)
        VALUES (
            new_header_id,
            (line->>'fg_item_id')::UUID,
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
    END LOOP;

    UPDATE sales_headers SET total_amount = total_val WHERE id = new_header_id;
    RETURN jsonb_build_object('success', true, 'sales_header_id', new_header_id);
END;
$$;

-- ============================================================
-- update_sales (Multi-UOM based)
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
BEGIN
    p_header_id := (payload->>'header_id')::UUID;

    DELETE FROM stock_ledger_fg WHERE reference_id = p_header_id AND transaction_type = 'SALES';
    DELETE FROM sales_lines WHERE sales_header_id = p_header_id;

    UPDATE sales_headers
    SET customer_id = (payload->>'customer_id')::UUID,
        date        = (payload->>'date')::DATE
    WHERE id = p_header_id;

    FOR line IN SELECT * FROM jsonb_array_elements(payload->'lines')
    LOOP
        p_size := CASE WHEN (line->>'packet_size') IS NULL OR (line->>'packet_size') = '' THEN NULL ELSE (line->>'packet_size')::NUMERIC END;
        orig_qty := (line->>'qty')::NUMERIC;
        ledger_qty := orig_qty;
        ledger_p_size := p_size;
        
        -- Check if there is a specific variant stock, otherwise treat as bulk stock deduction
        SELECT balance INTO current_stock
        FROM fg_stock_view
        WHERE fg_item_id = (line->>'fg_item_id')::UUID
          AND (
            (packet_size = p_size AND p_size IS NOT NULL) OR 
            (packet_size IS NULL AND p_size IS NULL) OR
            (packet_size IS NULL AND p_size IS NOT NULL) -- Selling packets from bulk
          )
        ORDER BY CASE WHEN packet_size = p_size THEN 0 ELSE 1 END
        LIMIT 1;

        -- If it's a packet sale, but we are pulling from bulk (packet_size is null in view), calculate grams needed
        IF (SELECT packet_size FROM fg_stock_view WHERE fg_item_id = (line->>'fg_item_id')::UUID AND packet_size IS NULL LIMIT 1) IS NULL AND p_size IS NOT NULL THEN
            IF NOT EXISTS (SELECT 1 FROM fg_stock_view WHERE fg_item_id = (line->>'fg_item_id')::UUID AND packet_size = p_size LIMIT 1) THEN
                 -- Fallback to bulk check
                 IF COALESCE((SELECT balance FROM fg_stock_view WHERE fg_item_id = (line->>'fg_item_id')::UUID AND packet_size IS NULL LIMIT 1), 0) < (orig_qty * p_size) THEN
                    RAISE EXCEPTION 'Insufficient Bulk FG Stock for item % to make packets', (line->>'fg_item_id');
                 END IF;
                 -- Deduct from bulk
                 ledger_p_size := NULL;
                 -- The qty to deduct from bulk is qty * original p_size
                 ledger_qty := orig_qty * p_size;
            ELSE
                 IF COALESCE(current_stock, 0) < orig_qty THEN
                    RAISE EXCEPTION 'Insufficient FG Stock for item % (Size: %)', (line->>'fg_item_id'), p_size;
                 END IF;
            END IF;
        ELSE
             IF COALESCE(current_stock, 0) < orig_qty THEN
                RAISE EXCEPTION 'Insufficient FG Stock for item % (Size: %)', (line->>'fg_item_id'), p_size;
             END IF;
        END IF;

        INSERT INTO sales_lines
            (sales_header_id, fg_item_id, qty, unit_price, total_amount,
             production_header_id, production_line_id, packet_size)
        VALUES (
            p_header_id,
            (line->>'fg_item_id')::UUID,
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
    END LOOP;

    UPDATE sales_headers SET total_amount = total_val WHERE id = p_header_id;
    RETURN jsonb_build_object('success', true);
END;
$$;
