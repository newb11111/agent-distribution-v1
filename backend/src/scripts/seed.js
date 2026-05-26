import 'dotenv/config'
import { initDatabase, pool } from '../db.js'

await initDatabase()
console.log('Seed/default data completed. Set SEED_DEMO_DATA=false in production if you do not want demo accounts/products.')
await pool.end()
