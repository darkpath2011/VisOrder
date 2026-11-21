/**
 * api.ts exposes a small table CRUD facade over the Supabase Data API.
 * Callers pass a public-schema table name and plain row objects; helpers unwrap
 * PostgREST errors into thrown Errors so UI code can await without checking
 * `{ data, error }` on every call. Pass an optional client when calling from
 * the server so Auth cookies and RLS still apply to the same helpers.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { createSupabaseBrowserClient } from "./client";

/** Filter equates listed columns to exact values in a PostgREST `.eq` chain. */
export type RowFilter = Record<string, string | number | boolean | null>;

/** ListQuery controls ordering and pagination for list/select helpers. */
export type ListQuery = {
  /** Column equality filters applied before ordering. */
  filter?: RowFilter;
  /** Column name used by `.order`; defaults to created_at when present. */
  orderBy?: string;
  /** When true, sort ascending; default is descending for newest-first lists. */
  ascending?: boolean;
  /** Maximum rows returned; omit for PostgREST default page size. */
  limit?: number;
};

/**
 * resolveClient returns the injected client or a browser client as the default.
 * Server callers should pass createSupabaseServerClient() so cookies stay attached.
 */
function resolveClient(client?: SupabaseClient): SupabaseClient {
  return client ?? createSupabaseBrowserClient();
}

/**
 * applyFilter chains `.eq` for each filter entry onto a Supabase query builder.
 * Null values use `.is(column, null)` because PostgREST treats eq-null differently.
 */
function applyFilter<T extends { eq: Function; is: Function }>(
  query: T,
  filter?: RowFilter,
): T {
  if (!filter) {
    return query;
  }
  let next = query;
  for (const [column, value] of Object.entries(filter)) {
    if (value === null) {
      next = next.is(column, null) as T;
    } else {
      next = next.eq(column, value) as T;
    }
  }
  return next;
}

/**
 * throwOnError converts a failed Supabase response into a thrown Error.
 * Successful calls return data unchanged, including an empty list or null row.
 */
function throwOnError<T>(
  data: T,
  error: { message: string } | null,
  action: string,
  table: string,
): T {
  if (error) {
    throw new Error(`Supabase ${action} on "${table}" failed: ${error.message}`);
  }
  return data;
}

/**
 * insertRow inserts one row and returns the inserted record including defaults.
 * Requires SELECT privilege on the table so `.select().single()` can round-trip.
 */
export async function insertRow<T extends Record<string, unknown>>(
  table: string,
  row: Record<string, unknown>,
  client?: SupabaseClient,
): Promise<T> {
  const { data, error } = await resolveClient(client)
    .from(table)
    .insert(row)
    .select()
    .single();
  return throwOnError(data as T, error, "insert", table);
}

/**
 * insertRows inserts many rows and returns the inserted records in order.
 * Prefer this over looping insertRow when writing a batch in one round trip.
 */
export async function insertRows<T extends Record<string, unknown>>(
  table: string,
  rows: Record<string, unknown>[],
  client?: SupabaseClient,
): Promise<T[]> {
  const { data, error } = await resolveClient(client)
    .from(table)
    .insert(rows)
    .select();
  return throwOnError((data ?? []) as T[], error, "insert", table);
}

/**
 * upsertRows inserts or updates rows matched by conflict columns and returns them.
 * Pass onConflict as a comma-separated unique column list expected by PostgREST.
 */
export async function upsertRows<T extends Record<string, unknown>>(
  table: string,
  rows: Record<string, unknown>[],
  onConflict: string,
  client?: SupabaseClient,
): Promise<T[]> {
  const { data, error } = await resolveClient(client)
    .from(table)
    .upsert(rows, { onConflict })
    .select();
  return throwOnError((data ?? []) as T[], error, "upsert", table);
}

/**
 * listRows returns matching rows with optional filter, order, and limit.
 * Default order is created_at descending when orderBy is omitted by the caller.
 */
export async function listRows<T extends Record<string, unknown>>(
  table: string,
  query: ListQuery = {},
  client?: SupabaseClient,
): Promise<T[]> {
  const orderBy = query.orderBy ?? "created_at";
  const ascending = query.ascending ?? false;

  let builder = resolveClient(client).from(table).select("*");
  builder = applyFilter(builder, query.filter);
  builder = builder.order(orderBy, { ascending });
  if (typeof query.limit === "number") {
    builder = builder.limit(query.limit);
  }

  const { data, error } = await builder;
  return throwOnError((data ?? []) as T[], error, "list", table);
}

/**
 * getRow returns the first row matching filter, or null when none match.
 * Uses `.maybeSingle()` so zero matches are not treated as a PostgREST error.
 */
export async function getRow<T extends Record<string, unknown>>(
  table: string,
  filter: RowFilter,
  client?: SupabaseClient,
): Promise<T | null> {
  let builder = resolveClient(client).from(table).select("*");
  builder = applyFilter(builder, filter);
  const { data, error } = await builder.maybeSingle();
  return throwOnError(data as T | null, error, "get", table);
}

/**
 * updateRows patches every row matching filter and returns the updated records.
 * Callers must supply a non-empty filter so updates cannot touch the whole table.
 */
export async function updateRows<T extends Record<string, unknown>>(
  table: string,
  filter: RowFilter,
  values: Record<string, unknown>,
  client?: SupabaseClient,
): Promise<T[]> {
  if (Object.keys(filter).length === 0) {
    throw new Error(`Supabase update on "${table}" requires a non-empty filter.`);
  }
  let builder = resolveClient(client).from(table).update(values);
  builder = applyFilter(builder, filter);
  const { data, error } = await builder.select();
  return throwOnError((data ?? []) as T[], error, "update", table);
}

/**
 * deleteRows deletes every row matching filter and returns the deleted records.
 * Callers must supply a non-empty filter so deletes cannot wipe the whole table.
 */
export async function deleteRows<T extends Record<string, unknown>>(
  table: string,
  filter: RowFilter,
  client?: SupabaseClient,
): Promise<T[]> {
  if (Object.keys(filter).length === 0) {
    throw new Error(`Supabase delete on "${table}" requires a non-empty filter.`);
  }
  let builder = resolveClient(client).from(table).delete();
  builder = applyFilter(builder, filter);
  const { data, error } = await builder.select();
  return throwOnError((data ?? []) as T[], error, "delete", table);
}

/**
 * supabaseApi groups the CRUD helpers for `import { supabaseApi } from ...` usage.
 * Prefer named exports when tree-shaking a single helper into a small client bundle.
 */
export const supabaseApi = {
  insertRow,
  insertRows,
  upsertRows,
  listRows,
  getRow,
  updateRows,
  deleteRows,
};
