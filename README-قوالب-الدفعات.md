# ربط القوالب لجميع الدفعات

1. نفذي `documents-schema.sql` إذا لم تنفذيه من قبل، ثم نفذي `document-templates-registry.sql` في Supabase SQL Editor.
2. ارفعي `server.js` و`index.html` المحدثين إلى GitHub. احتفظي بمجلد `templates/` كما هو.
3. افتحي جدول `public.trainee_document_templates` من Table Editor. لكل شهادة أو خطاب جديد أضيفي صفًا بالقيم: `template_id` فريد، `batch_name` يطابق الدفعة، `document_kind` إما certificate أو letter، و`document_type` مثل attendance/pass/excellence/letter، و`label` و`image_path` مسار الصورة داخل GitHub Pages.
4. الدفعة الثالثة عشرة: مثال مسار `templates/batch-13/attendance.png` لا يعمل إلا إذا رفعتِ صورة بهذا الاسم والمسار. عدلي المسار حسب ملفك الحقيقي.
5. تحديث صفحة الشهادات أو البحث من جديد يسحب القوالب من قاعدة البيانات. لا حاجة إلى تعديل `document-templates.js` لإضافة دفعة جديدة.
6. تأكدي أن Render يستخدم اتصال قاعدة البيانات الذي يستطيع قراءة الجدول. لا تمنحي `anon` وصولًا مباشرًا للجدول.

**مهم:** هذا التحديث يضيف فهرس قوالب ديناميكيًا، ولا يرفع ملفات الصور بنفسه. إذا كانت صورة الدفعة 13 في GitHub باسم آخر فحددي مسارها الحقيقي في `image_path`.
