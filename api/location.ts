import type { Request, Response } from "express";

type LanguageMeta = {
  value: string;
  label: string;
  nativeLabel: string;
  googleCode: string;
};

const LANGUAGE_CATALOG: LanguageMeta[] = [
  { value: "en", label: "English", nativeLabel: "English", googleCode: "en" },
  { value: "hi", label: "Hindi", nativeLabel: "हिंदी", googleCode: "hi" },
  { value: "bn", label: "Bengali", nativeLabel: "বাংলা", googleCode: "bn" },
  { value: "ne", label: "Nepali", nativeLabel: "नेपाली", googleCode: "ne" },
  { value: "as", label: "Assamese", nativeLabel: "অসমীয়া", googleCode: "as" },
  { value: "gu", label: "Gujarati", nativeLabel: "ગુજરાતી", googleCode: "gu" },
  { value: "mr", label: "Marathi", nativeLabel: "मराठी", googleCode: "mr" },
  { value: "ta", label: "Tamil", nativeLabel: "தமிழ்", googleCode: "ta" },
  { value: "te", label: "Telugu", nativeLabel: "తెలుగు", googleCode: "te" },
  { value: "kn", label: "Kannada", nativeLabel: "ಕನ್ನಡ", googleCode: "kn" },
  { value: "ml", label: "Malayalam", nativeLabel: "മലയാളം", googleCode: "ml" },
  { value: "pa", label: "Punjabi", nativeLabel: "ਪੰਜਾਬੀ", googleCode: "pa" },
  { value: "or", label: "Odia", nativeLabel: "ଓଡ଼ିଆ", googleCode: "or" },
  { value: "pt", label: "Portuguese", nativeLabel: "Português", googleCode: "pt" },
  { value: "es", label: "Spanish", nativeLabel: "Español", googleCode: "es" },
  { value: "nl", label: "Dutch", nativeLabel: "Nederlands", googleCode: "nl" },
  { value: "fr", label: "French", nativeLabel: "Français", googleCode: "fr" },
  { value: "de", label: "German", nativeLabel: "Deutsch", googleCode: "de" },
  { value: "it", label: "Italian", nativeLabel: "Italiano", googleCode: "it" },
  { value: "ar", label: "Arabic", nativeLabel: "العربية", googleCode: "ar" },
  { value: "ja", label: "Japanese", nativeLabel: "日本語", googleCode: "ja" },
  { value: "ko", label: "Korean", nativeLabel: "한국어", googleCode: "ko" },
  { value: "zh", label: "Chinese", nativeLabel: "中文", googleCode: "zh-CN" },
  { value: "ru", label: "Russian", nativeLabel: "Русский", googleCode: "ru" },
  { value: "tr", label: "Turkish", nativeLabel: "Türkçe", googleCode: "tr" },
  { value: "pl", label: "Polish", nativeLabel: "Polski", googleCode: "pl" },
  { value: "uk", label: "Ukrainian", nativeLabel: "Українська", googleCode: "uk" },
  { value: "vi", label: "Vietnamese", nativeLabel: "Tiếng Việt", googleCode: "vi" },
  { value: "th", label: "Thai", nativeLabel: "ไทย", googleCode: "th" },
  { value: "id", label: "Indonesian", nativeLabel: "Bahasa Indonesia", googleCode: "id" },
  { value: "ms", label: "Malay", nativeLabel: "Bahasa Melayu", googleCode: "ms" },
  { value: "sv", label: "Swedish", nativeLabel: "Svenska", googleCode: "sv" },
  { value: "no", label: "Norwegian", nativeLabel: "Norsk", googleCode: "no" },
  { value: "da", label: "Danish", nativeLabel: "Dansk", googleCode: "da" },
  { value: "fi", label: "Finnish", nativeLabel: "Suomi", googleCode: "fi" },
  { value: "cs", label: "Czech", nativeLabel: "Čeština", googleCode: "cs" },
  { value: "hu", label: "Hungarian", nativeLabel: "Magyar", googleCode: "hu" },
  { value: "ro", label: "Romanian", nativeLabel: "Română", googleCode: "ro" },
  { value: "el", label: "Greek", nativeLabel: "Ελληνικά", googleCode: "el" },
  { value: "he", label: "Hebrew", nativeLabel: "עברית", googleCode: "iw" },
  { value: "fa", label: "Persian", nativeLabel: "فارسی", googleCode: "fa" },
];

const LANGUAGE_BY_CODE = new Map(LANGUAGE_CATALOG.map((item) => [item.value, item]));

const COUNTRY_LANGUAGE_MAP: Record<string, string[]> = {
  in: ["hi", "en"],
  np: ["ne", "en", "hi"],
  bd: ["bn", "en", "hi"],
  bt: ["ne", "en", "hi"],
  lk: ["ta", "en"],
  pk: ["hi", "en", "pa"],
  ae: ["ar", "en", "hi"],
  sa: ["ar", "en", "hi"],
  qa: ["ar", "en", "hi"],
  om: ["ar", "en", "hi"],
  kw: ["ar", "en", "hi"],
  bh: ["ar", "en", "hi"],
  pt: ["pt", "en", "es"],
  br: ["pt", "en", "es"],
  es: ["es", "en", "pt"],
  mx: ["es", "en"],
  ar: ["es", "en", "pt"],
  cl: ["es", "en"],
  co: ["es", "en"],
  pe: ["es", "en"],
  uy: ["es", "pt", "en"],
  py: ["es", "pt", "en"],
  fr: ["fr", "en", "de", "es"],
  be: ["nl", "fr", "de", "en"],
  ch: ["de", "fr", "it", "en"],
  de: ["de", "en", "fr", "nl"],
  at: ["de", "en", "it"],
  it: ["it", "en", "fr", "de"],
  nl: ["nl", "en", "de"],
  lu: ["fr", "de", "en"],
  ie: ["en"],
  gb: ["en"],
  us: ["en", "es"],
  ca: ["en", "fr"],
  au: ["en"],
  nz: ["en"],
  za: ["en"],
  jp: ["ja", "en"],
  kr: ["ko", "en"],
  cn: ["zh", "en"],
  tw: ["zh", "en"],
  hk: ["zh", "en"],
  sg: ["en", "zh", "ms", "ta"],
  my: ["ms", "en", "zh"],
  id: ["id", "en"],
  th: ["th", "en"],
  vn: ["vi", "en"],
  tr: ["tr", "en"],
  pl: ["pl", "en", "de"],
  ua: ["uk", "en", "ru"],
  ru: ["ru", "en"],
  se: ["sv", "en"],
  no: ["no", "en"],
  dk: ["da", "en"],
  fi: ["fi", "en", "sv"],
  cz: ["cs", "en", "de"],
  hu: ["hu", "en", "de"],
  ro: ["ro", "en"],
  gr: ["el", "en"],
  il: ["he", "en", "ar"],
  ir: ["fa", "en", "ar"],
};

const INDIA_STATE_LANGUAGE_MAP: Record<string, string[]> = {
  assam: ["as", "bn", "ne", "hi"],
  bihar: ["hi", "bn"],
  chandigarh: ["hi", "pa", "en"],
  chhattisgarh: ["hi", "mr"],
  delhi: ["hi", "en", "pa"],
  goa: ["en", "hi", "mr"],
  gujarat: ["gu", "hi", "en"],
  haryana: ["hi", "pa", "en"],
  "himachal pradesh": ["hi", "en", "pa"],
  "jammu and kashmir": ["hi", "en", "pa"],
  jharkhand: ["hi", "bn"],
  karnataka: ["kn", "en", "ta", "te"],
  kerala: ["ml", "en", "ta"],
  ladakh: ["hi", "en"],
  "madhya pradesh": ["hi", "mr"],
  maharashtra: ["mr", "hi", "en"],
  odisha: ["or", "hi", "en"],
  orissa: ["or", "hi", "en"],
  punjab: ["pa", "hi", "en"],
  rajasthan: ["hi", "en"],
  sikkim: ["ne", "bn", "hi", "en"],
  "tamil nadu": ["ta", "en", "ml", "te"],
  telangana: ["te", "en", "hi"],
  tripura: ["bn", "as", "hi", "en"],
  "uttar pradesh": ["hi", "en"],
  uttarakhand: ["hi", "en"],
  "west bengal": ["bn", "ne", "as", "hi", "en"],
};

const BORDER_LANGUAGE_HINTS: Array<{
  countryCode: string;
  match: string[];
  languages: string[];
}> = [
  { countryCode: "in", match: ["darjeeling", "kalimpong", "kurseong", "mirik", "jalpaiguri", "siliguri"], languages: ["ne", "bn", "hi"] },
  { countryCode: "in", match: ["meghalaya", "arunachal", "nagaland", "manipur", "mizoram"], languages: ["as", "bn", "ne", "hi"] },
  { countryCode: "pt", match: ["guarda", "castelo branco", "portalegre", "beja", "faro", "bragança"], languages: ["pt", "es", "en"] },
  { countryCode: "es", match: ["galicia", "castilla", "extremadura", "andaluc", "basque", "catalonia", "navarre", "aragon"], languages: ["es", "pt", "fr", "en"] },
  { countryCode: "nl", match: ["limburg", "brabant", "gelderland", "overijssel", "zeeland"], languages: ["nl", "de", "fr", "en"] },
  { countryCode: "be", match: ["flanders", "wallonia", "brussels"], languages: ["nl", "fr", "de", "en"] },
  { countryCode: "ch", match: ["ticino", "geneva", "vaud", "zurich", "bern"], languages: ["de", "fr", "it", "en"] },
];

const buildLanguageOptions = (...codes: Array<string | null | undefined>) =>
  Array.from(
    new Set(
      codes
        .map((code) => String(code || "").trim().toLowerCase())
        .filter((code) => LANGUAGE_BY_CODE.has(code))
    )
  );

const normalizeBrowserLanguage = (value: string | undefined) => {
  const normalized = String(value || "").trim().toLowerCase();
  if (!normalized) return "en";
  const exact = normalized.replace("_", "-");
  const base = exact.split("-")[0];
  if (LANGUAGE_BY_CODE.has(exact)) return exact;
  if (LANGUAGE_BY_CODE.has(base)) return base;
  if (exact.startsWith("zh")) return "zh";
  return LANGUAGE_BY_CODE.has(base) ? base : "en";
};

const getComponentLongName = (components: any[], type: string) =>
  String(components.find((component) => component.types?.includes(type))?.long_name || "").trim().toLowerCase();

const getComponentShortName = (components: any[], type: string) =>
  String(components.find((component) => component.types?.includes(type))?.short_name || "").trim().toLowerCase();

const buildAddressTokens = (parts: string[]) =>
  Array.from(
    new Set(
      parts
        .map((part) => String(part || "").trim().toLowerCase())
        .filter(Boolean)
    )
  );

const getBorderLanguages = (countryCode: string, tokens: string[]) =>
  BORDER_LANGUAGE_HINTS
    .filter((rule) => rule.countryCode === countryCode && rule.match.some((keyword) => tokens.some((token) => token.includes(keyword))))
    .flatMap((rule) => rule.languages);

const resolveLanguageContext = ({
  countryCode,
  country,
  adminArea1,
  adminArea2,
  locality,
  sublocality,
  browserLanguage,
}: {
  countryCode: string;
  country: string;
  adminArea1: string;
  adminArea2: string;
  locality: string;
  sublocality: string;
  browserLanguage: string;
}) => {
  const normalizedBrowser = normalizeBrowserLanguage(browserLanguage);
  const countryLanguages = COUNTRY_LANGUAGE_MAP[countryCode] || [];
  const indiaStateLanguages = countryCode === "in" ? INDIA_STATE_LANGUAGE_MAP[adminArea1] || [] : [];
  const genericIndiaRegionalLanguages =
    countryCode === "in" && !adminArea1 ? ["bn", "ne", "as"] : [];
  const borderLanguages = getBorderLanguages(
    countryCode,
    buildAddressTokens([country, adminArea1, adminArea2, locality, sublocality])
  );

  const regionalPriority =
    indiaStateLanguages[0] ||
    borderLanguages[0] ||
    countryLanguages.find((code) => code !== "en") ||
    normalizedBrowser ||
    "en";

  const options =
    countryCode === "in"
      ? buildLanguageOptions(
          regionalPriority,
          "en",
          "hi",
          ...indiaStateLanguages,
          ...genericIndiaRegionalLanguages,
          ...borderLanguages,
          ...countryLanguages
        )
      : buildLanguageOptions(
          regionalPriority,
          "en",
          ...borderLanguages,
          ...countryLanguages
        );

  const suggested =
    regionalPriority && regionalPriority !== "en"
      ? regionalPriority
      : countryCode === "in"
        ? indiaStateLanguages[0] || borderLanguages[0] || "hi"
        : countryLanguages.find((code) => code !== "en") || normalizedBrowser || "en";

  return {
    suggested: LANGUAGE_BY_CODE.has(suggested) ? suggested : "en",
    options,
  };
};

export default async function locationHandler(req: Request, res: Response) {
  const action = String(req.query.action || "language-context").trim().toLowerCase();

  if (action === "language-catalog") {
    res.status(200).json({
      ok: true,
      catalog: LANGUAGE_CATALOG,
    });
    return;
  }

  const lat = Number.parseFloat(String(req.query.lat || ""));
  const lng = Number.parseFloat(String(req.query.lng || req.query.lon || ""));
  const browserLanguage = String(req.query.browserLanguage || req.query.browser_language || "en");

  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    res.status(400).json({ ok: false, error: "Missing valid lat/lng" });
    return;
  }

  const googleMapsApiKey =
    String(process.env.GOOGLE_MAPS_API_KEY || process.env.VITE_GOOGLE_MAPS_API_KEY || "").trim();

  if (!googleMapsApiKey) {
    const fallback = resolveLanguageContext({
      countryCode: "",
      country: "",
      adminArea1: "",
      adminArea2: "",
      locality: "",
      sublocality: "",
      browserLanguage,
    });
    res.status(200).json({
      ok: true,
      source: "browser-fallback",
      ...fallback,
      catalog: LANGUAGE_CATALOG,
    });
    return;
  }

  try {
    const geocodeUrl = new URL("https://maps.googleapis.com/maps/api/geocode/json");
    geocodeUrl.searchParams.set("latlng", `${lat},${lng}`);
    geocodeUrl.searchParams.set("language", "en");
    geocodeUrl.searchParams.set("key", googleMapsApiKey);

    const response = await fetch(geocodeUrl.toString(), { method: "GET" });
    const payload = await response.json().catch(() => null);
    const result = payload?.results?.[0];
    const components = Array.isArray(result?.address_components) ? result.address_components : [];

    const countryCode = getComponentShortName(components, "country").toLowerCase();
    const country = getComponentLongName(components, "country");
    const adminArea1 = getComponentLongName(components, "administrative_area_level_1");
    const adminArea2 = getComponentLongName(components, "administrative_area_level_2");
    const locality =
      getComponentLongName(components, "locality") ||
      getComponentLongName(components, "postal_town");
    const sublocality =
      getComponentLongName(components, "sublocality") ||
      getComponentLongName(components, "neighborhood");

    const resolved = resolveLanguageContext({
      countryCode,
      country,
      adminArea1,
      adminArea2,
      locality,
      sublocality,
      browserLanguage,
    });

    res.status(200).json({
      ok: true,
      source: "google-geocode",
      countryCode,
      country,
      adminArea1,
      adminArea2,
      locality,
      sublocality,
      ...resolved,
      catalog: LANGUAGE_CATALOG,
    });
  } catch (error: any) {
    const fallback = resolveLanguageContext({
      countryCode: "",
      country: "",
      adminArea1: "",
      adminArea2: "",
      locality: "",
      sublocality: "",
      browserLanguage,
    });
    res.status(200).json({
      ok: true,
      source: "browser-fallback",
      error: String(error?.message || error || "Language resolution failed"),
      ...fallback,
      catalog: LANGUAGE_CATALOG,
    });
  }
}
