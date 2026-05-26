import 'dotenv/config'
import { createSeedStore, saveStore } from './db.js'

saveStore(createSeedStore())
console.log('Seeded data store')
