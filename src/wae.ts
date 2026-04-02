export interface WaeResult {
  meta: { name: string; type: string }[];
  data: Record<string, unknown>[];
  rows: number;
}

export async function queryWae(
  accountId: string,
  apiToken: string,
  sql: string,
): Promise<WaeResult> {
  const url = `https://api.cloudflare.com/client/v4/accounts/${accountId}/analytics_engine/sql`;
  const resp = await fetch(url, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiToken}` },
    body: sql,
  });

  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`WAE query failed (${resp.status}): ${text}`);
  }

  return (await resp.json()) as WaeResult;
}
