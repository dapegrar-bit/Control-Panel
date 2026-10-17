// ملف تعريف القوالب: عدّلي أسماء الدفعات ومسارات الصور وموضع الاسم فقط.
// ارفعي الصور إلى مجلد templates في GitHub. مقاس الصور الموصى به 3508×2480 (A4 أفقي) أو العكس للعمودي.
// batch يجب أن يطابق قيمة عمود «الدفعة» في بيانات Excel تمامًا.
// لا تضعي خطوطًا غير مرخصة في المستودع. إذا كانت لديك رخصة DIN Next LT Arabic، ضعي ملف WOFF2 في assets/fonts/din-next-lt-arabic.woff2.
export const DOCUMENT_TEMPLATES = [
  // مثال: استبدلي «الدفعة الأولى» بالاسم الفعلي في جدولك وارفعي الصور بالمسارات الموضحة.
  {id:'batch1-attendance',batch:'الدفعة الأولى',kind:'certificate',type:'attendance',label:'شهادة حضور — الدفعة الأولى',image:'templates/batch-1/attendance.svg',orientation:'landscape',name:{x:50,y:54,size:34,color:'#1F4E46',width:78}},
  {id:'batch1-pass',batch:'الدفعة الأولى',kind:'certificate',type:'pass',label:'شهادة اجتياز — الدفعة الأولى',image:'templates/batch-1/pass.svg',orientation:'landscape',name:{x:50,y:54,size:34,color:'#1F4E46',width:78}},
  {id:'batch1-excellence',batch:'الدفعة الأولى',kind:'certificate',type:'excellence',label:'شهادة اجتياز بتميز — الدفعة الأولى',image:'templates/batch-1/excellence.svg',orientation:'landscape',name:{x:50,y:54,size:34,color:'#1F4E46',width:78}},
  {id:'batch1-letter',batch:'الدفعة الأولى',kind:'letter',type:'letter',label:'خطاب — الدفعة الأولى',image:'templates/batch-1/letter.svg',orientation:'portrait',name:{x:50,y:40,size:26,color:'#000000',width:80}}
];
// x,y نسب مئوية من عرض/ارتفاع الصفحة؛ size حجم الخط بالنقاط؛ width أقصى عرض للاسم بالنسبة المئوية.
// لإضافة دفعة أخرى انسخي الأسطر الأربعة، وعدّلي id وbatch وlabel وimage وموضع الاسم.
// أنواع الشهادات: attendance / pass / excellence. نوع الخطاب: letter.
