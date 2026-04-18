import * as XLSX from 'xlsx';

// =========================
// CONFIG
// =========================
const FILE_PATH = 'data/PPV_Input.xlsx';

// =========================
// READ SHEET
// =========================
export const readSheet = (sheetName: string) => {
  const workbook = XLSX.readFile(FILE_PATH);
  const sheet    = workbook.Sheets[sheetName];

  if (!sheet) {
    const available = workbook.SheetNames.join(', ');
    throw new Error(
      `❌ Sheet not found: "${sheetName}"\n` +
      `   Available sheets: ${available}`
    );
  }

  const rawData: any[] = XLSX.utils.sheet_to_json(sheet);

  if (!rawData.length) {
    throw new Error(`❌ Sheet is empty: "${sheetName}"`);
  }

  return rawData;
};

// =========================
// LANDING DATA
// =========================
export const getLandingData = () => {
  const data = readSheet('Landing page');

  const result: Record<string, any> = {};

  data.forEach((row: any) => {
    const field = row.Field?.toString().trim();
    const value = row.Expected;

    if (!field) {
      throw new Error(`❌ Missing 'Field' in Landing page row`);
    }

    result[field] = value;
  });

  console.log('📊 Landing Data:', result);
  return result;
};

// =========================
// PPV DATA BY VARIANT
// =========================
export const getPPVDataByVariant = (variant: string) => {
  const data = readSheet('PPV page');

  const normalize = (val: any) =>
    val?.toString().trim().toLowerCase();

  // Validate variant column exists
  if (data.length > 0 && !('Variant' in data[0])) {
    throw new Error(`❌ Missing 'Variant' column in PPV page sheet`);
  }

  const variantData = data.filter(
    (d: any) => normalize(d.Variant) === normalize(variant)
  );

  if (!variantData.length) {
    const available = [...new Set(data.map((d: any) => d.Variant))].join(', ');
    throw new Error(
      `❌ No data found for variant: "${variant}"\n` +
      `   Available variants: ${available}`
    );
  }

  console.log(`🧠 Variant: ${variant}`);
  console.log(`📊 FINAL DATA: ${variantData.length} rows`);

  return variantData;
};