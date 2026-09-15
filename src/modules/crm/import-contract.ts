import type { RecordInput } from './domain';
// Contrato reservado para importadores CSV/Excel futuros. Sem parser ou importação ativa nesta fase.
export type ImportRow={line:number;input:RecordInput};
export type ImportOutcome={line:number;status:'imported'|'ignored'|'duplicate'|'error';recordId?:string;message:string};
export type ImportReport={imported:number;ignored:number;duplicates:number;errors:number;rows:ImportOutcome[]};
export interface LeadImportParser{parse(source:AsyncIterable<string>):AsyncIterable<ImportRow>;}
