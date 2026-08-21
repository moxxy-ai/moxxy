/**
 * Field labels the rest of the accessibility layer has to recognise.
 *
 * Kept apart from the code that uses them because two places need the same
 * vocabulary — the redactor, which must never let a credential through, and the
 * wall detector, which must never let the agent try to fill one — and a security
 * regex with two copies is a security regex with two behaviours.
 */

/**
 * Labels whose value must never reach the model, and whose presence means the
 * page is asking for a credential.
 *
 * Deliberately broad and multi-lingual: over-matching costs a round trip where
 * the model has to ask, under-matching puts a credential in the transcript, the
 * event log and everything downstream of them.
 */
export const SECRET_LABEL =
  /(pass|hasł|hasl|passw|senha|contrase|kennwort|secret|token|otp|2fa|mfa|\bpin\b|cvv|cvc|security code|kod sms|verification code)/i;

/** A value already rendered as bullets is a masked input whatever its label. */
export const MASKED_VALUE = /^[•*·●]{3,}$/;
