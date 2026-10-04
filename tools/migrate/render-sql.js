'use strict';
/**
 * tools/migrate/render-sql.js — print one of the read-only check queries with the
 * migration name filled in, ready to paste into the Supabase connector's SQL tool.
 *
 *   node tools/migrate/render-sql.js record 046_acquisition_general_ledger
 *   node tools/migrate/render-sql.js fingerprint
 *   node tools/migrate/render-sql.js inventory
 *   node tools/migrate/render-sql.js data-hashes
 *
 * Every template is SELECT-only. The name must be NNN_snake_case; anything else
 * is refused so nothing unexpected can be spliced into a query.
 */
const fs = require('fs');
const path = require('path');
const [, , which, name] = process.argv;
const TEMPLATES = ['record', 'fingerprint', 'inventory', 'data-hashes'];
if (!TEMPLATES.includes(which)) { console.error('usage: render-sql.js <' + TEMPLATES.join('|') + '> [migration_name]'); process.exit(64); }
const file = path.join(__dirname, 'sql', which + '.sql');
let sql = fs.readFileSync(file, 'utf8');
if (sql.includes('{{MIGRATION_NAME}}')) {
  if (!name || !/^[0-9]{3}[a-z]?_[A-Za-z0-9_]+$/.test(name)) { console.error(which + ' needs a migration name of the form NNN_snake_case'); process.exit(64); }
  sql = sql.split('{{MIGRATION_NAME}}').join(name);
}
if (!/^\s*(--[^\n]*\n|\s)*(with|select)\b/i.test(sql) || /\b(insert|update|delete|drop|alter|create|truncate|grant|revoke)\b/i.test(sql.replace(/--[^\n]*/g, '').replace(/'[^']*'/g, ''))) {
  console.error('refusing: template is not read-only'); process.exit(70);
}
process.stdout.write(sql);
