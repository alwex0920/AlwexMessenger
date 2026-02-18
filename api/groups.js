import { sql, initDB } from '../lib/db.js';
import { json, authenticate, sanitize } from '../lib/utils.js';

export async function handleGroups(request) {
  await initDB();

  const { pathname } = new URL(request.url);
  const method = request.method;

  if (method === 'OPTIONS') {
    return new Response(null, { status: 204 });
  }

  try {
    const user = await authenticate(request, sql);
    if (!user) {
      return json({ error: 'Требуется авторизация' }, 401);
    }

    // Создание группы
    if (pathname === '/api/groups' && method === 'POST') {
      const { name, description, members, avatar } = await request.json();

      if (!name || name.length < 2 || name.length > 100) {
        return json({ error: 'Название группы: 2-100 символов' }, 400);
      }

      if (!members || !Array.isArray(members) || members.length === 0) {
        return json({ error: 'Добавьте хотя бы одного участника' }, 400);
      }

      const groupAvatar = avatar || `https://api.dicebear.com/7.x/identicon/svg?seed=${encodeURIComponent(name)}`;

      // Создание группы
      const result = await sql`
        INSERT INTO groups (name, description, avatar, owner_id)
        VALUES (
          ${sanitize(name)},
          ${sanitize(description || '')},
          ${groupAvatar},
          ${user.user_id}
        )
        RETURNING *
      `;

      const group = result[0];

      // Добавление владельца как админа
      await sql`
        INSERT INTO group_members (group_id, user_id, role)
        VALUES (${group.id}, ${user.user_id}, 'admin')
      `;

      // Добавление участников
      for (const memberId of members) {
        if (memberId !== user.user_id) {
          // Получаем публичный ключ участника для группового шифрования
          const member = await sql`
            SELECT public_key FROM users WHERE id = ${memberId} LIMIT 1
          `;
          
          if (member.length > 0) {
            await sql`
              INSERT INTO group_members (group_id, user_id, role, public_key)
              VALUES (${group.id}, ${memberId}, 'member', ${member[0].public_key})
              ON CONFLICT (group_id, user_id) DO NOTHING
            `;
          }
        }
      }

      return json({
        success: true,
        group: {
          id: group.id,
          name: group.name,
          description: group.description,
          avatar: group.avatar,
          ownerId: group.owner_id,
          memberCount: members.length + 1
        }
      }, 201);
    }

    // Список групп пользователя
    if (pathname === '/api/groups' && method === 'GET') {
      const groups = await sql`
        SELECT 
          g.*,
          gm.role,
          (SELECT COUNT(*) FROM group_members WHERE group_id = g.id) as member_count
        FROM groups g
        JOIN group_members gm ON g.id = gm.group_id
        WHERE gm.user_id = ${user.user_id}
        ORDER BY g.created_at DESC
      `;

      return json({
        groups: groups.map(g => ({
          id: g.id,
          name: g.name,
          description: g.description,
          avatar: g.avatar,
          ownerId: g.owner_id,
          role: g.role,
          memberCount: g.member_count,
          createdAt: g.created_at
        }))
      });
    }

    // Информация о группе
    if (pathname.match(/^\/api\/groups\/\d+$/) && method === 'GET') {
      const groupId = pathname.split('/').pop();

      // Проверка членства
      const membership = await sql`
        SELECT role FROM group_members 
        WHERE group_id = ${groupId} AND user_id = ${user.user_id}
        LIMIT 1
      `;

      if (membership.length === 0) {
        return json({ error: 'Вы не участник этой группы' }, 403);
      }

      const groupData = await sql`
        SELECT * FROM groups WHERE id = ${groupId} LIMIT 1
      `;

      if (groupData.length === 0) {
        return json({ error: 'Группа не найдена' }, 404);
      }

      const group = groupData[0];

      // Участники
      const members = await sql`
        SELECT 
          u.id, u.username, u.display_name, u.avatar, 
          u.last_seen, gm.role, gm.public_key
        FROM group_members gm
        JOIN users u ON gm.user_id = u.id
        WHERE gm.group_id = ${groupId}
        ORDER BY 
          CASE gm.role 
            WHEN 'admin' THEN 1 
            WHEN 'member' THEN 2 
          END,
          gm.joined_at ASC
      `;

      return json({
        group: {
          id: group.id,
          name: group.name,
          description: group.description,
          avatar: group.avatar,
          ownerId: group.owner_id,
          createdAt: group.created_at
        },
        members: members.map(m => ({
          id: m.id,
          username: m.username,
          displayName: m.display_name || m.username,
          avatar: m.avatar,
          role: m.role,
          publicKey: m.public_key,
          online: m.last_seen && (Date.now() - new Date(m.last_seen).getTime()) < 300000
        })),
        userRole: membership[0].role
      });
    }

    // Удаление группы
    if (pathname.match(/^\/api\/groups\/\d+$/) && method === 'DELETE') {
      const groupId = pathname.split('/').pop();

      const group = await sql`
        SELECT owner_id FROM groups WHERE id = ${groupId} LIMIT 1
      `;

      if (group.length === 0) {
        return json({ error: 'Группа не найдена' }, 404);
      }

      if (group[0].owner_id !== user.user_id) {
        return json({ error: 'Только владелец может удалить группу' }, 403);
      }

      // Удаление группы (каскадно удалятся участники и сообщения)
      await sql`DELETE FROM groups WHERE id = ${groupId}`;

      return json({ success: true });
    }

    // Добавление участника
    if (pathname.match(/^\/api\/groups\/\d+\/members$/) && method === 'POST') {
      const groupId = pathname.split('/')[3];
      const { userId: newMemberId } = await request.json();

      // Проверка прав
      const membership = await sql`
        SELECT role FROM group_members 
        WHERE group_id = ${groupId} AND user_id = ${user.user_id}
        LIMIT 1
      `;

      if (membership.length === 0 || membership[0].role !== 'admin') {
        return json({ error: 'Нет прав на добавление участников' }, 403);
      }

      // Получаем публичный ключ нового участника
      const newMember = await sql`
        SELECT id, public_key FROM users WHERE id = ${newMemberId} LIMIT 1
      `;

      if (newMember.length === 0) {
        return json({ error: 'Пользователь не найден' }, 404);
      }

      await sql`
        INSERT INTO group_members (group_id, user_id, role, public_key)
        VALUES (${groupId}, ${newMemberId}, 'member', ${newMember[0].public_key})
        ON CONFLICT (group_id, user_id) DO NOTHING
      `;

      return json({ success: true });
    }

    // Удаление участника
    if (pathname.match(/^\/api\/groups\/\d+\/members\/\d+$/) && method === 'DELETE') {
      const parts = pathname.split('/');
      const groupId = parts[3];
      const memberId = parts[5];

      const group = await sql`
        SELECT owner_id FROM groups WHERE id = ${groupId} LIMIT 1
      `;

      if (group.length === 0) {
        return json({ error: 'Группа не найдена' }, 404);
      }

      // Только владелец или сам участник может удалить
      if (group[0].owner_id !== user.user_id && memberId !== String(user.user_id)) {
        return json({ error: 'Нет прав на удаление участника' }, 403);
      }

      if (memberId === String(group[0].owner_id)) {
        return json({ error: 'Нельзя удалить владельца группы' }, 400);
      }

      await sql`
        DELETE FROM group_members 
        WHERE group_id = ${groupId} AND user_id = ${memberId}
      `;

      return json({ success: true });
    }

    return json({ error: 'Not found' }, 404);

  } catch (error) {
    console.error('Groups error:', error);
    return json({ error: 'Ошибка сервера', details: error.message }, 500);
  }
}

export default async function handler(request) {
  return handleGroups(request);
}
