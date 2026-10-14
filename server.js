import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import pg from 'pg';
import ExcelJS from 'exceljs';
import {timingSafeEqual} from 'node:crypto';
import {createClient} from '@supabase/supabase-js';
const app=express();
const db=new pg.Pool({connectionString:process.env.DATABASE_URL,ssl:{rejectUnauthorized:true}});
const auth=createClient(process.env.SUPABASE_URL,process.env.SUPABASE_ANON_KEY,{auth:{persistSession:false}});
app.disable('x-powered-by');app.use(helmet());app.use(cors({origin:process.env.ALLOWED_ORIGIN||false}));app.use(express.json({limit:'16kb'}));app.use(rateLimit({windowMs:60000,limit:80,standardHeaders:'draft-7',legacyHeaders:false}));
async function guard(req,res,next){try{const token=(req.headers.authorization||'').match(/^Bearer (.+)$/)?.[1];if(!token)return res.sendStatus(401);const {data,error}=await auth.auth.getUser(token);if(error||!data.user)return res.sendStatus(401);const role=await db.query(
  'SELECT role FROM app_private.user_roles WHERE user_id=$1',
  [data.user.id]
);if(!role.rows.length)return res.sendStatus(403);req.role=role.rows[0].role;next()}catch(e){next(e)}}
const adminAuth=process.env.SUPABASE_SERVICE_ROLE_KEY ? createClient(process.env.SUPABASE_URL,process.env.SUPABASE_SERVICE_ROLE_KEY,{auth:{persistSession:false}}) : null;
app.post('/setup/first-admin',async(req,res,next)=>{try{
 const {setupKey,email,password}=req.body||{};
 if(!process.env.INITIAL_ADMIN_SETUP_KEY||!adminAuth)return res.sendStatus(404);
 const a=Buffer.from(String(setupKey||'')),b=Buffer.from(process.env.INITIAL_ADMIN_SETUP_KEY);
 if(a.length!==b.length||!timingSafeEqual(a,b))return res.sendStatus(403);
 if(typeof email!=='string'||!/^\S+@\S+\.\S+$/.test(email)||typeof password!=='string'||password.length<12)return res.status(400).json({error:'أدخل بريدًا صحيحًا وكلمة مرور من 12 حرفًا على الأقل'});
 const client=await db.connect();let userId;
 try{await client.query('begin');await client.query('select pg_advisory_xact_lock(748193)');const existing=await client.query("select 1 from app_roles where role='admin' limit 1");if(existing.rowCount){await client.query('rollback');return res.status(409).json({error:'تم إعداد حساب المدير بالفعل'});}
 const {data,error}=await adminAuth.auth.admin.createUser({email,password,email_confirm:true});if(error)throw error;userId=data.user.id;
 await client.query("insert into app_roles(user_id,role) values($1,'admin')",[userId]);await client.query('commit');res.status(201).json({message:'تم إنشاء حساب المدير. يمكنك تسجيل الدخول الآن.'});
 }catch(e){await client.query('rollback').catch(()=>{});if(userId)await adminAuth.auth.admin.deleteUser(userId).catch(()=>{});throw e}finally{client.release()}
 }catch(e){next(e)}});
app.use('/api',guard);
app.get('/api/sheets',async(req,res,next)=>{try{const r=await db.query('select sheet_name,count(*)::int as count from trainee_records group by sheet_name order by sheet_name');res.json(r.rows)}catch(e){next(e)}});
function filters(q){let where=[],args=[];if(q.sheet){args.push(q.sheet);where.push(`sheet_name=$${args.length}`)}if(q.search){args.push('%'+String(q.search).slice(0,150)+'%');where.push(`payload::text ilike $${args.length}`)}return {sql:where.length?'where '+where.join(' and '):'',args}}
app.get('/api/records',async(req,res,next)=>{try{const f=filters(req.query),page=Math.max(1,Math.min(100000,Number(req.query.page)||1)),limit=50;const count=await db.query(`select count(*)::int as n from trainee_records ${f.sql}`,f.args);const r=await db.query(`select id,sheet_name,payload from trainee_records ${f.sql} order by id limit ${limit} offset $${f.args.length+1}`,[...f.args,(page-1)*limit]);res.json({total:count.rows[0].n,records:r.rows})}catch(e){next(e)}});
app.post('/api/export',async(req,res,next)=>{try{if(!['admin','exporter'].includes(req.role))return res.sendStatus(403);const ids=Array.isArray(req.body.ids)?req.body.ids.filter(x=>Number.isSafeInteger(x)&&x>0).slice(0,1000):[];if(!ids.length)return res.status(400).json({error:'حدد سجلات للتصدير (حتى 1000 سجل)'});const r=await db.query('select sheet_name,payload from trainee_records where id=any($1::bigint[]) order by id',[ids]);const wb=new ExcelJS.Workbook(),ws=wb.addWorksheet('البيانات المحددة');const keys=[...new Set(r.rows.flatMap(x=>Object.keys(x.payload)))];ws.addRow(['الورقة',...keys]);for(const row of r.rows){ws.addRow([row.sheet_name,...keys.map(k=>{const v=row.payload[k];if(v===null||v===undefined)return '';const s=String(v);return /^[=+\-@\t\r]/.test(s)?"'"+s:s})])}ws.views=[{rightToLeft:true}];res.setHeader('Content-Type','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');res.setHeader('Content-Disposition','attachment; filename="selected.xlsx"');await wb.xlsx.write(res);res.end()}catch(e){next(e)}});
app.use((err,req,res,next)=>{console.error(err);res.status(500).json({error:'حدث خطأ في الخادم'})});app.listen(process.env.PORT||3000);

// First administrator setup: server-only one-time secret; never expose it in public files.
