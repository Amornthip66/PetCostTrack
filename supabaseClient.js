import { createClient } from '@supabase/supabase-js'

const supabaseUrl = 'https://supabase.co'
const supabaseKey = 'your-anon-key'

export const supabase = createClient(supabaseUrl, supabaseKey)
