
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import pg from 'pg';
import ExcelJS from 'exceljs';
import multer from 'multer';
import { createHash } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';

// ========================================
// 1. إعداد التطبيق
// ========================================

const app = express();

app.disable('x-powered-by');
app.set('trust proxy', 1);

const PORT = Number(process.env.PORT) || 3000;

// ========================================
// 2. التحقق من متغيرات البيئة
// ========================================

const requiredVariables = [
  'DATABASE_URL',
  'SUPABASE_URL',
  'SUPABASE_ANON_KEY',
  'ALLOWED_ORIGIN'
];

for (const name of requiredVariables) {
  if (!process.env[name]?.trim()) {
    throw new Error(`Missing environment variable: ${name}`);
  }
}

// ========================================
// 3. إعداد الاتصال بقاعدة بيانات Supabase
// ========================================

const databaseUrl = process.env.DATABASE_URL.trim();

let parsedDatabaseUrl;

try {
  parsedDatabaseUrl = new URL(databaseUrl);

  if (
    !['postgresql:', 'postgres:'].includes(
      parsedDatabaseUrl.protocol
    )
  ) {
    throw new Error('Invalid database protocol');
  }

  if (
    !parsedDatabaseUrl.hostname ||
    !parsedDatabaseUrl.username ||
    !parsedDatabaseUrl.password
  ) {
    throw new Error('Incomplete database connection string');
  }
} catch {
  throw new Error(
    'DATABASE_URL must be a complete PostgreSQL connection URL'
  );
}

// منع تعارض معاملات SSL في الرابط مع إعدادات pg.
// إعداد SSL يُدار أدناه فقط.
for (const key of [
  'sslmode',
  'sslcert',
  'sslkey',
  'sslrootcert'
]) {
  parsedDatabaseUrl.searchParams.delete(key);
}

// شهادة CA اختيارية، لكنها قد تكون ضرورية
// لحل SELF_SIGNED_CERT_IN_CHAIN.
const databaseCa = process.env.DATABASE_CA_CERT
  ?.replace(/\\n/g, '\n')
  .trim();

if (
  databaseCa &&
  !databaseCa.includes('-----BEGIN CERTIFICATE-----')
) {
  throw new Error(
    'DATABASE_CA_CERT must contain a PEM certificate'
  );
}

const db = new pg.Pool({
  connectionString: parsedDatabaseUrl.toString(),

  ssl: databaseCa
    ? {
        ca: databaseCa,
        rejectUnauthorized: true
      }
    : {
        rejectUnauthorized: true
      },

  max: 5,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000
});

db.on('error', (error) => {
  console.error('Database pool error:', {
    code: error.code,
    message: error.message
  });
});

// ========================================
// 4. إعداد Supabase Authentication
// ========================================

const auth = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY,
  {
    auth: {
      persistSession: false,
      autoRefreshToken: false
    }
  }
);

// ========================================
// 5. إعداد الحماية و CORS
// ========================================

app.use(helmet());

const allowedOrigins = process.env.ALLOWED_ORIGIN
  .split(',')
  .map(origin => origin.trim().replace(/\/$/, ''))
  .filter(Boolean);

app.use(
  cors({
    origin(origin, callback) {
      if (!origin || allowedOrigins.includes(origin)) {
        return callback(null, true);
      }

      return callback(new Error('Origin not allowed'));
    },

    methods: ['GET', 'POST', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization']
  })
);

app.use(express.json({ limit: '16kb' }));

app.use(
  rateLimit({
    windowMs: 60 * 1000,
    limit: 80,
    standardHeaders: 'draft-7',
    legacyHeaders: false
  })
);

// ========================================
// 6. فحص تشغيل الخادم
// ========================================

app.get('/health', (_req, res) => {
  res.json({
    status: 'ok',
    service: 'Trainees Management System'
  });
});

// فحص قاعدة البيانات دون كشف معلومات حساسة.
// هذا المسار محمي بتسجيل الدخول.
app.get('/api/db-health', guard, async (_req, res, next) => {
  try {
    await db.query('SELECT 1');

    res.json({
      status: 'ok',
      database: 'connected'
    });
  } catch (error) {
    next(error);
  }
});

// ========================================
// 7. التحقق من المستخدم وصلاحياته
// ========================================

async function guard(req, res, next) {
  try {
    const token = (
      req.headers.authorization || ''
    ).match(/^Bearer (.+)$/)?.[1];

    if (!token) {
      return res.sendStatus(401);
    }

    const { data, error } = await auth.auth.getUser(token);

    if (error || !data.user) {
      return res.sendStatus(401);
    }

    const result = await db.query(
      `
      SELECT role
      FROM app_private.user_roles
      WHERE user_id = $1
      `,
      [data.user.id]
    );

    if (!result.rows.length) {
      return res.sendStatus(403);
    }

    req.userId = data.user.id;
    req.role = result.rows[0].role;

    next();
  } catch (error) {
    next(error);
  }
}

app.use('/api', guard);
app.get('/api/me', (req,res)=>res.json({role:req.role}));

// ========================================
// 8. جلب أسماء الأوراق وأعداد السجلات
// ========================================

app.get('/api/sheets', async (_req, res, next) => {
  try {
    const result = await db.query(
      `
      SELECT
        sheet_name,
        COUNT(*)::int AS count
      FROM public.trainee_records
      GROUP BY sheet_name
      ORDER BY sheet_name
      `
    );

    res.json(result.rows);
  } catch (error) {
    next(error);
  }
});

// ========================================
// 9. إعداد البحث والتصفية
// ========================================

function filters(query) {
  const where = [];
  const args = [];

  if (query.sheet) {
    args.push(String(query.sheet).slice(0, 200));

    where.push(
      `sheet_name = $${args.length}`
    );
  }

  if (query.search) {
    args.push(
      '%' +
      String(query.search).slice(0, 150) +
      '%'
    );

    where.push(
      `payload::text ILIKE $${args.length}`
    );
  }

  return {
    sql: where.length
      ? 'WHERE ' + where.join(' AND ')
      : '',
    args
  };
}

// ========================================
// 10. جلب السجلات مع ترقيم الصفحات
// ========================================

app.get('/api/records', async (req, res, next) => {
  try {
    const f = filters(req.query);

    const page = Math.max(
      1,
      Math.min(
        100000,
        Number.parseInt(req.query.page, 10) || 1
      )
    );

    const limit = 50;
    const offset = (page - 1) * limit;

    const countResult = await db.query(
      `
      SELECT COUNT(*)::int AS n
      FROM public.trainee_records
      ${f.sql}
      `,
      f.args
    );

    const recordsResult = await db.query(
      `
      SELECT
        id,
        sheet_name,
        payload
      FROM public.trainee_records
      ${f.sql}
      ORDER BY id
      LIMIT ${limit}
      OFFSET $${f.args.length + 1}
      `,
      [...f.args, offset]
    );

    res.json({
      total: countResult.rows[0].n,
      records: recordsResult.rows,
      page,
      pageSize: limit
    });
  } catch (error) {
    next(error);
  }
});

// ========================================
// 11. تصدير السجلات المحددة إلى Excel
// ========================================

app.post('/api/export', async (req, res, next) => {
  try {
    if (!['admin', 'exporter'].includes(req.role)) {
      return res.sendStatus(403);
    }

    const ids = Array.isArray(req.body?.ids)
      ? req.body.ids
          .filter(
            id =>
              Number.isSafeInteger(id) &&
              id > 0
          )
          .slice(0, 1000)
      : [];

    if (!ids.length) {
      return res.status(400).json({
        error: 'حددي سجلات للتصدير، بحد أقصى 1000 سجل'
      });
    }

    const result = await db.query(
      `
      SELECT
        sheet_name,
        payload
      FROM public.trainee_records
      WHERE id = ANY($1::bigint[])
      ORDER BY id
      `,
      [ids]
    );

    const workbook = new ExcelJS.Workbook();

    const worksheet = workbook.addWorksheet(
      'البيانات المحددة'
    );

    worksheet.views = [
      { rightToLeft: true }
    ];

    const keys = [
      ...new Set(
        result.rows.flatMap(
          row => Object.keys(row.payload || {})
        )
      )
    ];

    worksheet.addRow([
      'الورقة',
      ...keys
    ]);

    function safeExcelValue(value) {
      if (value === null || value === undefined) {
        return '';
      }

      const text = String(value);

      // حماية من تنفيذ الصيغ غير الموثوقة.
      if (/^[\s]*[=+\-@]/.test(text)) {
        return "'" + text;
      }

      return text;
    }

    for (const row of result.rows) {
      worksheet.addRow([
        safeExcelValue(row.sheet_name),

        ...keys.map(key =>
          safeExcelValue(row.payload?.[key])
        )
      ]);
    }

    worksheet.getRow(1).font = {
      bold: true,
      color: { argb: 'FFFFFFFF' }
    };

    worksheet.getRow(1).fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FF205D50' }
    };

    worksheet.columns.forEach(column => {
      column.width = 25;
    });

    res.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    );

    res.setHeader(
      'Content-Disposition',
      'attachment; filename="selected.xlsx"'
    );

    res.setHeader(
      'Cache-Control',
      'no-store'
    );

    await workbook.xlsx.write(res);

    res.end();
  } catch (error) {
    next(error);
  }
});


// ========================================
// استيراد Excel للمدير فقط
// ========================================
const excelUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 35 * 1024 * 1024, files: 1 },
  fileFilter(_req, file, callback) {
    const ok = /\.xlsx$/i.test(file.originalname);
    callback(ok ? null : new Error('يُسمح بملفات XLSX فقط'), ok);
  }
});

function adminOnly(req, res, next) {
  if (req.role !== 'admin') return res.sendStatus(403);
  next();
}

function excelValue(cell) {
  const value = cell.value;
  if (value === null || value === undefined) return null;
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'object') {
    if (value.result !== undefined) return value.result;
    if (value.text !== undefined) return value.text;
    if (value.richText) return value.richText.map(x => x.text).join('');
    if (value.hyperlink) return value.text || value.hyperlink;
    return cell.text || null;
  }
  return value;
}

async function parseWorkbook(buffer, includeRecords) {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer);
  const sheets = [];
  const records = [];
  for (const sheet of workbook.worksheets) {
    const header = sheet.getRow(1);
    const lastColumn = header.cellCount;
    if (!lastColumn) continue;
    const headers = [];
    const used = new Set();
    for (let i = 1; i <= lastColumn; i++) {
      const base = String(excelValue(header.getCell(i)) ?? `عمود ${i}`).trim() || `عمود ${i}`;
      let name = base, suffix = 2;
      while (used.has(name)) name = `${base} (${suffix++})`;
      used.add(name);
      headers.push(name);
    }
    let count = 0;
    sheet.eachRow((row, rowNumber) => {
      if (rowNumber === 1) return;
      const payload = {};
      let nonempty = false;
      for (let i = 1; i <= lastColumn; i++) {
        const value = excelValue(row.getCell(i));
        payload[headers[i - 1]] = value;
        if (value !== null && value !== '') nonempty = true;
      }
      if (!nonempty) return;
      count++;
      if (includeRecords) records.push({ sheet: sheet.name, payload });
    });
    sheets.push({ name: sheet.name, count, columns: headers.length });
  }
  if (!sheets.length) throw new Error('لم يُعثر على أوراق تحتوي على عناوين أعمدة');
  if (sheets.reduce((sum, s) => sum + s.count, 0) > 80000) {
    throw new Error('الحد الأقصى 80000 سجل في الملف الواحد');
  }
  return { sheets, records };
}

app.post('/api/import/preview', adminOnly, excelUpload.single('file'), async (req, res, next) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'اختاري ملف Excel' });
    const parsed = await parseWorkbook(req.file.buffer, false);
    res.json({ sheets: parsed.sheets, total: parsed.sheets.reduce((n, s) => n + s.count, 0) });
  } catch (error) { next(error); }
});

app.post('/api/import/upload', adminOnly, excelUpload.single('file'), async (req, res, next) => {
  let client;
  try {
    if (!req.file) return res.status(400).json({ error: 'اختاري ملف Excel' });
    const hash = createHash('sha256').update(req.file.buffer).digest('hex');
    const parsed = await parseWorkbook(req.file.buffer, true);
    client = await db.connect();
    await client.query('BEGIN');
    // يمنع تزامن عمليتي رفع داخل النظام نفسه.
    await client.query('SELECT pg_advisory_xact_lock(84621831)');
    const existing = await client.query('SELECT 1 FROM public.trainee_imports WHERE file_hash=$1', [hash]);
    if (existing.rowCount) {
      await client.query('ROLLBACK');
      client.release(); client = null;
      return res.status(409).json({ error: 'تم استيراد هذا الملف سابقًا، ولن نكرر بياناته' });
    }
    for (let offset = 0; offset < parsed.records.length; offset += 150) {
      const batch = parsed.records.slice(offset, offset + 150);
      const args = [];
      const placeholders = batch.map((record, i) => {
        args.push(record.sheet, JSON.stringify(record.payload));
        return `($${2*i+1},$${2*i+2}::jsonb)`;
      });
      await client.query(`INSERT INTO public.trainee_records (sheet_name,payload) VALUES ${placeholders.join(',')}`, args);
    }
    await client.query('INSERT INTO public.trainee_imports(file_hash,file_name,row_count) VALUES ($1,$2,$3)', [hash, req.file.originalname, parsed.records.length]);
    await client.query('COMMIT');
    client.release(); client = null;
    res.json({ imported: parsed.records.length, sheets: parsed.sheets });
  } catch (error) {
    if (client) { try { await client.query('ROLLBACK'); } catch {} client.release(); }
    next(error);
  }
});

// ========================================
// 12. معالجة الأخطاء
// ========================================

app.use((error, req, res, _next) => {
  if (error instanceof multer.MulterError) return res.status(400).json({ error: 'حجم الملف كبير أو نوع الرفع غير صالح (الحد 35MB)' });
  if (error.message?.includes('XLSX') || error.message?.includes('80000') || error.message?.includes('عناوين أعمدة')) return res.status(400).json({ error: error.message });
  console.error('Server error:', {
    code: error.code || 'UNKNOWN',
    message: error.message,
    path: req.path
  });

  if (res.headersSent) {
    return;
  }

  res.status(500).json({
    error: 'حدث خطأ في الخادم'
  });
});

// ========================================
// 13. تشغيل الخادم
// ========================================

app.listen(PORT, '0.0.0.0', () => {
  console.log(
    `Trainees Management API running on port ${PORT}`
  );
});

// ========================================
// ملاحظات أمنية
// ========================================

// حسابات المدير والصلاحيات تُدار داخل Supabase.
// إنشاء حساب المدير من الواجهة العامة معطل.
// لا تضع كلمات المرور أو مفاتيح service_role هنا.
// لا تعطل التحقق من شهادة SSL.
