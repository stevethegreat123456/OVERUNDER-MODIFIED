import { createClient, SupabaseClient } from '@supabase/supabase-js';

let supabaseClient: SupabaseClient | null = null;

export function initSupabase() {
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (supabaseUrl && supabaseKey) {
    try {
      const cleanUrl = supabaseUrl.replace(/\/rest\/v1\/?$/, '');
      supabaseClient = createClient(cleanUrl, supabaseKey);
      console.log("Supabase initialized successfully.");
    } catch (error) {
      console.error("Error initializing Supabase:", error);
    }
  } else {
    console.warn("SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY not found in environment. Database persistence is disabled until configured.");
  }
}

export const getSupabase = () => supabaseClient;
