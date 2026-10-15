
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import pg from 'pg';
import ExcelJS from 'exceljs';
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
// 12. معالجة الأخطاء
// ========================================

app.use((error, req, res, _next) => {
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
