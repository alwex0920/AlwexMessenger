export default async function handler(req, res) {
  // Целевой URL вашего Cloudflare Worker
  const targetBase = 'https://alwexmessenger.alwex.workers.dev';
  const url = new URL(req.url, targetBase);

  // Копируем заголовки (исключаем некоторые, чтобы избежать конфликтов)
  const headers = new Headers();
  for (const [key, value] of Object.entries(req.headers)) {
    if (!['host', 'connection', 'content-length'].includes(key.toLowerCase())) {
      headers.set(key, value);
    }
  }

  // Читаем тело запроса (если это не GET/HEAD)
  let body = null;
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    body = await new Promise((resolve) => {
      let data = '';
      req.on('data', chunk => data += chunk);
      req.on('end', () => resolve(data || undefined));
    });
  }

  try {
    // Отправляем запрос к целевому серверу
    const response = await fetch(url.toString(), {
      method: req.method,
      headers,
      body: body,
    });

    // Читаем ответ как текст, затем пытаемся распарсить как JSON
    const responseText = await response.text();
    let responseData;
    try {
      responseData = JSON.parse(responseText);
    } catch {
      responseData = responseText;
    }

    // Устанавливаем статус и заголовки ответа
    res.status(response.status);
    response.headers.forEach((value, key) => {
      if (!['content-encoding', 'content-length', 'transfer-encoding', 'connection'].includes(key.toLowerCase())) {
        res.setHeader(key, value);
      }
    });

    // Отправляем данные клиенту
    if (typeof responseData === 'object') {
      res.json(responseData);
    } else {
      res.send(responseData);
    }
  } catch (error) {
    console.error('Proxy error:', error);
    res.status(500).json({ error: 'Proxy error', details: error.message });
  }
}
