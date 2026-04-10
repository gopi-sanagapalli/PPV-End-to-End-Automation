import * as XLSX from 'xlsx';

// =========================
// CONFIG (single source of truth)
// =========================
const FILE_PATH = 'data/PPV_Input.xlsx';

// =========================
// READ SHEET (COMMON)
// =========================
export const readSheet = (sheetName: string) => {
  const workbook = XLSX.readFile(FILE_PATH);
  const sheet = workbook.Sheets[sheetName];

  if (!sheet) {
    throw new Error(`❌ Sheet not found: ${sheetName}`);
  }

  const rawData: any[] = XLSX.utils.sheet_to_json(sheet);

  if (!rawData.length) {
    throw new Error(`❌ Sheet is empty: ${sheetName}`);
  }

  return rawData;
};

// =========================
// 🔹 LANDING DATA (Field → Expected)
// =========================
export const getLandingData = () => {
  const data = readSheet('Landing page');

  const result: Record<string, any> = {};

  data.forEach((row: any) => {
    const field = row.Field?.toString().trim();
    const value = row.Expected; // ✅ FIXED

    if (!field) {
      throw new Error(`❌ Missing 'Field' in Landing page row`);
    }

    result[field] = value;
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

  const variantData = data.filter(d => {
    if (!d.Variant) {
      throw new Error(`❌ Missing 'Variant' column in PPV page`);
    }
    return normalize(d.Variant) === normalize(variant);
  });

  if (!variantData.length) {
    throw new Error(`❌ No data found for variant: ${variant}`);
  }

  console.log('🧠 Variant:', variant);
  console.log('📊 FINAL DATA:', variantData.length);

  return variantData;
};