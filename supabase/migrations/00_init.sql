-- Amrona Inventory System: Database Schema and Functions
-- This schema implements a strict Stock Ledger for both Raw Materials and Finished Goods.

-- 1. Master Data Tables
CREATE TABLE raw_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL UNIQUE,
    type TEXT,
    uom TEXT NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

CREATE TABLE fg_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL UNIQUE,
    type TEXT,
    uom TEXT NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

CREATE TABLE suppliers (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL UNIQUE,
    address TEXT,
    contact_person TEXT,
    phone TEXT,
    email TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

CREATE TABLE customers (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL UNIQUE,
    address TEXT,
    contact_person TEXT,
    phone TEXT,
    email TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- 2. Transaction Headers and Lines
CREATE TABLE purchase_headers (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    purchase_no TEXT NOT NULL UNIQUE,
    supplier_id UUID REFERENCES suppliers(id) NOT NULL,
    date DATE NOT NULL,
    total_amount NUMERIC(15, 2) NOT NULL DEFAULT 0,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

CREATE TABLE purchase_lines (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    purchase_header_id UUID REFERENCES purchase_headers(id) ON DELETE CASCADE NOT NULL,
    raw_item_id UUID REFERENCES raw_items(id) NOT NULL,
    qty NUMERIC(10, 2) NOT NULL CHECK (qty > 0),
    unit_cost NUMERIC(15, 2) NOT NULL CHECK (unit_cost >= 0),
    total_amount NUMERIC(15, 2) NOT NULL DEFAULT 0
);

CREATE TABLE production_headers (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    batch_no TEXT NOT NULL UNIQUE,
    fg_item_id UUID REFERENCES fg_items(id) NOT NULL,
    date DATE NOT NULL,
    mfd DATE NOT NULL,
    exp DATE NOT NULL,
    qty_per_packet NUMERIC(10, 2) NOT NULL,
    total_qty NUMERIC(10, 2) NOT NULL CHECK (total_qty > 0),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

CREATE TABLE production_consumptions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    production_header_id UUID REFERENCES production_headers(id) ON DELETE CASCADE NOT NULL,
    purchase_no UUID REFERENCES purchase_headers(id) NOT NULL, 
    raw_item_id UUID REFERENCES raw_items(id) NOT NULL,
    qty NUMERIC(10, 2) NOT NULL CHECK (qty > 0)
);

CREATE TABLE sales_headers (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    bill_no TEXT NOT NULL UNIQUE,
    customer_id UUID REFERENCES customers(id) NOT NULL,
    date DATE NOT NULL,
    total_amount NUMERIC(15, 2) NOT NULL DEFAULT 0,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

CREATE TABLE sales_lines (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    sales_header_id UUID REFERENCES sales_headers(id) ON DELETE CASCADE NOT NULL,
    fg_item_id UUID REFERENCES fg_items(id) NOT NULL,
    qty NUMERIC(10, 2) NOT NULL CHECK (qty > 0),
    unit_price NUMERIC(15, 2) NOT NULL CHECK (unit_price >= 0),
    total_amount NUMERIC(15, 2) NOT NULL DEFAULT 0
);

-- 3. Stock Ledgers
CREATE TABLE stock_ledger_raw (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    transaction_type TEXT NOT NULL CHECK (transaction_type IN ('PURCHASE', 'PRODUCTION')),
    reference_id UUID NOT NULL, -- Points to purchase_headers or production_headers
    raw_item_id UUID REFERENCES raw_items(id) NOT NULL,
    qty_in NUMERIC(10, 2) NOT NULL DEFAULT 0,
    qty_out NUMERIC(10, 2) NOT NULL DEFAULT 0,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

CREATE TABLE stock_ledger_fg (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    transaction_type TEXT NOT NULL CHECK (transaction_type IN ('PRODUCTION', 'SALES')),
    reference_id UUID NOT NULL, -- Points to production_headers or sales_headers
    fg_item_id UUID REFERENCES fg_items(id) NOT NULL,
    qty_in NUMERIC(10, 2) NOT NULL DEFAULT 0,
    qty_out NUMERIC(10, 2) NOT NULL DEFAULT 0,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- 4. Stock Balance Views
CREATE VIEW raw_stock_view AS
SELECT 
    r.id AS raw_item_id,
    r.name AS raw_item_name,
    COALESCE(SUM(l.qty_in), 0) AS total_in,
    COALESCE(SUM(l.qty_out), 0) AS total_out,
    COALESCE(SUM(l.qty_in) - SUM(l.qty_out), 0) AS balance
FROM raw_items r
LEFT JOIN stock_ledger_raw l ON r.id = l.raw_item_id
GROUP BY r.id, r.name;

CREATE VIEW fg_stock_view AS
SELECT 
    f.id AS fg_item_id,
    f.name AS fg_item_name,
    COALESCE(SUM(l.qty_in), 0) AS total_in,
    COALESCE(SUM(l.qty_out), 0) AS total_out,
    COALESCE(SUM(l.qty_in) - SUM(l.qty_out), 0) AS balance
FROM fg_items f
LEFT JOIN stock_ledger_fg l ON f.id = l.fg_item_id
GROUP BY f.id, f.name;

-- 5. RPC Functions for Transactions (All-or-Nothing)
-- These prevent partial updates and automatically hit the Stock Ledger.

-- Function: Post Purchase
CREATE OR REPLACE FUNCTION post_purchase(payload JSONB)
RETURNS JSONB
LANGUAGE plpgsql
AS $$
DECLARE
    new_header_id UUID;
    total_val NUMERIC(15,2) := 0;
    line JSONB;
BEGIN
    -- Insert Header
    INSERT INTO purchase_headers (purchase_no, supplier_id, date)
    VALUES (
        payload->>'purchase_no',
        (payload->>'supplier_id')::UUID,
        (payload->>'date')::DATE
    ) RETURNING id INTO new_header_id;

    -- Loop through lines
    FOR line IN SELECT * FROM jsonb_array_elements(payload->'lines')
    LOOP
        INSERT INTO purchase_lines (purchase_header_id, raw_item_id, qty, unit_cost, total_amount)
        VALUES (
            new_header_id,
            (line->>'raw_item_id')::UUID,
            (line->>'qty')::NUMERIC,
            (line->>'unit_cost')::NUMERIC,
            (line->>'qty')::NUMERIC * (line->>'unit_cost')::NUMERIC
        );

        total_val := total_val + ((line->>'qty')::NUMERIC * (line->>'unit_cost')::NUMERIC);

        -- Insert to Raw Ledger
        INSERT INTO stock_ledger_raw (transaction_type, reference_id, raw_item_id, qty_in)
        VALUES ('PURCHASE', new_header_id, (line->>'raw_item_id')::UUID, (line->>'qty')::NUMERIC);
    END LOOP;

    -- Update total amount
    UPDATE purchase_headers SET total_amount = total_val WHERE id = new_header_id;

    RETURN jsonb_build_object('success', true, 'purchase_header_id', new_header_id);
END;
$$;

-- Function: Post Production (Checks Raw Stock)
CREATE OR REPLACE FUNCTION post_production(payload JSONB)
RETURNS JSONB
LANGUAGE plpgsql
AS $$
DECLARE
    new_header_id UUID;
    consumption JSONB;
    current_stock NUMERIC;
BEGIN
    -- Note: payload must include { batch_no, fg_item_id, date, mfd, exp, qty_per_packet, total_qty, consumptions: [{ purchase_no, raw_item_id, qty }] }
    
    -- Insert Header
    INSERT INTO production_headers (batch_no, fg_item_id, date, mfd, exp, qty_per_packet, total_qty)
    VALUES (
        payload->>'batch_no',
        (payload->>'fg_item_id')::UUID,
        (payload->>'date')::DATE,
        (payload->>'mfd')::DATE,
        (payload->>'exp')::DATE,
        (payload->>'qty_per_packet')::NUMERIC,
        (payload->>'total_qty')::NUMERIC
    ) RETURNING id INTO new_header_id;

    -- Add FG Ledger In
    INSERT INTO stock_ledger_fg (transaction_type, reference_id, fg_item_id, qty_in)
    VALUES ('PRODUCTION', new_header_id, (payload->>'fg_item_id')::UUID, (payload->>'total_qty')::NUMERIC);

    -- Loop through consumptions
    FOR consumption IN SELECT * FROM jsonb_array_elements(payload->'consumptions')
    LOOP
        -- Check Current Stock
        SELECT balance INTO current_stock FROM raw_stock_view WHERE raw_item_id = (consumption->>'raw_item_id')::UUID;
        
        IF COALESCE(current_stock, 0) < (consumption->>'qty')::NUMERIC THEN
            RAISE EXCEPTION 'Negative Stock Error: Insufficient Raw Item Stock for %', (consumption->>'raw_item_id');
        END IF;

        -- Insert Consumption Record
        INSERT INTO production_consumptions (production_header_id, purchase_no, raw_item_id, qty)
        VALUES (
            new_header_id,
            (consumption->>'purchase_no')::UUID,
            (consumption->>'raw_item_id')::UUID,
            (consumption->>'qty')::NUMERIC
        );

        -- Add Raw Ledger Out
        INSERT INTO stock_ledger_raw (transaction_type, reference_id, raw_item_id, qty_out)
        VALUES ('PRODUCTION', new_header_id, (consumption->>'raw_item_id')::UUID, (consumption->>'qty')::NUMERIC);
    END LOOP;

    RETURN jsonb_build_object('success', true, 'production_header_id', new_header_id);
END;
$$;

-- Function: Post Sales (Checks FG Stock)
CREATE OR REPLACE FUNCTION post_sales(payload JSONB)
RETURNS JSONB
LANGUAGE plpgsql
AS $$
DECLARE
    new_header_id UUID;
    total_val NUMERIC(15,2) := 0;
    line JSONB;
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
        SELECT balance INTO current_stock FROM fg_stock_view WHERE fg_item_id = (line->>'fg_item_id')::UUID;
        
        IF COALESCE(current_stock, 0) < (line->>'qty')::NUMERIC THEN
            RAISE EXCEPTION 'Negative Stock Error: Insufficient FG Item Stock for %', (line->>'fg_item_id');
        END IF;

        INSERT INTO sales_lines (sales_header_id, fg_item_id, qty, unit_price, total_amount)
        VALUES (
            new_header_id,
            (line->>'fg_item_id')::UUID,
            (line->>'qty')::NUMERIC,
            (line->>'unit_price')::NUMERIC,
            (line->>'qty')::NUMERIC * (line->>'unit_price')::NUMERIC
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
