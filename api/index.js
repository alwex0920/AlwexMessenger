import { handleAuth } from './auth.js';
import { handleMessages } from './messages.js';
import { handleGroups } from './groups.js';
import { handleUsers } from './users.js';
import { json, corsHeaders } from '../lib/utils.js';
import { initDB } from '../lib/db.js';

export default async function handler(request) {
  const { pathname } = new URL(request.url);

  // CORS preflight
  if (request.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: corsHeaders
    });
  }

  try {
    // Инициализация БД при первом запросе
    await initDB();

    // Роутинг
    // Авторизация
    if (pathname.startsWith('/api/register') || 
        pathname.startsWith('/api/login') || 
        pathname.startsWith('/api/logout')) {
      return await handleAuth(request);
    }

    // Сообщения
    if (pathname.startsWith('/api/messages') || 
        pathname.startsWith('/api/chats')) {
      return await handleMessages(request);
    }

    // Группы
    if (pathname.startsWith('/api/groups')) {
      return await handleGroups(request);
    }

    // Пользователи и профиль
    if (pathname.startsWith('/api/users') || 
        pathname.startsWith('/api/profile')) {
      return await handleUsers(request);
    }

    // Ping endpoint
    if (pathname === '/api/ping') {
      return json({ 
        success: true, 
        timestamp: Date.now(),
        version: '2.0.0'
      });
    }

    // 404
    return json({ error: 'Эндпоинт не найден' }, 404);

  } catch (error) {
    console.error('API Error:', error);
    return json({ 
      error: 'Внутренняя ошибка сервера', 
      details: error.message 
    }, 500);
  }
}
