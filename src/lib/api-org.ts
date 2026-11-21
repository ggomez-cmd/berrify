// Header the app sends on paid-provider API calls (/api/ocr,
// /api/invoice-extract) to name the organization the call is for. The worker
// checks the caller is an admin or manager of that organization.
export const ORG_ID_HEADER = "X-Berrify-Org-Id";
