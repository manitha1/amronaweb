-- ============================================================
-- RPC: delete_purchase
-- Reverses stock and removes all purchase records atomically.
-- ============================================================
CREATE OR REPLACE FUNCTION delete_purchase(p_header_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
AS $$
BEGIN
    -- Remove stock ledger entries for this purchase (reverses stock-in)
    DELETE FROM stock_ledger_raw
    WHERE reference_id = p_header_id AND transaction_type = 'PURCHASE';

    -- Delete lines (also covered by ON DELETE CASCADE, but explicit is safer)
    DELETE FROM purchase_lines WHERE purchase_header_id = p_header_id;

    -- Delete header
    DELETE FROM purchase_headers WHERE id = p_header_id;

    RETURN jsonb_build_object('success', true);
END;
$$;


-- ============================================================
-- RPC: update_purchase
-- Reverses old stock, removes old lines, inserts new lines.
-- payload: { header_id, supplier_id, date, lines: [{raw_item_id, qty, unit_cost}] }
-- ============================================================
CREATE OR REPLACE FUNCTION update_purchase(payload JSONB)
RETURNS JSONB
LANGUAGE plpgsql
AS $$
DECLARE
    p_header_id UUID;
    total_val   NUMERIC(15,2) := 0;
    line        JSONB;
BEGIN
    p_header_id := (payload->>'header_id')::UUID;

    -- 1. Reverse old stock ledger entries
    DELETE FROM stock_ledger_raw
    WHERE reference_id = p_header_id AND transaction_type = 'PURCHASE';

    -- 2. Remove old lines
    DELETE FROM purchase_lines WHERE purchase_header_id = p_header_id;

    -- 3. Update header fields
    UPDATE purchase_headers
    SET supplier_id = (payload->>'supplier_id')::UUID,
        date        = (payload->>'date')::DATE
    WHERE id = p_header_id;

    -- 4. Insert new lines + rebuild ledger
    FOR line IN SELECT * FROM jsonb_array_elements(payload->'lines')
    LOOP
        INSERT INTO purchase_lines (purchase_header_id, raw_item_id, qty, unit_cost, total_amount)
        VALUES (
            p_header_id,
            (line->>'raw_item_id')::UUID,
            (line->>'qty')::NUMERIC,
            (line->>'unit_cost')::NUMERIC,
            (line->>'qty')::NUMERIC * (line->>'unit_cost')::NUMERIC
        );

        total_val := total_val + ((line->>'qty')::NUMERIC * (line->>'unit_cost')::NUMERIC);

        INSERT INTO stock_ledger_raw (transaction_type, reference_id, raw_item_id, qty_in)
        VALUES ('PURCHASE', p_header_id, (line->>'raw_item_id')::UUID, (line->>'qty')::NUMERIC);
    END LOOP;

    -- 5. Update total on header
    UPDATE purchase_headers SET total_amount = total_val WHERE id = p_header_id;

    RETURN jsonb_build_object('success', true);
END;
$$;
