const XLSX = require('xlsx');
const workbook = XLSX.readFile('data/Standalone_Input.xlsx');
console.log('Sheets:', workbook.SheetNames);
for (const name of workbook.SheetNames) {
  const sheet = workbook.Sheets[name];
  const data = XLSX.utils.sheet_to_json(sheet);
  console.log(`Sheet "${name}" rows:`, data.length);
  if (data.length > 0) {
    console.log('Columns:', Object.keys(data[0] || {}));
    console.log(JSON.stringify(data.slice(0, 3), null, 2));
  }
}
