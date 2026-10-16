export function normalizePhone(input: string | null | undefined, defaultCountryCode: string): string | null {
  if (!input) return null;
  const trimmed = input.trim();
  if (!trimmed) return null;
  let digits = trimmed.replace(/\D/g, "");
  if (!digits) return null;
  if (trimmed.startsWith("+")) {
    return digits.length >= 8 && digits.length <= 15 ? digits : null;
  }
  if (digits.startsWith("00")) {
    digits = digits.slice(2);
  } else if (digits.startsWith("0")) {
    digits = defaultCountryCode + digits.replace(/^0+/, "");
  } else if (!digits.startsWith(defaultCountryCode) && digits.length <= 10) {
    digits = defaultCountryCode + digits;
  }
  return digits.length >= 8 && digits.length <= 15 ? digits : null;
}

export function whatsappLink(phoneDigits: string, message: string): string {
  return `https://wa.me/${phoneDigits}?text=${encodeURIComponent(message)}`;
}
