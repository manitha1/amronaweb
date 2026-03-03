-- Seed Data for Amrona Inventory System

-- 1. Insert Raw Items
INSERT INTO raw_items (id, name, type, uom) VALUES
('11111111-1111-1111-1111-111111111111', 'Chilli Whole', 'Spice', 'KG'),
('22222222-2222-2222-2222-222222222222', 'Pepper Whole', 'Spice', 'KG'),
('33333333-3333-3333-3333-333333333333', 'Turmeric Roots', 'Spice', 'KG');

-- 2. Insert Finished Goods
INSERT INTO fg_items (id, name, type, uom) VALUES
('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Chilli Powder', 'Spice Powder', 'Packet'),
('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'Pepper Powder', 'Spice Powder', 'Packet'),
('cccccccc-cccc-cccc-cccc-cccccccccccc', 'Turmeric Powder', 'Spice Powder', 'Packet');

-- 3. Insert Suppliers
INSERT INTO suppliers (id, name, address, contact_person, phone, email) VALUES
('55555555-5555-5555-5555-555555555555', 'Spice Farm LK', '12 Farm Road', 'John Doe', '0123456789', 'john@spicefarm.lk');

-- 4. Insert Customers
INSERT INTO customers (id, name, address, contact_person, phone, email) VALUES
('77777777-7777-7777-7777-777777777777', 'City Supermarket', '100 Main St', 'Jane Smith', '0987654321', 'purchasing@citysupermarket.com');
