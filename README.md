# Amrona Inventory System

Welcome to the Amrona Inventory System! This project is a production-ready application built with React/Vite and Supabase, specifically designed for managing physical goods, manufacturing formulations, and stock ledgers.

## Tech Stack
- **Frontend**: React (Vite SPA) + React Router + Vanilla CSS
- **Backend/Database**: Supabase (PostgreSQL with Row Level Security, RPCs, and Views)

## Features
- **Strict Transactional Integrity**: Database RPCs ensure that stock updates and transaction entries happen atomically.
- **Ledger System**: Current stock dynamically balances off a history of `In` and `Out` ledgers ensuring zero race conditions.
- **Negative Stock Prevention**: Tightly integrated DB checks block entries that would drive inventory stock below zero, returning friendly errors to the client.

## Setup Instructions

### 1. Database Setup
1. Create a [Supabase Project](https://supabase.com).
2. Go to the **SQL Editor** in your Supabase dashboard.
3. Open `supabase/migrations/00_init.sql` and run it to create tables, relations, and RPCs.
4. Open `supabase/seed.sql` and run it to load dummy master data (items, suppliers, customers).

### 2. Application Setup
1. Install dependencies:
   ```bash
   npm install --legacy-peer-deps
   ```
2. Create your `.env.local` file by renaming `.env.local` and replacing values:
   ```env
   VITE_SUPABASE_URL=https://your-project-url.supabase.co
   VITE_SUPABASE_ANON_KEY=your-anon-public-key
   ```
3. Run the development server:
   ```bash
   npm run dev
   ```

### 3. Authentication Configuration
By default, the authentication requires Supabase Auth out of the box. 
1. Under **Authentication -> Users** in Supabase, create two users:
   - `admin@amrona.local` (password: `password123`)
   - `user@amrona.local` (password: `password123`)
2. Go to **Authentication -> Providers -> Email** and uncheck "Confirm email" if you want to allow easy signup testing.

## Demo Workflow

Once logged in, you can verify the entire workflow:

1. **Dashboard**: Note that Raw Material and FG items stock is `0`.
2. **Purchasing (In)**:
   - Go to Purchasing, click **New Purchase**.
   - Input supplier, create a purchase inserting 100 KG of "Chilli Whole" and post.
3. **Verify Dashboard**: Raw Material Stock is now `100`.
4. **Production**:
   - Go to Production, click **New Batch**.
   - Select FG Item "Chilli Powder". Enter quantity produced `50`.
   - Under Consumptions, select your recent Purchase No, Item "Chilli Whole", and Qty Consumed `10`.
   - Post to check strict validation logic.
5. **Sales (Out)**:
   - Go to Sales, click **New Sale**.
   - Select Customer and "Chilli Powder".
   - Submit quantity higher than stock to see the negative stock validation error.
   - Fix quantity to valid stock amount (e.g., `5`), and post to successfully update stock ledger.
