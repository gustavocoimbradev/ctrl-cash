// The ONLY place that knows how API documents map to table columns.
import type { Collection, Doc } from './validate.js';

type Kind = 'text' | 'int' | 'bool' | 'date' | 'float' | 'json' | 'textarr';
interface Field {
  key: string; // JSON field (camelCase)
  col: string; // column (snake_case)
  kind: Kind;
}
export interface Mapper {
  table: string;
  fields: Field[];
  order: string; // deterministic ORDER BY
  toRow(doc: Doc): unknown[]; // values in the order of `fields`
  fromRow(row: Record<string, unknown>): Doc;
}

const f = (key: string, col: string, kind: Kind): Field => ({ key, col, kind });
const id = f('id', 'id', 'text');
const created = f('createdAt', 'created_at_ms', 'int');
const archived = f('archivedAt', 'archived_at_ms', 'int');
const source = f('source', 'source', 'text');

function mapper(table: string, fields: Field[], order: string): Mapper {
  return {
    table,
    fields,
    order,
    toRow(doc) {
      return fields.map(({ key, kind }) => {
        const v = doc[key];
        if (v === undefined || v === null) return null;
        return kind === 'json' ? JSON.stringify(v) : v;
      });
    },
    fromRow(row) {
      const doc: Doc = {};
      for (const { key, col, kind } of fields) {
        const v = row[col];
        if (v === null || v === undefined) continue; // optional fields are simply absent
        doc[key] = kind === 'int' ? Number(v) : v; // bigint comes back as a string from pg
      }
      return doc;
    },
  };
}

const byCreated = 'created_at_ms asc nulls last, id asc';
const byDate = 'date asc, id asc';

export const mappers: Record<Collection, Mapper> = {
  transactions: mapper('transactions', [
    id, f('type', 'type', 'text'), f('description', 'description', 'text'), f('amount', 'amount', 'int'),
    f('date', 'date', 'date'), f('confirmed', 'confirmed', 'bool'), f('fixed', 'fixed', 'bool'),
    f('confirmedMonths', 'confirmed_months', 'textarr'), f('cardId', 'card_id', 'text'),
    f('reserveId', 'reserve_id', 'text'), f('invoiceKey', 'invoice_key', 'text'), f('category', 'category', 'text'),
    f('installment', 'installment', 'json'), f('revisions', 'revisions', 'json'), f('overrides', 'overrides', 'json'),
    created, archived, source,
  ], byCreated),
  cards: mapper('cards', [
    id, f('name', 'name', 'text'), f('limit', 'credit_limit', 'int'), f('dueDay', 'due_day', 'int'),
    f('color', 'color', 'text'), created, archived, source,
  ], byCreated),
  payments: mapper('payments', [
    id, f('cardId', 'card_id', 'text'), f('invoiceKey', 'invoice_key', 'text'), f('amount', 'amount', 'int'),
    f('date', 'date', 'date'), archived, source,
  ], byDate),
  reserves: mapper('reserves', [id, f('name', 'name', 'text'), f('goal', 'goal', 'int'), created, archived], byCreated),
  reserveMoves: mapper('reserve_moves', [
    id, f('reserveId', 'reserve_id', 'text'), f('type', 'type', 'text'), f('amount', 'amount', 'int'),
    f('date', 'date', 'date'), f('confirmed', 'confirmed', 'bool'), created, archived,
  ], byDate),
  categories: mapper('categories', [
    id, f('slug', 'slug', 'text'), f('kind', 'kind', 'text'), f('name', 'name', 'text'),
    f('weight', 'weight', 'float'), f('tone', 'tone', 'text'), created, archived, source,
  ], byCreated),
  shoppingLists: mapper('shopping_lists', [
    id, f('name', 'name', 'text'), f('items', 'items', 'json'), f('finishedAt', 'finished_at_ms', 'int'), created, archived,
  ], byCreated),
  wishlist: mapper('wishlist', [
    id, f('name', 'name', 'text'), f('price', 'price', 'int'), f('url', 'url', 'text'), f('note', 'note', 'text'), f('boughtAt', 'bought_at_ms', 'int'), created, archived,
  ], byCreated),
};
