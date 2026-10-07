export const DELIVERY_COUNTRIES = "AD AE AF AG AI AL AM AO AQ AR AS AT AU AW AX AZ BA BB BD BE BF BG BH BI BJ BL BM BN BO BQ BR BS BT BV BW BY BZ CA CC CD CF CG CH CI CK CL CM CN CO CR CU CV CW CX CY CZ DE DJ DK DM DO DZ EC EE EG EH ER ES ET FI FJ FK FM FO FR GA GB GD GE GF GG GH GI GL GM GN GP GQ GR GS GT GU GW GY HK HM HN HR HT HU ID IE IL IM IN IO IQ IR IS IT JE JM JO JP KE KG KH KI KM KN KP KR KW KY KZ LA LB LC LI LK LR LS LT LU LV LY MA MC MD ME MF MG MH MK ML MM MN MO MP MQ MR MS MT MU MV MW MX MY MZ NA NC NE NF NG NI NL NO NP NR NU NZ OM PA PE PF PG PH PK PL PM PN PR PS PT PW PY QA RE RO RS RU RW SA SB SC SD SE SG SH SI SJ SK SL SM SN SO SR SS ST SV SX SY SZ TC TD TF TG TH TJ TK TL TM TN TO TR TT TV TW TZ UA UG UM US UY UZ VA VC VE VG VI VN VU WF WS YE YT ZA ZM ZW".split(" ");

export type ProductDelivery = {
  kind: "manual" | "physical";
  instructions: string;
  returns?: string;
  shippingCost?: number;
  countries?: string[];
};

export type DeliveryAddress = {
  line1: string;
  line2: string;
  city: string;
  region: string;
  postalCode: string;
  country: string;
};

export function productDeliveryError(delivery: ProductDelivery | undefined): string | null {
  if (!delivery) return null; // Existing products keep their current delivery workflow.
  if (delivery.kind !== "manual" && delivery.kind !== "physical") return "Choose a delivery method.";
  if (typeof delivery.instructions !== "string" || !delivery.instructions.trim() || delivery.instructions.length > 2000) return "Add delivery instructions and an expected delivery time (up to 2,000 characters).";
  if (delivery.kind === "physical") {
    if (typeof delivery.returns !== "string" || !delivery.returns.trim() || delivery.returns.length > 2000) return "Explain your returns and cancellation policy (up to 2,000 characters).";
    if (!Number.isSafeInteger(delivery.shippingCost) || delivery.shippingCost! < 0) return "Enter a shipping charge, or 0 for free shipping.";
    if (!Array.isArray(delivery.countries) || !delivery.countries.length || delivery.countries.length > 250 || delivery.countries.some(code => typeof code !== "string" || !DELIVERY_COUNTRIES.includes(code))) return "Choose the countries you deliver to.";
  }
  return null;
}

export function parseDeliveryAddress(value: unknown, countries: string[]): DeliveryAddress {
  const input = value && typeof value === "object" ? value as Record<string, unknown> : {};
  const field = (key: string, max = 200) => typeof input[key] === "string" ? input[key].trim().slice(0, max) : "";
  const address = { line1: field("line1"), line2: field("line2"), city: field("city"), region: field("region"), postalCode: field("postalCode", 32), country: field("country", 2).toUpperCase() };
  if (!address.line1 || !address.city || !countries.includes(address.country)) throw new Error("Enter a delivery address in a supported country.");
  return address;
}
