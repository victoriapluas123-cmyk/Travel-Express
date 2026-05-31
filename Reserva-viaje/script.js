// Simple Express backend to support features:
// - user register/login (JWT), admin role support
// - visit counter (tracked via /api/trackVisit; /api/visits requires admin JWT)
// - contact form sends email (nodemailer) via SMTP env vars
// - reservations/search endpoint (stub for operator code integration)
// - chat scheduling & message endpoint (available if within hours)
// NOTE: Replace in-memory stores with a real DB for production.

const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const nodemailer = require('nodemailer');
require('dotenv').config();

const app = express();
app.use(cors());
app.use(bodyParser.json());
app.use(express.static('public'));

// Basic config
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'replace_this_secret';
const CHAT_START = parseInt(process.env.CHAT_START_HOUR || '9', 10); // 24h
const CHAT_END = parseInt(process.env.CHAT_END_HOUR || '18', 10);

// In-memory "DB"
let users = [];
let visits = 0;
let messages = [];

// Create admin default user if not present (for demo)
(async () => {
    const adminEmail = process.env.ADMIN_EMAIL || 'admin@example.com';
    const existing = users.find(u => u.email === adminEmail);
    if (!existing) {
        const pw = process.env.ADMIN_PASSWORD || 'admin123';
        const salt = await bcrypt.genSalt(10);
        const hash = await bcrypt.hash(pw, salt);
        users.push({ id: 1, name: 'Admin', email: adminEmail, password: hash, role: 'admin' });
        console.log(`Admin created: ${adminEmail} / ${pw}`);
    }
})();

// Utility: Auth middleware
function authMiddleware(req, res, next) {
    const header = req.headers.authorization;
    if (!header) return res.status(401).json({ message: 'Authorization header missing' });
    const token = header.split(' ')[1];
    try {
        const payload = jwt.verify(token, JWT_SECRET);
        req.user = payload;
        next();
    } catch (err) {
        res.status(401).json({ message: 'Token inválido' });
    }
}

// Get current user info
app.get('/api/me', authMiddleware, (req, res) => {
    const user = users.find(u => u.id === req.user.id);
    if (!user) return res.status(404).json({ message: 'Usuario no encontrado' });
    res.json({ id: user.id, email: user.email, name: user.name, role: user.role });
});

// Register
app.post('/api/register', async (req, res) => {
    const { name, email, password } = req.body;
    if (!email || !password) return res.status(400).json({ message: 'Email y contraseña son requeridos' });
    if (users.find(u => u.email === email)) return res.status(400).json({ message: 'Usuario ya registrado' });
    const salt = await bcrypt.genSalt(10);
    const hash = await bcrypt.hash(password, salt);
    const id = users.length + 1;
    users.push({ id, name: name || email, email, password: hash, role: 'user' });
    res.status(201).json({ message: 'Usuario creado' });
});

// Login
app.post('/api/login', async (req, res) => {
    const { email, password } = req.body;
    const user = users.find(u => u.email === email);
    if (!user) return res.status(401).json({ message: 'Credenciales incorrectas' });
    const ok = await bcrypt.compare(password, user.password);
    if (!ok) return res.status(401).json({ message: 'Credenciales incorrectas' });
    const token = jwt.sign({ id: user.id, email: user.email, role: user.role }, JWT_SECRET, { expiresIn: '8h' });
    res.json({ token });
});

// Track visit (public endpoint for front-end to call)
app.post('/api/trackVisit', (req, res) => {
    visits += 1;
    res.json({ visits });
});

// Admin-only: get visits (requires JWT with admin role)
app.get('/api/visits', authMiddleware, (req, res) => {
    const user = users.find(u => u.id === req.user.id);
    if (!user || user.role !== 'admin') return res.status(403).json({ message: 'Acceso denegado' });
    res.json({ visits });
});

// Contact form: sends email using nodemailer config
app.post('/api/contact', async (req, res) => {
    const { name, email, message } = req.body;
    if (!name || !email || !message) return res.status(400).json({ message: 'Campos incompletos' });

    // Transporter using env config (replace with your SMTP)
    const transporter = nodemailer.createTransport({
        host: process.env.SMTP_HOST || 'smtp.example.com',
        port: parseInt(process.env.SMTP_PORT || '587', 10),
        secure: process.env.SMTP_SECURE === 'true', // true for 465, false for other ports
        auth: {
            user: process.env.SMTP_USER || 'user@example.com',
            pass: process.env.SMTP_PASS || 'password',
        },
    });

    try {
        await transporter.sendMail({
            from: `"Contacto Travel" <${process.env.SMTP_FROM || 'contact@travel.com'}>`,
            to: process.env.CONTACT_EMAIL || 'contact@travel.com',
            subject: `Nuevo mensaje de ${name}`,
            text: `Email: ${email}\n\n${message}`,
            html: `<p><strong>Email:</strong> ${email}</p><p>${message}</p>`,
        });
        res.json({ message: 'Mensaje enviado' });
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'No se pudo enviar el mensaje' });
    }
});

// Reservations search (stub / operator integration)
// NOTE: Se debe pegar el código proporcionado por el operador o llamar a su API desde aquí.
// Here we echo back a fake result so we can demonstrate UI.
app.post('/api/reservations/search', (req, res) => {
    // Example: if your operator requires server-call, implement it here.
    const payload = req.body;
    // Replace below with operator API call or code.
    res.json({ results: [{ id: 'R-001', status: 'Confirmada', payload }] });
});

// Chat schedule endpoint: returns schedule and availability
app.get('/api/chat/schedule', (req, res) => {
    const now = new Date();
    const h = now.getHours();
    const available = h >= CHAT_START && h < CHAT_END;
    res.json({ available, startHour: CHAT_START, endHour: CHAT_END });
});

// Chat post (store in-memory)
app.post('/api/chat', authMiddleware, (req, res) => {
    const { text } = req.body;
    if (!text) return res.status(400).json({ message: 'Mensaje vacío' });
    // Only accept if chat is open
    const now = new Date();
    const h = now.getHours();
    if (h < CHAT_START || h >= CHAT_END) return res.status(403).json({ message: 'Chat fuera de horario' });
    messages.push({ id: messages.length + 1, userId: req.user.id, text, at: new Date() });
    res.json({ message: 'Mensaje recibido' });
});

// Serve static files
app.get('/', (req, res) => {
    res.sendFile(__dirname + '/index.html');
});

// Start server
app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
    console.log(`Chat horario: ${CHAT_START}:00 - ${CHAT_END}:00`);
});