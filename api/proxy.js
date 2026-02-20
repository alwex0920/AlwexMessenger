export default async function handler(req, res) {
  // Разрешаем CORS для всех источников (если нужно)
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Device-Fingerprint');

  // Если это preflight-запрос (OPTIONS), отвечаем сразу
  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  // Целевой URL можно брать из переменной окружения (задайте в Vercel)
  const targetBase = process.env.TARGET_API_URL || 'https://alwexmessenger.alwex.workers.dev';
  const url = new URL(req.url, targetBase);

  // Копируем заголовки
  const headers = new Headers();
  for (const [key, value] of Object.entries(req.headers)) {
    if (!['host', 'connection', 'content-length'].includes(key.toLowerCase())) {
      headers.set(key, value);
    }
  }

  // Читаем тело запроса
  let body = null;
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    body = await new Promise((resolve) => {
      let data = '';
      req.on('data', chunk => data += chunk);
      req.on('end', () => resolve(data || undefined));
    });
  }

  try {
    const response = await fetch(url.toString(), {
      method: req.method,
      headers,
      body: body,
    });

    const responseText = await response.text();
    let responseData;
    try {
      responseData = JSON.parse(responseText);
    } catch {
      responseData = responseText;
    }

    res.status(response.status);
    response.headers.forEach((value, key) => {
      if (!['content-encoding', 'content-length', 'transfer-encoding', 'connection'].includes(key.toLowerCase())) {
        res.setHeader(key, value);
      }
    });

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
