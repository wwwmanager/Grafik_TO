// Parses an uploaded .xlsx/.xls workbook into normalized records.
// Real SheetJS parsing lands in the parser slice; this stub keeps the module
// boundary stable and side-effect free.
export function parseWorkbook() {
  return { rows: [], headers: [] };
}