import { nanoid } from 'nanoid';
import crypto from 'crypto';

// Генерация токенов
export function generateToken() {
  return nanoid(64);
}

export function generateCode() {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

// Хеширование паролей (используем встроенный crypto вместо argon2 для Vercel)
export async function hashPassword(password) {
  return new Promise((resolve, reject) => {
    const salt = crypto.randomBytes(16).toString('hex');
    crypto.pbkdf2(password, salt, 100000, 64, 'sha512', (err, derivedKey) => {
      if (err) reject(err);
      resolve(salt + ':' + derivedKey.toString('hex'));
    });
  });
}

export async function verifyPassword(password, hash) {
  return new Promise((resolve, reject) => {
    const [salt, key] = hash.split(':');
    crypto.pbkdf2(password, salt, 100000, 64, 'sha512', (err, derivedKey) => {
      if (err) reject(err);
      resolve(key === derivedKey.toString('hex'));
    });
  });
}

// CORS headers
export const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

// JSON response helper
export function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json',
      ...corsHeaders,
      ...headers
    }
  });
}

// Валидация
export function validateUsername(username) {
  if (!username || username.length < 3 || username.length > 30) {
    return 'Имя пользователя: 3-30 символов';
  }
  if (!/^[a-zA-Z0-9_]+$/.test(username)) {
    return 'Только латиница, цифры и _';
  }
  return null;
}

export function validateEmail(email) {
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return 'Неверный email';
  }
  return null;
}

export function validatePassword(password) {
  if (!password || password.length < 8) {
    return 'Пароль минимум 8 символов';
  }
  if (!/[A-Z]/.test(password) || !/[a-z]/.test(password) || !/[0-9]/.test(password)) {
    return 'Пароль должен содержать A-Z, a-z и 0-9';
  }
  return null;
}

// Аутентификация
export async function authenticate(request, sql) {
  const auth = request.headers.get('Authorization');
  if (!auth || !auth.startsWith('Bearer ')) {
    return null;
  }

  const token = auth.substring(7);
  
  const result = await sql`
    SELECT s.*, u.* 
    FROM sessions s
    JOIN users u ON s.user_id = u.id
    WHERE s.token = ${token} 
    AND s.expires_at > NOW()
    LIMIT 1
  `;

  if (result.length === 0) return null;

  // Обновляем last_seen
  await sql`
    UPDATE users 
    SET last_seen = NOW() 
    WHERE id = ${result[0].user_id}
  `;

  return result[0];
}

// Sanitize HTML
export function sanitize(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;');
}

// Rate limiting (простая in-memory версия)
const rateLimits = new Map();

export function checkRateLimit(ip, endpoint, maxRequests = 100) {
  const key = `${ip}:${endpoint}`;
  const now = Date.now();
  const windowMs = 60000; // 1 минута

  if (!rateLimits.has(key)) {
    rateLimits.set(key, { count: 1, resetTime: now + windowMs });
    return { allowed: true };
  }

  const limit = rateLimits.get(key);

  if (now > limit.resetTime) {
    rateLimits.set(key, { count: 1, resetTime: now + windowMs });
    return { allowed: true };
  }

  if (limit.count >= maxRequests) {
    return { 
      allowed: false, 
      retryAfter: Math.ceil((limit.resetTime - now) / 1000) 
    };
  }

  limit.count++;
  return { allowed: true };
}

// Очистка старых rate limits каждые 5 минут
setInterval(() => {
  const now = Date.now();
  for (const [key, value] of rateLimits.entries()) {
    if (now > value.resetTime) {
      rateLimits.delete(key);
    }
  }
}, 300000);
