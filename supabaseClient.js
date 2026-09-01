import { createClient } from '@supabase/supabase-js'

// ใช้ค่าจาก CONFIG (config.env.js) แทน hardcoded
const supabaseUrl = CONFIG.SB_URL
const supabaseKey = CONFIG.SB_KEY

export const supabase = createClient(supabaseUrl, supabaseKey)
