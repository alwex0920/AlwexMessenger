import { sql, initDB } from '../lib/db.js';
import { 
  json, 
  hashPassword, 
  verifyPassword, 
  generateToken,
  validateUsername,
  validateEmail,
  validatePassword,
  checkRateLimit
} from '../lib/utils.js';

export async function handleAuth(request) {
  await initDB();
  
  const { pathname } = new URL(request.url);
  const clientIP = request.headers.get('x-forwarded-for') || 'unknown';

  // Rate limiting
  const rateLimit = checkRateLimit(clientIP, pathname, pathname.includes('login') ? 10 : 20);
  if (!rateLimit.allowed) {
    return json({ error: 'Слишком много запросов', retryAfter: rateLimit.retryAfter }, 429);
  }

  // OPTIONS
  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204 });
  }

  try {
    // Регистрация
    if (pathname === '/api/register' && request.method === 'POST') {
      const { username, email, password, gender, publicKey } = await request.json();

      // Валидация
      const usernameError = validateUsername(username);
      if (usernameError) return json({ error: usernameError }, 400);

      const emailError = validateEmail(email);
      if (emailError) return json({ error: emailError }, 400);

      const passwordError = validatePassword(password);
      if (passwordError) return json({ error: passwordError }, 400);

      if (!publicKey) {
        return json({ error: 'Public key обязателен для шифрования' }, 400);
      }

      // Проверка существования
      const existing = await sql`
        SELECT id FROM users 
        WHERE username = ${username.toLowerCase()} 
        OR email = ${email.toLowerCase()}
        LIMIT 1
      `;

      if (existing.length > 0) {
        return json({ error: 'Пользователь уже существует' }, 409);
      }

      // Хеширование пароля
      const passwordHash = await hashPassword(password);
      const avatar = `https://api.dicebear.com/7.x/avataaars/svg?seed=${username}`;

      // Создание пользователя
      const result = await sql`
        INSERT INTO users (
          username, email, password_hash, display_name, 
          gender, avatar, public_key, email_verified
        )
        VALUES (
          ${username.toLowerCase()},
          ${email.toLowerCase()},
          ${passwordHash},
          ${username},
          ${gender || 'other'},
          ${avatar},
          ${publicKey},
          TRUE
        )
        RETURNING id, username, display_name, email, gender, avatar, public_key
      `;

      const user = result[0];

      // Создание сессии
      const token = generateToken();
      const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 дней

      await sql`
        INSERT INTO sessions (user_id, token, ip_address, expires_at)
        VALUES (${user.id}, ${token}, ${clientIP}, ${expiresAt})
      `;

      return json({
        success: true,
        token,
        user: {
          id: user.id,
          username: user.username,
          displayName: user.display_name,
          email: user.email,
          gender: user.gender,
          avatar: user.avatar,
          publicKey: user.public_key,
          emailVerified: true
        }
      }, 201);
    }

    // Вход
    if (pathname === '/api/login' && request.method === 'POST') {
      const { username, password } = await request.json();

      const users = await sql`
        SELECT * FROM users 
        WHERE username = ${username.toLowerCase()} 
        OR email = ${username.toLowerCase()}
        LIMIT 1
      `;

      if (users.length === 0) {
        return json({ error: 'Неверные данные для входа' }, 401);
      }

      const user = users[0];

      // Проверка пароля
      const valid = await verifyPassword(password, user.password_hash);
      if (!valid) {
        return json({ error: 'Неверные данные для входа' }, 401);
      }

      // Создание сессии
      const token = generateToken();
      const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

      await sql`
        INSERT INTO sessions (user_id, token, ip_address, expires_at)
        VALUES (${user.id}, ${token}, ${clientIP}, ${expiresAt})
      `;

      return json({
        success: true,
        token,
        user: {
          id: user.id,
          username: user.username,
          displayName: user.display_name || user.username,
          email: user.email,
          bio: user.bio,
          gender: user.gender,
          avatar: user.avatar,
          publicKey: user.public_key,
          emailVerified: user.email_verified,
          twoFactorEnabled: user.two_factor_enabled
        }
      });
    }

    // Выход
    if (pathname === '/api/logout' && request.method === 'POST') {
      const auth = request.headers.get('Authorization');
      if (auth) {
        const token = auth.substring(7);
        await sql`DELETE FROM sessions WHERE token = ${token}`;
      }
      return json({ success: true });
    }

    return json({ error: 'Not found' }, 404);

  } catch (error) {
    console.error('Auth error:', error);
    return json({ error: 'Ошибка сервера', details: error.message }, 500);
  }
}

export default async function handler(request) {
  return handleAuth(request);
}
