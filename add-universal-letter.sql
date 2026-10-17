-- نفّذي هذا الملف بعد documents-schema.sql و document-templates-registry.sql.
-- يضيف خطاب إفادة عامًا لكل الدفعات دون تغيير القوالب أو السجلات السابقة.
INSERT INTO public.trainee_document_templates
(template_id,batch_name,document_kind,document_type,label,image_path,orientation,name_settings,enabled)
VALUES ('all-batches-letter','جميع الدفعات','letter','letter','خطاب إفادة — لجميع الدفعات',
 'templates/general/letter.svg','landscape',
 '{"x":50,"y":54,"size":36,"color":"#1F4E46","width":74}'::jsonb,true)
ON CONFLICT (template_id) DO UPDATE SET
 batch_name=EXCLUDED.batch_name, document_kind=EXCLUDED.document_kind,
 document_type=EXCLUDED.document_type, label=EXCLUDED.label,
 image_path=EXCLUDED.image_path, orientation=EXCLUDED.orientation,
 name_settings=EXCLUDED.name_settings, enabled=true;
