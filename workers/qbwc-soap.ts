import {
  deleteSession,
  findConnectionByUsername,
  insertSession,
  loadSession,
  newSessionTicket,
  patchConnection,
  sessionExpiryIso,
  setSessionError,
  verifyQbPassword,
  type QbwcConnectionRow,
  type QbwcRestEnv,
} from "./qbwc-auth";
import {
  ACCOUNT_QUERY_OPERATION,
  BILL_ADD_OPERATION,
  COMPANY_QUERY_OPERATION,
  VENDOR_QUERY_OPERATION,
  claimNextPendingJob,
  enqueueAccountQueryJob,
  enqueueCompanyQueryJob,
  enqueueVendorQueryJob,
  completeJob,
  failJob,
  markInvoiceQuickbooksBill,
  shouldEnqueueCompanyQuery,
} from "./qbwc-jobs";
import { upsertAccountsFromQuery } from "./qbwc-accounts";
import { upsertVendorsFromQuery } from "./qbwc-vendors";
import {
  parseAccountQueryRs,
  parseBillAddRs,
  parseCompanyQueryRs,
  parseHcpHostInfo,
  parseVendorQueryRs,
  xmlEscape,
  xmlText,
  xmlUnescape,
} from "./qbxml";

export const QBWC_SOAP_NS = "http://developer.intuit.com/";
export const SOAP_ENV_NS = "http://schemas.xmlsoap.org/soap/envelope/";
export const MAX_QBWC_BODY_BYTES = 1_000_000;
export const SERVER_VERSION = "1.0.0";

export type QbwcSoapMethod =
  | "serverVersion"
  | "clientVersion"
  | "authenticate"
  | "sendRequestXML"
  | "receiveResponseXML"
  | "connectionError"
  | "getLastError"
  | "closeConnection";

const METHODS: readonly QbwcSoapMethod[] = [
  "serverVersion",
  "clientVersion",
  "authenticate",
  "sendRequestXML",
  "receiveResponseXML",
  "connectionError",
  "getLastError",
  "closeConnection",
];

export type ParsedSoapCall = {
  method: QbwcSoapMethod;
  params: Record<string, string>;
};

export function soapEnvelope(inner: string): string {
  return [
    `<?xml version="1.0" encoding="utf-8"?>`,
    `<soap:Envelope xmlns:soap="${SOAP_ENV_NS}">`,
    `  <soap:Body>`,
    inner,
    `  </soap:Body>`,
    `</soap:Envelope>`,
  ].join("\n");
}

export function soapStringResult(method: QbwcSoapMethod, value: string): string {
  return soapEnvelope(
    [
      `    <${method}Response xmlns="${QBWC_SOAP_NS}">`,
      `      <${method}Result>${xmlEscape(value)}</${method}Result>`,
      `    </${method}Response>`,
    ].join("\n"),
  );
}

export function soapIntResult(method: "receiveResponseXML", value: number): string {
  return soapEnvelope(
    [
      `    <${method}Response xmlns="${QBWC_SOAP_NS}">`,
      `      <${method}Result>${value}</${method}Result>`,
      `    </${method}Response>`,
    ].join("\n"),
  );
}

export function soapStringArrayResult(method: "authenticate", values: string[]): string {
  const strings = values.map((value) => `        <string>${xmlEscape(value)}</string>`).join("\n");
  return soapEnvelope(
    [
      `    <${method}Response xmlns="${QBWC_SOAP_NS}">`,
      `      <${method}Result>`,
      strings,
      `      </${method}Result>`,
      `    </${method}Response>`,
    ].join("\n"),
  );
}

export function soapFault(message: string): string {
  return soapEnvelope(
    [
      `    <soap:Fault>`,
      `      <faultcode>soap:Client</faultcode>`,
      `      <faultstring>${xmlEscape(message)}</faultstring>`,
      `    </soap:Fault>`,
    ].join("\n"),
  );
}

export function soapXmlResponse(xml: string, status = 200): Response {
  return new Response(xml, {
    status,
    headers: {
      "Content-Type": "text/xml; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}

export function rejectOversizedOrUnsafeXml(body: string): string | null {
  if (body.length > MAX_QBWC_BODY_BYTES) return "Request too large";
  if (/<!DOCTYPE/i.test(body) || /<!ENTITY/i.test(body)) return "XML entities are not allowed";
  return null;
}

function localName(tag: string): string {
  const trimmed = tag.replace(/^\/+/, "");
  const colon = trimmed.lastIndexOf(":");
  return (colon >= 0 ? trimmed.slice(colon + 1) : trimmed).toLowerCase();
}

export function parseQbwcSoap(xml: string): ParsedSoapCall | { error: string } {
  const unsafe = rejectOversizedOrUnsafeXml(xml);
  if (unsafe) return { error: unsafe };

  const bodyMatch = /<([^>]*Body)[^>]*>([\s\S]*)<\/\1>/i.exec(xml);
  const body = bodyMatch?.[2] ?? xml;
  const methodMatch = /<([A-Za-z0-9:_-]+)([^>]*)>([\s\S]*?)<\/\1>/g;
  let found: ParsedSoapCall | null = null;
  let match: RegExpExecArray | null;
  while ((match = methodMatch.exec(body))) {
    const name = localName(match[1]);
    const method = METHODS.find((item) => item.toLowerCase() === name);
    if (!method) continue;
    const inner = match[3];
    const params: Record<string, string> = {};
    const paramRe = /<([A-Za-z0-9:_-]+)([^>]*)>([\s\S]*?)<\/\1>/g;
    let paramMatch: RegExpExecArray | null;
    while ((paramMatch = paramRe.exec(inner))) {
      params[localName(paramMatch[1])] = xmlUnescape(paramMatch[3].trim());
    }
    found = { method, params };
    break;
  }
  if (!found) return { error: "Unknown SOAP method" };
  return found;
}

function logSafe(event: string, extra: Record<string, string | number | boolean | null | undefined>): void {
  console.log(
    JSON.stringify({
      service: "qbwc",
      event,
      ...extra,
    }),
  );
}

function companyFileForAuth(connection: QbwcConnectionRow): string {
  return connection.company_file?.trim() ?? "";
}

function connectionMetaPatch(connection: QbwcConnectionRow, xml: string, versions?: { major?: string; minor?: string }) {
  const parsed = parseCompanyQueryRs(xml);
  const host = parseHcpHostInfo(xml);
  return {
    qb_company_name: parsed.companyName ?? host.companyName ?? connection.qb_company_name,
    qb_product_name: parsed.productName ?? host.productName ?? connection.qb_product_name,
    qb_major_version:
      parsed.majorVersion ?? host.majorVersion ?? versions?.major ?? connection.qb_major_version,
    qb_minor_version:
      parsed.minorVersion ?? host.minorVersion ?? versions?.minor ?? connection.qb_minor_version,
  };
}

export async function dispatchQbwcSoap(
  parsed: ParsedSoapCall,
  env: QbwcRestEnv,
  fetchImpl: typeof fetch,
): Promise<string> {
  switch (parsed.method) {
    case "serverVersion":
      return soapStringResult("serverVersion", SERVER_VERSION);
    case "clientVersion":
      return soapStringResult("clientVersion", "");
    case "authenticate":
      return handleAuthenticate(parsed.params, env, fetchImpl);
    case "sendRequestXML":
      return handleSendRequestXml(parsed.params, env, fetchImpl);
    case "receiveResponseXML":
      return handleReceiveResponseXml(parsed.params, env, fetchImpl);
    case "connectionError":
      return handleConnectionError(parsed.params, env, fetchImpl);
    case "getLastError":
      return handleGetLastError(parsed.params, env, fetchImpl);
    case "closeConnection":
      return handleCloseConnection(parsed.params, env, fetchImpl);
    default: {
      const exhaustive: never = parsed.method;
      return soapFault(`Unhandled method ${String(exhaustive)}`);
    }
  }
}

async function handleAuthenticate(
  params: Record<string, string>,
  env: QbwcRestEnv,
  fetchImpl: typeof fetch,
): Promise<string> {
  const username = params.strusername ?? params.username ?? "";
  const password = params.strpassword ?? params.password ?? "";
  const connection = await findConnectionByUsername(env, username, fetchImpl);
  if (!connection || !(await verifyQbPassword(password, connection.password_hash))) {
    logSafe("auth_fail", { username_present: Boolean(username) });
    return soapStringArrayResult("authenticate", ["nvu", ""]);
  }
  const ticket = newSessionTicket();
  const inserted = await insertSession(
    env,
    {
      ticket,
      connection_id: connection.id,
      org_id: connection.org_id,
      expires_at: sessionExpiryIso(),
      last_error: null,
    },
    fetchImpl,
  );
  if (!inserted) {
    logSafe("auth_fail", { reason: "session_insert" });
    return soapStringArrayResult("authenticate", ["nvu", ""]);
  }
  if (shouldEnqueueCompanyQuery(connection) || !connection.last_connected_at) {
    const queued = await enqueueCompanyQueryJob(env, connection, fetchImpl);
    logSafe("job_enqueue", { job_opcode: "company_query", connection_id: connection.id, result: queued });
  }
  logSafe("auth_ok", { ticket_id: ticket, connection_id: connection.id });
  return soapStringArrayResult("authenticate", [ticket, companyFileForAuth(connection)]);
}

async function handleSendRequestXml(
  params: Record<string, string>,
  env: QbwcRestEnv,
  fetchImpl: typeof fetch,
): Promise<string> {
  const ticket = params.ticket ?? "";
  const loaded = await loadSession(env, ticket, fetchImpl);
  if (!loaded) {
    logSafe("auth_fail", { reason: "bad_ticket", method: "sendRequestXML" });
    return soapStringResult("sendRequestXML", "");
  }
  const hcp = params.strhcpresponse ?? "";
  const major = params.qbxmlmajorvers ?? "";
  const minor = params.qbxmlminorvers ?? "";
  if (hcp) {
    const meta = connectionMetaPatch(loaded.connection, hcp, { major, minor });
    await patchConnection(
      env,
      loaded.connection.id,
      {
        ...meta,
        last_connected_at: new Date().toISOString(),
        last_error: null,
      },
      fetchImpl,
    );
  } else {
    await patchConnection(
      env,
      loaded.connection.id,
      {
        last_connected_at: new Date().toISOString(),
        qb_major_version: major || loaded.connection.qb_major_version,
        qb_minor_version: minor || loaded.connection.qb_minor_version,
      },
      fetchImpl,
    );
  }
  const job = await claimNextPendingJob(env, loaded.connection.id, fetchImpl);
  if (!job) {
    logSafe("send_request", { ticket_id: ticket, empty: true });
    return soapStringResult("sendRequestXML", "");
  }
  logSafe("send_request", { ticket_id: ticket, job_id: job.id, opcode: job.operation });
  return soapStringResult("sendRequestXML", job.qbxml_request ?? "");
}

async function handleReceiveResponseXml(
  params: Record<string, string>,
  env: QbwcRestEnv,
  fetchImpl: typeof fetch,
): Promise<string> {
  const ticket = params.ticket ?? "";
  const loaded = await loadSession(env, ticket, fetchImpl);
  if (!loaded) {
    logSafe("auth_fail", { reason: "bad_ticket", method: "receiveResponseXML" });
    return soapIntResult("receiveResponseXML", -1);
  }
  const hresult = params.hresult ?? "";
  const message = params.message ?? "";
  const responseXml = params.response ?? "";
  const job = await claimNextPendingJob(env, loaded.connection.id, fetchImpl);
  if (hresult) {
    if (job) {
      await failJob(env, job.id, { qbxml_response: responseXml, error_code: hresult, error_message: message }, fetchImpl);
    }
    await patchConnection(env, loaded.connection.id, { last_error: message || hresult }, fetchImpl);
    await setSessionError(env, ticket, message || hresult, fetchImpl);
    logSafe("job_fail", {
      ticket_id: ticket,
      job_id: job?.id ?? null,
      qb_status_code: hresult,
      qb_status_message: message,
    });
    return soapIntResult("receiveResponseXML", -1);
  }
  if (!job) {
    return soapIntResult("receiveResponseXML", 100);
  }
  if (job.operation === VENDOR_QUERY_OPERATION) {
    const parsed = parseVendorQueryRs(responseXml);
    const statusCode = parsed.statusCode;
    const statusMessage = parsed.statusMessage;
    if ((statusCode && statusCode !== "0") || !parsed.ok) {
      await failJob(
        env,
        job.id,
        { qbxml_response: responseXml, error_code: statusCode, error_message: statusMessage },
        fetchImpl,
      );
      await patchConnection(env, loaded.connection.id, { last_error: statusMessage || statusCode }, fetchImpl);
      await setSessionError(env, ticket, statusMessage || statusCode || "QuickBooks error", fetchImpl);
      logSafe("job_fail", {
        ticket_id: ticket,
        job_id: job.id,
        opcode: job.operation,
        qb_status_code: statusCode,
        qb_status_message: statusMessage,
      });
      return soapIntResult("receiveResponseXML", -1);
    }
    await upsertVendorsFromQuery(
      env,
      { orgId: loaded.connection.org_id, connectionId: loaded.connection.id, vendors: parsed.vendors },
      fetchImpl,
    );
    await completeJob(env, job.id, { qbxml_response: responseXml }, fetchImpl);
    await patchConnection(
      env,
      loaded.connection.id,
      {
        last_successful_sync_at: new Date().toISOString(),
        last_error: null,
      },
      fetchImpl,
    );
    logSafe("job_complete", {
      ticket_id: ticket,
      job_id: job.id,
      opcode: job.operation,
      vendor_count: parsed.vendors.length,
      qb_status_code: statusCode ?? "0",
      qb_status_message: statusMessage,
    });
    return soapIntResult("receiveResponseXML", 100);
  }
  if (job.operation === ACCOUNT_QUERY_OPERATION) {
    const parsed = parseAccountQueryRs(responseXml);
    const statusCode = parsed.statusCode;
    const statusMessage = parsed.statusMessage;
    if ((statusCode && statusCode !== "0") || !parsed.ok) {
      await failJob(
        env,
        job.id,
        { qbxml_response: responseXml, error_code: statusCode, error_message: statusMessage },
        fetchImpl,
      );
      await patchConnection(env, loaded.connection.id, { last_error: statusMessage || statusCode }, fetchImpl);
      await setSessionError(env, ticket, statusMessage || statusCode || "QuickBooks error", fetchImpl);
      logSafe("job_fail", {
        ticket_id: ticket,
        job_id: job.id,
        opcode: job.operation,
        qb_status_code: statusCode,
        qb_status_message: statusMessage,
      });
      return soapIntResult("receiveResponseXML", -1);
    }
    await upsertAccountsFromQuery(
      env,
      { orgId: loaded.connection.org_id, connectionId: loaded.connection.id, accounts: parsed.accounts },
      fetchImpl,
    );
    await completeJob(env, job.id, { qbxml_response: responseXml }, fetchImpl);
    await patchConnection(
      env,
      loaded.connection.id,
      {
        last_successful_sync_at: new Date().toISOString(),
        last_error: null,
      },
      fetchImpl,
    );
    logSafe("job_complete", {
      ticket_id: ticket,
      job_id: job.id,
      opcode: job.operation,
      account_count: parsed.accounts.length,
      qb_status_code: statusCode ?? "0",
      qb_status_message: statusMessage,
    });
    return soapIntResult("receiveResponseXML", 100);
  }
  if (job.operation === BILL_ADD_OPERATION) {
    const bill = parseBillAddRs(responseXml);
    if (!bill.ok || (bill.statusCode && bill.statusCode !== "0")) {
      await failJob(
        env,
        job.id,
        {
          qbxml_response: responseXml,
          error_code: bill.statusCode,
          error_message: bill.statusMessage,
        },
        fetchImpl,
      );
      await patchConnection(
        env,
        loaded.connection.id,
        { last_error: bill.statusMessage || bill.statusCode },
        fetchImpl,
      );
      await setSessionError(
        env,
        ticket,
        bill.statusMessage || bill.statusCode || "QuickBooks error",
        fetchImpl,
      );
      logSafe("job_fail", {
        ticket_id: ticket,
        job_id: job.id,
        opcode: job.operation,
        qb_status_code: bill.statusCode,
        qb_status_message: bill.statusMessage,
      });
      return soapIntResult("receiveResponseXML", -1);
    }
    await completeJob(
      env,
      job.id,
      {
        qbxml_response: responseXml,
        quickbooks_txn_id: bill.txnId,
        edit_sequence: bill.editSequence,
      },
      fetchImpl,
    );
    if (job.entity_type === "invoice") {
      await markInvoiceQuickbooksBill(
        env,
        job.entity_id,
        { quickbooks_txn_id: bill.txnId, quickbooks_edit_sequence: bill.editSequence },
        fetchImpl,
      );
    }
    await patchConnection(
      env,
      loaded.connection.id,
      {
        last_successful_sync_at: new Date().toISOString(),
        last_error: null,
      },
      fetchImpl,
    );
    logSafe("job_complete", {
      ticket_id: ticket,
      job_id: job.id,
      opcode: job.operation,
      qb_status_code: bill.statusCode ?? "0",
      qb_status_message: bill.statusMessage,
    });
    return soapIntResult("receiveResponseXML", 100);
  }
  if (job.operation !== COMPANY_QUERY_OPERATION) {
    await failJob(
      env,
      job.id,
      { qbxml_response: responseXml, error_code: "unsupported", error_message: `Unsupported operation ${job.operation}` },
      fetchImpl,
    );
    logSafe("job_fail", { ticket_id: ticket, job_id: job.id, opcode: job.operation, qb_status_code: "unsupported" });
    return soapIntResult("receiveResponseXML", -1);
  }
  const parsed = parseCompanyQueryRs(responseXml);
  const statusCode = parsed.statusCode;
  const statusMessage = parsed.statusMessage;
  if (statusCode && statusCode !== "0") {
    await failJob(
      env,
      job.id,
      { qbxml_response: responseXml, error_code: statusCode, error_message: statusMessage },
      fetchImpl,
    );
    await patchConnection(env, loaded.connection.id, { last_error: statusMessage || statusCode }, fetchImpl);
    await setSessionError(env, ticket, statusMessage || statusCode || "QuickBooks error", fetchImpl);
    logSafe("job_fail", {
      ticket_id: ticket,
      job_id: job.id,
      opcode: job.operation,
      qb_status_code: statusCode,
      qb_status_message: statusMessage,
    });
    return soapIntResult("receiveResponseXML", -1);
  }
  const txnId = xmlText(responseXml, "TxnID");
  const editSequence = xmlText(responseXml, "EditSequence");
  await completeJob(
    env,
    job.id,
    { qbxml_response: responseXml, quickbooks_txn_id: txnId, edit_sequence: editSequence },
    fetchImpl,
  );
  const meta = connectionMetaPatch(loaded.connection, responseXml);
  await patchConnection(
    env,
    loaded.connection.id,
    {
      ...meta,
      last_successful_sync_at: new Date().toISOString(),
      last_error: null,
    },
    fetchImpl,
  );
  const vendorQueued = await enqueueVendorQueryJob(env, loaded.connection, fetchImpl);
  const accountQueued = await enqueueAccountQueryJob(env, loaded.connection, fetchImpl);
  logSafe("job_complete", {
    ticket_id: ticket,
    job_id: job.id,
    opcode: job.operation,
    qb_status_code: statusCode ?? "0",
    qb_status_message: statusMessage,
    vendor_query: vendorQueued,
    account_query: accountQueued,
  });
  return soapIntResult("receiveResponseXML", 100);
}

async function handleConnectionError(
  params: Record<string, string>,
  env: QbwcRestEnv,
  fetchImpl: typeof fetch,
): Promise<string> {
  const ticket = params.ticket ?? "";
  const hresult = params.hresult ?? "";
  const message = params.message ?? "";
  const loaded = await loadSession(env, ticket, fetchImpl);
  const combined = [hresult, message].filter(Boolean).join(" ");
  if (loaded) {
    await patchConnection(env, loaded.connection.id, { last_error: combined || "connection error" }, fetchImpl);
    await setSessionError(env, ticket, combined || "connection error", fetchImpl);
  }
  logSafe("connection_error", {
    ticket_id: ticket || null,
    qb_status_code: hresult || null,
    qb_status_message: message || null,
  });
  return soapStringResult("connectionError", "done");
}

async function handleGetLastError(
  params: Record<string, string>,
  env: QbwcRestEnv,
  fetchImpl: typeof fetch,
): Promise<string> {
  const ticket = params.ticket ?? "";
  const loaded = await loadSession(env, ticket, fetchImpl);
  const message = loaded?.session.last_error || loaded?.connection.last_error || "";
  logSafe("get_last_error", { ticket_id: ticket || null });
  return soapStringResult("getLastError", message);
}

async function handleCloseConnection(
  params: Record<string, string>,
  env: QbwcRestEnv,
  fetchImpl: typeof fetch,
): Promise<string> {
  const ticket = params.ticket ?? "";
  await deleteSession(env, ticket, fetchImpl);
  logSafe("close_connection", { ticket_id: ticket || null });
  return soapStringResult("closeConnection", "OK");
}

export async function handleQbwcSoapPost(
  request: Request,
  env: QbwcRestEnv,
  fetchImpl: typeof fetch,
): Promise<Response> {
  const raw = await request.text();
  const parsed = parseQbwcSoap(raw);
  if ("error" in parsed) {
    logSafe("soap_reject", { reason: parsed.error });
    return soapXmlResponse(soapFault(parsed.error), parsed.error === "Request too large" ? 413 : 400);
  }
  const xml = await dispatchQbwcSoap(parsed, env, fetchImpl);
  return soapXmlResponse(xml);
}
