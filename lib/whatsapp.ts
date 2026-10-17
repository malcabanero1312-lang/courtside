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

export function whatsappAppLink(phoneDigits: string | null, message: string): string {
  const params = new URLSearchParams();
  if (phoneDigits) params.set("phone", phoneDigits);
  params.set("text", message);
  return `whatsapp://send?${params.toString().replace(/\+/g, "%20")}`;
}

export function isPhoneDevice(): boolean {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent || "";
  const iPadOs = navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1;
  return /Android|iPhone|iPad|iPod/i.test(ua) || iPadOs;
}

export function openWhatsApp(phoneDigits: string | null, message: string): void {
  const web = phoneDigits ? whatsappLink(phoneDigits, message) : `https://wa.me/?text=${encodeURIComponent(message)}`;
  if (!isPhoneDevice()) {
    window.open(web, "_blank", "noopener,noreferrer");
    return;
  }
  let left = false;
  const onHide = () => {
    if (document.visibilityState === "hidden") left = true;
  };
  document.addEventListener("visibilitychange", onHide);
  window.location.href = whatsappAppLink(phoneDigits, message);
  window.setTimeout(() => {
    document.removeEventListener("visibilitychange", onHide);
    if (!left && document.visibilityState === "visible") {
      window.location.href = web;
    }
  }, 1600);
}
