import admin from 'firebase-admin';
import { readFileSync, existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

let app;
let db;
let firestore;
let firebaseProjectId = null;

/**
 * Resolve the path to serviceAccountKey.json.
 * Priority: GOOGLE_APPLICATION_CREDENTIALS > MCP_INSTANCE_DIR/serviceAccountKey.json > engine root/serviceAccountKey.json
 */
export function resolveCredentialsPath() {
  if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
    return resolve(process.env.GOOGLE_APPLICATION_CREDENTIALS);
  }

  const instanceDir = process.env.MCP_INSTANCE_DIR;
  if (instanceDir) {
    const instancePath = resolve(instanceDir, 'serviceAccountKey.json');
    if (existsSync(instancePath)) {
      return instancePath;
    }
  }

  return resolve(__dirname, '..', 'serviceAccountKey.json');
}

export function initFirebase() {
  const credentialsPath = resolveCredentialsPath();
  const serviceAccount = JSON.parse(readFileSync(credentialsPath, 'utf8'));
  firebaseProjectId = serviceAccount.project_id || null;

  app = admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
    databaseURL: process.env.FIREBASE_DATABASE_URL
  });

  db = admin.database();
  firestore = admin.firestore();

  return { app, db, firestore };
}

export function getFirebaseProjectId() {
  return firebaseProjectId;
}

export function getDatabase() {
  if (!db) throw new Error('Firebase not initialized. Call initFirebase() first.');
  return db;
}

export function getFirestore() {
  if (!firestore) throw new Error('Firebase not initialized. Call initFirebase() first.');
  return firestore;
}
