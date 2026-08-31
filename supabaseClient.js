import { createClient } from '@supabase/supabase-js'

const supabaseUrl = 'https://slnakwquneyczqhxyfqb.supabase.co'
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InNsbmFrd3F1bmV5Y3pxaHh5ZnFiIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODcyMDc5MzMsImV4cCI6MjEwMjc4MzkzM30.ZvWe9iKb0ewo7viHNlo5Z8ecJVTSfxrHkz7qC35dnhw'

export const supabase = createClient(supabaseUrl, supabaseKey)
