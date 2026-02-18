// Серверная сторона - просто валидация и хранение
// Реальное шифрование происходит на клиенте через Web Crypto API

export function validateEncryptedMessage(data) {
  if (!data.encryptedContent) {
    return 'Зашифрованное содержимое обязательно';
  }
  if (!data.nonce) {
    return 'Nonce обязателен';
  }
  return null;
}

// Генерация ключевой пары (для демо)
// В реальности это делается на клиенте
export function generateKeyPairInfo() {
  return {
    algorithm: 'RSA-OAEP',
    keySize: 2048,
    hashFunction: 'SHA-256'
  };
}

// Клиентская часть шифрования (для HTML)
export const clientCryptoScript = `
// E2E шифрование на клиенте
const CryptoHelper = {
  // Генерация ключевой пары для пользователя
  async generateKeyPair() {
    const keyPair = await crypto.subtle.generateKey(
      {
        name: 'RSA-OAEP',
        modulusLength: 2048,
        publicExponent: new Uint8Array([1, 0, 1]),
        hash: 'SHA-256',
      },
      true,
      ['encrypt', 'decrypt']
    );
    
    const publicKey = await crypto.subtle.exportKey('spki', keyPair.publicKey);
    const privateKey = await crypto.subtle.exportKey('pkcs8', keyPair.privateKey);
    
    return {
      publicKey: this.arrayBufferToBase64(publicKey),
      privateKey: this.arrayBufferToBase64(privateKey)
    };
  },
  
  // Шифрование сообщения для получателя
  async encryptMessage(message, recipientPublicKey) {
    // Генерируем случайный симметричный ключ
    const symmetricKey = await crypto.subtle.generateKey(
      { name: 'AES-GCM', length: 256 },
      true,
      ['encrypt', 'decrypt']
    );
    
    // Шифруем сообщение симметричным ключом
    const nonce = crypto.getRandomValues(new Uint8Array(12));
    const encoder = new TextEncoder();
    const encodedMessage = encoder.encode(message);
    
    const encryptedContent = await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv: nonce },
      symmetricKey,
      encodedMessage
    );
    
    // Экспортируем симметричный ключ
    const exportedKey = await crypto.subtle.exportKey('raw', symmetricKey);
    
    // Шифруем симметричный ключ публичным ключом получателя
    const importedPublicKey = await crypto.subtle.importKey(
      'spki',
      this.base64ToArrayBuffer(recipientPublicKey),
      { name: 'RSA-OAEP', hash: 'SHA-256' },
      false,
      ['encrypt']
    );
    
    const encryptedKey = await crypto.subtle.encrypt(
      { name: 'RSA-OAEP' },
      importedPublicKey,
      exportedKey
    );
    
    return {
      encryptedContent: this.arrayBufferToBase64(encryptedContent),
      encryptedKey: this.arrayBufferToBase64(encryptedKey),
      nonce: this.arrayBufferToBase64(nonce)
    };
  },
  
  // Расшифровка сообщения
  async decryptMessage(encryptedData, privateKey) {
    try {
      // Импортируем приватный ключ
      const importedPrivateKey = await crypto.subtle.importKey(
        'pkcs8',
        this.base64ToArrayBuffer(privateKey),
        { name: 'RSA-OAEP', hash: 'SHA-256' },
        false,
        ['decrypt']
      );
      
      // Расшифровываем симметричный ключ
      const decryptedKey = await crypto.subtle.decrypt(
        { name: 'RSA-OAEP' },
        importedPrivateKey,
        this.base64ToArrayBuffer(encryptedData.encryptedKey)
      );
      
      // Импортируем симметричный ключ
      const symmetricKey = await crypto.subtle.importKey(
        'raw',
        decryptedKey,
        { name: 'AES-GCM' },
        false,
        ['decrypt']
      );
      
      // Расшифровываем сообщение
      const decryptedContent = await crypto.subtle.decrypt(
        {
          name: 'AES-GCM',
          iv: this.base64ToArrayBuffer(encryptedData.nonce)
        },
        symmetricKey,
        this.base64ToArrayBuffer(encryptedData.encryptedContent)
      );
      
      const decoder = new TextDecoder();
      return decoder.decode(decryptedContent);
    } catch (error) {
      console.error('Decryption failed:', error);
      return '[Не удалось расшифровать]';
    }
  },
  
  // Вспомогательные функции
  arrayBufferToBase64(buffer) {
    const bytes = new Uint8Array(buffer);
    let binary = '';
    for (let i = 0; i < bytes.byteLength; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary);
  },
  
  base64ToArrayBuffer(base64) {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    return bytes.buffer;
  },
  
  // Сохранение ключей в localStorage (зашифрованными паролем пользователя)
  async saveKeys(publicKey, privateKey, password) {
    // Для упрощения сохраняем приватный ключ зашифрованным
    const passwordKey = await this.deriveKeyFromPassword(password);
    const nonce = crypto.getRandomValues(new Uint8Array(12));
    
    const encoder = new TextEncoder();
    const encryptedPrivateKey = await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv: nonce },
      passwordKey,
      encoder.encode(privateKey)
    );
    
    localStorage.setItem('alwex_public_key', publicKey);
    localStorage.setItem('alwex_private_key_encrypted', this.arrayBufferToBase64(encryptedPrivateKey));
    localStorage.setItem('alwex_private_key_nonce', this.arrayBufferToBase64(nonce));
  },
  
  async loadPrivateKey(password) {
    const encrypted = localStorage.getItem('alwex_private_key_encrypted');
    const nonce = localStorage.getItem('alwex_private_key_nonce');
    
    if (!encrypted || !nonce) return null;
    
    const passwordKey = await this.deriveKeyFromPassword(password);
    
    const decrypted = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: this.base64ToArrayBuffer(nonce) },
      passwordKey,
      this.base64ToArrayBuffer(encrypted)
    );
    
    const decoder = new TextDecoder();
    return decoder.decode(decrypted);
  },
  
  async deriveKeyFromPassword(password) {
    const encoder = new TextEncoder();
    const passwordBuffer = encoder.encode(password);
    
    const passwordKey = await crypto.subtle.importKey(
      'raw',
      passwordBuffer,
      { name: 'PBKDF2' },
      false,
      ['deriveBits', 'deriveKey']
    );
    
    return await crypto.subtle.deriveKey(
      {
        name: 'PBKDF2',
        salt: encoder.encode('AlwexMessenger2026'),
        iterations: 100000,
        hash: 'SHA-256'
      },
      passwordKey,
      { name: 'AES-GCM', length: 256 },
      false,
      ['encrypt', 'decrypt']
    );
  }
};

// Глобально доступно
window.CryptoHelper = CryptoHelper;
`;
