const express = require('express');
const cors = require('cors');
const { createServer } = require('http');
const { Server } = require('socket.io');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    }
});

app.use(cors());
app.use(express.json());
app.use('/logo', express.static(path.join(__dirname, '../logo')));

// Database setup
const db = new sqlite3.Database('./pizza-pos.db');

// Create tables
db.serialize(() => {
    db.run(`CREATE TABLE IF NOT EXISTS menu (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        item_name TEXT NOT NULL,
        price DECIMAL(10,2) NOT NULL,
        category TEXT NOT NULL,
        available BOOLEAN DEFAULT 1
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS orders (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        order_number TEXT UNIQUE,
        status TEXT DEFAULT 'pending',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        total_price DECIMAL(10,2),
        payment_method TEXT
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS order_items (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        order_id INTEGER,
        item_name TEXT,
        quantity INTEGER,
        toppings TEXT,
        special_instructions TEXT,
        FOREIGN KEY(order_id) REFERENCES orders(id)
    )`);
});

// Insert sample menu items for Franco's Pizza
const sampleMenu = [
    ['Margherita Pizza', 14.99, 'Pizza'],
    ['Pepperoni Pizza', 16.99, 'Pizza'],
    ['Supreme Pizza', 19.99, 'Pizza'],
    ['White Pizza', 15.99, 'Pizza'],
    ['Caesar Salad', 8.99, 'Salads'],
    ['Greek Salad', 9.99, 'Salads'],
    ['Garlic Bread', 4.99, 'Sides'],
    ['Chicken Wings', 12.99, 'Sides'],
    ['Soda', 2.49, 'Drinks'],
    ['Bottled Water', 1.99, 'Drinks']
];

db.serialize(() => {
    const stmt = db.prepare("INSERT OR IGNORE INTO menu (item_name, price, category) VALUES (?, ?, ?)");
    sampleMenu.forEach(item => {
        stmt.run(item[0], item[1], item[2]);
    });
    stmt.finalize();
});

// API Routes
app.get('/api/menu', (req, res) => {
    db.all("SELECT * FROM menu WHERE available = 1", [], (err, rows) => {
        if (err) {
            res.status(500).json({ error: err.message });
            return;
        }
        res.json(rows);
    });
});

app.post('/api/orders', (req, res) => {
    const { items, total, paymentMethod } = req.body;
    const orderNumber = 'ORD-' + Date.now();

    db.serialize(() => {
        db.run("INSERT INTO orders (order_number, total_price, payment_method) VALUES (?, ?, ?)",
            [orderNumber, total, paymentMethod],
            function(err) {
                if (err) {
                    res.status(500).json({ error: err.message });
                    return;
                }

                const orderId = this.lastID;
                const stmt = db.prepare("INSERT INTO order_items (order_id, item_name, quantity, toppings, special_instructions) VALUES (?, ?, ?, ?, ?)");
                
                items.forEach(item => {
                    stmt.run(orderId, item.name, item.quantity, item.toppings || '', item.instructions || '');
                });
                
                stmt.finalize();

                // Emit to kitchen
                io.emit('new-order', { orderId, orderNumber, items });

                res.json({ 
                    success: true, 
                    orderId, 
                    orderNumber,
                    message: 'Order sent to kitchen!' 
                });
            });
    });
});

app.get('/api/orders', (req, res) => {
    db.all(`
        SELECT o.*, GROUP_CONCAT(oi.item_name || ' x' || oi.quantity) as items 
        FROM orders o 
        LEFT JOIN order_items oi ON o.id = oi.order_id 
        WHERE o.status IN ('pending', 'cooking')
        GROUP BY o.id
        ORDER BY o.created_at DESC
    `, [], (err, rows) => {
        if (err) {
            res.status(500).json({ error: err.message });
            return;
        }
        res.json(rows);
    });
});

app.put('/api/orders/:id/status', (req, res) => {
    const { status } = req.body;
    db.run("UPDATE orders SET status = ? WHERE id = ?", [status, req.params.id], function(err) {
        if (err) {
            res.status(500).json({ error: err.message });
            return;
        }
        io.emit('order-updated', { orderId: req.params.id, status });
        res.json({ success: true });
    });
});

// Real-time socket connection
io.on('connection', (socket) => {
    console.log('Kitchen connected');
    socket.on('disconnect', () => {
        console.log('Kitchen disconnected');
    });
});

const PORT = 3000;
httpServer.listen(PORT, () => {
    console.log(`✅ Server running on port ${PORT}`);
    console.log(`📍 Franco's Pizza & Pasta`);
    console.log(`📍 228 S Main St, Newtown, CT`);
    console.log(`📞 203-270-3548`);
});
