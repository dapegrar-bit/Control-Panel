import os,sys,json
import openpyxl,psycopg
from psycopg.types.json import Jsonb
if len(sys.argv)!=2:raise SystemExit('Usage: python import.py file.xlsx')
w=openpyxl.load_workbook(sys.argv[1],read_only=True,data_only=True)
with psycopg.connect(os.environ['DATABASE_URL']) as con:
 for sh in w:
  rows=sh.iter_rows(values_only=True); headers=[str(v).strip() if v is not None else f'عمود {i+1}' for i,v in enumerate(next(rows))]
  with con.cursor() as cur:
   for n,values in enumerate(rows,2):
    if not any(v is not None for v in values):continue
    data={k:(v.isoformat() if hasattr(v,'isoformat') else v) for k,v in zip(headers,values)}
    cur.execute('insert into trainee_records(sheet_name,row_number,payload) values (%s,%s,%s) on conflict(sheet_name,row_number) do update set payload=excluded.payload',(sh.title.strip(),n,Jsonb(data)))
  con.commit();print(sh.title,'imported')
