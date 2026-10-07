import { getDatabase } from '@netlify/database';

type QueryResult = { rows: Record<string, unknown>[]; rowCount: number | null };
type Executor = { query: (sql: string, values?: unknown[]) => Promise<QueryResult> };
let driver: ReturnType<typeof getDatabase> | undefined;
function database() { return driver ??= getDatabase(); }

export async function inTransaction<T>(operation: (client: Executor) => Promise<T>) {
  const client = await database().pool.connect();
  try {
    await client.query('BEGIN');
    const result = await operation(client as Executor);
    await client.query('COMMIT');
    return result;
  } catch (error) { await client.query('ROLLBACK'); throw error; }
  finally { client.release(); }
}

// Existing application statements use positional ? parameters. Never interpolate values.
export function postgresSql(sql: string) {
  let result = '', index = 0, quote = '';
  for (let i = 0; i < sql.length; i++) {
    const c = sql[i];
    if (quote) {
      result += c;
      if (c === quote) { if (sql[i + 1] === quote) result += sql[++i]; else quote = ''; }
    } else if (c === "'" || c === '"') { quote = c; result += c; }
    else result += c === '?' ? `$${++index}` : c;
  }
  return result;
}
export class PreparedStatement {
  constructor(readonly sql: string, readonly values: unknown[] = []) {}
  bind(...values: unknown[]) { return new PreparedStatement(this.sql, values.map(v => v === undefined ? null : v)); }
  async execute(client: Executor = database().pool as Executor) { return client.query(postgresSql(this.sql), this.values); }
  async first<T = Record<string, unknown>>() { return (await this.execute()).rows[0] as T | undefined ?? null; }
  async all<T = Record<string, unknown>>() { return { results: (await this.execute()).rows as T[] }; }
  async run() { const result = await this.execute(); return { meta: { changes: result.rowCount ?? 0 } }; }
}
export function db() {
  return {
    prepare: (sql: string) => new PreparedStatement(sql),
    async batch(statements: PreparedStatement[]) {
      if (!statements.length) return [];
      const client = await database().pool.connect();
      try {
        await client.query('BEGIN');
        const results = [];
        for (const statement of statements) {
          const result = await statement.execute(client as Executor);
          results.push({ meta: { changes: result.rowCount ?? 0 } });
        }
        await client.query('COMMIT');
        return results;
      } catch (error) { await client.query('ROLLBACK'); throw error; }
      finally { client.release(); }
    },
  };
}
