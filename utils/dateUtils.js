"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.formatNextPaymentDate = formatNextPaymentDate;
exports.formatNextPaymentDateMonthly = formatNextPaymentDateMonthly;
exports.formatNextPaymentDateYearly = formatNextPaymentDateYearly;
exports.formatNextPaymentDateMonthlyUS = formatNextPaymentDateMonthlyUS;
exports.formatNextPaymentDateYearlyUS = formatNextPaymentDateYearlyUS;
exports.formatNextPaymentDateUS = formatNextPaymentDateUS;
exports.formatFlexFutureDate = formatFlexFutureDate;
exports.formatRenewalDate = formatRenewalDate;
exports.formatRenewalDateUS = formatRenewalDateUS;
function formatNextPaymentDate(daysOffset) {
    const date = new Date();
    date.setDate(date.getDate() + daysOffset);
    const dd = String(date.getDate()).padStart(2, '0');
    const mm = String(date.getMonth() + 1).padStart(2, '0');
    const yyyy = date.getFullYear();
    return `${dd}/${mm}/${yyyy}`;
}
// ✅ New helper — adds exactly 1 calendar month
function formatNextPaymentDateMonthly() {
    const date = new Date();
    date.setMonth(date.getMonth() + 1);
    const dd = String(date.getDate()).padStart(2, '0');
    const mm = String(date.getMonth() + 1).padStart(2, '0');
    const yyyy = date.getFullYear();
    return `${dd}/${mm}/${yyyy}`;
}
// ✅ New helper — adds exactly 1 calendar year
function formatNextPaymentDateYearly() {
    const date = new Date();
    date.setFullYear(date.getFullYear() + 1);
    const dd = String(date.getDate()).padStart(2, '0');
    const mm = String(date.getMonth() + 1).padStart(2, '0');
    const yyyy = date.getFullYear();
    return `${dd}/${mm}/${yyyy}`;
}
// ── US format MM.DD.YYYY ──────────────────────────────────────
// US monthly — 1 month from today in MM.DD.YYYY
function formatNextPaymentDateMonthlyUS() {
    const date = new Date();
    date.setMonth(date.getMonth() + 1);
    const dd = String(date.getDate()).padStart(2, '0');
    const mm = String(date.getMonth() + 1).padStart(2, '0');
    const yyyy = date.getFullYear();
    return `${mm}/${dd}/${yyyy}`;
}
// US yearly — 1 year from today in MM.DD.YYYY
function formatNextPaymentDateYearlyUS() {
    const date = new Date();
    date.setFullYear(date.getFullYear() + 1);
    const dd = String(date.getDate()).padStart(2, '0');
    const mm = String(date.getMonth() + 1).padStart(2, '0');
    const yyyy = date.getFullYear();
    return `${mm}/${dd}/${yyyy}`;
}
// US offset — N days from today in MM.DD.YYYY
function formatNextPaymentDateUS(daysOffset) {
    const date = new Date();
    date.setDate(date.getDate() + daysOffset);
    const dd = String(date.getDate()).padStart(2, '0');
    const mm = String(date.getMonth() + 1).padStart(2, '0');
    const yyyy = date.getFullYear();
    return `${mm}/${dd}/${yyyy}`;
}
// ── Flex Future Date — "In 7 days • 4 June 2026" ────────────
function formatFlexFutureDate(daysOffset = 7) {
    const date = new Date();
    date.setDate(date.getDate() + daysOffset);
    const day = date.getDate();
    const month = date.toLocaleString('en-GB', { month: 'long' });
    const year = date.getFullYear();
    return `In ${daysOffset} days • ${day} ${month} ${year}`;
}
// ✅ Renewal date helper — 1 year minus 1 day from today in DD/MM/YYYY
function formatRenewalDate() {
    const date = new Date();
    date.setFullYear(date.getFullYear() + 1);
    date.setDate(date.getDate() - 1);
    const dd = String(date.getDate()).padStart(2, '0');
    const mm = String(date.getMonth() + 1).padStart(2, '0');
    const yyyy = date.getFullYear();
    return `${dd}/${mm}/${yyyy}`;
}
// ✅ US renewal date helper — 1 year minus 1 day from today in MM/DD/YYYY
function formatRenewalDateUS() {
    const date = new Date();
    date.setFullYear(date.getFullYear() + 1);
    date.setDate(date.getDate() - 1);
    const dd = String(date.getDate()).padStart(2, '0');
    const mm = String(date.getMonth() + 1).padStart(2, '0');
    const yyyy = date.getFullYear();
    return `${mm}/${dd}/${yyyy}`;
}
