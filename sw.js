// sw.js
self.addEventListener('push', event => {
    console.log('🔔 Push event received', event);
    let data = {};
    if (event.data) {
        try {
            data = event.data.json();
            console.log('✅ Push data parsed:', data);
        } catch (e) {
            console.log('⚠️ Push data text:', event.data.text());
        }
    } else {
        console.log('❌ Push data is empty');
    }
    const options = {
        body: data.body || 'Тестовое уведомление',
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
