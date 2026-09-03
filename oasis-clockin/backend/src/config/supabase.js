const crypto = require('crypto');

function hashPassword(password, salt) {
  return crypto.pbkdf2Sync(password, salt, 100000, 64, 'sha512').toString('hex');
}

const defaultAdminSalt = crypto.randomBytes(32).toString('hex');
const defaultAdminHash = hashPassword('admin12345', defaultAdminSalt);

const defaultLocId = 'c0000000-0000-0000-0000-000000000001';
const defaultLoc2Id = 'c0000000-0000-0000-0000-000000000002';
const defaultStudent1Id = 'b0000000-0000-0000-0000-000000000001';
const defaultStudent2Id = 'b0000000-0000-0000-0000-000000000002';
const defaultStudent3Id = 'b0000000-0000-0000-0000-000000000003';
const defaultAdminId = 'a0000000-0000-0000-0000-000000000001';

const tables = {
  admin_accounts: [
    {
      id: defaultAdminId,
      full_name: 'System Administrator',
      admin_id: 'ADMIN-001',
      email: 'emmitechfx@gmail.com',
      password_hash: defaultAdminHash,
      password_salt: defaultAdminSalt,
      created_at: new Date().toISOString(),
    },
  ],
  students: [
    {
      id: defaultStudent1Id,
      full_name: 'Ada Lovelace',
      student_id: 'SAN-2026-014',
      email: 'ada@oasis.edu',
      registered_ip: '192.168.1.156',
      registered_mac: 'BE:64:B4:14:4D:67',
      role: 'student',
      status: 'active',
      created_at: new Date(Date.now() - 86400000 * 30).toISOString(),
    },
    {
      id: defaultStudent2Id,
      full_name: 'Charles Babbage',
      student_id: 'SAN-2026-015',
      email: 'charles@oasis.edu',
      registered_ip: '192.168.1.156',
      registered_mac: 'BE:64:B4:14:4D:67',
      role: 'student',
      status: 'active',
      created_at: new Date(Date.now() - 86400000 * 20).toISOString(),
    },
    {
      id: defaultStudent3Id,
      full_name: 'Grace Hopper',
      student_id: 'SAN-2026-016',
      email: 'grace@oasis.edu',
      registered_ip: '192.168.1.156',
      registered_mac: 'BE:64:B4:14:4D:67',
      role: 'student',
      status: 'active',
      created_at: new Date(Date.now() - 86400000 * 10).toISOString(),
    },
  ],
  devices: [
    {
      id: 'dev-00000000-0000-0000-0000-000000000001',
      student_id: defaultStudent1Id,
      mac_address: 'BE:64:B4:14:4D:67',
      webauthn_credential_id: 'sample-credential-ada-001',
      public_key: 'sample-public-key-ada-001',
      counter: 1,
      transports: ['internal'],
      status: 'AUTHORIZED',
      ip_address: '192.168.1.156',
      user_agent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Oasis PWA',
      last_seen_at: new Date().toISOString(),
      registered_at: new Date(Date.now() - 86400000 * 5).toISOString(),
      revoked_at: null,
    },
    {
      id: 'dev-00000000-0000-0000-0000-000000000002',
      student_id: defaultStudent2Id,
      mac_address: 'BE:64:B4:14:4D:67',
      webauthn_credential_id: 'sample-credential-charles-002',
      public_key: 'sample-public-key-charles-002',
      counter: 1,
      transports: ['internal'],
      status: 'AUTHORIZED',
      ip_address: '192.168.1.156',
      user_agent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120.0 Oasis PWA',
      last_seen_at: new Date(Date.now() - 3600000 * 4).toISOString(),
      registered_at: new Date(Date.now() - 86400000 * 18).toISOString(),
      revoked_at: null,
    },
    {
      id: 'dev-00000000-0000-0000-0000-000000000003',
      student_id: defaultStudent3Id,
      mac_address: 'BE:64:B4:14:4D:67',
      webauthn_credential_id: 'sample-credential-grace-003',
      public_key: 'sample-public-key-grace-003',
      counter: 1,
      transports: ['internal'],
      status: 'AUTHORIZED',
      ip_address: '192.168.1.156',
      user_agent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) Oasis PWA',
      last_seen_at: new Date(Date.now() - 3600000 * 2).toISOString(),
      registered_at: new Date(Date.now() - 86400000 * 9).toISOString(),
      revoked_at: null,
    },
  ],
  locations: [
    {
      id: defaultLocId,
      name: 'Sandlip Oasis - Lecture & Hall Complex',
      latitude: 8.9280843,
      longitude: 11.3307533,
      geofence_radius_m: 200,
      active_start: '06:00:00',
      active_end: '22:00:00',
      created_by: defaultAdminId,
      created_at: new Date().toISOString(),
      active_qr_nonce: 'initial-nonce-loc-1',
      qr_generated_at: new Date().toISOString(),
    },
    {
      id: defaultLoc2Id,
      name: 'Sandlip Oasis - Innovation & Tech Wing',
      latitude: 8.9280843,
      longitude: 11.3307533,
      geofence_radius_m: 200,
      active_start: '06:00:00',
      active_end: '22:00:00',
      created_by: defaultAdminId,
      created_at: new Date().toISOString(),
      active_qr_nonce: 'initial-nonce-loc-2',
      qr_generated_at: new Date().toISOString(),
    },
  ],
  attendance_sessions: [
    {
      id: 'sess-00000000-0000-0000-0000-000000000001',
      title: 'Morning Class & Lab Session',
      location_id: defaultLocId,
      created_by: defaultAdminId,
      status: 'ACTIVE',
      started_at: new Date(Date.now() - 3600000 * 2).toISOString(),
      ends_at: new Date(Date.now() + 3600000 * 8).toISOString(),
      closed_at: null,
      created_at: new Date().toISOString(),
    },
  ],
  organization_config: [
    {
      id: 'default',
      name: 'Sandlip Oasis',
      address: 'Sandlip Oasis Campus, Innovation Way',
      latitude: 8.9280843,
      longitude: 11.3307533,
      attendance_radius_m: 200,
      work_start_time: '08:30:00',
      grace_period_minutes: 15,
      early_threshold_minutes: 15,
      wifi_mac: 'be:64:b4:14:4d:67',
      wifi_ip: '192.168.1.156',
      wifi_ssid: 'Sandlip-Oasis-WiFi',
      require_ip_match: true,
      require_wifi_match: true,
      require_gps: true,
      require_qr: false,
      require_device_auth: false,
      ip_check_mode: 'warn',
      status: 'active',
      updated_at: new Date().toISOString(),
    },
  ],
  approved_networks: [
    {
      id: 'net-00000000-0000-0000-0000-000000000001',
      cidr: '192.168.1.156/32',
      label: 'Sandlip Oasis WiFi Host (IP: 192.168.1.156, MAC: BE:64:B4:14:4D:67)',
      mac_address: 'be:64:b4:14:4d:67',
      created_by: defaultAdminId,
      created_at: new Date().toISOString(),
    },
    {
      id: 'net-00000000-0000-0000-0000-000000000002',
      cidr: '192.168.1.0/24',
      label: 'Sandlip Oasis Campus Subnet (192.168.1.0/24, AP MAC: BE:64:B4:14:4D:67)',
      mac_address: 'be:64:b4:14:4d:67',
      created_by: defaultAdminId,
      created_at: new Date().toISOString(),
    },
  ],
  attendance: [
    {
      id: 'att-00000000-0000-0000-0000-000000000001',
      student_id: defaultStudent1Id,
      location_id: defaultLocId,
      type: 'clock_in',
      recorded_at: new Date(Date.now() - 3600000).toISOString(),
      latitude: 8.9280843,
      longitude: 11.3307533,
      device_id: 'dev-00000000-0000-0000-0000-000000000001',
      device_mac: 'BE:64:B4:14:4D:67',
      session_id: 'sess-00000000-0000-0000-0000-000000000001',
      risk_score: 95,
      verification_status: 'VERIFIED',
      punctuality: 'EARLY',
      ip_address: '192.168.1.156',
      gps_accuracy: 10,
      is_late: false,
      marked_absent_at: null,
      absence_reason: null,
    },
  ],
  audit_log: [
    {
      id: 'aud-00000000-0000-0000-0000-000000000001',
      student_id: defaultStudent1Id,
      event_type: 'attendance_recorded',
      detail: { attendanceType: 'clock_in', location: 'Main Campus - Lecture Hall A', punctuality: 'EARLY' },
      created_at: new Date(Date.now() - 3600000).toISOString(),
    },
  ],
  webauthn_challenges: [],
};

function getTable(name) {
  if (!tables[name]) tables[name] = [];
  return tables[name];
}

function clone(obj) {
  return JSON.parse(JSON.stringify(obj));
}

function resolveJoins(item, tableName, selectFields) {
  if (!item) return item;
  const res = clone(item);

  // Join with students
  if (selectFields && selectFields.includes('students(')) {
    const student = tables.students?.find((s) => s.id === item.student_id);
    if (student) {
      res.students = {
        full_name: student.full_name,
        student_id: student.student_id,
        email: student.email,
        registered_ip: student.registered_ip || '—',
        registered_mac: student.registered_mac || '—',
      };
    } else {
      res.students = null;
    }
  }

  // Join with locations
  if (selectFields && selectFields.includes('locations(')) {
    const location = tables.locations?.find((l) => l.id === item.location_id);
    if (location) {
      res.locations = { name: location.name };
    } else {
      res.locations = null;
    }
  }

  // Join with devices
  if (selectFields && selectFields.includes('devices(')) {
    const devs = (tables.devices || []).filter((d) => d.student_id === item.id);
    res.devices = devs;
  }

  return res;
}

class MockQueryBuilder {
  constructor(tableName) {
    this.tableName = tableName;
    this.filters = [];
    this.selectFields = '*';
    this.limitCount = null;
    this.orderCol = null;
    this.orderAsc = true;
    this.isSingle = false;
    this.action = 'select';
    this.payload = null;
    this.upsertOptions = null;
  }

  select(fields = '*') {
    this.selectFields = fields;
    return this;
  }

  insert(data) {
    this.action = 'insert';
    this.payload = Array.isArray(data) ? data : [data];
    return this;
  }

  update(data) {
    this.action = 'update';
    this.payload = data;
    return this;
  }

  upsert(data, options) {
    this.action = 'upsert';
    this.payload = Array.isArray(data) ? data : [data];
    this.upsertOptions = options;
    return this;
  }

  delete() {
    this.action = 'delete';
    return this;
  }

  eq(col, val) {
    this.filters.push((row) => {
      if (row[col] === val) return true;
      if (typeof row[col] === 'string' && typeof val === 'string') {
        return row[col].toLowerCase() === val.toLowerCase();
      }
      return false;
    });
    return this;
  }

  ilike(col, val) {
    const raw = String(val == null ? '' : val);
    const pattern = raw.toLowerCase().replace(/^%/, '').replace(/%$/, '');
    this.filters.push((row) => {
      const fieldVal = String(row[col] == null ? '' : row[col]).toLowerCase();
      if (raw.startsWith('%') || raw.endsWith('%')) {
        return fieldVal.includes(pattern);
      }
      return fieldVal === pattern;
    });
    return this;
  }

  like(col, val) {
    const raw = String(val == null ? '' : val);
    const pattern = raw.replace(/^%/, '').replace(/%$/, '');
    this.filters.push((row) => {
      const fieldVal = String(row[col] == null ? '' : row[col]);
      if (raw.startsWith('%') || raw.endsWith('%')) {
        return fieldVal.includes(pattern);
      }
      return fieldVal === pattern;
    });
    return this;
  }

  neq(col, val) {
    this.filters.push((row) => row[col] !== val);
    return this;
  }

  is(col, val) {
    this.filters.push((row) => (val === null ? row[col] == null : row[col] === val));
    return this;
  }

  gte(col, val) {
    this.filters.push((row) => {
      if (row[col] == null) return false;
      return row[col] >= val;
    });
    return this;
  }

  lte(col, val) {
    this.filters.push((row) => {
      if (row[col] == null) return false;
      return row[col] <= val;
    });
    return this;
  }

  in(col, valArray) {
    this.filters.push((row) => valArray && valArray.includes(row[col]));
    return this;
  }

  or(filterString) {
    const parts = filterString.split(',');
    this.filters.push((row) => {
      return parts.some((p) => {
        const match = p.match(/([^.]+)\.ilike\.%([^%]+)%/);
        if (match) {
          const [, field, term] = match;
          const val = String(row[field] || '').toLowerCase();
          return val.includes(term.toLowerCase());
        }
        return false;
      });
    });
    return this;
  }

  order(col, { ascending = true } = {}) {
    this.orderCol = col;
    this.orderAsc = ascending;
    return this;
  }

  limit(n) {
    this.limitCount = n;
    return this;
  }

  single() {
    this.isSingle = true;
    return this;
  }

  _execSync() {
    const tbl = getTable(this.tableName);

    if (this.action === 'insert') {
      const inserted = [];
      for (const item of this.payload) {
        const newItem = {
          id: item.id || `${this.tableName.slice(0, 3)}-${crypto.randomUUID()}`,
          created_at: item.created_at || new Date().toISOString(),
          ...item,
        };
        tbl.push(newItem);
        inserted.push(newItem);
      }
      const resData = this.isSingle ? inserted[0] : inserted;
      return { data: resolveJoins(resData, this.tableName, this.selectFields), error: null };
    }

    if (this.action === 'upsert') {
      const onConflict = this.upsertOptions?.onConflict || 'id';
      const updated = [];
      for (const item of this.payload) {
        const conflictVal = item[onConflict];
        const existingIdx = tbl.findIndex((r) => r[onConflict] === conflictVal);
        if (existingIdx >= 0) {
          tbl[existingIdx] = { ...tbl[existingIdx], ...item };
          updated.push(tbl[existingIdx]);
        } else {
          const newItem = {
            id: item.id || `${this.tableName.slice(0, 3)}-${crypto.randomUUID()}`,
            created_at: item.created_at || new Date().toISOString(),
            ...item,
          };
          tbl.push(newItem);
          updated.push(newItem);
        }
      }
      const resData = this.isSingle ? updated[0] : updated;
      return { data: resolveJoins(resData, this.tableName, this.selectFields), error: null };
    }

    if (this.action === 'update') {
      const updatedRows = [];
      for (let i = 0; i < tbl.length; i++) {
        const matches = this.filters.every((f) => f(tbl[i]));
        if (matches) {
          tbl[i] = { ...tbl[i], ...this.payload };
          updatedRows.push(tbl[i]);
        }
      }
      const resData = this.isSingle ? updatedRows[0] || null : updatedRows;
      return { data: resolveJoins(resData, this.tableName, this.selectFields), error: null };
    }

    if (this.action === 'delete') {
      for (let i = tbl.length - 1; i >= 0; i--) {
        const matches = this.filters.every((f) => f(tbl[i]));
        if (matches) {
          tbl.splice(i, 1);
        }
      }
      return { data: null, error: null };
    }

    // Action is 'select'
    let results = tbl.filter((row) => this.filters.every((f) => f(row)));

    if (this.orderCol) {
      results.sort((a, b) => {
        const valA = a[this.orderCol];
        const valB = b[this.orderCol];
        if (valA == null) return 1;
        if (valB == null) return -1;
        if (valA < valB) return this.orderAsc ? -1 : 1;
        if (valA > valB) return this.orderAsc ? 1 : -1;
        return 0;
      });
    }

    if (this.limitCount != null) {
      results = results.slice(0, this.limitCount);
    }

    const joinedResults = results.map((r) => resolveJoins(r, this.tableName, this.selectFields));

    if (this.isSingle) {
      return { data: joinedResults[0] || null, error: null };
    }

    return { data: joinedResults, error: null };
  }

  then(onFulfilled, onRejected) {
    return Promise.resolve(this._execSync()).then(onFulfilled, onRejected);
  }

  catch(onRejected) {
    return Promise.resolve(this._execSync()).catch(onRejected);
  }
}

let supabaseAdmin;

const isSupabaseConfigured =
  Boolean(process.env.SUPABASE_URL) &&
  Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY) &&
  !process.env.SUPABASE_URL.includes('your-') &&
  !process.env.SUPABASE_URL.includes('example') &&
  !process.env.SUPABASE_SERVICE_ROLE_KEY.includes('your-') &&
  process.env.SUPABASE_URL.startsWith('http');

if (isSupabaseConfigured) {
  try {
    const { createClient } = require('@supabase/supabase-js');
    supabaseAdmin = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY,
      { auth: { autoRefreshToken: false, persistSession: false } }
    );
    console.log('✓ Connected to external Supabase instance');
  } catch (err) {
    console.warn('⚠️ Supabase connection failed, falling back to in-memory store:', err.message);
  }
}

if (!supabaseAdmin) {
  console.log('📦 Using in-memory Supabase store for development');
  supabaseAdmin = {
    from: (tableName) => new MockQueryBuilder(tableName),
  };
}

module.exports = { supabaseAdmin };
