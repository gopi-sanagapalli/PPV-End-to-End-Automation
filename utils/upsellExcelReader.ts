import * as XLSX from 'xlsx';
import * as path from 'path';

const FILE_PATH = path.resolve(process.cwd(), 'data/Upsell_Input.xlsx');

export const readUpsellSheet = (sheetName: string) => {
  const workbook = XLSX.readFile(FILE_PATH);
  
  let targetSheetName = sheetName;
  if (!workbook.Sheets[targetSheetName]) {
    // If sheet not found directly, look for any sheet matching the name pattern dynamically
    if (sheetName.toLowerCase().includes('payment')) {
      const found = workbook.SheetNames.find(
        name => name.toLowerCase().includes('payment') && name.toLowerCase() !== 'payment page'
      );
      if (found) targetSheetName = found;
    }
  }

  const sheet = workbook.Sheets[targetSheetName];

  if (!sheet) {
    const available = workbook.SheetNames.join(', ');
    throw new Error(
      `❌ Sheet not found: "${sheetName}" (resolved as "${targetSheetName}") in ${FILE_PATH}\n` +
      `   Available sheets: ${available}`
    );
  }

  const rawData: any[] = XLSX.utils.sheet_to_json(sheet);
  return rawData;
};

