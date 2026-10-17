import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import pg from 'pg';
import ExcelJS from 'exceljs';
import multer from 'multer';
import { createHash, randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { unlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createClient } from '@supabase/supabase-js';

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', 1);
const PORT = Number(process.env.PORT) || 3000;
for (const name of ['DATABASE_URL', 'SUPABASE_URL', 'SUPABASE_ANON_KEY', 'ALLOWED_ORIGIN']) {
  if (!process.env[name]?.trim()) throw new Error(`Missing environment variable: ${name}`);
}

let databaseUrl;
try {
  databaseUrl = new URL(process.env.DATABASE_URL.trim());
  if (!['postgresql:', 'postgres:'].includes(databaseUrl.protocol) ||
      !databaseUrl.hostname || !databaseUrl.username || !databaseUrl.password) {
    throw new Error('Incomplete connection string');
  }
} catch {
  throw new Error('DATABASE_URL must be a complete PostgreSQL connection URL');
}
for (const key of ['sslmode', 'sslcert', 'sslkey', 'sslrootcert']) databaseUrl.searchParams.delete(key);
const databaseCa = process.env.DATABASE_CA_CERT?.replace(/\\n/g, '\n').trim();
if (databaseCa && !databaseCa.includes('-----BEGIN CERTIFICATE-----')) {
  throw new Error('DATABASE_CA_CERT must contain a PEM certificate');
}
const db = new pg.Pool({
  connectionString: databaseUrl.toString(),
  ssl: databaseCa ? { ca: databaseCa, rejectUnauthorized: true } : { rejectUnauthorized: true },
  max: 5,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000
});
db.on('error', error => console.error('Database pool error:', { code: error.code, message: error.message }));
const auth = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY, {
  auth: { persistSession: false, autoRefreshToken: false }
});

app.use(helmet());
const allowedOrigins = process.env.ALLOWED_ORIGIN.split(',')
  .map(origin => origin.trim().replace(/\/$/, '')).filter(Boolean);
app.use(cors({
  origin(origin, callback) {
    if (!origin || allowedOrigins.includes(origin)) return callback(null, true);
    callback(new Error('Origin not allowed'));
  },
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));
app.use(express.json({ limit: '16kb' }));
app.use(rateLimit({ windowMs: 60_000, limit: 80, standardHeaders: 'draft-7', legacyHeaders: false }));

app.get('/health', (_req, res) => res.json({ status: 'ok', service: 'Trainees Management System' }));

async function guard(req, res, next) {
  try {
    const token = (req.headers.authorization || '').match(/^Bearer (.+)$/)?.[1];
    if (!token) return res.sendStatus(401);
    const { data, error } = await auth.auth.getUser(token);
    if (error || !data.user) return res.sendStatus(401);
    const result = await db.query('SELECT role FROM app_private.user_roles WHERE user_id = $1', [data.user.id]);
    if (!result.rows.length) return res.sendStatus(403);
    req.userId = data.user.id;
    req.role = result.rows[0].role;
    next();
  } catch (error) { next(error); }
}
app.use('/api', guard);
app.get('/api/db-health', async (_req, res, next) => {
  try { await db.query('SELECT 1'); res.json({ status: 'ok', database: 'connected' }); }
  catch (error) { next(error); }
});
app.get('/api/me', (req, res) => res.json({ role: req.role }));
app.get('/api/sheets', async (_req, res, next) => {
  try {
    const result = await db.query('SELECT sheet_name, COUNT(*)::int AS count FROM public.trainee_records GROUP BY sheet_name ORDER BY sheet_name');
    res.json(result.rows);
  } catch (error) { next(error); }
});
function filters(query) {
  const where = [], args = [];
  if (query.sheet) {
    args.push(String(query.sheet).slice(0, 200));
    where.push(`sheet_name = $${args.length}`);
  }
  if (query.search) {
    args.push('%' + String(query.search).slice(0, 150) + '%');
    where.push(`payload::text ILIKE $${args.length}`);
  }
  return { sql: where.length ? 'WHERE ' + where.join(' AND ') : '', args };
}
app.get('/api/records', async (req, res, next) => {
  try {
    const f = filters(req.query);
    const page = Math.max(1, Math.min(100000, Number.parseInt(req.query.page, 10) || 1));
    const limit = 50, offset = (page - 1) * limit;
    const countResult = await db.query(`SELECT COUNT(*)::int AS n FROM public.trainee_records ${f.sql}`, f.args);
    const recordsResult = await db.query(
      `SELECT id, sheet_name, payload FROM public.trainee_records ${f.sql} ORDER BY id LIMIT ${limit} OFFSET $${f.args.length + 1}`,
      [...f.args, offset]
    );
    res.json({ total: countResult.rows[0].n, records: recordsResult.rows, page, pageSize: limit });
  } catch (error) { next(error); }
});
function safeExcelValue(value) {
  if (value === null || value === undefined) return '';
  const text = String(value);
  return /^[\s]*[=+\-@]/.test(text) ? "'" + text : text;
}
app.post('/api/export', async (req, res, next) => {
  try {
    if (!['admin', 'exporter'].includes(req.role)) return res.sendStatus(403);
    const ids = Array.isArray(req.body?.ids)
      ? req.body.ids.filter(id => Number.isSafeInteger(id) && id > 0).slice(0, 1000) : [];
    if (!ids.length) return res.status(400).json({ error: 'حددي سجلات للتصدير، بحد أقصى 1000 سجل' });
    const result = await db.query('SELECT sheet_name, payload FROM public.trainee_records WHERE id = ANY($1::bigint[]) ORDER BY id', [ids]);
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('البيانات المحددة');
    worksheet.views = [{ rightToLeft: true }];
    const keys = TRAINEE_COLUMNS;
    worksheet.addRow([...keys]);
    for (const row of result.rows) worksheet.addRow(
      keys.map(key => safeExcelValue(row.payload?.[key]))
    );
    worksheet.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
    worksheet.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF205D50' } };
    worksheet.columns.forEach(column => { column.width = 25; });
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename="selected.xlsx"');
    res.setHeader('Cache-Control', 'no-store');
    await workbook.xlsx.write(res);
    res.end();
  } catch (error) { next(error); }
});

// أسماء الحقول الرسمية وبترتيب الأعمدة الأصلي (يُحافظ على المسافات في النص).
const TRAINEE_COLUMNS = Object.freeze([
  'الجنس',
  'المنطقة',
  'المؤهل الدراسي',
  'اسم جامعة او الكلية ( سواء كنت طالب فيها او خريج منها )',
  'الدفعة',
  'العام',
  'الحالة',
  'الاسم الثلاثي ( باللغة العربية )',
  'الايميل',
  'رقم الجوال',
  'رقم الهوية الوطنية',
  'مقرر المحاسبة',
  'مقرر مهارات التواصل',
  'مقرر  الزكاة',
  'مقرر الضريبة',
  'مقرر التكاليف',
  'مقرر الاكسل',
  'مقرر البرامج المحاسبية',
  'الالتزام والانضباط',
  'مقرر الإنجليزي',
  ' مقرر التطبيق العملي لمحاسبة الرواتب والأجور',
]);

// Upload directly to a temporary file: no file-size-sized Buffer retained in Node's heap.
const MAX_FILE_BYTES = 35 * 1024 * 1024;
const MAX_RECORDS = 80_000;
const BATCH_SIZE = 75;
const excelUpload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, callback) => callback(null, tmpdir()),
    filename: (_req, _file, callback) => callback(null, `trainee-${randomUUID()}.xlsx`)
  }),
  limits: { fileSize: MAX_FILE_BYTES, files: 1 },
  fileFilter(_req, file, callback) {
    const ok = /\.xlsx$/i.test(file.originalname);
    callback(ok ? null : new Error('يُسمح بملفات XLSX فقط'), ok);
  }
});
function adminOnly(req, res, next) {
  if (req.role !== 'admin') return res.sendStatus(403);
  next();
}
async function cleanTemp(file) {
  if (file?.path) {
    try { await unlink(file.path); }
    catch (error) { if (error.code !== 'ENOENT') console.error('Temp cleanup error:', error.message); }
  }
}
// Multer can leave a partially written temp file after rejecting a request.
function receiveExcel(req, res, next) {
  excelUpload.single('file')(req, res, async error => {
    if (error) {
      await cleanTemp(req.file);
      return next(error);
    }
    next();
  });
}
function excelValue(cell, preserveText = false) {
  const value = cell.value;
  if (value === null || value === undefined) return null;
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'object') {
    if (value.result !== undefined) return value.result === null ? null : String(value.result);
    if (value.text !== undefined) return String(value.text);
    if (value.richText) return value.richText.map(item => item.text).join('');
    if (value.hyperlink) return String(value.text || value.hyperlink);
    return String(cell.text || '');
  }
  // يحافظ على الرقم نصًا عند الحفظ، ولا يسمح بتحويل أرقام الهوية والجوال إلى صيغة علمية.
  if (preserveText) {
    const format = cell.numFmt || '';
    if (typeof value === 'number' && /^0+$/.test(format)) {
      return String(value).padStart(format.length, '0');
    }
    return String(value);
  }
  return value;
}
function normalizedHeading(text) {
  return String(text ?? '').normalize('NFKC').replace(/[\u064B-\u065F\u0670]/g, '')
    .replace(/\s+/g, ' ').trim();
}
function importError(message) {
  const error = new Error(message);
  error.status = 400;
  return error;
}
async function fileHash(path) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest('hex');
}

/** Read one worksheet row at a time. Never accumulate whole-workbook records. */
async function parseWorkbookFile(path, onRecord = null) {
  const reader = new ExcelJS.stream.xlsx.WorkbookReader(path, {
    entries: 'emit', worksheets: 'emit', sharedStrings: 'cache',
    hyperlinks: 'ignore', styles: 'cache'
  });
  const sheets = [];
  let total = 0;
  for await (const sheet of reader) {
    let headerRead = false;
    let count = 0;
    for await (const row of sheet) {
      if (!headerRead) {
        if (row.number !== 1) throw importError(`الورقة ${sheet.name}: عناوين الأعمدة يجب أن تكون في الصف الأول`);
        const actualHeaders = TRAINEE_COLUMNS.map((_, i) => normalizedHeading(excelValue(row.getCell(i + 1))));
        const mismatches = TRAINEE_COLUMNS.filter((header, i) =>
          actualHeaders[i] !== normalizedHeading(header));
        if (mismatches.length) {
          throw importError(`الورقة ${sheet.name}: أسماء الأعمدة أو ترتيبها لا تطابق الأعمدة الـ21 المطلوبة. أول عمود مختلف: ${mismatches[0]}`);
        }
        const extras = row.values.slice(TRAINEE_COLUMNS.length + 1);
        if (extras.some(value => value !== null && value !== undefined && value !== '')) {
          throw importError(`الورقة ${sheet.name}: توجد أعمدة إضافية بعد العمود 21`);
        }
        headerRead = true;
        continue;
      }
      const payload = {};
      let nonempty = false;
      for (let i = 0; i < TRAINEE_COLUMNS.length; i++) {
        const value = excelValue(row.getCell(i + 1), true);
        payload[TRAINEE_COLUMNS[i]] = value;
        if (value !== null && value !== '') nonempty = true;
      }
      if (!nonempty) continue;
      if (row.cellCount > TRAINEE_COLUMNS.length) {
        for (let i = TRAINEE_COLUMNS.length + 1; i <= row.cellCount; i++) {
          if (excelValue(row.getCell(i)) !== null) throw importError(`الورقة ${sheet.name}: توجد قيمة خارج الأعمدة الـ21 في الصف ${row.number}`);
        }
      }
      if (++total > MAX_RECORDS) throw importError('الحد الأقصى 80000 سجل في الملف الواحد');
      count++;
      if (onRecord) await onRecord({ sheet: sheet.name, rowNumber: row.number, payload });
    }
    if (headerRead) sheets.push({ name: sheet.name, count, columns: TRAINEE_COLUMNS.length });
  }
  if (!sheets.length) throw importError('لم يُعثر على أوراق تحتوي على عناوين أعمدة');
  return { sheets, total };
}

// Batch inserts and adapt to either existing DB schema: with/without row_number.
async function hasRowNumberColumn(client) {
  const result = await client.query(`
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='trainee_records' AND column_name='row_number'
  `);
  return result.rowCount > 0;
}
async function insertBatch(client, batch, rowNumberEnabled, sheetOffsets) {
  if (!batch.length) return;
  const args = [];
  const placeholders = batch.map((record, i) => {
    if (rowNumberEnabled) {
      const index = (sheetOffsets.get(record.sheet) || 0) + 1;
      sheetOffsets.set(record.sheet, index);
      args.push(record.sheet, index, JSON.stringify(record.payload));
      return `($${3*i+1},$${3*i+2},$${3*i+3}::jsonb)`;
    }
    args.push(record.sheet, JSON.stringify(record.payload));
    return `($${2*i+1},$${2*i+2}::jsonb)`;
  });
  const columns = rowNumberEnabled ? '(sheet_name,row_number,payload)' : '(sheet_name,payload)';
  await client.query(`INSERT INTO public.trainee_records ${columns} VALUES ${placeholders.join(',')}`, args);
}

app.post('/api/import/preview', adminOnly, receiveExcel, async (req, res, next) => {
  try {
    if (!req.file) throw importError('اختاري ملف Excel');
    const result = await parseWorkbookFile(req.file.path);
    res.json(result);
  } catch (error) { next(error); }
  finally { await cleanTemp(req.file); }
});

app.post('/api/import/upload', adminOnly, receiveExcel, async (req, res, next) => {
  let client = null;
  let committed = false;
  try {
    if (!req.file) throw importError('اختاري ملف Excel');
    const hash = await fileHash(req.file.path);
    client = await db.connect();
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock(84621831)');
    const existing = await client.query('SELECT 1 FROM public.trainee_imports WHERE file_hash=$1', [hash]);
    if (existing.rowCount) {
      const error = new Error('تم استيراد هذا الملف سابقًا، ولن نكرر بياناته');
      error.status = 409;
      throw error;
    }
    const rowNumberEnabled = await hasRowNumberColumn(client);
    const sheetOffsets = new Map();
    if (rowNumberEnabled) {
      const positions = await client.query(`
        SELECT sheet_name, COALESCE(MAX(row_number),0)::int AS last_number
        FROM public.trainee_records GROUP BY sheet_name
      `);
      for (const position of positions.rows) sheetOffsets.set(position.sheet_name, position.last_number);
    }
    let batch = [];
    const parsed = await parseWorkbookFile(req.file.path, async record => {
      batch.push(record);
      if (batch.length >= BATCH_SIZE) {
        await insertBatch(client, batch, rowNumberEnabled, sheetOffsets);
        batch = [];
      }
    });
    await insertBatch(client, batch, rowNumberEnabled, sheetOffsets);
    await client.query(
      'INSERT INTO public.trainee_imports(file_hash,file_name,row_count) VALUES ($1,$2,$3)',
      [hash, req.file.originalname, parsed.total]
    );
    await client.query('COMMIT');
    committed = true;
    res.json({ imported: parsed.total, sheets: parsed.sheets });
  } catch (error) {
    if (client && !committed) {
      try { await client.query('ROLLBACK'); } catch (rollbackError) {
        console.error('Import rollback failed:', rollbackError.message);
      }
    }
    next(error);
  } finally {
    if (client) client.release();
    await cleanTemp(req.file);
  }
});

app.use((error, req, res, _next) => {
  if (res.headersSent) return;
  if (error instanceof multer.MulterError) {
    return res.status(400).json({ error: 'حجم الملف كبير أو نوع الرفع غير صالح (الحد 35MB)' });
  }
  if (error.status === 400 || error.status === 409 || error.message?.includes('XLSX')) {
    return res.status(error.status || 400).json({ error: error.message });
  }
  console.error('Server error:', { code: error.code || 'UNKNOWN', message: error.message, path: req.path });
  res.status(500).json({ error: 'حدث خطأ في الخادم' });
});
app.listen(PORT, '0.0.0.0', () => console.log(`Trainees Management API running on port ${PORT}`));
