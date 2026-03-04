-- ============================================================
-- Migration 06 (Part 2): Just the RPCs — columns already dropped
-- Run this in Supabase SQL Editor.
-- ============================================================

-- Ensure production_lines table exists
CREATE TABLE IF NOT EXISTS production_lines (
    id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    production_header_id UUID REFERENCES production_headers(id) ON DELETE CASCADE NOT NULL,
    fg_item_id           UUID REFERENCES fg_items(id) NOT NULL,
    qty_per_packet       NUMERIC(10, 2) NOT NULL CHECK (qty_per_packet > 0),
    total_qty            NUMERIC(10, 2) NOT NULL CHECK (total_qty > 0),
    created_at           TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- ============================================================
-- post_production (multi-pack)
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
        INSERT INTO production_lines (production_header_id, fg_item_id, qty_per_packet, total_qty)
        VALUES (
            new_header_id,
            (prod_line->>'fg_item_id')::UUID,
            (prod_line->>'qty_per_packet')::NUMERIC,
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
-- update_production (multi-pack)
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
        INSERT INTO production_lines (production_header_id, fg_item_id, qty_per_packet, total_qty)
        VALUES (
            p_header_id,
            (prod_line->>'fg_item_id')::UUID,
            (prod_line->>'qty_per_packet')::NUMERIC,
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
-- delete_production (multi-pack)
-- ============================================================
CREATE OR REPLACE FUNCTION delete_production(p_header_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
AS $$
BEGIN
    DELETE FROM stock_ledger_fg  WHERE reference_id = p_header_id AND transaction_type = 'PRODUCTION';
    DELETE FROM stock_ledger_raw WHERE reference_id = p_header_id AND transaction_type = 'PRODUCTION';
    DELETE FROM production_lines        WHERE production_header_id = p_header_id;
    DELETE FROM production_consumptions WHERE production_header_id = p_header_id;
    DELETE FROM production_headers WHERE id = p_header_id;

    RETURN jsonb_build_object('success', true);
END;
$$;
