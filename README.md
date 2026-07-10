# QR Waiter - QR Code Restaurant Waiter Calling System

A complete full-stack web application that allows restaurant customers to call a waiter by scanning a QR code on their table.

## Quick Start

```bash
cd restaurant-system
npm install
npm start
```

Open http://localhost:3000 in your browser.

## Access Points

| Page | URL |
|------|-----|
| Home | http://localhost:3000 |
| Customer (Table 1) | http://localhost:3000/call?table=1 |
| Waiter Dashboard | http://localhost:3000/dashboard |
| Admin Panel | http://localhost:3000/admin |

## Features

- **Customer Interface**: Call waiter, request bill, water, or cutlery
- **Waiter Dashboard**: Real-time requests with accept/complete/dismiss
- **Admin Panel**: Manage tables, generate QR codes, view statistics
- **QR Code Generator**: Generate, download, and print QR codes
- **Real-Time Updates**: Socket.IO for instant notifications
- **Sound & Browser Notifications**: Audio alerts for new requests
- **Export**: CSV and PDF export of request history
- **Statistics**: Charts for requests per hour, wait times, daily activity

## Tech Stack

- Node.js + Express
- SQLite (better-sqlite3)
- Socket.IO
- QRCode library
- Vanilla JavaScript frontend

## API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | /api/request | Submit a request |
| GET | /api/requests | Get active requests |
| POST | /api/accept | Accept a request |
| POST | /api/complete | Complete a request |
| POST | /api/dismiss | Dismiss a request |
| GET | /api/statistics | Get dashboard statistics |
| GET | /api/history | Get request history |
| GET | /api/export/csv | Export as CSV |
| GET | /api/export/pdf | Export as PDF |
| GET | /api/tables | List tables |
| POST | /api/tables | Add a table |
| POST | /api/tables/batch | Add table range |
| DELETE | /api/tables/:id | Delete a table |
| GET | /api/settings | Get restaurant settings |
| POST | /api/settings | Update settings |
| POST | /api/upload/logo | Upload logo |
| GET | /api/qrcode/:table | Generate QR code |
| GET | /api/qrcode/:table/download | Download QR code |
| GET | /api/qrcodes/zip | Download all QR as ZIP |
| GET | /api/qrcodes/print | Print all QR codes |

## Deploy to Raspberry Pi

1. Install Node.js on Raspberry Pi
2. Copy the `restaurant-system` folder
3. Run `npm install`
4. Run `npm start`
5. Access from any device on the network

## License

MIT
