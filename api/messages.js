import { sql, initDB } from '../lib/db.js';
import { json, authenticate, sanitize } from '../lib/utils.js';
import { validateEncryptedMessage } from '../lib/crypto.js';

export async function handleMessages(request) {
  await initDB();

  const { pathname, searchParams } = new URL(request.url);
  const method = request.method;

  // OPTIONS
  if (method === 'OPTIONS') {
    return new Response(null, { status: 204 });
  }

  try {
    // Аутентификация для всех эндпоинтов
    const user = await authenticate(request, sql);
    if (!user) {
      return json({ error: 'Требуется авторизация' }, 401);
    }

    // Получение сообщений
    if (pathname === '/api/messages' && method === 'GET') {
      const recipientId = searchParams.get('with');
      const groupId = searchParams.get('group');
      const limit = parseInt(searchParams.get('limit') || '100');
      const before = searchParams.get('before'); // для пагинации

      if (!recipientId && !groupId) {
        return json({ error: 'Укажите получателя или группу' }, 400);
      }

      let messages;

      if (groupId) {
        // Проверка членства в группе
        const membership = await sql`
          SELECT 1 FROM group_members 
          WHERE group_id = ${groupId} AND user_id = ${user.user_id}
          LIMIT 1
        `;

        if (membership.length === 0) {
          return json({ error: 'Вы не участник этой группы' }, 403);
        }

        // Получение сообщений группы
        let query = sql`
          SELECT 
            m.*,
            u.username as sender_username,
            u.display_name as sender_name,
            u.avatar as sender_avatar
          FROM messages m
          JOIN users u ON m.sender_id = u.id
          WHERE m.group_id = ${groupId} 
          AND m.deleted = FALSE
        `;

        if (before) {
          query = sql`${query} AND m.id < ${before}`;
        }

        query = sql`${query} ORDER BY m.created_at DESC LIMIT ${limit}`;
        messages = await query;

      } else {
        // Личные сообщения
        let query = sql`
          SELECT 
            m.*,
            u.username as sender_username,
            u.display_name as sender_name,
            u.avatar as sender_avatar
          FROM messages m
          JOIN users u ON m.sender_id = u.id
          WHERE (
            (m.sender_id = ${user.user_id} AND m.recipient_id = ${recipientId})
            OR (m.sender_id = ${recipientId} AND m.recipient_id = ${user.user_id})
          )
          AND m.deleted = FALSE
        `;

        if (before) {
          query = sql`${query} AND m.id < ${before}`;
        }

        query = sql`${query} ORDER BY m.created_at DESC LIMIT ${limit}`;
        messages = await query;

        // Отметить как прочитанные
        await sql`
          UPDATE messages 
          SET read_at = NOW()
          WHERE recipient_id = ${user.user_id} 
          AND sender_id = ${recipientId}
          AND read_at IS NULL
        `;
      }

      return json({
        messages: messages.reverse().map(m => ({
          id: m.id,
          senderId: m.sender_id,
          senderName: m.sender_name || m.sender_username,
          senderAvatar: m.sender_avatar,
          encryptedContent: m.encrypted_content,
          encryptedKey: m.encrypted_key,
          nonce: m.nonce,
          type: m.type,
          createdAt: m.created_at,
          read: m.read_at !== null
        }))
      });
    }

    // Отправка сообщения
    if (pathname === '/api/messages' && method === 'POST') {
      const body = await request.json();
      const { recipientId, groupId, encryptedContent, encryptedKey, nonce, type = 'text' } = body;

      // Валидация
      if (!recipientId && !groupId) {
        return json({ error: 'Укажите получателя или группу' }, 400);
      }

      const validationError = validateEncryptedMessage({ encryptedContent, nonce });
      if (validationError) {
        return json({ error: validationError }, 400);
      }

      let result;

      if (groupId) {
        // Проверка членства
        const membership = await sql`
          SELECT 1 FROM group_members 
          WHERE group_id = ${groupId} AND user_id = ${user.user_id}
          LIMIT 1
        `;

        if (membership.length === 0) {
          return json({ error: 'Вы не участник этой группы' }, 403);
        }

        // Сохранение сообщения в группу
        result = await sql`
          INSERT INTO messages (
            sender_id, group_id, encrypted_content, 
            encrypted_key, nonce, type
          )
          VALUES (
            ${user.user_id}, ${groupId}, ${encryptedContent},
            ${encryptedKey || null}, ${nonce}, ${type}
          )
          RETURNING *
        `;
      } else {
        // Проверка существования получателя
        const recipient = await sql`
          SELECT id, public_key FROM users 
          WHERE id = ${recipientId}
          LIMIT 1
        `;

        if (recipient.length === 0) {
          return json({ error: 'Получатель не найден' }, 404);
        }

        // Для личных сообщений обязателен encryptedKey
        if (!encryptedKey) {
          return json({ error: 'Encrypted key обязателен для личных сообщений' }, 400);
        }

        // Сохранение личного сообщения
        result = await sql`
          INSERT INTO messages (
            sender_id, recipient_id, encrypted_content,
            encrypted_key, nonce, type
          )
          VALUES (
            ${user.user_id}, ${recipientId}, ${encryptedContent},
            ${encryptedKey}, ${nonce}, ${type}
          )
          RETURNING *
        `;
      }

      const message = result[0];

      return json({
        success: true,
        message: {
          id: message.id,
          senderId: message.sender_id,
          senderName: user.display_name || user.username,
          senderAvatar: user.avatar,
          encryptedContent: message.encrypted_content,
          encryptedKey: message.encrypted_key,
          nonce: message.nonce,
          type: message.type,
          createdAt: message.created_at
        }
      }, 201);
    }

    // Удаление сообщения
    if (pathname.match(/^\/api\/messages\/\d+$/) && method === 'DELETE') {
      const messageId = pathname.split('/').pop();

      // Проверка права на удаление
      const messageCheck = await sql`
        SELECT sender_id, recipient_id, group_id 
        FROM messages 
        WHERE id = ${messageId}
        LIMIT 1
      `;

      if (messageCheck.length === 0) {
        return json({ error: 'Сообщение не найдено' }, 404);
      }

      const message = messageCheck[0];

      // Может удалить только отправитель или админ группы
      let canDelete = message.sender_id === user.user_id;

      if (!canDelete && message.group_id) {
        const group = await sql`
          SELECT owner_id FROM groups WHERE id = ${message.group_id} LIMIT 1
        `;
        
        if (group.length > 0 && group[0].owner_id === user.user_id) {
          canDelete = true;
        }
      }

      if (!canDelete) {
        return json({ error: 'Нет прав на удаление' }, 403);
      }

      // Soft delete
      await sql`
        UPDATE messages 
        SET deleted = TRUE 
        WHERE id = ${messageId}
      `;

      return json({ success: true });
    }

    // Список чатов
    if (pathname === '/api/chats' && method === 'GET') {
      // Личные чаты
      const directChats = await sql`
        WITH latest_messages AS (
          SELECT DISTINCT ON (
            CASE 
              WHEN sender_id = ${user.user_id} THEN recipient_id 
              ELSE sender_id 
            END
          )
            CASE 
              WHEN sender_id = ${user.user_id} THEN recipient_id 
              ELSE sender_id 
            END as other_user_id,
            created_at,
            type
          FROM messages
          WHERE (sender_id = ${user.user_id} OR recipient_id = ${user.user_id})
          AND recipient_id IS NOT NULL
          AND deleted = FALSE
          ORDER BY 
            CASE 
              WHEN sender_id = ${user.user_id} THEN recipient_id 
              ELSE sender_id 
            END,
            created_at DESC
        )
        SELECT 
          u.id,
          u.username,
          u.display_name,
          u.avatar,
          u.last_seen,
          lm.created_at as last_message_time,
          lm.type as last_message_type,
          (
            SELECT COUNT(*) 
            FROM messages 
            WHERE sender_id = u.id 
            AND recipient_id = ${user.user_id}
            AND read_at IS NULL
            AND deleted = FALSE
          ) as unread_count
        FROM latest_messages lm
        JOIN users u ON lm.other_user_id = u.id
        ORDER BY lm.created_at DESC
      `;

      // Групповые чаты
      const groupChats = await sql`
        SELECT 
          g.id,
          g.name,
          g.description,
          g.avatar,
          g.owner_id,
          (SELECT COUNT(*) FROM group_members WHERE group_id = g.id) as member_count,
          (SELECT created_at FROM messages WHERE group_id = g.id AND deleted = FALSE ORDER BY created_at DESC LIMIT 1) as last_message_time,
          (SELECT type FROM messages WHERE group_id = g.id AND deleted = FALSE ORDER BY created_at DESC LIMIT 1) as last_message_type
        FROM groups g
        JOIN group_members gm ON g.id = gm.group_id
        WHERE gm.user_id = ${user.user_id}
        ORDER BY last_message_time DESC NULLS LAST
      `;

      const chats = [
        ...directChats.map(chat => ({
          type: 'direct',
          user: {
            id: chat.id,
            username: chat.username,
            displayName: chat.display_name || chat.username,
            avatar: chat.avatar,
            online: chat.last_seen && (Date.now() - new Date(chat.last_seen).getTime()) < 300000
          },
          lastMessageTime: chat.last_message_time,
          lastMessageType: chat.last_message_type,
          unread: chat.unread_count
        })),
        ...groupChats.map(chat => ({
          type: 'group',
          group: {
            id: chat.id,
            name: chat.name,
            description: chat.description,
            avatar: chat.avatar,
            ownerId: chat.owner_id,
            memberCount: chat.member_count
          },
          lastMessageTime: chat.last_message_time,
          lastMessageType: chat.last_message_type,
          unread: 0
        }))
      ];

      // Сортируем все чаты по времени последнего сообщения
      chats.sort((a, b) => {
        const timeA = a.lastMessageTime ? new Date(a.lastMessageTime).getTime() : 0;
        const timeB = b.lastMessageTime ? new Date(b.lastMessageTime).getTime() : 0;
        return timeB - timeA;
      });

      return json({ chats });
    }

    return json({ error: 'Not found' }, 404);

  } catch (error) {
    console.error('Messages error:', error);
    return json({ error: 'Ошибка сервера', details: error.message }, 500);
  }
}

export default async function handler(request) {
  return handleMessages(request);
}
