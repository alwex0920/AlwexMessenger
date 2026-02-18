import { sql, initDB } from '../lib/db.js';
import { json, authenticate, sanitize } from '../lib/utils.js';

export async function handleUsers(request) {
  await initDB();

  const { pathname, searchParams } = new URL(request.url);
  const method = request.method;

  if (method === 'OPTIONS') {
    return new Response(null, { status: 204 });
  }

  try {
    const user = await authenticate(request, sql);
    if (!user) {
      return json({ error: 'Требуется авторизация' }, 401);
    }

    // Поиск пользователей
    if (pathname === '/api/users' && method === 'GET') {
      const search = searchParams.get('search') || '';
      
      let users;
      if (search) {
        users = await sql`
          SELECT id, username, display_name, avatar, last_seen, public_key
          FROM users
          WHERE id != ${user.user_id}
          AND (
            username ILIKE ${`%${search}%`}
            OR display_name ILIKE ${`%${search}%`}
          )
          ORDER BY last_seen DESC
          LIMIT 50
        `;
      } else {
        users = await sql`
          SELECT id, username, display_name, avatar, last_seen, public_key
          FROM users
          WHERE id != ${user.user_id}
          ORDER BY last_seen DESC
          LIMIT 50
        `;
      }

      return json({
        users: users.map(u => ({
          id: u.id,
          username: u.username,
          displayName: u.display_name || u.username,
          avatar: u.avatar,
          publicKey: u.public_key,
          online: u.last_seen && (Date.now() - new Date(u.last_seen).getTime()) < 300000
        }))
      });
    }

    // Получить профиль текущего пользователя
    if (pathname === '/api/profile' && method === 'GET') {
      return json({
        user: {
          id: user.user_id,
          username: user.username,
          displayName: user.display_name || user.username,
          email: user.email,
          bio: user.bio,
          gender: user.gender,
          avatar: user.avatar,
          publicKey: user.public_key,
          emailVerified: user.email_verified,
          twoFactorEnabled: user.two_factor_enabled,
          createdAt: user.created_at
        }
      });
    }

    // Обновить профиль
    if (pathname === '/api/profile' && method === 'PUT') {
      const { displayName, bio, gender, avatar } = await request.json();

      const updates = [];
      const values = [];

      if (displayName !== undefined) {
        if (displayName.length > 50) {
          return json({ error: 'Имя максимум 50 символов' }, 400);
        }
        updates.push('display_name');
        values.push(sanitize(displayName));
      }

      if (bio !== undefined) {
        if (bio.length > 500) {
          return json({ error: 'Био максимум 500 символов' }, 400);
        }
        updates.push('bio');
        values.push(sanitize(bio));
      }

      if (gender !== undefined) {
        if (!['male', 'female', 'other'].includes(gender)) {
          return json({ error: 'Неверный пол' }, 400);
        }
        updates.push('gender');
        values.push(gender);
      }

      if (avatar !== undefined) {
        updates.push('avatar');
        values.push(avatar);
      }

      if (updates.length > 0) {
        const setClause = updates.map((col, i) => `${col} = $${i + 1}`).join(', ');
        values.push(user.user_id);
        
        await sql.unsafe(`UPDATE users SET ${setClause} WHERE id = $${values.length}`, values);
      }

      return json({ success: true, message: 'Профиль обновлён' });
    }

    return json({ error: 'Not found' }, 404);

  } catch (error) {
    console.error('Users error:', error);
    return json({ error: 'Ошибка сервера', details: error.message }, 500);
  }
}
