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
app.use(express.json({ limit: '128kb' }));
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
const ID_COLUMN = 'رقم الهوية الوطنية';
const NAME_COLUMN = 'الاسم الثلاثي ( باللغة العربية )';
const PHONE_COLUMN = 'رقم الجوال';
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
        // Match by column position; header spelling and extra whitespace may differ.
        // The output keys always use the 21 canonical column names.
        if (!row.getCell(1).value) throw importError(`الورقة ${sheet.name}: الصف الأول لا يحتوي على عناوين`);
        for (let i=0;i<TRAINEE_COLUMNS.length;i++) {
          if (normalizedHeading(excelValue(row.getCell(i+1))) !== normalizedHeading(TRAINEE_COLUMNS[i]))
            throw importError(`الورقة ${sheet.name}: العمود ${i+1} يجب أن يكون «${TRAINEE_COLUMNS[i].trim()}»؛ الموجود «${String(excelValue(row.getCell(i+1))??'فارغ').slice(0,100)}»`);
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

// Matching is based on national ID only. Records without ID are not auto-merged.
function identity(payload) { return String(payload?.[ID_COLUMN] ?? '').trim(); }
function cleanPayload(input, partial = false) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw importError('بيانات السجل غير صحيحة');
  const result = {};
  for (const key of TRAINEE_COLUMNS) {
    if (partial && !Object.hasOwn(input, key)) continue;
    const value = input[key];
    if (value !== null && value !== undefined && typeof value === 'object') throw importError(`قيمة غير صالحة في ${key}`);
    result[key] = value === null || value === undefined ? null : String(value).trim();
    if (result[key]?.length > 2000) throw importError(`قيمة طويلة جدًا في ${key}`);
  }
  return result;
}
async function hasRowNumberColumn(client) {
  const r = await client.query(`SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='trainee_records' AND column_name='row_number'`);
  return r.rowCount > 0;
}
async function nextRowNumber(client, sheet) {
  const r = await client.query('SELECT COALESCE(MAX(row_number),0)+1 AS n FROM public.trainee_records WHERE sheet_name=$1', [sheet]);
  return Number(r.rows[0].n);
}
async function insertOne(client, sheet, payload, rowNumberEnabled) {
  if (rowNumberEnabled) {
    const n = await nextRowNumber(client, sheet);
    return client.query('INSERT INTO public.trainee_records(sheet_name,row_number,payload) VALUES($1,$2,$3::jsonb) RETURNING id', [sheet,n,JSON.stringify(payload)]);
  }
  return client.query('INSERT INTO public.trainee_records(sheet_name,payload) VALUES($1,$2::jsonb) RETURNING id', [sheet,JSON.stringify(payload)]);
}
// Keep a unique national-ID index in memory, not the full workbook. Detect ambiguous preexisting duplicates.
async function identityIndex(client) {
  const r = await client.query(`SELECT id, TRIM(payload->>$1) AS national_id FROM public.trainee_records WHERE NULLIF(TRIM(payload->>$1),'') IS NOT NULL`, [ID_COLUMN]);
  const map = new Map();
  for (const row of r.rows) {
    if (map.has(row.national_id)) map.set(row.national_id, null);
    else map.set(row.national_id, row.id);
  }
  return map;
}
async function upsertRecord(client, sheet, payload, index, rowNumberEnabled) {
  const id = identity(payload);
  if (id && index.has(id)) {
    const recordId = index.get(id);
    if (recordId === null) throw importError(`الهوية ${id} مكررة مسبقًا في قاعدة البيانات؛ يجب مراجعتها يدويًا`);
    await client.query(`UPDATE public.trainee_records SET payload = payload || $1::jsonb WHERE id=$2`, [JSON.stringify(payload),recordId]);
    return 'updated';
  }
  if (!id) {
    // Without national ID, only exact same sheet + payload can be considered a duplicate.
    // Do not guess identity from name or phone number.
    const same = await client.query('SELECT id FROM public.trainee_records WHERE sheet_name=$1 AND payload=$2::jsonb LIMIT 1', [sheet, JSON.stringify(payload)]);
    if (same.rowCount) return 'unchanged';
  }
  const inserted = await insertOne(client, sheet, payload, rowNumberEnabled);
  if (id) index.set(id, inserted.rows[0].id);
  return 'added';
}
app.get('/api/columns', (_req,res) => res.json(TRAINEE_COLUMNS));

const DASH_FIELDS = TRAINEE_COLUMNS;
app.post('/api/dashboard', async(req,res,next)=>{
  try {
    const ids = Array.isArray(req.body?.ids) ? req.body.ids.filter(Number.isSafeInteger).filter(x=>x>0).slice(0,80000) : [];
    const useIds = req.body?.selectedOnly === true;
    if(useIds && !ids.length) return res.json({total:0,groups:Object.fromEntries(DASH_FIELDS.map(x=>[x,[]]))});
    const f=filters({sheet:req.body?.sheet,search:req.body?.search});
    const clauses=[];const args=[...f.args];
    if(f.sql) clauses.push(f.sql.slice(6));
    if(useIds){args.push(ids);clauses.push(`id = ANY($${args.length}::bigint[])`);}
    const where=clauses.length?'WHERE '+clauses.join(' AND '):'';
    const result=await db.query(`SELECT COUNT(*)::int AS total FROM public.trainee_records ${where}`,args);
    const groups={};
    for(const field of DASH_FIELDS){
      const r=await db.query(`SELECT COALESCE(NULLIF(TRIM(payload->>$${args.length+1}),''),'غير محدد') AS label,COUNT(*)::int AS count FROM public.trainee_records ${where} GROUP BY 1 ORDER BY count DESC,label LIMIT 30`,[...args,field]);
      groups[field]=r.rows;
    }
    res.json({total:result.rows[0].total,groups});
  }catch(error){next(error);}
});


// عمليات جماعية محمية: النطاق إما معرفات محددة أو جميع النتائج المطابقة للمرشح.
function batchScope(body) {
  if (body?.scope === 'filtered') {
    const f = filters({sheet:body.sheet,search:body.search});
    return {where:f.sql,args:f.args};
  }
  if (body?.scope !== 'selected' || !Array.isArray(body.ids)) {
    const e=new Error('نطاق العملية غير صالح');e.status=400;throw e;
  }
  const ids=[...new Set(body.ids.filter(id=>Number.isSafeInteger(id)&&id>0))].slice(0,80000);
  if(!ids.length){const e=new Error('لم تحددي أي سجلات');e.status=400;throw e;}
  return {where:'WHERE id = ANY($1::bigint[])',args:[ids]};
}
app.post('/api/selection', async(req,res,next)=>{
  try{
    const f=filters({sheet:req.body?.sheet,search:req.body?.search});
    const r=await db.query(`SELECT id FROM public.trainee_records ${f.sql} ORDER BY id LIMIT 80001`,f.args);
    if(r.rows.length>80000)return res.status(413).json({error:'تجاوز التحديد 80000 سجل'});
    res.json({ids:r.rows.map(x=>Number(x.id))});
  }catch(e){next(e);}
});
app.post('/api/records/delete-bulk',adminOnly,async(req,res,next)=>{
  let client;
  try{
    const {where,args}=batchScope(req.body);
    if(req.body.scope==='filtered' && !req.body.confirmAll) return res.status(400).json({error:'تأكيد حذف جميع النتائج مطلوب'});
    client=await db.connect();await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock(84621831)');
    const result=await client.query(`DELETE FROM public.trainee_records ${where}`,args);
    await client.query('COMMIT');res.json({deleted:result.rowCount});
  }catch(e){if(client)await client.query('ROLLBACK').catch(()=>{});next(e);}finally{client?.release();}
});
app.post('/api/export-bulk',async(req,res,next)=>{
  if(!['admin','exporter'].includes(req.role))return res.sendStatus(403);
  try{
    const {where,args}=batchScope(req.body);
    res.setHeader('Content-Type','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition','attachment; filename="trainees.xlsx"');
    res.setHeader('Cache-Control','no-store');
    const wb=new ExcelJS.stream.xlsx.WorkbookWriter({stream:res,useStyles:false,useSharedStrings:false});
    const ws=wb.addWorksheet('البيانات',{views:[{rightToLeft:true}]});
    ws.addRow(TRAINEE_COLUMNS).commit();
    let lastId=0;
    while(true){
      const r=await db.query(`SELECT id,payload FROM public.trainee_records ${where ? where+' AND':'WHERE'} id>$${args.length+1} ORDER BY id LIMIT 300`,[...args,lastId]);
      if(!r.rows.length)break;
      for(const row of r.rows)ws.addRow(TRAINEE_COLUMNS.map(k=>safeExcelValue(row.payload?.[k]))).commit();
      lastId=Number(r.rows.at(-1).id);
    }
    ws.commit();await wb.commit();
  }catch(e){if(res.headersSent){res.destroy(e);}else next(e);}
});

app.post('/api/records', adminOnly, async (req,res,next) => {
  let client;
  try {
    const sheet = String(req.body?.sheet_name || 'إضافة مباشرة').trim().slice(0,200);
    const payload = cleanPayload(req.body?.payload);
    if (!payload[NAME_COLUMN] && !identity(payload)) throw importError('أدخلي الاسم أو رقم الهوية');
    client = await db.connect(); await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock(84621831)');
    const index = await identityIndex(client);
    const result = await upsertRecord(client,sheet,payload,index,await hasRowNumberColumn(client));
    await client.query('COMMIT'); res.status(result==='added'?201:200).json({status:result});
  } catch(e) { if(client) await client.query('ROLLBACK').catch(()=>{}); next(e); }
  finally { client?.release(); }
});
app.patch('/api/records/:id', adminOnly, async(req,res,next)=>{
  let client;
  try {
    const id=Number(req.params.id);
    if (!Number.isSafeInteger(id) || id<=0) throw importError('رقم السجل غير صالح');
    const changes=cleanPayload(req.body?.payload,true);
    if(!Object.keys(changes).length) throw importError('لا توجد تعديلات');
    client=await db.connect(); await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock(84621831)');
    const old=await client.query('SELECT payload FROM public.trainee_records WHERE id=$1 FOR UPDATE',[id]);
    if(!old.rowCount) { const e=new Error('السجل غير موجود');e.status=404;throw e; }
    const merged={...old.rows[0].payload,...changes};
    const nationalId=identity(merged);
    if(nationalId) {
      const conflict=await client.query(`SELECT id FROM public.trainee_records WHERE id<>$1 AND TRIM(payload->>$2)=$3 LIMIT 1`,[id,ID_COLUMN,nationalId]);
      if(conflict.rowCount) {const e=new Error('رقم الهوية موجود في سجل آخر');e.status=409;throw e;}
    }
    await client.query('UPDATE public.trainee_records SET payload=$1::jsonb WHERE id=$2',[JSON.stringify(merged),id]);
    await client.query('COMMIT'); res.json({updated:true,id});
  }catch(e){if(client) await client.query('ROLLBACK').catch(()=>{});next(e);}finally{client?.release();}
});

app.post('/api/import/preview', adminOnly, receiveExcel, async (req, res, next) => {
  try {
    if (!req.file) throw importError('اختاري ملف Excel');
    const result = await parseWorkbookFile(req.file.path);
    res.json(result);
  } catch (error) { next(error); }
  finally { await cleanTemp(req.file); }
});

app.post('/api/import/upload', adminOnly, receiveExcel, async (req, res, next) => {
  let client;
  try {
    if (!req.file) throw importError('اختاري ملف Excel');
    const hash = await fileHash(req.file.path);
    client = await db.connect(); await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock(84621831)');
    const existing=await client.query('SELECT 1 FROM public.trainee_imports WHERE file_hash=$1',[hash]);
    if(existing.rowCount){const e=new Error('هذا الملف نفسه سبق استيراده');e.status=409;throw e;}
    const index=await identityIndex(client);
    const rowNumberEnabled=await hasRowNumberColumn(client);
    let added=0,updated=0,unchanged=0;
    const parsed=await parseWorkbookFile(req.file.path, async record=>{
      const result=await upsertRecord(client,record.sheet,record.payload,index,rowNumberEnabled);
      if(result==='updated') updated++; else if(result==='unchanged') unchanged++; else added++;
    });
    await client.query('INSERT INTO public.trainee_imports(file_hash,file_name,row_count) VALUES($1,$2,$3)',[hash,req.file.originalname,parsed.total]);
    await client.query('COMMIT');
    res.json({imported:parsed.total,added,updated,unchanged,sheets:parsed.sheets});
  } catch(e){if(client) await client.query('ROLLBACK').catch(()=>{});next(e);}
  finally{client?.release();await cleanTemp(req.file);}
});

// Import only genuinely new trainees; existing national IDs are never overwritten.
app.post('/api/import/new-only', adminOnly, receiveExcel, async (req, res, next) => {
  let client;
  try {
    if (!req.file) throw importError('اختاري ملف Excel');
    client = await db.connect();
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock(84621831)');
    const index = await identityIndex(client);
    const rowNumberEnabled = await hasRowNumberColumn(client);
    let added = 0, skipped = 0;
    const seenNoId = new Set();
    const parsed = await parseWorkbookFile(req.file.path, async record => {
      const id = identity(record.payload);
      if (id) {
        if (index.has(id)) {
          if (index.get(id) === null) throw importError(`الهوية ${id} مكررة في قاعدة البيانات وتحتاج مراجعة`);
          skipped++;
          return;
        }
      } else {
        // Do not merge distinct people based on name or phone; skip only exact duplicates.
        const signature = JSON.stringify([record.sheet, record.payload]);
        if (seenNoId.has(signature)) { skipped++; return; }
        seenNoId.add(signature);
        const same = await client.query(
          'SELECT 1 FROM public.trainee_records WHERE sheet_name=$1 AND payload=$2::jsonb LIMIT 1',
          [record.sheet, JSON.stringify(record.payload)]
        );
        if (same.rowCount) { skipped++; return; }
      }
      const result = await insertOne(client, record.sheet, record.payload, rowNumberEnabled);
      if (id) index.set(id, result.rows[0].id);
      added++;
    });
    await client.query('COMMIT');
    res.json({ imported: parsed.total, added, skipped, sheets: parsed.sheets });
  } catch (error) {
    if (client) await client.query('ROLLBACK').catch(() => {});
    next(error);
  } finally {
    client?.release();
    await cleanTemp(req.file);
  }
});


// Import jobs: the browser receives a job ID immediately and polls real server-side counters.
// Jobs live in process memory: run Render with one instance, or use a persistent job store for scaling.
const importJobs = new Map();
function publicJob(job) {
  const { state, phase, total, processed, added, updated, unchanged, skipped, error, startedAt, endedAt, sheets } = job;
  return { state, phase, total, processed, added, updated, unchanged, skipped, error,
    startedAt, endedAt, sheets, committed: state === 'completed' };
}
app.get('/api/import/jobs/:id', adminOnly, (req,res) => {
  const job=importJobs.get(req.params.id);
  if (!job || job.userId !== req.userId) return res.sendStatus(404);
  res.set('Cache-Control','no-store').json(publicJob(job));
});
app.post('/api/import/start/:mode', adminOnly, receiveExcel, async (req,res,next) => {
  if (!req.file) return next(importError('اختاري ملف Excel'));
  if (!['new-only','update'].includes(req.params.mode)) { await cleanTemp(req.file);return next(importError('نوع الاستيراد غير صالح')); }
  const id=randomUUID();
  const job={ userId:req.userId, state:'running', phase:'فحص الملف', total:0, processed:0,
    added:0, updated:0, unchanged:0, skipped:0, error:null, sheets:[], startedAt:Date.now(), endedAt:null };
  importJobs.set(id,job);
  res.status(202).json({jobId:id});
  // Start after responding so progress polling works during long imports.
  setImmediate(async () => {
    let client;
    try {
      job.phase='فحص الصفوف وحساب الإجمالي';
      const preview=await parseWorkbookFile(req.file.path);
      job.total=preview.total;job.sheets=preview.sheets;
      job.phase='مقارنة السجلات وحفظ التغييرات';
      client=await db.connect();await client.query('BEGIN');
      await client.query('SELECT pg_advisory_xact_lock(84621831)');
      const index=await identityIndex(client);
      const rowNumberEnabled=await hasRowNumberColumn(client);
      const seenNoId=new Set();
      const pending=[];
      async function flushPending(){
        if(!pending.length)return;
        const args=[];
        const values=pending.map((r,i)=>{args.push(r.sheet,JSON.stringify(r.payload));return `($${i*2+1},$${i*2+2}::jsonb)`}).join(',');
        await client.query(`INSERT INTO public.trainee_records(sheet_name,payload) VALUES ${values}`,args);
        pending.length=0;
      }
      await parseWorkbookFile(req.file.path,async record=>{
        if(req.params.mode==='update'){
          const result=await upsertRecord(client,record.sheet,record.payload,index,rowNumberEnabled);
          if(result==='added')job.added++;
          else if(result==='updated')job.updated++;
          else job.unchanged++;
        }else{
          const nationalId=identity(record.payload);
          if(nationalId && index.has(nationalId)){
            if(index.get(nationalId)===null)throw importError(`الهوية ${nationalId} مكررة في قاعدة البيانات وتحتاج مراجعة`);
            job.skipped++;
          }else{
            const signature=JSON.stringify([record.sheet,record.payload]);
            if(!nationalId && seenNoId.has(signature))job.skipped++;
            else{
              if(!nationalId)seenNoId.add(signature);
              const duplicate=!nationalId && (await client.query(
                'SELECT 1 FROM public.trainee_records WHERE sheet_name=$1 AND payload=$2::jsonb LIMIT 1',
                [record.sheet,JSON.stringify(record.payload)])).rowCount>0;
              if(duplicate)job.skipped++;
              else{
                if(rowNumberEnabled){
                  const inserted=await insertOne(client,record.sheet,record.payload,rowNumberEnabled);
                  if(nationalId)index.set(nationalId,inserted.rows[0].id);
                }else{
                  pending.push(record);
                  if(nationalId)index.set(nationalId,-1);
                  if(pending.length>=200)await flushPending();
                }
                job.added++;
              }
            }
          }
        }
        job.processed++;
      });
      if(req.params.mode==='new-only')await flushPending();
      job.phase='اعتماد التغييرات في قاعدة البيانات';
      await client.query('COMMIT');
      job.state='completed';job.phase='اكتمل الحفظ';job.endedAt=Date.now();
    }catch(error){
      if(client)await client.query('ROLLBACK').catch(()=>{});
      job.state='failed';job.error=error.status===400?error.message:'تعذر الاستيراد؛ لم تُعتمد التغييرات. راجعي سجل Render.';
      job.phase='فشل الاستيراد';job.endedAt=Date.now();
      console.error('Import job failed:',{id,code:error.code,message:error.message});
    }finally{client?.release();await cleanTemp(req.file);}
  });
});
// Prevent memory growth; active jobs are never evicted.
setInterval(()=>{for(const [id,job] of importJobs){if(job.endedAt && Date.now()-job.endedAt>60*60*1000)importJobs.delete(id)}},15*60*1000).unref();

app.use((error, req, res, _next) => {
  if (res.headersSent) return;
  if (error instanceof multer.MulterError) {
    return res.status(400).json({ error: error.code==='LIMIT_FILE_SIZE' ? 'حجم الملف أكبر من 35 ميجابايت' : `تعذر استقبال الملف: ${error.code}` });
  }
  if ([400,404,409].includes(error.status) || error.message?.includes('XLSX') || /invalid|corrupt|zip|entry|unexpected end|encrypted/i.test(error.message||'')) {
    return res.status(error.status || 400).json({ error: error.status ? error.message : 'ملف Excel تالف أو مشفر أو ليس بصيغة XLSX صحيحة' });
  }
  console.error('Server error:', { code: error.code || 'UNKNOWN', message: error.message, path: req.path });
  res.status(500).json({ error: 'حدث خطأ في الخادم' });
});
app.listen(PORT, '0.0.0.0', () => console.log(`Trainees Management API running on port ${PORT}`));
