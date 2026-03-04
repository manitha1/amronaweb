-- Add production_header_id to sales_lines so we can track which batch each sale line came from
ALTER TABLE sales_lines
    ADD COLUMN IF NOT EXISTS production_header_id UUID REFERENCES production_headers(id);

-- Updated post_sales RPC that also stores production_header_id per line
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
    -- Insert Header
    INSERT INTO sales_headers (bill_no, customer_id, date)
    VALUES (
        payload->>'bill_no',
        (payload->>'customer_id')::UUID,
        (payload->>'date')::DATE
    ) RETURNING id INTO new_header_id;

    -- Loop through lines
    FOR line IN SELECT * FROM jsonb_array_elements(payload->'lines')
    LOOP
        -- Check FG Stock
        SELECT balance INTO current_stock
        FROM fg_stock_view
        WHERE fg_item_id = (line->>'fg_item_id')::UUID;

        IF COALESCE(current_stock, 0) < (line->>'qty')::NUMERIC THEN
            RAISE EXCEPTION 'Negative Stock Error: Insufficient FG Item Stock for %', (line->>'fg_item_id');
        END IF;

        INSERT INTO sales_lines (sales_header_id, fg_item_id, qty, unit_price, total_amount, production_header_id)
        VALUES (
            new_header_id,
            (line->>'fg_item_id')::UUID,
            (line->>'qty')::NUMERIC,
            (line->>'unit_price')::NUMERIC,
            (line->>'qty')::NUMERIC * (line->>'unit_price')::NUMERIC,
            CASE WHEN line->>'production_header_id' IS NOT NULL AND line->>'production_header_id' != 'null'
                 THEN (line->>'production_header_id')::UUID
                 ELSE NULL END
        );

        total_val := total_val + ((line->>'qty')::NUMERIC * (line->>'unit_price')::NUMERIC);

        -- Add FG Ledger Out
        INSERT INTO stock_ledger_fg (transaction_type, reference_id, fg_item_id, qty_out)
        VALUES ('SALES', new_header_id, (line->>'fg_item_id')::UUID, (line->>'qty')::NUMERIC);
    END LOOP;

    -- Update total amount
    UPDATE sales_headers SET total_amount = total_val WHERE id = new_header_id;

    RETURN jsonb_build_object('success', true, 'sales_header_id', new_header_id);
END;
$$;
