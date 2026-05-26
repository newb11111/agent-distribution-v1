import 'dotenv/config'
import { initDatabase, pool } from '../db.js'

await initDatabase()
console.log('Database initialized successfully.')
await pool.end()
