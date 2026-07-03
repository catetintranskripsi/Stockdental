// ============================================
// SUPABASE CLIENT SETUP
// Percakapan 3 - SUPABASE CLIENT
// ============================================

// Import Supabase library dari CDN (ditulis di index.html, bukan di sini)
// Variabel `supabase` global datang dari script CDN itu

const SUPABASE_URL = 'https://redocvsmqvjocbenlicw.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJlZG9jdnNtcXZqb2NiZW5saWN3Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODI5MzMzODEsImV4cCI6MjA5ODUwOTM4MX0.mr_0eg5CDNJnGpXTA0toMm-_wmBlFd7zTXrzpBALVeI';

// Bikin client Supabase yang bakal dipakai di seluruh app
const supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// Cek koneksi (jalan otomatis saat file ini di-load)
console.log('Supabase client initialized:', supabaseClient ? 'OK' : 'FAILED');
