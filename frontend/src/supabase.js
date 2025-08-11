import { createClient } from '@supabase/supabase-js'
import getSupabaseConfig from './config/supabase'

const config = getSupabaseConfig();
export const supabase = createClient(config.url, config.anonKey)
