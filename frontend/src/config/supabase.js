// src/config/supabase.js
const getSupabaseConfig = () => {
  const supabaseUrl = process.env.REACT_APP_SUPABASE_URL;
  const supabaseAnonKey = process.env.REACT_APP_SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseAnonKey) {
    console.error(
      'Missing Supabase environment variables. Please check your .env file or environment configuration.'
    );
    throw new Error(
      'Supabase configuration is required. Set REACT_APP_SUPABASE_URL and REACT_APP_SUPABASE_ANON_KEY in your environment.'
    );
  }

  return {
    url: supabaseUrl,
    anonKey: supabaseAnonKey,
  };
};

export default getSupabaseConfig;
