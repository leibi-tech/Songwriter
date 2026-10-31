// Supabase-Verbindung für den Cloud-Sync.
// Werte aus Supabase → Project Settings → API eintragen.
// Der "anon public" Key darf öffentlich sein; die Daten schützt die Row Level Security (siehe supabase/schema.sql).
// Leer lassen = Verbindung wird in der App unter ⚙︎ eingetragen.
window.SONGWRITER_CONFIG = {
  supabaseUrl: '',
  supabaseAnonKey: '',
};
