-- Migration 13: Fix FG Stock Deduction for Sales (Bulk vs Packets)

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
    is_bulk       BOOLEAN;
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
        is_bulk := COALESCE((line->>'is_bulk')::BOOLEAN, FALSE);
        
        -- If no production line supplied, or if not specified, guess based on previous logic 
        -- but frontend explicitly sends is_bulk now
        IF is_bulk THEN
            -- User selected a bulk batch to sell as packets
            SELECT balance INTO current_stock
            FROM fg_stock_view
            WHERE fg_item_id = (line->>'fg_item_id')::UUID
              AND packet_size IS NULL
            LIMIT 1;

            IF COALESCE(current_stock, 0) < (orig_qty * COALESCE(p_size, 1)) THEN
                RAISE EXCEPTION 'Insufficient Bulk FG Stock for item % to make packets', (line->>'fg_item_id');
            END IF;

            ledger_p_size := NULL;
            ledger_qty := orig_qty * COALESCE(p_size, 1);
        ELSE
            -- Normal packet sale
            SELECT balance INTO current_stock
            FROM fg_stock_view
            WHERE fg_item_id = (line->>'fg_item_id')::UUID
              AND (packet_size = p_size OR (packet_size IS NULL AND p_size IS NULL))
            LIMIT 1;

            IF current_stock IS NULL AND p_size IS NOT NULL THEN
                 -- Legacy fallback if exact packet doesn't exist, check bulk if they tried to sell packets
                 SELECT balance INTO current_stock
                 FROM fg_stock_view
                 WHERE fg_item_id = (line->>'fg_item_id')::UUID
                   AND packet_size IS NULL
                 LIMIT 1;
                 
                 IF COALESCE(current_stock, 0) < (orig_qty * p_size) THEN
                    RAISE EXCEPTION 'Insufficient FG Stock for item % (Size: %)', (line->>'fg_item_id'), p_size;
                 END IF;

                 ledger_p_size := NULL;
                 ledger_qty := orig_qty * p_size;
            ELSE
                 IF COALESCE(current_stock, 0) < orig_qty THEN
                    RAISE EXCEPTION 'Insufficient FG Stock for item % (Size: %)', (line->>'fg_item_id'), p_size;
                 END IF;
                 
                 ledger_p_size := p_size;
                 ledger_qty := orig_qty;
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
    is_bulk       BOOLEAN;
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
        is_bulk := COALESCE((line->>'is_bulk')::BOOLEAN, FALSE);
        
        IF is_bulk THEN
            SELECT balance INTO current_stock
            FROM fg_stock_view
            WHERE fg_item_id = (line->>'fg_item_id')::UUID
              AND packet_size IS NULL
            LIMIT 1;

            IF COALESCE(current_stock, 0) < (orig_qty * COALESCE(p_size, 1)) THEN
                RAISE EXCEPTION 'Insufficient Bulk FG Stock for item % to make packets', (line->>'fg_item_id');
            END IF;

            ledger_p_size := NULL;
            ledger_qty := orig_qty * COALESCE(p_size, 1);
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
                    RAISE EXCEPTION 'Insufficient FG Stock for item % (Size: %)', (line->>'fg_item_id'), p_size;
                 END IF;

                 ledger_p_size := NULL;
                 ledger_qty := orig_qty * p_size;
            ELSE
                 IF COALESCE(current_stock, 0) < orig_qty THEN
                    RAISE EXCEPTION 'Insufficient FG Stock for item % (Size: %)', (line->>'fg_item_id'), p_size;
                 END IF;
                 
                 ledger_p_size := p_size;
                 ledger_qty := orig_qty;
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
