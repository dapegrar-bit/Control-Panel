
/*
 * document-templates.js
 * سجل قوالب الشهادات والخطابات
 *
 * قوالب أصلية من الأرشيف.
 * صورة «نموذج إشعار القبول» ليست شهادة حضور،
 * ولذلك لم تُدرج كشهادة.
 *
 * أسماء الدفعات متوافقة مع بيانات المتدربين
 * في Supabase.
 */

export const DOCUMENT_TEMPLATES = [
  {
    id: "batch-8-pass",
    batch: "الثامنة",
    kind: "certificate",
    type: "pass",
    label: "شهادة اجتياز — الدفعة الثامنة",
    image: "templates/batch-8/pass.png",
    orientation: "landscape",
    name: {
      x: 50, y: 47, size: 32,
      color: "#1F4E46", width: 74
    }
  },
  {
    id: "batch-8-excellence",
    batch: "الثامنة",
    kind: "certificate",
    type: "excellence",
    label: "شهادة اجتياز بتميز — الدفعة الثامنة",
    image: "templates/batch-8/excellence.png",
    orientation: "landscape",
    name: {
      x: 50, y: 47, size: 32,
      color: "#1F4E46", width: 74
    }
  },
  {
    id: "batch-12-pass",
    batch: "الثانية عشر",
    kind: "certificate",
    type: "pass",
    label: "شهادة اجتياز — الدفعة الثانية عشرة",
    image: "templates/batch-12/pass.jpg",
    orientation: "landscape",
    name: {
      x: 50, y: 47, size: 32,
      color: "#1F4E46", width: 74
    }
  },
  {
    id: "batch-12-excellence",
    batch: "الثانية عشر",
    kind: "certificate",
    type: "excellence",
    label: "شهادة اجتياز بتميز — الدفعة الثانية عشرة",
    image: "templates/batch-12/excellence.jpg",
    orientation: "landscape",
    name: {
      x: 50, y: 47, size: 32,
      color: "#1F4E46", width: 74
    }
  },
  {
    id: "batch-12-attendance",
    batch: "الثانية عشر",
    kind: "certificate",
    type: "attendance",
    label: "شهادة حضور — الدفعة الثانية عشرة",
    image: "templates/batch-12/attendance.jpg",
    orientation: "landscape",
    name: {
      x: 50, y: 47, size: 32,
      color: "#1F4E46", width: 74
    }
  },
  {
    id: "batch-11-pass",
    batch: "الحادي عشر",
    kind: "certificate",
    type: "pass",
    label: "شهادة اجتياز — الدفعة الحادية عشرة",
    image: "templates/batch-11/pass.png",
    orientation: "landscape",
    name: {
      x: 50, y: 47, size: 32,
      color: "#1F4E46", width: 74
    }
  },
  {
    id: "batch-11-excellence",
    batch: "الحادي عشر",
    kind: "certificate",
    type: "excellence",
    label: "شهادة اجتياز بتميز — الدفعة الحادية عشرة",
    image: "templates/batch-11/excellence.png",
    orientation: "landscape",
    name: {
      x: 50, y: 47, size: 32,
      color: "#1F4E46", width: 74
    }
  },
  {
    id: "batch-11-attendance",
    batch: "الحادي عشر",
    kind: "certificate",
    type: "attendance",
    label: "شهادة حضور — الدفعة الحادية عشرة",
    image: "templates/batch-11/attendance.png",
    orientation: "landscape",
    name: {
      x: 50, y: 47, size: 32,
      color: "#1F4E46", width: 74
    }
  },
  {
    id: "batch-5-letter",
    batch: "الخامسة",
    kind: "letter",
    type: "letter",
    label: "خطاب — الدفعة الخامسة",
    image: "templates/batch-5/letter.png",
    orientation: "landscape",
    name: {
      x: 50, y: 51, size: 32,
      color: "#FFFFFF", width: 74
    }
  },
  {
    id: "batch-5-pass",
    batch: "الخامسة",
    kind: "certificate",
    type: "pass",
    label: "شهادة اجتياز — الدفعة الخامسة",
    image: "templates/batch-5/pass.png",
    orientation: "landscape",
    name: {
      x: 50, y: 47, size: 32,
      color: "#1F4E46", width: 74
    }
  },
  {
    id: "batch-5-excellence",
    batch: "الخامسة",
    kind: "certificate",
    type: "excellence",
    label: "شهادة اجتياز بتميز — الدفعة الخامسة",
    image: "templates/batch-5/excellence.png",
    orientation: "landscape",
    name: {
      x: 50, y: 47, size: 32,
      color: "#1F4E46", width: 74
    }
  },
  {
    id: "batch-7-letter",
    batch: "السابعة",
    kind: "letter",
    type: "letter",
    label: "خطاب — الدفعة السابعة",
    image: "templates/batch-7/letter.png",
    orientation: "landscape",
    name: {
      x: 50, y: 51, size: 32,
      color: "#FFFFFF", width: 74
    }
  },
  {
    id: "batch-7-pass",
    batch: "السابعة",
    kind: "certificate",
    type: "pass",
    label: "شهادة اجتياز — الدفعة السابعة",
    image: "templates/batch-7/pass.jpg",
    orientation: "landscape",
    name: {
      x: 50, y: 47, size: 32,
      color: "#1F4E46", width: 74
    }
  },
  {
    id: "batch-7-excellence",
    batch: "السابعة",
    kind: "certificate",
    type: "excellence",
    label: "شهادة اجتياز بتميز — الدفعة السابعة",
    image: "templates/batch-7/excellence.jpg",
    orientation: "landscape",
    name: {
      x: 50, y: 47, size: 32,
      color: "#1F4E46", width: 74
    }
  },
  {
    id: "batch-7-attendance",
    batch: "السابعة",
    kind: "certificate",
    type: "attendance",
    label: "شهادة حضور — الدفعة السابعة",
    image: "templates/batch-7/attendance.jpg",
    orientation: "landscape",
    name: {
      x: 50, y: 47, size: 32,
      color: "#1F4E46", width: 74
    }
  },
  {
    id: "batch-6-letter",
    batch: "السادسة",
    kind: "letter",
    type: "letter",
    label: "خطاب — الدفعة السادسة",
    image: "templates/batch-6/letter.png",
    orientation: "landscape",
    name: {
      x: 50, y: 51, size: 32,
      color: "#FFFFFF", width: 74
    }
  },
  {
    id: "batch-6-pass",
    batch: "السادسة",
    kind: "certificate",
    type: "pass",
    label: "شهادة اجتياز — الدفعة السادسة",
    image: "templates/batch-6/pass.png",
    orientation: "landscape",
    name: {
      x: 50, y: 47, size: 32,
      color: "#1F4E46", width: 74
    }
  },
  {
    id: "batch-6-excellence",
    batch: "السادسة",
    kind: "certificate",
    type: "excellence",
    label: "شهادة اجتياز بتميز — الدفعة السادسة",
    image: "templates/batch-6/excellence.png",
    orientation: "landscape",
    name: {
      x: 50, y: 47, size: 32,
      color: "#1F4E46", width: 74
    }
  },
  {
    id: "batch-10-pass",
    batch: "العاشرة",
    kind: "certificate",
    type: "pass",
    label: "شهادة اجتياز — الدفعة العاشرة",
    image: "templates/batch-10/pass.png",
    orientation: "landscape",
    name: {
      x: 50, y: 47, size: 32,
      color: "#1F4E46", width: 74
    }
  },
  {
    id: "batch-10-excellence",
    batch: "العاشرة",
    kind: "certificate",
    type: "excellence",
    label: "شهادة اجتياز بتميز — الدفعة العاشرة",
    image: "templates/batch-10/excellence.png",
    orientation: "landscape",
    name: {
      x: 50, y: 47, size: 32,
      color: "#1F4E46", width: 74
    }
  }
];

/*
 * توحيد أسماء الدفعات
 * يدعم الصيغة الكاملة والمختصرة
 */

const BATCH_NAME_MAP = {
  "الدفعة الخامسة": "الخامسة",
  "الدفعة السادسة": "السادسة",
  "الدفعة السابعة": "السابعة",
  "الدفعة الثامنة": "الثامنة",
  "الدفعة التاسعة": "التاسعة",
  "الدفعة العاشرة": "العاشرة",
  "الدفعة الحادية عشرة": "الحادي عشر",
  "الدفعة الحادي عشر": "الحادي عشر",
  "الحادية عشرة": "الحادي عشر",
  "الدفعة الثانية عشرة": "الثانية عشر",
  "الثانية عشرة": "الثانية عشر",
  "الدفعة الثالثة عشرة": "الثالثة عشر",
  "الثالثة عشرة": "الثالثة عشر"
};

export function normalizeBatchName(value) {
  const normalized = String(value ?? "")
    .normalize("NFKC")
    .replace(/\u0640/g, "")
    .replace(/\s+/g, " ")
    .trim();

  return BATCH_NAME_MAP[normalized] ?? normalized;
}

/*
 * جلب القوالب الخاصة بدفعة معينة
 */

export function getTemplatesForBatch(batchName) {
  const targetBatch = normalizeBatchName(batchName);

  if (!targetBatch) return [];

  return DOCUMENT_TEMPLATES.filter(template => {
    return normalizeBatchName(template.batch) === targetBatch;
  });
}

/*
 * جلب الشهادات فقط
 */

export function getCertificatesForBatch(batchName) {
  return getTemplatesForBatch(batchName).filter(
    template => template.kind === "certificate"
  );
}

/*
 * جلب الخطابات فقط
 */

export function getLettersForBatch(batchName) {
  return getTemplatesForBatch(batchName).filter(
    template => template.kind === "letter"
  );
}
