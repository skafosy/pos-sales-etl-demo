'use strict';

const { Client } = require('pg');

/** Connection from DATABASE_URL, or the standard PG* environment variables. */
async function connect() {
  const client = new Client(process.env.DATABASE_URL ? { connectionString: process.env.DATABASE_URL } : {});
  await client.connect();
  return client;
}

module.exports = { connect };
