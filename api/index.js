// api/index.js
import { handleAuth } from './auth.js';
import { handleMessages } from './messages.js';
import { handleGroups } from './groups.js';
import { handleUsers } from './users.js';

export default async function handler(request) {
  const url = new URL(request.url);
  const path = url.pathname;

  try {
    // Авторизация
    if (path === '/api/register' || path === '/api/login' || path === '/api/logout') {
      return await handleAuth(request);
    }

    // Сообщения и чаты
    if (path === '/api/messages' || path === '/api/chats') {
      return await handleMessages(request);
    }

    // Группы
    if (path.startsWith('/api/groups')) {
      return await handleGroups(request);
    }

    // Пользователи и профиль
    if (path === '/api/users' || path === '/api/profile') {
      return await handleUsers(request);
    }

    // Ping
    if (path === '/api/ping') {
      return new Response(JSON.stringify({ success: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // Неизвестный путь
    return new Response(JSON.stringify({ error: 'Not found' }), {
      status: 404,
      headers: { 'Content-Type': 'application/json' }
    });

  } catch (error) {
    console.error('API Error:', error);
    return new Response(JSON.stringify({ error: 'Internal server error' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}
