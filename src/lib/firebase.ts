import { auth } from './supabaseCompat/auth';
import { db } from './supabaseCompat/firestore';
import { storage } from './supabaseCompat/storage';

export { auth, db, storage };

export default { auth, db, storage };
