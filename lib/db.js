import { neon } from '@neondatabase/serverless';

const sql = neon(process.env.POSTGRES_URL);

export async function initDB() {
  await sql`
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      username VARCHAR(30) UNIQUE NOT NULL,
      email VARCHAR(255) UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      display_name VARCHAR(50),
      bio TEXT,
      gender VARCHAR(10) DEFAULT 'other',
      avatar TEXT,
      public_key TEXT,
      email_verified BOOLEAN DEFAULT FALSE,
      two_factor_enabled BOOLEAN DEFAULT FALSE,
      two_factor_secret TEXT,
      created_at TIMESTAMP DEFAULT NOW(),
      last_seen TIMESTAMP DEFAULT NOW()
    )
  `;

  await sql`
    CREATE TABLE IF NOT EXISTS sessions (
      id SERIAL PRIMARY KEY,
      user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
      token VARCHAR(255) UNIQUE NOT NULL,
      ip_address VARCHAR(45),
      created_at TIMESTAMP DEFAULT NOW(),
      expires_at TIMESTAMP
    )
  `;

  await sql`
    CREATE TABLE IF NOT EXISTS messages (
      id SERIAL PRIMARY KEY,
      sender_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
      recipient_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
      group_id INTEGER,
      encrypted_content TEXT NOT NULL,
      encrypted_key TEXT,
      nonce TEXT,
      type VARCHAR(20) DEFAULT 'text',
      created_at TIMESTAMP DEFAULT NOW(),
      read_at TIMESTAMP,
      deleted BOOLEAN DEFAULT FALSE
    )
  `;

  await sql`
    CREATE TABLE IF NOT EXISTS groups (
      id SERIAL PRIMARY KEY,
      name VARCHAR(100) NOT NULL,
      description TEXT,
      avatar TEXT,
      owner_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
      created_at TIMESTAMP DEFAULT NOW()
    )
  `;

  await sql`
    CREATE TABLE IF NOT EXISTS group_members (
      id SERIAL PRIMARY KEY,
      group_id INTEGER REFERENCES groups(id) ON DELETE CASCADE,
      user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
      role VARCHAR(20) DEFAULT 'member',
      public_key TEXT,
      joined_at TIMESTAMP DEFAULT NOW(),
      UNIQUE(group_id, user_id)
    )
  `;

  await sql`
    CREATE INDEX IF NOT EXISTS idx_messages_sender ON messages(sender_id)
  `;
  
  await sql`
    CREATE INDEX IF NOT EXISTS idx_messages_recipient ON messages(recipient_id)
  `;
  
  await sql`
    CREATE INDEX IF NOT EXISTS idx_messages_group ON messages(group_id)
  `;
  
  await sql`
    CREATE INDEX IF NOT EXISTS idx_sessions_token ON sessions(token)
  `;
}

export { sql };
