import { notFound } from 'next/navigation';
import type { Kind } from './domain';
export function sectionKind(section:string):Kind{const kind:Record<string,Kind>={leads:'lead',clientes:'customer',empresas:'company'};if(!kind[section])notFound();return kind[section];}
