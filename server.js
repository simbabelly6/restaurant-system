const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const multer = require('multer');
const fs = require('fs');
const { getDB, execute, closeDB } = require('./database/db');
const apiRoutes = require('./routes/api');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.set('io', io);

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));
app.use('/qrcodes', express.static(path.join(__dirname, 'qrcodes')));
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

app.use('/', apiRoutes);

// Serve HTML pages without .html extension
const htmlRoutes = ['/', '/call', '/dashboard', '/admin'];
htmlRoutes.forEach(route => {
  app.get(route, (req, res) => {
    const filePath = route === '/' ? '/index.html' : route + '.html';
    res.sendFile(path.join(__dirname, 'public', filePath));
  });
});

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, path.join(__dirname, 'uploads')),
  filename: (req, file, cb) => cb(null, 'logo' + path.extname(file.originalname))
});
const upload = multer({ storage });

app.post('/api/upload/logo', upload.single('logo'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
    await getDB();
    execute('UPDATE restaurants SET logo = ? WHERE id = 1', ['/uploads/' + req.file.filename]);
    res.json({ logo: '/uploads/' + req.file.filename });
  } catch (err) {
    console.error('Upload error:', err);
    res.status(500).json({ error: 'Upload failed' });
  }
});

const QRCode = require('qrcode');
app.get('/api/qrcode/:table', async (req, res) => {
  try {
    const table = parseInt(req.params.table, 10);
    if (!table || table < 1) return res.status(400).json({ error: 'Invalid table' });
    const baseUrl = `${req.protocol}://${req.get('host')}`;
    const url = `${baseUrl}/call?table=${table}`;
    const qrBuffer = await QRCode.toBuffer(url, { width: 400, margin: 2, color: { dark: '#2d3436', light: '#ffffff' } });
    res.setHeader('Content-Type', 'image/png');
    res.send(qrBuffer);
  } catch (err) {
    console.error('QR generation error:', err);
    res.status(500).json({ error: 'Failed to generate QR' });
  }
});

app.get('/api/qrcode/:table/download', async (req, res) => {
  try {
    const table = parseInt(req.params.table, 10);
    if (!table || table < 1) return res.status(400).json({ error: 'Invalid table' });
    const baseUrl = `${req.protocol}://${req.get('host')}`;
    const url = `${baseUrl}/call?table=${table}`;
    const qrBuffer = await QRCode.toBuffer(url, { width: 400, margin: 2, color: { dark: '#2d3436', light: '#ffffff' } });
    res.setHeader('Content-Type', 'image/png');
    res.setHeader('Content-Disposition', `attachment; filename=table-${table}.png`);
    res.send(qrBuffer);
  } catch (err) {
    console.error('QR download error:', err);
    res.status(500).json({ error: 'Failed to generate QR' });
  }
});

app.get('/api/qrcodes/zip', async (req, res) => {
  try {
    await getDB();
    const { queryAll } = require('./database/db');
    const tables = queryAll('SELECT table_number FROM tables ORDER BY table_number');
    if (tables.length === 0) return res.status(404).json({ error: 'No tables found' });

    const archiver = require('archiver');
    const archive = archiver('zip', { zlib: { level: 9 } });

    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', 'attachment; filename=qrcodes.zip');

    archive.pipe(res);

    const baseUrl = `${req.protocol}://${req.get('host')}`;

    for (const t of tables) {
      const url = `${baseUrl}/call?table=${t.table_number}`;
      const qrBuffer = await QRCode.toBuffer(url, { width: 400, margin: 2, color: { dark: '#2d3436', light: '#ffffff' } });
      archive.append(qrBuffer, { name: `table-${t.table_number}.png` });
    }

    await archive.finalize();
  } catch (err) {
    console.error('QR zip error:', err);
    res.status(500).json({ error: 'Failed to generate zip' });
  }
});

app.get('/api/qrcodes/print', async (req, res) => {
  try {
    await getDB();
    const { queryAll, queryOne } = require('./database/db');
    const tables = queryAll('SELECT table_number FROM tables ORDER BY table_number');
    const restaurant = queryOne('SELECT * FROM restaurants WHERE id = 1');

    if (tables.length === 0) return res.status(404).json({ error: 'No tables found' });

    const PDFDocument = require('pdfkit');
    const doc = new PDFDocument({ autoFirstPage: false, size: [300, 400], margin: 10 });
    const baseUrl = `${req.protocol}://${req.get('host')}`;

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'attachment; filename=qrcodes.pdf');
    doc.pipe(res);

    for (let i = 0; i < tables.length; i++) {
      const t = tables[i];
      if (i > 0) doc.addPage({ size: [300, 400] });

      const qrUrl = `${baseUrl}/call?table=${t.table_number}`;
      const qrBuffer = await QRCode.toBuffer(qrUrl, { width: 200, margin: 1, color: { dark: '#2d3436', light: '#ffffff' } });

      if (restaurant.logo) {
        try {
          const logoPath = path.join(__dirname, restaurant.logo);
          if (fs.existsSync(logoPath)) {
            doc.image(logoPath, 110, 10, { width: 80 });
          }
        } catch (e) {}
      }

      doc.fontSize(14).font('Helvetica-Bold').text(restaurant.name, 10, 100, { align: 'center', width: 280 });
      doc.moveDown(0.5);
      doc.fontSize(24).font('Helvetica-Bold').text(`Table ${t.table_number}`, { align: 'center', width: 280 });
      doc.moveDown(0.5);
      doc.image(qrBuffer, 50, 140, { width: 200 });
      doc.moveDown(0.5);
      doc.fontSize(10).font('Helvetica').text('Scan to request service', { align: 'center', width: 280 });
    }

    doc.end();
  } catch (err) {
    console.error('QR print error:', err);
    res.status(500).json({ error: 'Failed to generate print PDF' });
  }
});

io.on('connection', (socket) => {
  socket.on('join_dashboard', () => {});
  socket.on('disconnect', () => {});
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`QR Waiter server running on http://localhost:${PORT}`);
  console.log(`Customer interface: http://localhost:${PORT}/call?table=1`);
  console.log(`Waiter dashboard:   http://localhost:${PORT}/dashboard`);
  console.log(`Admin panel:        http://localhost:${PORT}/admin`);
});

process.on('SIGINT', () => { closeDB(); process.exit(); });
process.on('SIGTERM', () => { closeDB(); process.exit(); });
