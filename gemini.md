You are a senior full-stack engineer. Build a production-ready web app for an inventory + manufacturing system.

System overview:
- I buy RAW materials (chillie, pepper,turmeric...) with purchase No
- I produce Finished Goods (chillie powder, pepper powder,turmeric powder...) using Raw materials
- when Production purchase no should be select and select RAW materials with qty must reduce RAW stock and increase FG stock
- I sell FG to customers with Bill No and reduce FG stock

Hard “anti-gravity” rules:
1) Output COMPLETE runnable code (no missing files). Include folder structure.
2) Include database schema + migrations.
3) Include authentication (admin + user roles) and audit logs.
4) Use transactions: posting a document must be all-or-nothing.
5) Validate on both client and server. Show friendly error messages.
6) Never allow negative stock. If shortage, block posting and show shortage per item/batch.
7) Provide seed data + demo workflow steps.

Tech stack
I am using react for frontend and backend serverless with supabase


Database design requirement:
- Use Stock Ledger as the source of truth.
- Tables should include:
  Raw_items(id,name, type, uom)
  FG_items(id,name, type, uom)
  Supplier(id,name,address,contact_person,phone,email)
  Customer(id,name,address,contact_person,phone,email   )
  purchase_headers(Purchase_No,supplier_name, date,Total_Amount)
  purchase_lines(id,Purchase_No,Raw_item_name,qty, unit_cost,Total_Amount)
  production_headers(Date,batch_no,FG_item_name,MFD.EXP,Qty_per_packet,Total_qty)
  production_consumptions(Batch_no,purchase_no,Raw_item_name,qty)
  sales(Bill_No,customer_name,date,Total_Amount)
  sales_lines(id,Bill_No,FG_item_name,qty, unit_cost,Total_Amount)
  raw_stock(id,Raw_item_name,Total Qty,In Stock,Out Stock,Balance)
  fg_stock(id,FG_item_name,Total Qty,In Stock,Out Stock,Balance)  
- The raw stock and fg stock should be updated when the purchase, production and sales are posted
- Raw_items,FG_items,Supplier,Customer can be created by admin
- when make a purchase one purchase_no have more raw items
- when make a production one batch_no have more raw items
- when make a sales one bill_no have more fg items
- when make a production should select purchase_no and raw items with qty
- when make a sales should select FG items with qty
- when i click purchase it should show all the purchase_no and when i click purchase_no it should show all the raw items with qty
- when i click production it should show all the batch_no and when i click batch_no it should show all the raw items with qty
- when i click sales it should show all the bill_no and when i click bill_no it should show all the fg items with qty

Frontend requirements:
- Dashboard cards: Raw_item_stock, FG_item_stock
- Data tables with search/filter
- Forms:
  - Raw_item entry
  - FG_item entry
  - Supplier entry
  - Customer entry
  - Purchase entry (add multiple items lines)
  - Production entry (select FG + qty)
  - Sales entry
- Use a beautiful clean UI.

Deliverables:
1) Folder structure
2) Frontend code
3) Instructions to run locally (npm install, env vars)
4) Example test data + sample workflow clicks