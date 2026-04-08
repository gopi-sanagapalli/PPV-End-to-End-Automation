import * as XLSX from 'xlsx';

// =========================
// READ SHEET (COMMON)
// =========================
export const readSheet = (sheetName: string) => {
  const workbook = XLSX.readFile('data/ppv-input.xlsx');
  const sheet = workbook.Sheets[sheetName];

  if (!sheet) {
    throw new Error(`❌ Sheet not found: ${sheetName}`);
  }

  const rawData: any[] = XLSX.utils.sheet_to_json(sheet);

  return rawData;
};



// =========================
// 🔹 LANDING DATA (Field → Value)
// =========================
export const getLandingData = () => {
  const data = readSheet('Landing page');

  const result: any = {};

  data.forEach((row: any) => {
    const field = row.Field?.toString().trim();
    const value = row.Value;

    if (field) {
      result[field] = value;
    }
  });

  console.log('📊 Landing Data:', result);

  return result;
};



// =========================
// 🔹 PPV DATA (Variant based)
// =========================
export const getPPVDataByVariant = (variant: string) => {
  const data = readSheet('PPV page');

  const normalize = (val: any) =>
    val?.toString().trim().toLowerCase();

  const variantData = data.filter(
    d => normalize(d.Variant) === normalize(variant)
  );

  const finalData = [...variantData];

  console.log('🧠 Variant:', variant);
  console.log('📊 FINAL DATA:', finalData.length);

  return finalData;
};