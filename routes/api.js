const express = require('express');
const router = express.Router();
const { getDB, queryAll, queryOne, execute } = require('../database/db');

const requestTimestamps = {};

function getTimeElapsed(createdAt) {
  const diff = Date.now() - new Date(createdAt + 'Z').getTime();
  const mins = Math.floor(diff / 60000);
  const secs = Math.floor((diff % 60000) / 1000);
  if (mins > 0) return `${mins}m ${secs}s`;
  return `${secs}s`;
}

router.post('/api/request', async (req, res) => {
  try {
    const { table, type } = req.body;
    const tableNum = parseInt(table, 10);
    const requestType = (type || 'waiter').toString().trim().toLowerCase();

    if (!tableNum || tableNum < 1) {
      return res.status(400).json({ error: 'Invalid table number' });
    }

    const validTypes = ['waiter', 'bill', 'water', 'cutlery'];
    if (!validTypes.includes(requestType)) {
      return res.status(400).json({ error: 'Invalid request type' });
    }

    const now = Date.now();
    const lastRequest = requestTimestamps[tableNum];
    if (lastRequest && (now - lastRequest) < 30000) {
      const remaining = Math.ceil((30000 - (now - lastRequest)) / 1000);
      return res.status(429).json({ error: 'Please wait', remaining });
    }

    await getDB();
    const tableExists = queryOne('SELECT id FROM tables WHERE table_number = ?', [tableNum]);
    if (!tableExists) {
      execute('INSERT INTO tables (restaurant_id, table_number) VALUES (1, ?)', [tableNum]);
    }

    const result = execute(
      "INSERT INTO requests (restaurant_id, table_number, request_type, status) VALUES (1, ?, ?, 'waiting')",
      [tableNum, requestType]
    );

    requestTimestamps[tableNum] = now;

    const request = queryOne('SELECT * FROM requests WHERE id = ?', [result.lastInsertRowid]);

    const io = req.app.get('io');
    if (io) {
      io.emit('new_request', {
        id: request.id,
        table_number: request.table_number,
        request_type: request.request_type,
        status: request.status,
        created_at: request.created_at,
        waiting_time: getTimeElapsed(request.created_at)
      });
    }

    res.json({ success: true, id: request.id });
  } catch (err) {
    console.error('POST /api/request error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.get('/api/requests', async (req, res) => {
  try {
    await getDB();
    const statusFilter = req.query.status;
    let rows;
    if (statusFilter) {
      rows = queryAll("SELECT * FROM requests WHERE status = ? ORDER BY created_at DESC", [statusFilter]);
    } else {
      rows = queryAll("SELECT * FROM requests WHERE status != 'completed' ORDER BY created_at DESC");
    }
    const requests = rows.map(r => ({
      ...r,
      waiting_time: getTimeElapsed(r.created_at)
    }));
    res.json(requests);
  } catch (err) {
    console.error('GET /api/requests error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/api/accept', async (req, res) => {
  try {
    const { id } = req.body;
    if (!id) return res.status(400).json({ error: 'Request ID required' });

    await getDB();
    const result = execute(
      "UPDATE requests SET status = 'in_progress', accepted_at = datetime('now') WHERE id = ? AND status = 'waiting'",
      [id]
    );

    if (result.changes === 0) {
      return res.status(404).json({ error: 'Request not found or already accepted' });
    }

    const request = queryOne('SELECT * FROM requests WHERE id = ?', [id]);

    const io = req.app.get('io');
    if (io) {
      io.emit('update_request', {
        id: request.id,
        status: request.status,
        accepted_at: request.accepted_at,
        waiting_time: getTimeElapsed(request.created_at)
      });
    }

    res.json({ success: true });
  } catch (err) {
    console.error('POST /api/accept error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/api/complete', async (req, res) => {
  try {
    const { id } = req.body;
    if (!id) return res.status(400).json({ error: 'Request ID required' });

    await getDB();
    const result = execute(
      "UPDATE requests SET status = 'completed', completed_at = datetime('now') WHERE id = ? AND status != 'completed'",
      [id]
    );

    if (result.changes === 0) {
      return res.status(404).json({ error: 'Request not found' });
    }

    const request = queryOne('SELECT * FROM requests WHERE id = ?', [id]);

    const io = req.app.get('io');
    if (io) {
      io.emit('update_request', {
        id: request.id,
        status: request.status,
        completed_at: request.completed_at,
        waiting_time: getTimeElapsed(request.created_at)
      });
    }

    res.json({ success: true });
  } catch (err) {
    console.error('POST /api/complete error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/api/dismiss', async (req, res) => {
  try {
    const { id } = req.body;
    if (!id) return res.status(400).json({ error: 'Request ID required' });

    await getDB();
    execute("UPDATE requests SET status = 'dismissed' WHERE id = ?", [id]);

    const io = req.app.get('io');
    if (io) {
      io.emit('remove_request', { id });
    }

    res.json({ success: true });
  } catch (err) {
    console.error('POST /api/dismiss error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.get('/api/statistics', async (req, res) => {
  try {
    await getDB();
    const today = new Date().toISOString().split('T')[0];

    const totalToday = queryOne(
      "SELECT COUNT(*) as count FROM requests WHERE date(created_at) >= ?", [today]
    );

    const activeRequests = queryOne(
      "SELECT COUNT(*) as count FROM requests WHERE status IN ('waiting', 'in_progress')"
    );

    const completedToday = queryOne(
      "SELECT COUNT(*) as count FROM requests WHERE status = 'completed' AND date(created_at) >= ?", [today]
    );

    const avgResponse = queryOne(
      "SELECT AVG(strftime('%s', accepted_at) - strftime('%s', created_at)) as avg_time FROM requests WHERE accepted_at IS NOT NULL AND date(created_at) >= ?",
      [today]
    );

    const avgWait = queryOne(
      "SELECT AVG(strftime('%s', completed_at) - strftime('%s', created_at)) as avg_wait FROM requests WHERE completed_at IS NOT NULL AND date(created_at) >= ?",
      [today]
    );

    const busiestTables = queryAll(
      "SELECT table_number, COUNT(*) as count FROM requests WHERE date(created_at) >= ? GROUP BY table_number ORDER BY count DESC LIMIT 5",
      [today]
    );

    const mostRequested = queryAll(
      "SELECT request_type, COUNT(*) as count FROM requests WHERE date(created_at) >= ? GROUP BY request_type ORDER BY count DESC",
      [today]
    );

    const requestsPerHour = queryAll(
      "SELECT strftime('%H', created_at) as hour, COUNT(*) as count FROM requests WHERE date(created_at) >= ? GROUP BY hour ORDER BY hour",
      [today]
    );

    const dailyActivity = queryAll(
      "SELECT date(created_at) as day, COUNT(*) as count FROM requests GROUP BY day ORDER BY day DESC LIMIT 7"
    );

    const waitTimeByHour = queryAll(
      "SELECT strftime('%H', created_at) as hour, AVG(strftime('%s', completed_at) - strftime('%s', created_at)) as avg_wait FROM requests WHERE completed_at IS NOT NULL AND date(created_at) >= ? GROUP BY hour ORDER BY hour",
      [today]
    );

    res.json({
      requests_today: totalToday ? totalToday.count : 0,
      active_requests: activeRequests ? activeRequests.count : 0,
      completed_today: completedToday ? completedToday.count : 0,
      average_response_time: avgResponse && avgResponse.avg_time ? Math.round(avgResponse.avg_time) : 0,
      average_wait_time: avgWait && avgWait.avg_wait ? Math.round(avgWait.avg_wait) : 0,
      busiest_tables: busiestTables,
      most_requested: mostRequested,
      requests_per_hour: requestsPerHour,
      daily_activity: dailyActivity,
      wait_time_by_hour: waitTimeByHour
    });
  } catch (err) {
    console.error('GET /api/statistics error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.get('/api/history', async (req, res) => {
  try {
    await getDB();
    const { search, type, dateFrom, dateTo, page = 1, limit = 50 } = req.query;

    let conditions = [];
    let params = [];

    if (search) {
      conditions.push("(table_number LIKE ? OR request_type LIKE ?)");
      params.push(`%${search}%`, `%${search}%`);
    }
    if (type) {
      conditions.push("request_type = ?");
      params.push(type);
    }
    if (dateFrom) {
      conditions.push("created_at >= ?");
      params.push(dateFrom);
    }
    if (dateTo) {
      conditions.push("created_at <= ?");
      params.push(dateTo + ' 23:59:59');
    }

    const where = conditions.length > 0 ? ' WHERE ' + conditions.join(' AND ') : '';
    const offset = (parseInt(page) - 1) * parseInt(limit);

    const rows = queryAll(
      `SELECT * FROM requests${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`,
      [...params, parseInt(limit), offset]
    );

    const countResult = queryOne(
      `SELECT COUNT(*) as count FROM requests${where}`,
      params
    );

    res.json({
      requests: rows,
      total: countResult ? countResult.count : 0,
      page: parseInt(page),
      limit: parseInt(limit)
    });
  } catch (err) {
    console.error('GET /api/history error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.get('/api/export/csv', async (req, res) => {
  try {
    await getDB();
    const { dateFrom, dateTo } = req.query;
    let conditions = [];
    let params = [];

    if (dateFrom) { conditions.push('created_at >= ?'); params.push(dateFrom); }
    if (dateTo) { conditions.push('created_at <= ?'); params.push(dateTo + ' 23:59:59'); }
    const where = conditions.length > 0 ? ' WHERE ' + conditions.join(' AND ') : '';

    const rows = queryAll(`SELECT * FROM requests${where} ORDER BY created_at DESC`, params);

    const { stringify } = require('csv-stringify/sync');
    const csv = stringify(rows, { header: true });

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename=requests.csv');
    res.send(csv);
  } catch (err) {
    console.error('GET /api/export/csv error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.get('/api/export/pdf', async (req, res) => {
  try {
    await getDB();
    const { dateFrom, dateTo } = req.query;
    let conditions = [];
    let params = [];

    if (dateFrom) { conditions.push('created_at >= ?'); params.push(dateFrom); }
    if (dateTo) { conditions.push('created_at <= ?'); params.push(dateTo + ' 23:59:59'); }
    const where = conditions.length > 0 ? ' WHERE ' + conditions.join(' AND ') : '';

    const rows = queryAll(`SELECT * FROM requests${where} ORDER BY created_at DESC`, params);

    const PDFDocument = require('pdfkit');
    const doc = new PDFDocument({ margin: 30, size: 'A4' });

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'attachment; filename=requests.pdf');
    doc.pipe(res);

    doc.fontSize(20).text('Request History', { align: 'center' });
    doc.moveDown();

    rows.forEach((r, i) => {
      doc.fontSize(10);
      doc.text(`#${r.id} | Table ${r.table_number} | ${r.request_type} | ${r.status} | ${r.created_at}`);
      if ((i + 1) % 30 === 0) doc.addPage();
    });

    doc.end();
  } catch (err) {
    console.error('GET /api/export/pdf error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.get('/api/tables', async (req, res) => {
  try {
    await getDB();
    const tables = queryAll('SELECT * FROM tables ORDER BY table_number');
    res.json(tables);
  } catch (err) {
    console.error('GET /api/tables error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/api/tables', async (req, res) => {
  try {
    const { table_number } = req.body;
    const num = parseInt(table_number, 10);
    if (!num || num < 1) return res.status(400).json({ error: 'Invalid table number' });

    await getDB();
    const exists = queryOne('SELECT id FROM tables WHERE table_number = ?', [num]);
    if (exists) return res.status(409).json({ error: 'Table already exists' });

    execute('INSERT INTO tables (restaurant_id, table_number) VALUES (1, ?)', [num]);
    const table = queryOne('SELECT * FROM tables WHERE table_number = ?', [num]);
    res.json(table);
  } catch (err) {
    console.error('POST /api/tables error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/api/tables/batch', async (req, res) => {
  try {
    const { start, end } = req.body;
    const s = parseInt(start, 10);
    const e = parseInt(end, 10);
    if (!s || !e || s > e || s < 1) return res.status(400).json({ error: 'Invalid range' });

    await getDB();
    const { save, getRawDB } = require('../database/db');
    const rawDb = getRawDB();

    const existing = queryAll('SELECT table_number FROM tables');
    const existingNums = new Set(existing.map(t => t.table_number));

    let count = 0;
    for (let n = s; n <= e; n++) {
      if (!existingNums.has(n)) {
        rawDb.run('INSERT INTO tables (restaurant_id, table_number) VALUES (1, ?)', [n]);
        count++;
      }
    }
    save();
    res.json({ success: true, added: count });
  } catch (err) {
    console.error('POST /api/tables/batch error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.delete('/api/tables/:id', async (req, res) => {
  try {
    await getDB();
    execute('DELETE FROM tables WHERE id = ?', [req.params.id]);
    res.json({ success: true });
  } catch (err) {
    console.error('DELETE /api/tables error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.get('/api/settings', async (req, res) => {
  try {
    await getDB();
    const restaurant = queryOne('SELECT * FROM restaurants WHERE id = 1');
    res.json(restaurant);
  } catch (err) {
    console.error('GET /api/settings error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/api/settings', async (req, res) => {
  try {
    const { name, address, primary_color, accent_color } = req.body;
    await getDB();
    execute(
      'UPDATE restaurants SET name = COALESCE(?, name), address = COALESCE(?, address), primary_color = COALESCE(?, primary_color), accent_color = COALESCE(?, accent_color) WHERE id = 1',
      [name || null, address || null, primary_color || null, accent_color || null]
    );
    const restaurant = queryOne('SELECT * FROM restaurants WHERE id = 1');
    res.json(restaurant);
  } catch (err) {
    console.error('POST /api/settings error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
