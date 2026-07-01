// Conexión a Supabase
export const SUPABASE_URL = "https://eqztjpkrjkwssfwjhxhc.supabase.co";
export const SUPABASE_KEY = "sb_publishable_cyTPNjcU4KJddFuK5LArSA_5-_u6txp";

export const db = supabase.createClient(SUPABASE_URL, SUPABASE_KEY);
