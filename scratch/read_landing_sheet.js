const XLSX = require('xlsx');
const workbook = XLSX.readFile('data/PPV_Input.xlsx');
const sheet = workbook.Sheets['Landing page'];
const data = XLSX.utils.sheet_to_json(sheet);
console.log('Total rows:', data.length);
console.log('All rows:');
console.log(JSON.stringify(data, null, 2));
