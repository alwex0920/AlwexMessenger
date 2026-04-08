// sw.js
self.addEventListener('push', event => {
    if (!event.data) return;
    
    let data;
    try {
        data = event.data.json();
    } catch (e) {
        data = { title: 'Новое сообщение', body: event.data.text() };
    }
    
    const options = {
        body: data.body || '',
        icon: data.icon || '/favicon.ico',
        badge: '/favicon.ico',
        vibrate: [200, 100, 200],
        requireInteraction: true,
        data: data.data || {}
    };
    
    event.waitUntil(
        self.registration.showNotification(data.title || 'AlwexMessenger', options)
    );
});

self.addEventListener('notificationclick', event => {
    event.notification.close();
    const urlToOpen = event.notification.data?.chatId 
        ? `/?chat=${event.notification.data.chatId}` 
        : '/';
    event.waitUntil(
        clients.matchAll({ type: 'window', includeUncontrolled: true })
            .then(clients => {
                for (let client of clients) {
                    if (client.url === urlToOpen && 'focus' in client) {
                        return client.focus();
                    }
                }
                if (clients.openWindow) return clients.openWindow(urlToOpen);
            })
    );
});
