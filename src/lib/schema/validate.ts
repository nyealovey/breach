import Ajv from 'ajv/dist/2020';
import addFormats from 'ajv-formats';

import canonicalV1Schema from './canonical-v1.schema.json';
import normalizedV1Schema from './normalized-v1.schema.json';

type Issue = { instancePath: string; message: string };

export type ValidationResult = { ok: true } | { ok: false; issues: Issue[] };

const ajv = new Ajv({ allErrors: true, strict: false });
addFormats(ajv);

const validateNormalized = ajv.compile(normalizedV1Schema);
const validateCanonical = ajv.compile(canonicalV1Schema);

function toIssues(errors: typeof validateNormalized.errors): Issue[] {
  if (!errors) return [];
  return errors.map((err) => ({
    instancePath: err.instancePath,
    message: err.message ?? 'invalid',
  }));
}

export function validateNormalizedV1(input: unknown): ValidationResult {
  const ok = validateNormalized(input);
  if (ok) return { ok: true };
  return { ok: false, issues: toIssues(validateNormalized.errors) };
}

export function validateCanonicalV1(input: unknown): ValidationResult {
  const ok = validateCanonical(input);
  if (ok) return { ok: true };
  return { ok: false, issues: toIssues(validateCanonical.errors) };
}
