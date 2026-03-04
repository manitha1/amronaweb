-- ============================================================
-- RPC: delete_production
-- Reverses FG stock-in, reverses raw material consumption, removes records.
-- ============================================================
CREATE OR REPLACE FUNCTION delete_production(p_header_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
AS $$
BEGIN
    -- Reverse FG stock ledger (undo the production qty-in)
    DELETE FROM stock_ledger_fg
    WHERE reference_id = p_header_id AND transaction_type = 'PRODUCTION';

    -- Reverse raw stock ledger (undo the consumption qty-out)
    DELETE FROM stock_ledger_raw
    WHERE reference_id = p_header_id AND transaction_type = 'PRODUCTION';

    -- Delete consumptions (also CASCADE, but explicit is safer)
    DELETE FROM production_consumptions WHERE production_header_id = p_header_id;

    -- Delete header
    DELETE FROM production_headers WHERE id = p_header_id;

    RETURN jsonb_build_object('success', true);
END;
$$;


-- ============================================================
-- RPC: update_production
-- Reverses old ledger entries, replaces consumptions, re-applies stock.
-- payload: { header_id, fg_item_id, date, mfd, exp, qty_per_packet, total_qty,
--            consumptions: [{purchase_no, raw_item_id, qty}] }
-- ============================================================
CREATE OR REPLACE FUNCTION update_production(payload JSONB)
RETURNS JSONB
LANGUAGE plpgsql
AS $$
DECLARE
    p_header_id  UUID;
    consumption  JSONB;
    current_stock NUMERIC;
BEGIN
    p_header_id := (payload->>'header_id')::UUID;

    -- 1. Reverse old FG ledger (undo old production qty-in)
    DELETE FROM stock_ledger_fg
    WHERE reference_id = p_header_id AND transaction_type = 'PRODUCTION';

    -- 2. Reverse old raw ledger (undo old consumption qty-out)
    DELETE FROM stock_ledger_raw
    WHERE reference_id = p_header_id AND transaction_type = 'PRODUCTION';

    -- 3. Remove old consumption lines
    DELETE FROM production_consumptions WHERE production_header_id = p_header_id;

    -- 4. Update header fields
    UPDATE production_headers
    SET fg_item_id    = (payload->>'fg_item_id')::UUID,
        date          = (payload->>'date')::DATE,
        mfd           = (payload->>'mfd')::DATE,
        exp           = (payload->>'exp')::DATE,
        qty_per_packet = (payload->>'qty_per_packet')::NUMERIC,
        total_qty     = (payload->>'total_qty')::NUMERIC
    WHERE id = p_header_id;

    -- 5. Re-apply new FG ledger entry
    INSERT INTO stock_ledger_fg (transaction_type, reference_id, fg_item_id, qty_in)
    VALUES ('PRODUCTION', p_header_id,
            (payload->>'fg_item_id')::UUID,
            (payload->>'total_qty')::NUMERIC);

    -- 6. Insert new consumptions + raw ledger out
    FOR consumption IN SELECT * FROM jsonb_array_elements(payload->'consumptions')
    LOOP
        -- Check stock
        SELECT balance INTO current_stock
        FROM raw_stock_view
        WHERE raw_item_id = (consumption->>'raw_item_id')::UUID;

        IF COALESCE(current_stock, 0) < (consumption->>'qty')::NUMERIC THEN
            RAISE EXCEPTION 'Insufficient stock for raw item %', (consumption->>'raw_item_id');
        END IF;

        INSERT INTO production_consumptions (production_header_id, purchase_no, raw_item_id, qty)
        VALUES (p_header_id,
                (consumption->>'purchase_no')::UUID,
                (consumption->>'raw_item_id')::UUID,
                (consumption->>'qty')::NUMERIC);

        INSERT INTO stock_ledger_raw (transaction_type, reference_id, raw_item_id, qty_out)
        VALUES ('PRODUCTION', p_header_id,
                (consumption->>'raw_item_id')::UUID,
                (consumption->>'qty')::NUMERIC);
    END LOOP;

    RETURN jsonb_build_object('success', true);
END;
$$;
