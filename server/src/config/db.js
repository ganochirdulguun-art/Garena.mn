const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  // 2026-09-14: default idleTimeout 10с байсан тул холболт байнга хаагдаж-нээгдэж
  // («PostgreSQL-д холбогдлоо» спам + query бүрт шинэ TCP+TLS саатал) → 10 мин + keepAlive
  idleTimeoutMillis: 10 * 60 * 1000,
  keepAlive: true,
  max: 10,
});

pool.on('connect', () => {
  console.log('PostgreSQL-д холбогдлоо');
});

pool.on('error', (err) => {
  console.error('PostgreSQL алдаа:', err);
});

module.exports = pool;
