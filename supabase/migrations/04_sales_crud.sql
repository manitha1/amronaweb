-- ============================================================
-- RPC: delete_sales
-- Reverses FG stock-out and removes all sale records atomically.
-- ============================================================
CREATE OR REPLACE FUNCTION delete_sales(p_header_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
AS $$
BEGIN
    -- Reverse FG stock ledger (undo the sales qty-out)
    DELETE FROM stock_ledger_fg
    WHERE reference_id = p_header_id AND transaction_type = 'SALES';

    -- Delete lines (also CASCADE)
    DELETE FROM sales_lines WHERE sales_header_id = p_header_id;

    -- Delete header
    DELETE FROM sales_headers WHERE id = p_header_id;

    RETURN jsonb_build_object('success', true);
END;
$$;


-- ============================================================
-- RPC: update_sales
-- Reverses old FG ledger, removes old lines, inserts new ones.
-- payload: { header_id, customer_id, date,
--            lines: [{fg_item_id, qty, unit_price, production_header_id}] }
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

    -- 1. Reverse old FG ledger entries
    DELETE FROM stock_ledger_fg
    WHERE reference_id = p_header_id AND transaction_type = 'SALES';

    -- 2. Remove old lines
    DELETE FROM sales_lines WHERE sales_header_id = p_header_id;

    -- 3. Update header fields
    UPDATE sales_headers
    SET customer_id = (payload->>'customer_id')::UUID,
        date        = (payload->>'date')::DATE
    WHERE id = p_header_id;

    -- 4. Insert new lines + rebuild ledger
    FOR line IN SELECT * FROM jsonb_array_elements(payload->'lines')
    LOOP
        -- Check FG stock
        SELECT balance INTO current_stock
        FROM fg_stock_view
        WHERE fg_item_id = (line->>'fg_item_id')::UUID;

        IF COALESCE(current_stock, 0) < (line->>'qty')::NUMERIC THEN
            RAISE EXCEPTION 'Insufficient FG stock for item %', (line->>'fg_item_id');
        END IF;

        INSERT INTO sales_lines (sales_header_id, fg_item_id, qty, unit_price, total_amount, production_header_id)
        VALUES (
            p_header_id,
            (line->>'fg_item_id')::UUID,
            (line->>'qty')::NUMERIC,
            (line->>'unit_price')::NUMERIC,
            (line->>'qty')::NUMERIC * (line->>'unit_price')::NUMERIC,
            CASE WHEN line->>'production_header_id' IS NOT NULL AND line->>'production_header_id' != 'null'
                 THEN (line->>'production_header_id')::UUID ELSE NULL END
        );

        total_val := total_val + ((line->>'qty')::NUMERIC * (line->>'unit_price')::NUMERIC);

        INSERT INTO stock_ledger_fg (transaction_type, reference_id, fg_item_id, qty_out)
        VALUES ('SALES', p_header_id, (line->>'fg_item_id')::UUID, (line->>'qty')::NUMERIC);
    END LOOP;

    -- 5. Update total
    UPDATE sales_headers SET total_amount = total_val WHERE id = p_header_id;

    RETURN jsonb_build_object('success', true);
END;
$$;
