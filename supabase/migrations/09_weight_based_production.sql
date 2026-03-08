-- Migration 09: Weight Based FG Stock Ledger

-- 1. Drop constraints and alter columns
ALTER TABLE production_lines ALTER COLUMN qty_per_packet DROP NOT NULL;
ALTER TABLE sales_lines ADD COLUMN IF NOT EXISTS packet_size NUMERIC(10, 2);

-- 2. Convert historical fg_stock to grams
-- Convert PRODUCTION qty_in
UPDATE stock_ledger_fg sl
SET qty_in = sl.qty_in * COALESCE((
    SELECT pl.qty_per_packet
    FROM production_lines pl
    WHERE pl.production_header_id = sl.reference_id AND pl.fg_item_id = sl.fg_item_id
    LIMIT 1
), 1)
WHERE transaction_type = 'PRODUCTION';

-- Convert SALES qty_out
UPDATE stock_ledger_fg sl
SET qty_out = sl.qty_out * COALESCE((
    SELECT pl.qty_per_packet
    FROM sales_lines s
    LEFT JOIN production_lines pl ON s.production_line_id = pl.id
    WHERE s.sales_header_id = sl.reference_id AND s.fg_item_id = sl.fg_item_id
    LIMIT 1
), (
    SELECT pl.qty_per_packet
    FROM sales_lines s
    LEFT JOIN production_headers ph ON s.production_header_id = ph.id
    LEFT JOIN production_lines pl ON ph.id = pl.production_header_id AND pl.fg_item_id = s.fg_item_id
    WHERE s.sales_header_id = sl.reference_id AND s.fg_item_id = sl.fg_item_id
    LIMIT 1
), 1)
WHERE transaction_type = 'SALES';

-- Set historical sales_lines.packet_size
UPDATE sales_lines s
SET packet_size = COALESCE((
    SELECT pl.qty_per_packet
    FROM production_lines pl
    WHERE pl.id = s.production_line_id
), (
    SELECT pl.qty_per_packet
    FROM production_headers ph
    LEFT JOIN production_lines pl ON ph.id = pl.production_header_id AND pl.fg_item_id = s.fg_item_id
    WHERE ph.id = s.production_header_id
    LIMIT 1
), 1);

-- Finally, update production_lines total_qty to be in grams
UPDATE production_lines
SET total_qty = total_qty * COALESCE(qty_per_packet, 1)
WHERE qty_per_packet IS NOT NULL;


-- ============================================================
-- post_production (Grams based)
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
        INSERT INTO production_lines (production_header_id, fg_item_id, total_qty)
        VALUES (
            new_header_id,
            (prod_line->>'fg_item_id')::UUID,
            (prod_line->>'total_qty')::NUMERIC
        );

        INSERT INTO stock_ledger_fg (transaction_type, reference_id, fg_item_id, qty_in)
        VALUES ('PRODUCTION', new_header_id,
                (prod_line->>'fg_item_id')::UUID,
                (prod_line->>'total_qty')::NUMERIC);
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
-- update_production (Grams based)
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
        INSERT INTO production_lines (production_header_id, fg_item_id, total_qty)
        VALUES (
            p_header_id,
            (prod_line->>'fg_item_id')::UUID,
            (prod_line->>'total_qty')::NUMERIC
        );

        INSERT INTO stock_ledger_fg (transaction_type, reference_id, fg_item_id, qty_in)
        VALUES ('PRODUCTION', p_header_id,
                (prod_line->>'fg_item_id')::UUID,
                (prod_line->>'total_qty')::NUMERIC);
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
-- post_sales (Packet sizes)
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
    total_grams   NUMERIC;
BEGIN
    INSERT INTO sales_headers (bill_no, customer_id, date)
    VALUES (
        payload->>'bill_no',
        (payload->>'customer_id')::UUID,
        (payload->>'date')::DATE
    ) RETURNING id INTO new_header_id;

    FOR line IN SELECT * FROM jsonb_array_elements(payload->'lines')
    LOOP
        total_grams := (line->>'qty')::NUMERIC * (line->>'packet_size')::NUMERIC;
    
        SELECT balance INTO current_stock
        FROM fg_stock_view
        WHERE fg_item_id = (line->>'fg_item_id')::UUID;

        IF COALESCE(current_stock, 0) < total_grams THEN
            RAISE EXCEPTION 'Insufficient FG Stock for item %', (line->>'fg_item_id');
        END IF;

        INSERT INTO sales_lines
            (sales_header_id, fg_item_id, qty, unit_price, total_amount,
             production_header_id, production_line_id, packet_size)
        VALUES (
            new_header_id,
            (line->>'fg_item_id')::UUID,
            (line->>'qty')::NUMERIC,
            (line->>'unit_price')::NUMERIC,
            (line->>'qty')::NUMERIC * (line->>'unit_price')::NUMERIC,
            CASE WHEN line->>'production_header_id' IS NOT NULL
                  AND line->>'production_header_id' NOT IN ('null','')
                 THEN (line->>'production_header_id')::UUID ELSE NULL END,
            CASE WHEN line->>'production_line_id' IS NOT NULL
                  AND line->>'production_line_id' NOT IN ('null','')
                 THEN (line->>'production_line_id')::UUID ELSE NULL END,
            (line->>'packet_size')::NUMERIC
        );

        total_val := total_val + ((line->>'qty')::NUMERIC * (line->>'unit_price')::NUMERIC);

        INSERT INTO stock_ledger_fg (transaction_type, reference_id, fg_item_id, qty_out)
        VALUES ('SALES', new_header_id, (line->>'fg_item_id')::UUID, total_grams);
    END LOOP;

    UPDATE sales_headers SET total_amount = total_val WHERE id = new_header_id;
    RETURN jsonb_build_object('success', true, 'sales_header_id', new_header_id);
END;
$$;


-- ============================================================
-- update_sales (Packet sizes)
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
    total_grams   NUMERIC;
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
        total_grams := (line->>'qty')::NUMERIC * (line->>'packet_size')::NUMERIC;
    
        SELECT balance INTO current_stock FROM fg_stock_view WHERE fg_item_id = (line->>'fg_item_id')::UUID;
        IF COALESCE(current_stock, 0) < total_grams THEN
            RAISE EXCEPTION 'Insufficient FG stock for item %', (line->>'fg_item_id');
        END IF;

        INSERT INTO sales_lines
            (sales_header_id, fg_item_id, qty, unit_price, total_amount,
             production_header_id, production_line_id, packet_size)
        VALUES (
            p_header_id,
            (line->>'fg_item_id')::UUID,
            (line->>'qty')::NUMERIC,
            (line->>'unit_price')::NUMERIC,
            (line->>'qty')::NUMERIC * (line->>'unit_price')::NUMERIC,
            CASE WHEN line->>'production_header_id' IS NOT NULL
                  AND line->>'production_header_id' NOT IN ('null','')
                 THEN (line->>'production_header_id')::UUID ELSE NULL END,
            CASE WHEN line->>'production_line_id' IS NOT NULL
                  AND line->>'production_line_id' NOT IN ('null','')
                 THEN (line->>'production_line_id')::UUID ELSE NULL END,
            (line->>'packet_size')::NUMERIC
        );

        total_val := total_val + ((line->>'qty')::NUMERIC * (line->>'unit_price')::NUMERIC);

        INSERT INTO stock_ledger_fg (transaction_type, reference_id, fg_item_id, qty_out)
        VALUES ('SALES', p_header_id, (line->>'fg_item_id')::UUID, total_grams);
    END LOOP;

    UPDATE sales_headers SET total_amount = total_val WHERE id = p_header_id;
    RETURN jsonb_build_object('success', true);
END;
$$;
