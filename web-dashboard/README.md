# Unified Social Inbox Dashboard

This is the real-time web dashboard for your social messages.

## Setup Instructions

1.  **Supabase Setup**:
    - Create a new project on [Supabase.com](https://supabase.com).
    - Run the following SQL in the SQL Editor:
    ```sql
    CREATE TABLE messages (
      id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
      created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
      sender_name TEXT,
      message_text TEXT,
      app_source TEXT,
      device_id TEXT
    );

    ALTER TABLE messages ENABLE ROW LEVEL SECURITY;
    -- For now, allow all reads/inserts for simplicity.
    CREATE POLICY "Allow all" ON messages FOR ALL USING (true);
    ```

2.  **Environment Variables**:
    - Create a `.env.local` file with:
    ```
    NEXT_PUBLIC_SUPABASE_URL=your_supabase_url
    NEXT_PUBLIC_SUPABASE_ANON_KEY=your_supabase_anon_key
    ```

3.  **Run the App**:
    - `npm install`
    - `npm run dev`
