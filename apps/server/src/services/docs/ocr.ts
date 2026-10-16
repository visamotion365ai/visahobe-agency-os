/**
 * Optional local OCR.
 *
 * Tesseract.js is loaded lazily so the API still works when the language data
 * is unavailable (offline installs, restricted networks). Callers must handle
 * a thrown error and fall back to manual data entry.
 */
export interface OcrResult {
  text: string;
  confidence: number;
  engine: string;
}

export async function runOcr(buffer: Buffer, mime?: string | null): Promise<OcrResult> {
  let createWorker: any;
  try {
    ({ createWorker } = await import('tesseract.js'));
  } catch {
    throw new Error('OCR engine (tesseract.js) is not installed in this deployment');
  }
  const worker = await createWorker('eng');
  try {
    const { data } = await worker.recognize(buffer, {}, { text: true, blocks: true });
    return {
      text: data?.text ?? '',
      confidence: typeof data?.confidence === 'number' ? data.confidence : 0,
      engine: 'tesseract.js',
    };
  } finally {
    await worker.terminate?.().catch(() => undefined);
  }
}

export interface ExtractedFields {
  fullName?: string;
  passportNumber?: string;
  nationality?: string;
  dateOfBirth?: string;
  gender?: string;
  passportIssueDate?: string;
  passportExpiryDate?: string;
  confidence: 'low' | 'medium' | 'high';
}

function normaliseDate(raw: string): string | null {
  const digits = raw.replace(/\D/g, '');
  if (digits.length === 6) {
    // ddmmyy
    const dd = digits.slice(0, 2);
    const mm = digits.slice(2, 4);
    const yy = Number(digits.slice(4, 6));
    const year = yy > 40 ? 1900 + yy : 2000 + yy;
    return `${year}-${mm}-${dd}`;
  }
  if (digits.length === 8) {
    return `${digits.slice(0, 4)}-${digits.slice(4, 6)}-${digits.slice(6, 8)}`;
  }
  return null;
}

/**
 * Heuristic field extraction from OCR text. Every extracted value is a
 * suggestion: the UI always asks staff to confirm before it is saved.
 */
export function extractPassportFields(text: string): ExtractedFields {
  const out: ExtractedFields = { confidence: 'low' };
  if (!text) return out;
  const upper = text.toUpperCase();

  const passportMatch = upper.match(/\b([A-Z]{1,2}\d{6,9})\b/);
  if (passportMatch) {
    out.passportNumber = passportMatch[1];
    out.confidence = 'medium';
  }

  const label = (patterns: RegExp[]) => patterns.some((p) => p.test(text));

  const nameMatch = text.match(/(?:NAME|SURNAME|GIVEN NAMES?|FULL NAME)\s*[:\-]?\s*([A-Z][A-Z '\-]{3,60})/i);
  if (nameMatch) {
    out.fullName = nameMatch[1].replace(/\s+/g, ' ').trim();
    out.confidence = 'medium';
  }

  if (label([/\bNATIONALITY\b/i, /\bCITIZENSHIP\b/i])) {
    const nat = text.match(/NATIONALITY\s*[:\-]?\s*([A-Z]{3,30})/i);
    if (nat) out.nationality = nat[1].trim();
  }

  const dob = text.match(/(?:DATE OF BIRTH|DOB|BIRTH(?:DATE)?)\s*[:\-]?\s*([0-9]{2,4}[/.\-\s][0-9]{1,2}[/.\-\s][0-9]{2,4})/i);
  if (dob) {
    const value = normaliseDate(dob[1]);
    if (value) out.dateOfBirth = value;
  }

  const issue = text.match(/(?:DATE OF ISSUE|ISSUE(?:D)?(?: ON)?|ISSUED(?: ON)?)\s*[:\-]?\s*([0-9]{2,4}[/.\-\s][0-9]{1,2}[/.\-\s][0-9]{2,4})/i);
  if (issue) {
    const value = normaliseDate(issue[1]);
    if (value) out.passportIssueDate = value;
  }

  const expiry = text.match(/(?:DATE OF EXPIRY|EXPIRY(?: DATE)?|EXPIRES(?: ON)?|VALID UNTIL)\s*[:\-]?\s*([0-9]{2,4}[/.\-\s][0-9]{1,2}[/.\-\s][0-9]{2,4})/i);
  if (expiry) {
    const value = normaliseDate(expiry[1]);
    if (value) out.passportExpiryDate = value;
  }

  const sex = text.match(/\b(SEX|GENDER)\s*[:\-]?\s*([MFHX])/i);
  if (sex) out.gender = sex[2].toUpperCase() === 'M' ? 'male' : sex[2].toUpperCase() === 'F' ? 'female' : 'other';

  if (out.fullName && out.passportNumber) out.confidence = 'high';
  return out;
}
