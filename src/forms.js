// Staff forms filled in and signed in the clinic app (no paper).
// Each field is filled either by the issuer when the form is sent (by: 'issuer') or by the staff
// member (by: 'staff'). The form as issued is stored with the document, so later edits to these
// templates never change a form that was already sent or signed.
// Types: text, textarea, date, tel, email, select (options), check (single tick box), checks (several).

const CLINIC_PHONE_ORDER = 'Office Order HCPL/OO/2026/001 (Clinic Official Phone Policy)';

export const FORMS = {
  joining: {
    title: 'Employee joining form',
    intro: 'Please fill in your details for your employee file. Your manager has filled in the employment details.',
    sections: [
      { title: 'Employment (filled in by the clinic)', fields: [
        { k: 'designation', label: 'Designation', type: 'text', by: 'issuer' },
        { k: 'department', label: 'Department', type: 'text', by: 'issuer' },
        { k: 'joined_on', label: 'Date of joining', type: 'date', by: 'issuer' },
        { k: 'reports_to', label: 'Reports to', type: 'text', by: 'issuer' },
      ] },
      { title: 'Personal details', fields: [
        { k: 'full_name', label: 'Full name (as in ID)', type: 'text', req: true },
        { k: 'dob', label: 'Date of birth', type: 'date', req: true },
        { k: 'gender', label: 'Gender', type: 'select', options: ['Female', 'Male', 'Other'], req: true },
        { k: 'mobile', label: 'Mobile number', type: 'tel', req: true },
        { k: 'alt_mobile', label: 'Alternative mobile', type: 'tel' },
        { k: 'email', label: 'Personal email', type: 'email' },
        { k: 'blood_group', label: 'Blood group', type: 'select', options: ['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-', 'Not known'] },
        { k: 'perm_address', label: 'Permanent address', type: 'textarea', req: true },
        { k: 'curr_address', label: 'Current address (if different)', type: 'textarea' },
      ] },
      { title: 'Emergency contact', fields: [
        { k: 'em_name', label: 'Name', type: 'text', req: true },
        { k: 'em_relation', label: 'Relationship', type: 'text', req: true },
        { k: 'em_mobile', label: 'Mobile number', type: 'tel', req: true },
      ] },
      { title: 'Qualifications and experience', fields: [
        { k: 'qualification', label: 'Highest qualification', type: 'text', req: true },
        { k: 'registration', label: 'Professional registration number (e.g. Nursing / Dental Council), if any', type: 'text' },
        { k: 'prev_employer', label: 'Previous employer', type: 'text' },
        { k: 'experience', label: 'Total experience (years)', type: 'text' },
      ] },
    ],
    declaration: 'I declare that the information I have given is true and complete. I will tell the clinic in writing about any change. I understand that giving false information may lead to the end of my employment.',
  },
  bank_id: {
    title: 'Bank, ID and statutory details',
    intro: 'Your salary is paid into this account. Do not enter your full Aadhaar number here — give the office a copy if it is needed for PF or ESI.',
    sections: [
      { title: 'Salary account', fields: [
        { k: 'account_holder', label: 'Account holder name', type: 'text', req: true },
        { k: 'bank', label: 'Bank', type: 'text', req: true },
        { k: 'branch', label: 'Branch', type: 'text' },
        { k: 'account_no', label: 'Account number', type: 'text', req: true, pattern: '^[0-9]{6,20}$', hint: 'numbers only' },
        { k: 'account_no2', label: 'Account number again', type: 'text', req: true, same: 'account_no' },
        { k: 'ifsc', label: 'IFSC', type: 'text', req: true, pattern: '^[A-Za-z]{4}0[A-Za-z0-9]{6}$', hint: '11 characters, e.g. SBIN0070123', upper: true },
      ] },
      { title: 'ID and statutory numbers', fields: [
        { k: 'pan', label: 'PAN', type: 'text', pattern: '^[A-Za-z]{5}[0-9]{4}[A-Za-z]$', hint: 'e.g. ABCDE1234F', upper: true },
        { k: 'aadhaar_last4', label: 'Aadhaar — last 4 digits only', type: 'text', pattern: '^[0-9]{4}$' },
        { k: 'uan', label: 'PF UAN (if any)', type: 'text', pattern: '^[0-9]{12}$', hint: '12 digits' },
        { k: 'esi', label: 'ESI IP number (if any)', type: 'text' },
      ] },
    ],
    declaration: 'I confirm that this account is in my name and that the details are correct. I authorise HASWEL CARE Private Limited to pay my salary into this account. I will tell the office in writing before any change.',
  },
  confidentiality: {
    title: 'Confidentiality and patient privacy agreement',
    intro: 'Every member of the team handles patient and clinic information. Please read this agreement carefully.',
    clauses: [
      'Patient information — names, phone numbers, treatment, photographs, records and payments — is confidential. I will use it only to do my work at the clinic and will discuss it only with colleagues who need it for the patient\'s care.',
      'I will not photograph patients, their records or screens on my personal phone, and I will not send patient information through personal WhatsApp, social media or email. Clinical photographs are taken only on clinic devices and saved only in the clinic app.',
      'I will not post anything about patients, their treatment or before-and-after results on social media unless the clinic has the patient\'s written consent and the post is approved by the management.',
      'Clinic business information — prices, offers, supplier details, staff details, finances and the clinic\'s systems and passwords — is confidential. I will not share it outside the clinic.',
      'I will keep my login to the clinic apps to myself and log out of shared devices. I will report any loss of a device, a record or a password to the management at once.',
      'When I leave the clinic I will return all records, devices and materials, and these duties of confidentiality continue after I leave.',
      'I understand that breaking this agreement may lead to disciplinary action, including the end of my employment, and may also be unlawful under the Digital Personal Data Protection Act, 2023 and other laws.',
    ],
    sections: [],
    declaration: 'I have read and understood this agreement and I agree to keep to it during and after my employment.',
  },
  uniform_assets: {
    title: 'Uniform and equipment receipt',
    intro: 'Please check the items listed by the clinic and confirm you have received them.',
    sections: [
      { title: 'Items issued (filled in by the clinic)', fields: [
        { k: 'items', label: 'Items (one per line: item — quantity — notes)', type: 'textarea', by: 'issuer', req: true },
        { k: 'issued_on', label: 'Date issued', type: 'date', by: 'issuer', req: true },
      ] },
      { title: 'Received', fields: [
        { k: 'received_ok', label: 'I have received all the items listed above in good condition', type: 'check', req: true },
        { k: 'remarks', label: 'Remarks (anything missing or damaged)', type: 'textarea' },
      ] },
    ],
    declaration: 'These items remain the property of the clinic. I will look after them, use them only for my work, and return them when asked or when I leave. The clinic may recover the cost of items lost or damaged through my negligence.',
  },
  phone_handover: {
    title: 'Clinic official phone — handover',
    intro: `The clinic phone is handed over to you for clinic work only, under ${CLINIC_PHONE_ORDER}.`,
    sections: [
      { title: 'Phone (filled in by the clinic)', fields: [
        { k: 'model', label: 'Phone model', type: 'text', by: 'issuer', req: true },
        { k: 'imei', label: 'IMEI / serial number', type: 'text', by: 'issuer', req: true },
        { k: 'sim', label: 'SIM / mobile number', type: 'text', by: 'issuer' },
        { k: 'accessories', label: 'Accessories (charger, cover…)', type: 'text', by: 'issuer' },
        { k: 'condition', label: 'Condition at handover', type: 'text', by: 'issuer' },
        { k: 'handover_on', label: 'Handover date', type: 'date', by: 'issuer', req: true },
      ] },
      { title: 'Received', fields: [
        { k: 'received_ok', label: 'I have received the phone and accessories listed above in the condition described', type: 'check', req: true },
        { k: 'policy_read', label: `I have read ${CLINIC_PHONE_ORDER} and will follow it`, type: 'check', req: true },
        { k: 'remarks', label: 'Remarks', type: 'textarea' },
      ] },
    ],
    declaration: 'I will use the clinic phone only for clinic work, keep it in the clinic during my shift unless told otherwise, not install personal apps or use personal accounts on it, keep patient information on it confidential, and return it with its accessories at the end of my shift or when asked.',
  },
  exit: {
    title: 'Exit and clearance form',
    intro: 'Please complete this form before your last working day.',
    sections: [
      { title: 'Leaving details', fields: [
        { k: 'last_day', label: 'Last working day', type: 'date', req: true },
        { k: 'reason', label: 'Reason for leaving', type: 'select', options: ['Resignation', 'End of contract', 'Relocation', 'Higher studies', 'Health reasons', 'Other'], req: true },
        { k: 'reason_note', label: 'Anything you would like to add', type: 'textarea' },
      ] },
      { title: 'Clinic property returned', fields: [
        { k: 'returned', label: 'Tick everything you have returned', type: 'checks', options: ['Uniform', 'ID card', 'Keys', 'Clinic phone and accessories', 'Patient records / files', 'Stock, instruments or equipment', 'Nothing was issued to me'] },
        { k: 'handover', label: 'Work handed over (to whom, and what)', type: 'textarea', req: true },
      ] },
      { title: 'Contact after leaving', fields: [
        { k: 'fwd_address', label: 'Address for letters and documents', type: 'textarea', req: true },
        { k: 'fwd_phone', label: 'Mobile number', type: 'tel', req: true },
        { k: 'fwd_email', label: 'Email', type: 'email' },
      ] },
      { title: 'Feedback (optional)', fields: [
        { k: 'feedback', label: 'What could the clinic do better?', type: 'textarea' },
      ] },
    ],
    declaration: 'I confirm that I have returned all clinic property and handed over my work, and that I have not kept any patient or clinic information. I understand that my duty to keep patient and clinic information confidential continues after I leave.',
  },
};

export const FORM_LIST = Object.entries(FORMS).map(([k, f]) => ({ key: k, title: f.title }));
const fieldsOf = def => (def.sections || []).flatMap(s => s.fields);
const str = v => String(v == null ? '' : v).trim();

// Read and check the values for one side (issuer or staff). Returns [error, values].
export function readForm(def, input, side) {
  const out = {}, src = input && typeof input === 'object' ? input : {};
  for (const f of fieldsOf(def)) {
    if ((f.by || 'staff') !== side) continue;
    let v;
    if (f.type === 'check') v = src[f.k] === true || src[f.k] === 'on' || src[f.k] === 'true';
    else if (f.type === 'checks') v = (Array.isArray(src[f.k]) ? src[f.k] : []).map(str).filter(x => (f.options || []).includes(x));
    else v = str(src[f.k]).slice(0, f.type === 'textarea' ? 2000 : 200);
    if (f.upper) v = v.toUpperCase();
    const empty = f.type === 'check' ? !v : f.type === 'checks' ? !v.length : !v;
    if (f.req && empty) return [f.type === 'check' ? `Tick: ${f.label}` : `Fill in: ${f.label}`];
    if (!empty && f.type === 'date' && !/^\d{4}-\d{2}-\d{2}$/.test(v)) return [`${f.label}: enter a valid date.`];
    if (!empty && f.type === 'tel' && v.replace(/\D/g, '').length < 10) return [`${f.label}: enter a 10-digit mobile number.`];
    if (!empty && f.type === 'email' && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v)) return [`${f.label}: that email does not look right.`];
    if (!empty && f.type === 'select' && !(f.options || []).includes(v)) return [`${f.label}: choose from the list.`];
    if (!empty && f.pattern && !new RegExp(f.pattern).test(v)) return [`${f.label}: check the format${f.hint ? ` (${f.hint})` : ''}.`];
    if (f.same && v !== str(src[f.same])) return [`${f.label} does not match.`];
    out[f.k] = v;
  }
  return [null, out];
}

// Standard PDF fonts only cover Latin text; anything else (e.g. Malayalam) prints as '?'.
const safe = t => String(t).replace(/₹/g, 'Rs.').replace(/[^\x20-\x7E\xA0-\xFF–—‘’“”•…\n]/g, '?');
const show = (f, v) => safe( f.type === 'check' ? (v ? 'Yes' : 'No') : f.type === 'checks' ? ((v || []).join(', ') || '—') : (v == null || v === '' ? '—' : String(v)));

// Draw the completed form into a pdfKit document.
export function drawForm(k, def, prefill, values, title) {
  k.text(title || def.title, k.L, 15, k.bold); k.y -= 20;
  if (def.intro) { k.wrap(def.intro, 9, k.reg, k.L, k.W, 12); k.y -= 6; }
  if (def.clauses && def.clauses.length) {
    def.clauses.forEach((c, i) => { if (k.y < 90) k.newPage(); k.wrap(`${i + 1}. ${c}`, 9.5, k.reg, k.L, k.W, 13); k.y -= 4; });
    k.y -= 6;
  }
  for (const s of def.sections || []) {
    if (k.y < 120) k.newPage();
    k.text(s.title, k.L, 11, k.bold); k.y -= 16;
    for (const f of s.fields) {
      const v = (f.by || 'staff') === 'issuer' ? (prefill || {})[f.k] : (values || {})[f.k];
      if (k.y < 80) k.newPage();
      const y0 = k.y; k.wrap(f.label, 8.5, k.reg, k.L, 170, 11); const yL = k.y;
      k.y = y0; k.wrap(show(f, v), 9.5, k.bold, k.L + 185, k.W - 185, 13);
      k.y = Math.min(k.y, yL) - 5;
    }
    k.y -= 6;
  }
  if (def.declaration) { if (k.y < 110) k.newPage(); k.text('Declaration', k.L, 11, k.bold); k.y -= 15; k.wrap(def.declaration, 9.5, k.reg, k.L, k.W, 13); k.y -= 8; }
}
