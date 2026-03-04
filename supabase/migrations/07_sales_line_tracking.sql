-- ============================================================
-- Migration 07: Track sales per production_line (packet size)
-- Adds production_line_id to sales_lines so sold qty is
-- attributable to the exact batch+size combination.
-- Run in Supabase SQL Editor.
-- ============================================================

-- 1. Add production_line_id column to sales_lines
ALTER TABLE sales_lines
    ADD COLUMN IF NOT EXISTS production_line_id UUID REFERENCES production_lines(id);

-- ============================================================
-- 2. Updated post_sales — stores production_line_id per line
-- payload.lines: [{ fg_item_id, qty, unit_price,
--                    production_header_id, production_line_id }]
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
BEGIN
    INSERT INTO sales_headers (bill_no, customer_id, date)
    VALUES (
        payload->>'bill_no',
        (payload->>'customer_id')::UUID,
        (payload->>'date')::DATE
    ) RETURNING id INTO new_header_id;

    FOR line IN SELECT * FROM jsonb_array_elements(payload->'lines')
    LOOP
        SELECT balance INTO current_stock
        FROM fg_stock_view
        WHERE fg_item_id = (line->>'fg_item_id')::UUID;

        IF COALESCE(current_stock, 0) < (line->>'qty')::NUMERIC THEN
            RAISE EXCEPTION 'Insufficient FG Stock for item %', (line->>'fg_item_id');
        END IF;

        INSERT INTO sales_lines
            (sales_header_id, fg_item_id, qty, unit_price, total_amount,
             production_header_id, production_line_id)
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
                 THEN (line->>'production_line_id')::UUID ELSE NULL END
        );

        total_val := total_val + ((line->>'qty')::NUMERIC * (line->>'unit_price')::NUMERIC);

        INSERT INTO stock_ledger_fg (transaction_type, reference_id, fg_item_id, qty_out)
        VALUES ('SALES', new_header_id, (line->>'fg_item_id')::UUID, (line->>'qty')::NUMERIC);
    END LOOP;

    UPDATE sales_headers SET total_amount = total_val WHERE id = new_header_id;
    RETURN jsonb_build_object('success', true, 'sales_header_id', new_header_id);
END;
$$;

-- ============================================================
-- 3. Updated update_sales — same production_line_id support
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
        SELECT balance INTO current_stock FROM fg_stock_view WHERE fg_item_id = (line->>'fg_item_id')::UUID;
        IF COALESCE(current_stock, 0) < (line->>'qty')::NUMERIC THEN
            RAISE EXCEPTION 'Insufficient FG stock for item %', (line->>'fg_item_id');
        END IF;

        INSERT INTO sales_lines
            (sales_header_id, fg_item_id, qty, unit_price, total_amount,
             production_header_id, production_line_id)
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
                 THEN (line->>'production_line_id')::UUID ELSE NULL END
        );

        total_val := total_val + ((line->>'qty')::NUMERIC * (line->>'unit_price')::NUMERIC);

        INSERT INTO stock_ledger_fg (transaction_type, reference_id, fg_item_id, qty_out)
        VALUES ('SALES', p_header_id, (line->>'fg_item_id')::UUID, (line->>'qty')::NUMERIC);
    END LOOP;

    UPDATE sales_headers SET total_amount = total_val WHERE id = p_header_id;
    RETURN jsonb_build_object('success', true);
END;
$$;
