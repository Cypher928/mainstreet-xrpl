'use strict';

// Generates realistic fixture PDFs for Phase 21 real-world validation:
//   reserve-agreement.pdf, hvac-invoice.pdf, roof-invoice.pdf, lien-waiver.pdf
// Run: node generate-pdfs.js

const PDFDocument = require('pdfkit');
const fs = require('fs');
const path = require('path');

const OUT = __dirname;

function newDoc(filename) {
  const doc = new PDFDocument({ size: 'LETTER', margin: 54 });
  doc.pipe(fs.createWriteStream(path.join(OUT, filename)));
  return doc;
}

function hr(doc, color = '#999999') {
  doc.moveTo(doc.page.margins.left, doc.y)
    .lineTo(doc.page.width - doc.page.margins.right, doc.y)
    .strokeColor(color).lineWidth(1).stroke();
  doc.moveDown(0.6);
}

// ── 1. Reserve & Escrow Agreement ────────────────────────────────────────
function buildReserveAgreement() {
  const doc = newDoc('reserve-agreement.pdf');

  doc.font('Times-Bold').fontSize(16).text('RESERVE AND ESCROW AGREEMENT', { align: 'center' });
  doc.moveDown(0.2);
  doc.font('Times-Roman').fontSize(10).fillColor('#555').text(
    'Lakeside Commercial Lending, LLC  ·  Loan No. LCL-2024-0871', { align: 'center' });
  doc.fillColor('#000').moveDown(1);

  doc.font('Times-Roman').fontSize(11).text(
    'This Reserve and Escrow Agreement (this "Agreement") is made and entered into as of January 15, 2025, ' +
    'by and between Lakeside Commercial Lending, LLC, a Delaware limited liability company ("Lender"), and ' +
    '4400 Riverside Partners LLC, a Texas limited liability company ("Borrower"), in connection with that ' +
    'certain loan in the original principal amount of $8,250,000.00 (the "Loan") made by Lender to Borrower ' +
    'and secured by, among other things, a deed of trust encumbering the real property commonly known as ' +
    '4400 Riverside Drive, Austin, Texas 78741 (the "Property").',
    { align: 'justify' }
  );
  doc.moveDown(1);

  doc.font('Times-Bold').fontSize(12).text('ARTICLE 3 — RESERVE ACCOUNTS');
  hr(doc);

  doc.font('Times-Bold').fontSize(11).text('3.1  Roof Reserve Account.', { continued: true });
  doc.font('Times-Roman').text(
    ' Concurrently with the closing of the Loan, Lender has established and shall maintain a Roof Reserve ' +
    'Account (the "Roof Reserve") with an initial balance of $75,000.00 as of the Closing Date. Funds held ' +
    'in the Roof Reserve may be used solely and exclusively for roof repair and roof replacement work at the ' +
    'Property, as more particularly described in the Property Condition Report dated December 2, 2024, ' +
    'prepared by Travis County Building Consultants, Inc.',
    { align: 'justify' }
  );
  doc.moveDown(0.5);
  doc.font('Times-Roman').text(
    'To request a disbursement from the Roof Reserve, Borrower shall submit to Lender, not less than ten ' +
    '(10) business days prior to the requested disbursement date: (a) paid or unpaid itemized contractor ' +
    'invoices describing the work performed or to be performed; (b) before-and-after photographs of the ' +
    'completed work, in each case clearly identifying the area of the Property affected; and (c) executed ' +
    'conditional or unconditional lien waivers, as applicable, from each contractor and subcontractor ' +
    'performing any portion of the work. No disbursement shall be made from the Roof Reserve in the absence ' +
    'of all three of the foregoing items.',
    { align: 'justify' }
  );
  doc.moveDown(0.8);

  doc.font('Times-Bold').text('3.2  HVAC Reserve Account.', { continued: true });
  doc.font('Times-Roman').text(
    ' Lender has established a separate HVAC Reserve Account (the "HVAC Reserve") with an initial balance ' +
    'of $40,000.00, to be used exclusively for the repair or replacement of heating, ventilation, and air ' +
    'conditioning equipment serving the Property. Each disbursement request shall be accompanied by itemized ' +
    'contractor invoices, and any single disbursement request exceeding $10,000.00 shall additionally require ' +
    'Borrower to submit competitive bids from no fewer than two (2) licensed HVAC contractors.',
    { align: 'justify' }
  );
  doc.moveDown(0.8);

  doc.font('Times-Bold').text('3.3  Capital Reserve Account.', { continued: true });
  doc.font('Times-Roman').text(
    ' Borrower shall fund and Lender shall maintain a Capital Reserve Account in the amount of $150,000.00 ' +
    'for general capital expenditures at the Property, subject to Lender\'s prior written approval, which ' +
    'approval shall not be unreasonably withheld. No minimum draw amount shall apply to disbursements from ' +
    'the Capital Reserve.',
    { align: 'justify' }
  );
  doc.moveDown(0.8);

  doc.font('Times-Bold').text('3.4  Draw Requests Generally.', { continued: true });
  doc.font('Times-Roman').text(
    ' All draw requests submitted under this Article 3 must be received by Lender no later than the ' +
    'fifteenth (15th) day of each calendar quarter. Lender shall have ten (10) business days following ' +
    'receipt of a complete draw request package to approve or reject such request in writing. No ' +
    'disbursement shall be released from any reserve account described in this Article 3 absent Lender\'s ' +
    'prior written approval.',
    { align: 'justify' }
  );

  doc.moveDown(1);
  doc.font('Helvetica-Bold').fontSize(9.5);
  const tableTop = doc.y;
  const cols = [54, 175, 270, 400];
  const headers = ['Reserve Account', 'Initial Balance', 'Eligible Use', 'Minimum Draw'];
  headers.forEach((h, i) => doc.text(h, cols[i], tableTop, { width: (cols[i + 1] || 540) - cols[i] - 4 }));
  doc.moveDown(0.4);
  hr(doc, '#444');
  doc.font('Helvetica').fontSize(9.5);
  const rows = [
    ['Roof Reserve', '$75,000.00', 'Roof repair and replacement', 'None specified'],
    ['HVAC Reserve', '$40,000.00', 'HVAC equipment repair/replacement', 'None specified'],
    ['Capital Reserve', '$150,000.00', 'General capital expenditures', 'None specified'],
  ];
  rows.forEach(r => {
    const y = doc.y;
    r.forEach((c, i) => doc.text(c, cols[i], y, { width: (cols[i + 1] || 540) - cols[i] - 4 }));
    doc.moveDown(0.6);
  });

  doc.addPage();
  doc.font('Times-Bold').fontSize(12).text('ARTICLE 4 — RESERVE EXPIRATION');
  hr(doc);
  doc.font('Times-Roman').fontSize(11).text(
    '4.1  Unless extended by Lender in writing, all reserve accounts described in Article 3 shall expire, ' +
    'and any unused balance shall be released to Borrower or applied to the outstanding principal balance ' +
    'of the Loan at Lender\'s election, on December 31, 2027.',
    { align: 'justify' }
  );
  doc.moveDown(0.8);
  doc.text(
    '4.2  Completion Deadline. All repair or capital improvement work funded from a reserve account ' +
    'established under this Agreement must be substantially completed within one hundred eighty (180) days ' +
    'of the date the related disbursement is approved by Lender.',
    { align: 'justify' }
  );
  doc.moveDown(0.8);
  doc.text(
    '4.3  This Agreement shall be governed by and construed in accordance with the laws of the State of ' +
    'Texas, without regard to conflicts of laws principles.',
    { align: 'justify' }
  );

  doc.moveDown(3);
  const sigY = doc.y;
  doc.moveTo(54, sigY).lineTo(280, sigY).stroke();
  doc.moveTo(320, sigY).lineTo(546, sigY).stroke();
  doc.fontSize(9.5).text('Borrower — 4400 Riverside Partners LLC', 54, sigY + 4, { width: 226 });
  doc.text('By: Marcus T. Whitfield, Managing Member', 54, sigY + 18, { width: 226 });
  doc.text('Lender — Lakeside Commercial Lending, LLC', 320, sigY + 4, { width: 226 });
  doc.text('By: Dana R. Ocampo, Senior Vice President', 320, sigY + 18, { width: 226 });

  doc.end();
}

// ── 2. HVAC Invoice ──────────────────────────────────────────────────────
function buildHvacInvoice() {
  const doc = newDoc('hvac-invoice.pdf');

  doc.fillColor('#1f5c8b').font('Helvetica-Bold').fontSize(17).text('Centerline Mechanical Services, Inc.');
  doc.fillColor('#555').font('Helvetica').fontSize(9).text(
    '4810 Industrial Loop · Austin, TX 78744 · (512) 555-0147 · TACLB#42117C');
  doc.fillColor('#000');
  doc.moveUp(2);
  doc.font('Helvetica-Bold').fontSize(16).text('INVOICE', { align: 'right' });
  doc.moveDown(0.5);
  doc.strokeColor('#1f5c8b').lineWidth(2)
    .moveTo(54, doc.y).lineTo(558, doc.y).stroke();
  doc.moveDown(1);

  const topY = doc.y;
  doc.font('Helvetica-Bold').fontSize(10).text('Bill To:', 54, topY);
  doc.font('Helvetica').text('4400 Riverside Partners LLC\n4400 Riverside Drive\nAustin, TX 78741\nAttn: Property Management', 54, doc.y);

  doc.font('Helvetica').fontSize(10).text(
    'Invoice #: CMS-20871\nInvoice Date: March 18, 2025\nDue Date: April 17, 2025\nJob Site: 4400 Riverside Drive, Austin, TX',
    320, topY, { width: 226, align: 'right' }
  );

  doc.moveDown(2);
  doc.font('Helvetica-Bold').fontSize(9.5);
  let y = doc.y;
  doc.rect(54, y, 504, 20).fill('#1f5c8b');
  doc.fillColor('#fff').text('Description', 60, y + 5, { width: 300 });
  doc.text('Qty', 360, y + 5, { width: 40, align: 'right' });
  doc.text('Unit Price', 400, y + 5, { width: 70, align: 'right' });
  doc.text('Amount', 470, y + 5, { width: 80, align: 'right' });
  doc.fillColor('#000');
  doc.y = y + 24;

  const items = [
    ['Replacement of failed 12.5-ton rooftop HVAC unit (Building B, RTU-4) — equipment, crane rental, and disposal of existing unit', '1', '$8,450.00', '$8,450.00'],
    ['Labor — removal of failed unit and installation of replacement unit (16 hrs @ $135/hr, 2 technicians)', '16', '$135.00', '$2,160.00'],
    ['New roof curb adapter and ductwork transition fittings', '1', '$610.00', '$610.00'],
    ['Refrigerant charge (R-410A, 18 lbs)', '18', '$28.00', '$504.00'],
    ['Electrical disconnect and re-terminate to existing 3-phase circuit', '1', '$385.00', '$385.00'],
    ['Post-installation startup, controls calibration, and 12-month parts/labor warranty registration', '1', '$0.00', '$0.00'],
  ];
  doc.font('Helvetica').fontSize(9.5);
  items.forEach(([desc, qty, price, amt]) => {
    const rowY = doc.y;
    doc.text(desc, 60, rowY, { width: 300 });
    const rowBottom = doc.y;
    doc.text(qty, 360, rowY, { width: 40, align: 'right' });
    doc.text(price, 400, rowY, { width: 70, align: 'right' });
    doc.text(amt, 470, rowY, { width: 80, align: 'right' });
    doc.y = Math.max(rowBottom, rowY + 14) + 4;
    doc.moveTo(54, doc.y - 2).lineTo(558, doc.y - 2).strokeColor('#ddd').lineWidth(0.5).stroke();
    doc.strokeColor('#000');
  });

  doc.moveDown(1);
  doc.font('Helvetica').fontSize(10.5);
  const totalsX = 380;
  doc.text('Subtotal', totalsX, doc.y, { width: 100 });
  doc.text('$12,109.00', totalsX + 90, doc.y - 12, { width: 88, align: 'right' });
  doc.moveDown(0.3);
  doc.text('Sales Tax (8.25%)', totalsX, doc.y, { width: 100 });
  doc.text('$998.99', totalsX + 90, doc.y - 12, { width: 88, align: 'right' });
  doc.moveDown(0.5);
  doc.moveTo(totalsX, doc.y).lineTo(558, doc.y).strokeColor('#1f5c8b').lineWidth(1.5).stroke();
  doc.moveDown(0.3);
  doc.font('Helvetica-Bold').fontSize(12.5);
  doc.text('Total Due', totalsX, doc.y, { width: 100 });
  doc.text('$13,107.99', totalsX + 90, doc.y - 14, { width: 88, align: 'right' });

  doc.moveDown(2);
  doc.font('Helvetica').fontSize(9).fillColor('#1f5c8b');
  doc.rect(54, doc.y, 504, 70).fillAndStroke('#f3f7fa', '#1f5c8b');
  doc.fillColor('#000').text(
    'Work performed under HVAC Reserve disbursement request submitted to Lakeside Commercial Lending, LLC. ' +
    'Two competing bids obtained per reserve account requirements (see attached bid comparison from ' +
    'Centerline Mechanical Services, Inc. and Hill Country Air Systems, LLC). Failed unit (RTU-4, S/N ' +
    'CTX-88841) removed and disposed of per EPA refrigerant recovery requirements. Before/after photographs ' +
    'provided separately.',
    64, doc.y - 64, { width: 484 }
  );

  doc.end();
}

// ── 3. Roof Invoice ──────────────────────────────────────────────────────
function buildRoofInvoice() {
  const doc = newDoc('roof-invoice.pdf');

  doc.fillColor('#8a4f1f').font('Helvetica-Bold').fontSize(17).text('Summit Roofing & Exteriors, LLC');
  doc.fillColor('#555').font('Helvetica').fontSize(9).text(
    '2210 Burleson Rd · Austin, TX 78741 · (512) 555-0298 · TX Roofing Lic. #RC-30471');
  doc.fillColor('#000');
  doc.moveUp(2);
  doc.font('Helvetica-Bold').fontSize(16).text('INVOICE', { align: 'right' });
  doc.moveDown(0.5);
  doc.strokeColor('#8a4f1f').lineWidth(2)
    .moveTo(54, doc.y).lineTo(558, doc.y).stroke();
  doc.moveDown(1);

  const topY = doc.y;
  doc.font('Helvetica-Bold').fontSize(10).text('Bill To:', 54, topY);
  doc.font('Helvetica').text('4400 Riverside Partners LLC\n4400 Riverside Drive\nAustin, TX 78741\nAttn: Property Management', 54, doc.y);

  doc.font('Helvetica').fontSize(10).text(
    'Invoice #: SRE-44209\nInvoice Date: February 26, 2025\nDue Date: March 28, 2025\nJob Site: 4400 Riverside Drive, Austin, TX',
    320, topY, { width: 226, align: 'right' }
  );

  doc.moveDown(2);
  doc.font('Helvetica-Bold').fontSize(9.5);
  let y = doc.y;
  doc.rect(54, y, 504, 20).fill('#8a4f1f');
  doc.fillColor('#fff').text('Description', 60, y + 5, { width: 290 });
  doc.text('Qty', 350, y + 5, { width: 50, align: 'right' });
  doc.text('Unit Price', 400, y + 5, { width: 70, align: 'right' });
  doc.text('Amount', 470, y + 5, { width: 80, align: 'right' });
  doc.fillColor('#000');
  doc.y = y + 24;

  const items = [
    ['Tear-off and removal of existing TPO membrane, Building A west wing (approx. 6,200 sq ft)', '6,200', '$1.85 / sf', '$11,470.00'],
    ['Replacement 60-mil TPO membrane, fully adhered, including fasteners and seam tape', '6,200', '$3.10 / sf', '$19,220.00'],
    ['Tapered insulation board to correct ponding water at northeast drain area', '1', '$4,850.00', '$4,850.00'],
    ['Replacement of (3) roof drains and associated flashing', '3', '$675.00', '$2,025.00'],
    ['Disposal and hauling of tear-off debris', '1', '$1,400.00', '$1,400.00'],
    ['15-year manufacturer NDL warranty registration (GAF EverGuard TPO)', '1', '$0.00', '$0.00'],
  ];
  doc.font('Helvetica').fontSize(9.5);
  items.forEach(([desc, qty, price, amt]) => {
    const rowY = doc.y;
    doc.text(desc, 60, rowY, { width: 290 });
    const rowBottom = doc.y;
    doc.text(qty, 350, rowY, { width: 50, align: 'right' });
    doc.text(price, 400, rowY, { width: 70, align: 'right' });
    doc.text(amt, 470, rowY, { width: 80, align: 'right' });
    doc.y = Math.max(rowBottom, rowY + 14) + 4;
    doc.moveTo(54, doc.y - 2).lineTo(558, doc.y - 2).strokeColor('#ddd').lineWidth(0.5).stroke();
    doc.strokeColor('#000');
  });

  doc.moveDown(1);
  doc.font('Helvetica').fontSize(10.5);
  const totalsX = 380;
  doc.text('Subtotal', totalsX, doc.y, { width: 100 });
  doc.text('$38,965.00', totalsX + 90, doc.y - 12, { width: 88, align: 'right' });
  doc.moveDown(0.3);
  doc.text('Sales Tax (8.25%)', totalsX, doc.y, { width: 100 });
  doc.text('$3,214.61', totalsX + 90, doc.y - 12, { width: 88, align: 'right' });
  doc.moveDown(0.5);
  doc.moveTo(totalsX, doc.y).lineTo(558, doc.y).strokeColor('#8a4f1f').lineWidth(1.5).stroke();
  doc.moveDown(0.3);
  doc.font('Helvetica-Bold').fontSize(12.5);
  doc.text('Total Due', totalsX, doc.y, { width: 100 });
  doc.text('$42,179.61', totalsX + 90, doc.y - 14, { width: 88, align: 'right' });

  doc.moveDown(2);
  doc.font('Helvetica').fontSize(9);
  doc.rect(54, doc.y, 504, 60).fillAndStroke('#faf3ec', '#8a4f1f');
  doc.fillColor('#000').text(
    'Work performed under Roof Reserve disbursement request submitted to Lakeside Commercial Lending, LLC, ' +
    'per the scope identified in the Property Condition Report dated December 2, 2024. Before-and-after ' +
    'photographs of the Building A west wing roof area provided separately. Conditional lien waiver from ' +
    'Summit Roofing & Exteriors, LLC attached.',
    64, doc.y - 54, { width: 484 }
  );

  doc.end();
}

// ── 4. Lien Waiver ───────────────────────────────────────────────────────
function buildLienWaiver() {
  const doc = newDoc('lien-waiver.pdf');

  doc.font('Times-Bold').fontSize(14).text('CONDITIONAL WAIVER AND RELEASE OF LIEN', { align: 'center' });
  doc.font('Times-Bold').fontSize(14).text('UPON PROGRESS PAYMENT', { align: 'center' });
  doc.moveDown(0.2);
  doc.font('Times-Roman').fontSize(10).fillColor('#555').text('Texas Property Code § 53.284', { align: 'center' });
  doc.fillColor('#000').moveDown(1.2);

  const fields = [
    ['Property Owner:', '4400 Riverside Partners LLC'],
    ['Property:', '4400 Riverside Drive, Austin, Texas 78741'],
    ['Claimant:', 'Summit Roofing & Exteriors, LLC'],
    ["Claimant's Customer:", '4400 Riverside Partners LLC'],
    ['Invoice / Application No.:', 'SRE-44209'],
    ['Through Date:', 'February 26, 2025'],
    ['Amount of Conditional Release:', '$42,179.61'],
  ];
  doc.font('Times-Roman').fontSize(11);
  fields.forEach(([label, val]) => {
    const y = doc.y;
    doc.font('Times-Bold').text(label, 54, y, { width: 200, continued: false });
    doc.font('Times-Roman').text(val, 270, y, { width: 280 });
    doc.moveTo(54, doc.y + 2).lineTo(550, doc.y + 2).strokeColor('#bbb').lineWidth(0.5).stroke();
    doc.strokeColor('#000');
    doc.moveDown(0.3);
  });

  doc.moveDown(1);
  doc.font('Times-Roman').fontSize(11).text(
    'Upon receipt by the undersigned of a check from 4400 Riverside Partners LLC in the above-referenced ' +
    'sum, payable to Summit Roofing & Exteriors, LLC, and when the check has been properly endorsed and has ' +
    'been paid by the bank upon which it is drawn, this document becomes effective to release any ' +
    "mechanic's lien, stop notice, or any right against a labor and material bond on the job described " +
    'above to the extent of the sum referenced above, and only to that extent. This document is effective ' +
    "only on the claimant's receipt of payment and the bank's payment of the above-referenced check.",
    { align: 'justify' }
  );
  doc.moveDown(0.8);
  doc.text(
    'This release covers a progress payment for labor, services, equipment, or materials furnished to the ' +
    'property through the date stated above and does not cover any retention withheld, any items furnished ' +
    'after that date, or any items furnished but not yet billed.',
    { align: 'justify' }
  );

  doc.moveDown(1.2);
  const noticeY = doc.y;
  doc.font('Times-Bold').fontSize(9.5);
  const noticeText = 'NOTICE: THIS DOCUMENT WAIVES RIGHTS UNCONDITIONALLY AND STATES THAT YOU HAVE BEEN PAID FOR ' +
    'GIVING UP THOSE RIGHTS. THIS DOCUMENT IS ENFORCEABLE AGAINST YOU IF YOU SIGN IT, EVEN IF YOU HAVE NOT ' +
    'BEEN PAID. IF YOU HAVE NOT BEEN PAID, USE A CONDITIONAL WAIVER AND RELEASE FORM.';
  const noticeHeight = doc.heightOfString(noticeText, { width: 468 }) + 20;
  doc.rect(54, noticeY, 504, noticeHeight).stroke();
  doc.text(noticeText, 64, noticeY + 10, { width: 484 });
  doc.font('Times-Roman').fontSize(11);
  doc.y = noticeY + noticeHeight + 30;

  const sigY = doc.y;
  doc.moveTo(54, sigY).lineTo(330, sigY).stroke();
  doc.fontSize(10).text("Claimant's Signature", 54, sigY + 4);
  doc.moveDown(1);
  doc.font('Times-Roman').fontSize(10).text(
    'Name: Robert J. Aldana     Title: President, Summit Roofing & Exteriors, LLC\nDate: March 4, 2025'
  );
  doc.moveDown(1.2);
  doc.font('Times-Roman').fontSize(9).fillColor('#555').text(
    'Company: Summit Roofing & Exteriors, LLC · 2210 Burleson Rd, Austin, TX 78741 · TX Roofing Lic. #RC-30471'
  );

  doc.end();
}

buildReserveAgreement();
buildHvacInvoice();
buildRoofInvoice();
buildLienWaiver();

console.log('Generated 4 PDFs in', OUT);
