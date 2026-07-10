const initSqlJs = require('sql.js');
const path = require('path');
const fs = require('fs');

const dbPath = path.join(__dirname, '..', 'database.db');
let db = null;
let SQL = null;

async function getDB() {
  if (db) return db;

  SQL = await initSqlJs();

  if (fs.existsSync(dbPath)) {
    const buffer = fs.readFileSync(dbPath);
    db = new SQL.Database(buffer);
  } else {
    db = new SQL.Database();
  }

  db.run('PRAGMA foreign_keys = ON');
  initTables();
  return db;
}

function initTables() {
  db.run(`
    CREATE TABLE IF NOT EXISTS restaurants (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL DEFAULT 'My Restaurant',
      logo TEXT,
      address TEXT DEFAULT '',
      primary_color TEXT DEFAULT '#2d3436',
      accent_color TEXT DEFAULT '#00b894',
      created_at DATETIME DEFAULT (datetime('now'))
    )
  `);
  db.run(`
    CREATE TABLE IF NOT EXISTS tables (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      restaurant_id INTEGER NOT NULL DEFAULT 1,
      table_number INTEGER NOT NULL UNIQUE,
      created_at DATETIME DEFAULT (datetime('now')),
      FOREIGN KEY (restaurant_id) REFERENCES restaurants(id)
    )
  `);
  db.run(`
    CREATE TABLE IF NOT EXISTS requests (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      restaurant_id INTEGER NOT NULL DEFAULT 1,
      table_number INTEGER NOT NULL,
      request_type TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'waiting',
      created_at DATETIME DEFAULT (datetime('now')),
      accepted_at DATETIME,
      completed_at DATETIME,
      FOREIGN KEY (restaurant_id) REFERENCES restaurants(id)
    )
  `);
  db.run('CREATE INDEX IF NOT EXISTS idx_requests_status ON requests(status)');
  db.run('CREATE INDEX IF NOT EXISTS idx_requests_created ON requests(created_at)');
  db.run('CREATE INDEX IF NOT EXISTS idx_requests_restaurant ON requests(restaurant_id)');

  const result = db.exec('SELECT COUNT(*) as count FROM restaurants');
  if (result.length > 0 && result[0].values[0][0] === 0) {
    db.run("INSERT INTO restaurants (name, address) VALUES ('My Restaurant', '123 Main Street')");
  }
  save();
}

function save() {
  if (db) {
    const data = db.export();
    const buffer = Buffer.from(data);
    fs.writeFileSync(dbPath, buffer);
  }
}

function queryAll(sql, params) {
  const stmt = db.prepare(sql);
  if (params) stmt.bind(params);
  const results = [];
  while (stmt.step()) {
    results.push(stmt.getAsObject());
  }
  stmt.free();
  return results;
}

function queryOne(sql, params) {
  const stmt = db.prepare(sql);
  if (params) stmt.bind(params);
  const result = stmt.step() ? stmt.getAsObject() : null;
  stmt.free();
  return result;
}

function execute(sql, params) {
  const stmt = db.prepare(sql);
  if (params) stmt.bind(params);
  stmt.step();
  stmt.free();
  const changes = db.getRowsModified();
  const isInsert = sql.trim().toUpperCase().startsWith('INSERT');
  let lastInsertRowid = null;
  if (isInsert) {
    const idResult = db.exec('SELECT last_insert_rowid() as id');
    if (idResult.length > 0 && idResult[0].values.length > 0) {
      lastInsertRowid = idResult[0].values[0][0];
    }
  }
  save();
  return { changes, lastInsertRowid };
}

function closeDB() {
  if (db) {
    save();
    db.close();
    db = null;
  }
}

function getRawDB() {
  return db;
}

module.exports = { getDB, queryAll, queryOne, execute, closeDB, save, getRawDB };
