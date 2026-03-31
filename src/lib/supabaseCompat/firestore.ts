import { supabase } from '../supabase';

type Primitive = string | number | boolean | null;
type WhereValue = Primitive | Primitive[];

export interface FirestoreCompatDb {
  kind: 'db';
}

export interface CollectionReference<T = any> {
  kind: 'collection';
  path: string;
}

export interface DocumentReference<T = any> {
  kind: 'doc';
  collection: string;
  id: string;
  path: string;
}

type WhereConstraint = {
  kind: 'where';
  field: string;
  op: string;
  value: WhereValue;
};

type OrderConstraint = {
  kind: 'orderBy';
  field: string;
  direction: 'asc' | 'desc';
};

type LimitConstraint = {
  kind: 'limit';
  count: number;
};

type Constraint = WhereConstraint | OrderConstraint | LimitConstraint;

export interface Query<T = any> {
  kind: 'query';
  collection: string;
  constraints: Constraint[];
}

export class DocumentSnapshot<T = any> {
  constructor(private record: T | null, public id: string) {}

  exists() {
    return this.record !== null;
  }

  data(): any {
    return this.record as any;
  }
}

export class QueryDocumentSnapshot<T = any> extends DocumentSnapshot<T> {}

export class QuerySnapshot<T = any> {
  constructor(public docs: QueryDocumentSnapshot<T>[]) {}

  get empty() {
    return this.docs.length === 0;
  }

  forEach(cb: (doc: QueryDocumentSnapshot<T>) => void) {
    this.docs.forEach(cb);
  }
}

type IncrementSentinel = {
  __op: 'increment';
  amount: number;
};

type ServerTimestampSentinel = {
  __op: 'serverTimestamp';
};

export const db: FirestoreCompatDb = { kind: 'db' };

function nowIso() {
  return new Date().toISOString();
}

function deepClone<T>(value: T): T {
  return value === undefined ? value : JSON.parse(JSON.stringify(value));
}

function getTableName(path: string) {
  return path.split('/')[0];
}

function mapFieldToColumn(table: string, field: string) {
  const perTable: Record<string, Record<string, string>> = {
    users: {
      uid: 'id',
      email: 'email',
      displayName: 'display_name',
      role: 'role',
      status: 'status',
      phoneNumber: 'phone_number',
      photoURL: 'photo_url',
      onboardingComplete: 'onboarding_complete',
      adminRole: 'admin_role',
      verificationStatus: 'verification_status',
      rejectionReason: 'rejection_reason',
      verifiedBy: 'verified_by',
      referralCode: 'referral_code',
      referredBy: 'referred_by',
      createdAt: 'created_at',
      updatedAt: 'updated_at',
    },
    bookings: {
      rideId: 'ride_id',
      consumerId: 'consumer_id',
      driverId: 'driver_id',
      status: 'status',
      createdAt: 'created_at',
    },
    rides: {
      driverId: 'driver_id',
      status: 'status',
      createdAt: 'created_at',
    },
    transactions: {
      userId: 'user_id',
      type: 'type',
      status: 'status',
      createdAt: 'created_at',
    },
    referrals: {
      referrerId: 'referrer_id',
      referredId: 'referred_id',
      status: 'status',
      createdAt: 'created_at',
      updatedAt: 'updated_at',
    },
    support_tickets: {
      userId: 'user_id',
      status: 'status',
      priority: 'priority',
      createdAt: 'created_at',
      updatedAt: 'updated_at',
    },
    app_config: {
      createdAt: 'created_at',
      updatedAt: 'updated_at',
    },
  };

  return perTable[table]?.[field] || field;
}

function inflateRecord<T>(table: string, row: any): T {
  if (!row) return row;
  const base = row.data && typeof row.data === 'object' ? deepClone(row.data) : {};
  const id = row.uid ?? row.id;
  if (table === 'users') {
    return {
      ...base,
      uid: id,
      email: row.email ?? base.email ?? '',
      displayName: row.display_name ?? base.displayName ?? '',
      role: row.role ?? base.role,
      status: row.status ?? base.status,
      phoneNumber: row.phone_number ?? base.phoneNumber ?? '',
      photoURL: row.photo_url ?? base.photoURL ?? '',
      onboardingComplete: row.onboarding_complete ?? base.onboardingComplete ?? false,
      createdAt: row.created_at ?? base.createdAt,
      adminRole: row.admin_role ?? base.adminRole,
      verificationStatus: row.verification_status ?? base.verificationStatus,
      rejectionReason: row.rejection_reason ?? base.rejectionReason,
      verifiedBy: row.verified_by ?? base.verifiedBy,
      referralCode: row.referral_code ?? base.referralCode,
      referredBy: row.referred_by ?? base.referredBy,
      referralPath: row.referral_path ?? base.referralPath,
      forcePasswordChange:
        row.force_password_change ?? base.forcePasswordChange ?? false,
      wallet: row.wallet ?? base.wallet,
      location: row.location ?? base.location,
      driverDetails: row.driver_details ?? base.driverDetails,
    } as T;
  }

  return {
    ...base,
    id,
    createdAt: row.created_at ?? base.createdAt,
    updatedAt: row.updated_at ?? base.updatedAt,
  } as T;
}

function flattenForStorage(table: string, data: Record<string, any>) {
  const payload = deepClone(data);
  const row: Record<string, any> = {};

  if (table === 'users') {
    row.id = payload.uid ?? payload.id;
    row.email = payload.email ?? null;
    row.display_name = payload.displayName ?? null;
    row.role = payload.role ?? null;
    row.status = payload.status ?? 'active';
    row.phone_number = payload.phoneNumber ?? null;
    row.photo_url = payload.photoURL ?? null;
    row.onboarding_complete = payload.onboardingComplete ?? false;
    row.admin_role = payload.adminRole ?? null;
    row.verification_status = payload.verificationStatus ?? null;
    row.rejection_reason = payload.rejectionReason ?? null;
    row.verified_by = payload.verifiedBy ?? null;
    row.referral_code = payload.referralCode ?? null;
    row.referred_by = payload.referredBy ?? null;
    row.referral_path = payload.referralPath ?? [];
    row.force_password_change = payload.forcePasswordChange ?? false;
    row.wallet = payload.wallet ?? null;
    row.location = payload.location ?? null;
    row.driver_details = payload.driverDetails ?? null;
    row.data = payload;
    row.id = payload.uid;
    row.created_at = payload.createdAt ?? nowIso();
    row.updated_at = nowIso();
    return row;
  }

  row.id = payload.id;
  if ('createdAt' in payload) row.created_at = payload.createdAt ?? nowIso();
  if ('updatedAt' in payload) row.updated_at = payload.updatedAt ?? nowIso();
  row.data = payload;

  const mappings: Record<string, string> = {
    userId: 'user_id',
    driverId: 'driver_id',
    consumerId: 'consumer_id',
    rideId: 'ride_id',
    referrerId: 'referrer_id',
    referredId: 'referred_id',
    senderId: 'sender_id',
    status: 'status',
    type: 'type',
    priority: 'priority',
    email: 'email',
  };

  for (const [key, column] of Object.entries(mappings)) {
    if (key in payload) row[column] = payload[key];
  }

  return row;
}

function setNestedValue(target: Record<string, any>, key: string, value: any) {
  const parts = key.split('.');
  let ref: Record<string, any> = target;
  for (let i = 0; i < parts.length - 1; i++) {
    const part = parts[i];
    if (typeof ref[part] !== 'object' || ref[part] === null) {
      ref[part] = {};
    }
    ref = ref[part];
  }
  ref[parts[parts.length - 1]] = value;
}

function getNestedValue(target: Record<string, any>, key: string) {
  return key.split('.').reduce<any>((acc, part) => (acc == null ? acc : acc[part]), target);
}

function applyPatch<T extends Record<string, any>>(current: T, patch: Record<string, any>) {
  const next = deepClone(current);

  for (const [key, value] of Object.entries(patch)) {
    if (value && typeof value === 'object' && value.__op === 'increment') {
      const currentValue = Number(getNestedValue(next, key) ?? 0);
      setNestedValue(next, key, currentValue + value.amount);
      continue;
    }

    if (value && typeof value === 'object' && value.__op === 'serverTimestamp') {
      setNestedValue(next, key, nowIso());
      continue;
    }

    setNestedValue(next, key, value);
  }

  return next;
}

async function executeDocumentRead<T>(ref: DocumentReference<T>) {
  const { data, error } = await supabase.from(ref.collection).select('*').eq('id', ref.id).maybeSingle();
  if (error) throw error;
  return new DocumentSnapshot<T>(data ? inflateRecord<T>(ref.collection, data) : null, ref.id);
}

function applyConstraints(builder: any, table: string, constraints: Constraint[]) {
  let queryBuilder = builder;
  for (const constraint of constraints) {
    if (constraint.kind === 'where') {
      const field = mapFieldToColumn(table, constraint.field);
      if (constraint.op === '==') queryBuilder = queryBuilder.eq(field, constraint.value);
      if (constraint.op === '!=') queryBuilder = queryBuilder.neq(field, constraint.value);
      if (constraint.op === 'in') queryBuilder = queryBuilder.in(field, constraint.value as Primitive[]);
    }
    if (constraint.kind === 'orderBy') {
      const field = mapFieldToColumn(table, constraint.field);
      queryBuilder = queryBuilder.order(field, { ascending: constraint.direction !== 'desc' });
    }
    if (constraint.kind === 'limit') {
      queryBuilder = queryBuilder.limit(constraint.count);
    }
  }
  return queryBuilder;
}

async function executeQueryRead<T>(ref: Query<T>) {
  let builder = supabase.from(ref.collection).select('*');
  builder = applyConstraints(builder, ref.collection, ref.constraints.map((constraint) => ({ ...constraint })));
  const { data, error } = await builder;
  if (error) throw error;
  const docs = (data || []).map((row: any) => {
    const id = row.uid ?? row.id;
    return new QueryDocumentSnapshot<T>(inflateRecord<T>(ref.collection, row), id);
  });
  return new QuerySnapshot<T>(docs);
}

export function collection<T>(_db: FirestoreCompatDb, path: string): CollectionReference<T> {
  return { kind: 'collection', path };
}

export function doc<T>(
  parent: FirestoreCompatDb | CollectionReference<T>,
  path?: string,
  id?: string
): DocumentReference<T> {
  if ((parent as CollectionReference<T>).kind === 'collection') {
    const collectionRef = parent as CollectionReference<T>;
    const docId = path || crypto.randomUUID();
    return {
      kind: 'doc',
      collection: collectionRef.path,
      id: docId,
      path: `${collectionRef.path}/${docId}`,
    };
  }

  if (!path || !id) {
    throw new Error('Document id is required');
  }

  return {
    kind: 'doc',
    collection: path,
    id,
    path: `${path}/${id}`,
  };
}

export function query<T>(
  collectionRef: CollectionReference<T>,
  ...constraints: Constraint[]
): Query<T> {
  return {
    kind: 'query',
    collection: collectionRef.path,
    constraints,
  };
}

export function where(field: string, op: string, value: WhereValue): WhereConstraint {
  return { kind: 'where', field, op, value };
}

export function orderBy(
  field: string,
  direction: 'asc' | 'desc' = 'asc'
): OrderConstraint {
  return { kind: 'orderBy', field, direction };
}

export function limit(count: number): LimitConstraint {
  return { kind: 'limit', count };
}

export async function getDoc(ref: DocumentReference<any>) {
  return executeDocumentRead(ref);
}

export async function getDocFromServer(ref: DocumentReference<any>) {
  return executeDocumentRead(ref);
}

export async function getDocs(ref: Query<any>) {
  return executeQueryRead(ref);
}

export async function getDocsFromServer(ref: Query<any>) {
  return executeQueryRead(ref);
}

export async function setDoc<T>(
  ref: DocumentReference<T>,
  data: Record<string, any>,
  _options?: { merge?: boolean }
) {
  const row = flattenForStorage(ref.collection, { ...data, id: data.id ?? ref.id, uid: data.uid ?? ref.id });
  const { error } = await supabase.from(ref.collection).upsert(row, { onConflict: 'id' });
  if (error) throw error;
}

export async function updateDoc<T>(ref: DocumentReference<T>, patch: Record<string, any>) {
  const existing = await getDoc(ref);
  if (!existing.exists()) {
    throw new Error(`Document ${ref.path} does not exist`);
  }
  const merged = applyPatch(existing.data() as Record<string, any>, patch);
  const row = flattenForStorage(ref.collection, {
    ...merged,
    id: (merged as any).id ?? ref.id,
    uid: (merged as any).uid ?? ref.id,
  });
  const { error } = await supabase.from(ref.collection).update(row).eq('id', ref.id);
  if (error) throw error;
}

export async function deleteDoc<T>(ref: DocumentReference<T>) {
  const { error } = await supabase.from(ref.collection).delete().eq('id', ref.id);
  if (error) throw error;
}

export async function addDoc<T>(collectionRef: CollectionReference<T>, data: Record<string, any>) {
  const id = data.id ?? crypto.randomUUID();
  const ref = doc(collectionRef, id);
  await setDoc(ref, { ...data, id });
  return ref;
}

export function increment(amount: number): IncrementSentinel {
  return { __op: 'increment', amount };
}

export function serverTimestamp(): ServerTimestampSentinel {
  return { __op: 'serverTimestamp' };
}

export function onSnapshot(
  ref: Query<any> | DocumentReference<any>,
  onNext: (snapshot: any) => void,
  onError?: (error: unknown) => void
): () => void {
  let active = true;

  const run = async () => {
    try {
      const snapshot =
        ref.kind === 'doc' ? await executeDocumentRead(ref) : await executeQueryRead(ref);
      if (active) onNext(snapshot as any);
    } catch (error) {
      if (active && onError) onError(error);
    }
  };

  void run();
  const interval = window.setInterval(run, 3000);

  return () => {
    active = false;
    window.clearInterval(interval);
  };
}

export async function runTransaction<T>(
  _db: FirestoreCompatDb,
  executor: (transaction: {
    get: <R>(ref: DocumentReference<R>) => Promise<DocumentSnapshot<R>>;
    update: <R>(ref: DocumentReference<R>, patch: Record<string, any>) => Promise<void>;
    set: <R>(ref: DocumentReference<R>, value: Record<string, any>) => Promise<void>;
  }) => Promise<T>
) {
  return executor({
    get: getDoc,
    update: updateDoc,
    set: setDoc,
  });
}
