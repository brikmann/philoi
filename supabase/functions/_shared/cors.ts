// Standard Supabase Edge Function CORS headers — the mobile app calls these via supabase-js,
// which still needs a permissive OPTIONS/preflight response the same as a web caller would.
export const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};
