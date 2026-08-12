import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';

export function exportPDF(filename: string, title: string, headers: string[], rows: string[][]) {
  const doc = new jsPDF();
  doc.setFontSize(14);
  doc.text(title, 14, 20);
  autoTable(doc, {
    head: [headers],
    body: rows,
    startY: 28,
    styles: { fontSize: 8 },
    headStyles: { fillColor: [60, 141, 188] },
  });
  doc.save(filename);
}
