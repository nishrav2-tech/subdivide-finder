// Subdivide Finder settings. These values are safe to publish:
// the Supabase key is the public "anon" key, and Row Level Security
// only lets people listed in sf_members read or change anything.
window.SF_CONFIG = {
  SUPABASE_URL: "https://yahosblylysopbxgztvg.supabase.co",
  SUPABASE_ANON_KEY: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InlhaG9zYmx5bHlzb3BieGd6dHZnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODMzNjk5ODMsImV4cCI6MjA5ODk0NTk4M30.WsUJ470wCbKEVvM0xVIkfhnfRlMgerutl3HH2NeaY88",

  // Google Cloud OAuth "Web application" client ID (README step 4).
  GOOGLE_CLIENT_ID: "PASTE_YOUR_CLIENT_ID.apps.googleusercontent.com",

  // The Gmail account the site reads and sends from.
  GMAIL_ACCOUNT: "jay@utopiancapitalinvest.com",

  // Added under every email sent from the site (Gmail's API does not add your Gmail signature).
  SIGNATURE_TEXT: "Jay Ravathur\nUtopian Capital\n(336) 962-2411",

  // Name of the Supabase Edge Function that writes emails with Claude.
  DRAFT_FUNCTION: "sf-draft"
};
